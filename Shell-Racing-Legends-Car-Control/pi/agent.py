#!/usr/bin/env python3
"""
Pi agent — bridges the backend server with the local car (BLE) and camera (go2rtc).

Connects *outbound* to the backend WebSocket so no inbound ports are needed
on the Pi beyond go2rtc's local API.

Environment variables:
    BACKEND_URL   e.g. ws://myserver:3000   (default: ws://localhost:3000)
    PI_TOKEN      shared secret              (default: changeme)
    GO2RTC_URL    local go2rtc               (default: ws://127.0.0.1:1984)
"""

import asyncio
import json
import os
import signal
import sys

try:
    import websockets
except ImportError:
    sys.exit("Missing 'websockets' package.  Install with:  pip install websockets")

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    sys.exit("Missing 'bleak' package.  Install with:  pip install bleak")


# ── Config ──────────────────────────────────────────────────────

BACKEND_URL = os.environ.get('BACKEND_URL', 'ws://localhost:3000')
PI_TOKEN = os.environ.get('PI_TOKEN', 'changeme')
GO2RTC_URL = os.environ.get('GO2RTC_URL', 'ws://127.0.0.1:1984')

CHAR_UUID = '0000fff1-0000-1000-8000-00805f9b34fb'
BATTERY_CHAR = '00002a19-0000-1000-8000-00805f9b34fb'
NAME_PREFIXES = ['SL-']
SCAN_TIMEOUT = 10          # seconds
CONTROL_HZ = 20
RECONNECT_DELAY = 3        # seconds


