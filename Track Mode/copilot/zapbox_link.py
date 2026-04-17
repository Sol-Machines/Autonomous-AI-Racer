"""
Zapbox Controller Server — serves controller.html and accepts WebSocket
connections from the ZapBox browser for manual driving input.

Identical to the Agentic Cars version but serves the Track Mode controller.html.
"""

import asyncio
import json
import logging
import os
import time

from aiohttp import web

log = logging.getLogger("zapbox")

ZAPBOX_PORT = int(os.getenv("ZAPBOX_PORT", "8080"))
INACTIVITY_SEC = float(os.getenv("INACTIVITY_SEC", "3.0"))
JOYSTICK_THRESHOLD = float(os.getenv("JOYSTICK_THRESHOLD", "0.30"))
TILT_THRESHOLD = float(os.getenv("TILT_THRESHOLD", "15.0"))

CONTROLLER_HTML = os.path.join(
    os.path.dirname(__file__), "..", "zapbox", "controller.html"
)

ZERO = dict(forward=0, reverse=0, left=0, right=0, lights=0, turbo=0, donut=0)


class ZapboxLink:
    def __init__(self):
        self.connected = False
        self.running = True
        self.port = ZAPBOX_PORT
        self._control: dict = dict(ZERO)
        self._last_movement: float = 0.0
        self._msg_count: int = 0
        self._prev_fwd: float = 0.0
        self._prev_steer: float = 0.0

    def is_active(self) -> bool:
        if not self.connected:
            return False
        return (time.time() - self._last_movement) < INACTIVITY_SEC

    def get_control(self) -> dict:
        return dict(self._control)

    def _process(self, msg: dict):
        if "joystick" in msg:
            self._process_joystick(msg)
        else:
            self._process_gyro(msg)

    def _process_joystick(self, msg: dict):
        joy = msg.get("joystick", {})
        toggles = msg.get("toggles", {})
        fwd = float(joy.get("forward", 0.0))
        steer = float(joy.get("steer", 0.0))

        self._control = dict(
            forward=1 if fwd > JOYSTICK_THRESHOLD else 0,
            reverse=1 if fwd < -JOYSTICK_THRESHOLD else 0,
            left=1 if steer < -JOYSTICK_THRESHOLD else 0,
            right=1 if steer > JOYSTICK_THRESHOLD else 0,
            lights=1 if toggles.get("lights") else 0,
            turbo=1 if toggles.get("turbo") else 0,
            donut=1 if toggles.get("donut") else 0,
        )

        if abs(fwd - self._prev_fwd) > 0.05 or abs(steer - self._prev_steer) > 0.05:
            self._last_movement = time.time()
        self._prev_fwd = fwd
        self._prev_steer = steer

    def _process_gyro(self, msg: dict):
        rot = msg.get("rotation", {})
        buttons = msg.get("buttons", {})
        p = rot.get("pitch", 0.0)
        r = rot.get("roll", 0.0)

        self._control = dict(
            forward=1 if p > TILT_THRESHOLD else 0,
            reverse=1 if p < -TILT_THRESHOLD else 0,
            left=1 if r < -TILT_THRESHOLD else 0,
            right=1 if r > TILT_THRESHOLD else 0,
            lights=1 if buttons.get("lights") else 0,
            turbo=1 if buttons.get("turbo") else 0,
            donut=1 if buttons.get("donut") else 0,
        )
        self._last_movement = time.time()

    def _reset(self):
        self._control = dict(ZERO)
        self._prev_fwd = 0.0
        self._prev_steer = 0.0

    async def _handle_index(self, _request):
        return web.FileResponse(CONTROLLER_HTML)

    async def _handle_ws(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        log.info("Controller connected from %s", request.remote or "unknown")
        self.connected = True
        self._reset()
        self._last_movement = time.time()
        try:
            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                    except json.JSONDecodeError:
                        continue
                    if data.get("type") == "controller_state":
                        self._process(data)
                elif msg.type == web.WSMsgType.ERROR:
                    break
        finally:
            self.connected = False
            self._reset()
            log.info("Controller disconnected")
        return ws

    async def run(self):
        app = web.Application()
        app.router.add_get("/", self._handle_index)
        app.router.add_get("/ws", self._handle_ws)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", self.port)
        await site.start()
        log.info("Zapbox server on 0.0.0.0:%d", self.port)
        try:
            while self.running:
                await asyncio.sleep(0.5)
        finally:
            await runner.cleanup()