class PiAgent:
    def __init__(self):
        self.backend_ws = None
        self.ble_client = None
        self.car_connected = False
        self.car_name = ''
        self.control_state = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
        self.camera_sessions = {}   # clientId → (go2rtc_ws, relay_task)
        self.running = True

    # ── Send helper ─────────────────────────────────────────────

    async def send(self, msg):
        if self.backend_ws is not None:
            try:
                await self.backend_ws.send(json.dumps(msg))
            except websockets.ConnectionClosed:
                pass

    # ── Backend connection (auto-reconnect) ─────────────────────

    async def run_backend(self):
        ws_url = f'{BACKEND_URL}/ws/pi?token={PI_TOKEN}'
        while self.running:
            try:
                async with websockets.connect(ws_url) as ws:
                    self.backend_ws = ws
                    print(f'Connected to backend: {BACKEND_URL}')
                    async for raw in ws:
                        try:
                            await self.handle_message(json.loads(raw))
                        except json.JSONDecodeError:
                            pass
            except (websockets.ConnectionClosed, OSError) as exc:
                print(f'Backend lost ({exc}). Reconnecting in {RECONNECT_DELAY}s…')
            except Exception as exc:
                print(f'Backend error ({exc}). Reconnecting in {RECONNECT_DELAY}s…')
            finally:
                self.backend_ws = None
            await asyncio.sleep(RECONNECT_DELAY)

    # ── Incoming message dispatch ───────────────────────────────

    async def handle_message(self, msg):
        t = msg.get('type', '')
        if t == 'control':
            self.control_state[1] = 1 if msg.get('forward') else 0
            self.control_state[2] = 1 if msg.get('reverse') else 0
            self.control_state[3] = 1 if msg.get('left') else 0
            self.control_state[4] = 1 if msg.get('right') else 0
            self.control_state[5] = 1 if msg.get('lights') else 0
            self.control_state[6] = 1 if msg.get('turbo') else 0
            self.control_state[7] = 1 if msg.get('donut') else 0
        elif t == 'car/connect':
            asyncio.create_task(self.connect_car())
        elif t == 'car/disconnect':
            await self.disconnect_car()
        elif t == 'camera/offer':
            asyncio.create_task(self.start_camera_session(msg))
        elif t == 'camera/candidate':
            await self.forward_ice_candidate(msg)
        elif t == 'camera/stop':
            self.stop_camera_session(msg.get('clientId'))

    # ── Car BLE ─────────────────────────────────────────────────

    async def connect_car(self):
        if self.car_connected:
            return

        await self.send({
            'type': 'car/status', 'connected': False,
            'name': '', 'battery': None, 'scanning': True,
        })

        try:
            print('Scanning for Shell Racing cars…')
            devices = await BleakScanner.discover(timeout=SCAN_TIMEOUT)
            target = None
            for d in devices:
                if d.name and any(d.name.startswith(p) for p in NAME_PREFIXES):
                    target = d
                    break

            if target is None:
                print('No car found')
                await self.send({
                    'type': 'car/status', 'connected': False,
                    'name': '', 'battery': None, 'error': 'No car found',
                })
                return

            client = BleakClient(target.address)
            await client.connect()
            self.ble_client = client
            self.car_connected = True
            self.car_name = target.name or 'Unknown'

            battery = None
            try:
                raw = await client.read_gatt_char(BATTERY_CHAR)
                battery = raw[0]
            except Exception:
                pass

            print(f'Car connected: {self.car_name} (battery={battery})')
            await self.send({
                'type': 'car/status', 'connected': True,
                'name': self.car_name, 'battery': battery,
            })

        except Exception as exc:
            print(f'Car connect failed: {exc}')
            self.ble_client = None
            self.car_connected = False
            await self.send({
                'type': 'car/status', 'connected': False,
                'name': '', 'battery': None, 'error': str(exc),
            })

    async def disconnect_car(self):
        if self.ble_client:
            try:
                await self.ble_client.disconnect()
            except Exception:
                pass
            self.ble_client = None
        self.car_connected = False
        self.car_name = ''
        self.control_state = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
        print('Car disconnected')
        await self.send({
            'type': 'car/status', 'connected': False,
            'name': '', 'battery': None,
        })

    async def run_control(self):
        """Write BLE control packets at 20 Hz."""
        while self.running:
            if self.car_connected and self.ble_client:
                try:
                    if self.ble_client.is_connected:
                        await self.ble_client.write_gatt_char(
                            CHAR_UUID, bytes(self.control_state), response=False,
                        )
                    else:
                        raise Exception('BLE disconnected')
                except Exception:
                    print('BLE write failed — marking car disconnected')
                    self.car_connected = False
                    self.ble_client = None
                    await self.send({
                        'type': 'car/status', 'connected': False,
                        'name': '', 'battery': None,
                    })
            await asyncio.sleep(1.0 / CONTROL_HZ)

    # ── Camera signaling relay ──────────────────────────────────

    async def start_camera_session(self, msg):
        client_id = msg.get('clientId')
        if not client_id:
            return

        # Tear down any existing session for this client
        self.stop_camera_session(client_id)

        try:
            go2rtc_ws = await websockets.connect(
                f'{GO2RTC_URL}/api/ws?src=camera',
            )

            # Forward client's SDP offer to go2rtc
            await go2rtc_ws.send(json.dumps({
                'type': 'webrtc/offer',
                'value': msg['sdp'],
            }))

            task = asyncio.create_task(self._relay_go2rtc(client_id, go2rtc_ws))
            self.camera_sessions[client_id] = (go2rtc_ws, task)
            print(f'Camera session started for client {client_id[:8]}')

        except Exception as exc:
            print(f'Camera session failed for {client_id[:8]}: {exc}')

    async def _relay_go2rtc(self, client_id, go2rtc_ws):
        """Forward go2rtc answers & ICE candidates back to the client via backend."""
        try:
            async for raw in go2rtc_ws:
                msg = json.loads(raw)
                if msg['type'] == 'webrtc/answer':
                    await self.send({
                        'type': 'camera/answer',
                        'clientId': client_id,
                        'sdp': msg['value'],
                    })
                elif msg['type'] == 'webrtc/candidate':
                    await self.send({
                        'type': 'camera/candidate',
                        'clientId': client_id,
                        'candidate': msg['value'],
                    })
        except websockets.ConnectionClosed:
            pass
        except Exception as exc:
            print(f'Camera relay error ({client_id[:8]}): {exc}')
        finally:
            self.camera_sessions.pop(client_id, None)

    async def forward_ice_candidate(self, msg):
        client_id = msg.get('clientId')
        session = self.camera_sessions.get(client_id)
        if not session:
            return
        go2rtc_ws, _ = session
        try:
            await go2rtc_ws.send(json.dumps({
                'type': 'webrtc/candidate',
                'value': msg['candidate'],
            }))
        except websockets.ConnectionClosed:
            pass

    def stop_camera_session(self, client_id):
        session = self.camera_sessions.pop(client_id, None)
        if session:
            go2rtc_ws, task = session
            task.cancel()
            asyncio.ensure_future(go2rtc_ws.close())
            print(f'Camera session stopped for client {client_id[:8]}')

    # ── Main ────────────────────────────────────────────────────

    async def run(self):
        print('Pi agent starting…')
        print(f'  Backend : {BACKEND_URL}')
        print(f'  go2rtc  : {GO2RTC_URL}')
        await asyncio.gather(
            self.run_backend(),
            self.run_control(),
        )


def main():
    agent = PiAgent()

    def shutdown(*_):
        agent.running = False

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    asyncio.run(agent.run())


if __name__ == '__main__':
    main()
