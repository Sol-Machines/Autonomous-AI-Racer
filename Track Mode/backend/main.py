"""
Track Mode Backend — FastAPI server.

Provides:
  - BLE car scan/connect/control (from Agentic Cars)
  - Camera proxy (go2rtc on Pi or laptop webcam)
  - Track management (save/validate/clear)
  - Visual odometry (start/stop/calibrate/pose)
  - Race control (start/stop/status)
  - WebSocket /ws/track for real-time pose + track updates to ZapBox
"""

import asyncio
import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)
load_dotenv(Path(__file__).resolve().parent.parent / ".env.example", override=False)

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from bleak import BleakScanner, BleakClient

from visual_odom import VisualOdometry
from track_manager import TrackManager
from path_controller import PathController

try:
    import cv2
except Exception:
    cv2 = None

log = logging.getLogger("backend")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PORT = int(os.environ.get("PORT", "3000"))
PI_IP = os.environ.get("PI_IP", "172.20.10.2")
GO2RTC_PORT = int(os.environ.get("GO2RTC_PORT", "1984"))
GO2RTC_BASE = f"http://{PI_IP}:{GO2RTC_PORT}"
USE_LAPTOP_CAMERA = os.environ.get("USE_LAPTOP_CAMERA", "0").lower() in (
    "1", "true", "yes", "on"
)
LAPTOP_CAMERA_INDEX = int(os.environ.get("LAPTOP_CAMERA_INDEX", "0"))
LAPTOP_CAMERA_WIDTH = int(os.environ.get("LAPTOP_CAMERA_WIDTH", "1280"))
LAPTOP_CAMERA_HEIGHT = int(os.environ.get("LAPTOP_CAMERA_HEIGHT", "720"))
LAPTOP_CAMERA_FPS = max(1, int(os.environ.get("LAPTOP_CAMERA_FPS", "20")))
LAPTOP_CAMERA_JPEG_QUALITY = max(
    1, min(100, int(os.environ.get("LAPTOP_CAMERA_JPEG_QUALITY", "80")))
)
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

# BLE UUIDs (Shell Racing Legends)
CONTROL_CHAR_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"
BATTERY_CHAR_UUID = "00002a19-0000-1000-8000-00805f9b34fb"


# ---------------------------------------------------------------------------
# Singletons
# ---------------------------------------------------------------------------
class CarState:
    def __init__(self):
        self.ble_client: BleakClient | None = None
        self.connected: bool = False
        self.name: str = ""
        self.battery: int | None = None
        self.scanning: bool = False
        self.scanned_devices: list[dict] = []
        self.control = bytearray([1, 0, 0, 0, 0, 0, 0, 0])


class LaptopCamera:
    def __init__(self):
        self._cap = None
        self._lock = threading.Lock()

    def start(self):
        if cv2 is None:
            raise RuntimeError("OpenCV not installed")
        cap = cv2.VideoCapture(LAPTOP_CAMERA_INDEX)
        if not cap or not cap.isOpened():
            raise RuntimeError(f"Cannot open camera index {LAPTOP_CAMERA_INDEX}")
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, LAPTOP_CAMERA_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, LAPTOP_CAMERA_HEIGHT)
        cap.set(cv2.CAP_PROP_FPS, LAPTOP_CAMERA_FPS)
        self._cap = cap

    def stop(self):
        with self._lock:
            if self._cap is not None:
                self._cap.release()
                self._cap = None

    def is_ready(self) -> bool:
        return self._cap is not None

    def read_jpeg(self) -> bytes | None:
        if self._cap is None:
            return None
        with self._lock:
            ok, frame = self._cap.read()
            if not ok:
                return None
            ok, encoded = cv2.imencode(
                ".jpg", frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), LAPTOP_CAMERA_JPEG_QUALITY],
            )
            return encoded.tobytes() if ok else None


car = CarState()
laptop_camera = LaptopCamera()
vo = VisualOdometry()
track = TrackManager()
controller = PathController()

# Connected WebSocket clients for pose streaming
ws_clients: set[WebSocket] = set()

# Race state
race_running = False


# ---------------------------------------------------------------------------
# Background loops
# ---------------------------------------------------------------------------
async def ble_control_loop():
    """Write car control state at 20 Hz."""
    while True:
        if car.connected and car.ble_client and car.ble_client.is_connected:
            try:
                await car.ble_client.write_gatt_char(
                    CONTROL_CHAR_UUID, bytes(car.control), response=False
                )
            except Exception as exc:
                log.warning("BLE write failed: %s", exc)
                car.connected = False
                car.ble_client = None
                car.name = ""
                car.battery = None
                car.control = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
        await asyncio.sleep(1.0 / 20)


async def race_loop():
    """When racing, poll VO and feed the path controller at ~20 Hz."""
    global race_running
    while True:
        if not race_running:
            await asyncio.sleep(0.1)
            continue

        pose = vo.get_pose()
        if not pose["calibrated"]:
            await asyncio.sleep(0.1)
            continue

        track_info = track.nearest_point(pose["x"], pose["z"])
        ctrl = controller.compute(
            pose["x"], pose["z"], pose["heading"],
            pose["confidence"], track_info,
        )

        # Apply drift correction when marginally outside track
        if track_info and not track.is_within_bounds(pose["x"], pose["z"]):
            vo.apply_track_correction(track_info["x"], track_info["z"], weight=0.05)

        # Lap closure
        status = controller.get_status()
        if status["lap_count"] > 0 and track_info and track_info["progress"] < 0.05:
            vo.snap_to_start()

        # Write to car
        if car.connected:
            car.control[1] = ctrl["forward"]
            car.control[2] = ctrl["reverse"]
            car.control[3] = ctrl["left"]
            car.control[4] = ctrl["right"]
            car.control[5] = ctrl["lights"]
            car.control[6] = ctrl["turbo"]
            car.control[7] = ctrl["donut"]

        # Check if controller emergency-stopped
        if status["emergency_stopped"]:
            race_running = False
            car.control = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
            log.info("Race ended: %s", status["stop_reason"])

        await asyncio.sleep(1.0 / 20)


async def ws_pose_broadcast():
    """Push car pose to all connected WebSocket clients at ~10 Hz."""
    while True:
        if ws_clients and vo.get_status()["running"]:
            pose = vo.get_pose()
            status = controller.get_status()
            msg = json.dumps({
                "type": "pose",
                "pose": pose,
                "race": status,
            })
            dead = set()
            for ws in ws_clients:
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.add(ws)
            ws_clients -= dead
        await asyncio.sleep(0.1)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [
        asyncio.create_task(ble_control_loop()),
        asyncio.create_task(race_loop()),
        asyncio.create_task(ws_pose_broadcast()),
    ]
    print(f"Track Mode backend on port {PORT}")
    if USE_LAPTOP_CAMERA:
        try:
            laptop_camera.start()
            print(f"Using laptop camera (index={LAPTOP_CAMERA_INDEX})")
        except Exception as e:
            print(f"Laptop camera failed: {e}")
    else:
        print(f"Pi camera at {GO2RTC_BASE}")
    yield
    for t in tasks:
        t.cancel()
    vo.stop()
    if car.ble_client and car.connected:
        try:
            await car.ble_client.disconnect()
        except Exception:
            pass
    if USE_LAPTOP_CAMERA:
        laptop_camera.stop()


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===========================  CAR ENDPOINTS  ===============================

@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/car/scan")
async def car_scan():
    if car.scanning:
        return JSONResponse({"error": "Already scanning"}, status_code=409)
    car.scanning = True
    try:
        devices = await BleakScanner.discover(timeout=10)
        found = []
        for d in devices:
            name = d.name or ""
            if name.startswith("SL-"):
                found.append({"name": name, "address": d.address})
        car.scanned_devices = found[:3]
        return {
            "cars": [
                {"number": i + 1, "name": c["name"], "address": c["address"]}
                for i, c in enumerate(car.scanned_devices)
            ]
        }
    finally:
        car.scanning = False


@app.post("/car/connect/{car_number}")
async def car_connect(car_number: int):
    if car.connected:
        return JSONResponse({"error": "Already connected"}, status_code=409)
    if car_number < 1 or car_number > len(car.scanned_devices):
        return JSONResponse({"error": "Invalid car number"}, status_code=400)

    device = car.scanned_devices[car_number - 1]
    try:
        client = BleakClient(device["address"])
        await client.connect()
        battery = None
        try:
            raw = await client.read_gatt_char(BATTERY_CHAR_UUID)
            battery = raw[0]
        except Exception:
            pass
        car.ble_client = client
        car.connected = True
        car.name = device["name"]
        car.battery = battery
        car.control = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
        return {"connected": True, "name": car.name, "battery": car.battery}
    except Exception as e:
        return JSONResponse({"error": f"Connect failed: {e}"}, status_code=500)


@app.post("/car/disconnect")
async def car_disconnect():
    if not car.connected:
        return JSONResponse({"error": "No car connected"}, status_code=409)
    try:
        if car.ble_client:
            await car.ble_client.disconnect()
    except Exception:
        pass
    car.connected = False
    car.ble_client = None
    car.name = ""
    car.battery = None
    car.control = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
    return {"connected": False}


class ControlInput(BaseModel):
    forward: int = 0
    reverse: int = 0
    left: int = 0
    right: int = 0
    lights: int = 0
    turbo: int = 0
    donut: int = 0


@app.post("/car/control")
async def car_control(inp: ControlInput):
    if not car.connected:
        return JSONResponse({"error": "No car connected"}, status_code=409)
    # Don't allow manual control during active race
    if race_running:
        return JSONResponse({"error": "Race in progress"}, status_code=409)
    car.control[1] = 1 if inp.forward else 0
    car.control[2] = 1 if inp.reverse else 0
    car.control[3] = 1 if inp.left else 0
    car.control[4] = 1 if inp.right else 0
    car.control[5] = 1 if inp.lights else 0
    car.control[6] = 1 if inp.turbo else 0
    car.control[7] = 1 if inp.donut else 0
    return {"ok": True}


@app.get("/car/status")
async def car_status():
    return {
        "connected": car.connected,
        "name": car.name,
        "battery": car.battery,
        "scanning": car.scanning,
    }


# ===========================  CAMERA ENDPOINTS  ===========================

@app.get("/camera/info")
async def camera_info():
    if USE_LAPTOP_CAMERA:
        return {"source": "laptop", "stream_url": None, "snapshot_url": None}
    return {
        "source": "pi",
        "pi_ip": PI_IP,
        "go2rtc_port": GO2RTC_PORT,
        "stream_url": f"http://{PI_IP}:{GO2RTC_PORT}/api/stream.mp4?src=camera",
        "snapshot_url": f"http://{PI_IP}:{GO2RTC_PORT}/api/frame.jpeg?src=camera",
    }


@app.get("/camera/snapshot")
async def camera_snapshot():
    if USE_LAPTOP_CAMERA:
        frame = laptop_camera.read_jpeg()
        if frame is None:
            return JSONResponse({"error": "Camera not ready"}, status_code=503)
        return Response(content=frame, media_type="image/jpeg")
    url = f"{GO2RTC_BASE}/api/frame.jpeg?src=camera"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return Response(content=resp.content, media_type="image/jpeg")
    except Exception:
        return JSONResponse({"error": f"Cannot get snapshot from {url}"}, status_code=503)


@app.get("/camera/stream")
async def camera_stream():
    if USE_LAPTOP_CAMERA:
        if not laptop_camera.is_ready():
            return JSONResponse({"error": "Camera not ready"}, status_code=503)

        async def gen():
            while True:
                frame = laptop_camera.read_jpeg()
                if frame:
                    yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
                await asyncio.sleep(1.0 / LAPTOP_CAMERA_FPS)

        return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")

    url = f"{GO2RTC_BASE}/api/stream.mp4?src=camera"
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10, read=None, write=None, pool=None)
    )
    try:
        req = client.build_request("GET", url)
        resp = await client.send(req, stream=True)
        ct = resp.headers.get("content-type", "video/mp4")
    except Exception:
        await client.aclose()
        return JSONResponse({"error": f"Cannot connect to {url}"}, status_code=503)

    async def gen():
        try:
            async for chunk in resp.aiter_bytes(chunk_size=4096):
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(gen(), media_type=ct)


# ===========================  TRACK ENDPOINTS  ============================

class TrackPointsInput(BaseModel):
    points: list[dict]


class TrackWidthInput(BaseModel):
    half_width: float


@app.post("/track/save")
async def track_save(inp: TrackPointsInput):
    track.set_points(inp.points)
    return {"ok": True, "point_count": len(track.raw_points)}


@app.post("/track/validate")
async def track_validate():
    result = track.validate()
    return result


@app.post("/track/clear")
async def track_clear():
    global race_running
    race_running = False
    controller.stop()
    track.clear()
    return {"ok": True}


@app.post("/track/set-width")
async def track_set_width(inp: TrackWidthInput):
    track.set_width(inp.half_width)
    return {"ok": True, "half_width": track.half_width}


@app.get("/track/data")
async def track_data():
    return track.get_data()


# ===========================  SLAM ENDPOINTS  =============================

class CalibrateInput(BaseModel):
    x: float
    z: float
    heading: float


@app.post("/slam/calibrate")
async def slam_calibrate(inp: CalibrateInput):
    vo.set_origin(inp.x, inp.z, inp.heading)
    return {"ok": True, "calibrated": True}


@app.post("/slam/start")
async def slam_start():
    vo.start()
    return {"ok": True}


@app.post("/slam/stop")
async def slam_stop():
    vo.stop()
    return {"ok": True}


@app.get("/slam/pose")
async def slam_pose():
    return vo.get_pose()


@app.get("/slam/status")
async def slam_status():
    return vo.get_status()


# ===========================  RACE ENDPOINTS  =============================

@app.post("/track/start-race")
async def track_start_race():
    global race_running
    if not track.valid:
        return JSONResponse({"error": "Track not validated"}, status_code=400)
    if not vo.get_status()["calibrated"]:
        return JSONResponse({"error": "Not calibrated"}, status_code=400)
    if not car.connected:
        return JSONResponse({"error": "No car connected"}, status_code=400)
    controller.start()
    race_running = True
    vo.start()
    return {"ok": True, "racing": True}


@app.post("/track/stop-race")
async def track_stop_race():
    global race_running
    race_running = False
    controller.stop()
    car.control = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
    return {"ok": True, "racing": False}


@app.get("/track/race-status")
async def track_race_status():
    return {
        "racing": race_running,
        **controller.get_status(),
        "vo": vo.get_status(),
    }


# ===========================  WEBSOCKET  ==================================

@app.websocket("/ws/track")
async def ws_track(websocket: WebSocket):
    await websocket.accept()
    ws_clients.add(websocket)
    log.info("WS client connected (%d total)", len(ws_clients))
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")
            if msg_type == "track_points":
                track.set_points(msg.get("points", []))
            elif msg_type == "track_validate":
                result = track.validate()
                await websocket.send_text(json.dumps({"type": "validation_result", **result}))
            elif msg_type == "track_clear":
                track.clear()
            elif msg_type == "track_set_width":
                track.set_width(msg.get("half_width", 0.15))
            elif msg_type == "calibrate":
                vo.set_origin(msg.get("x", 0), msg.get("z", 0), msg.get("heading", 0))
                await websocket.send_text(json.dumps({"type": "calibrated", "ok": True}))
            elif msg_type == "start_race":
                if track.valid and vo.get_status()["calibrated"] and car.connected:
                    global race_running
                    controller.start()
                    race_running = True
                    vo.start()
                    await websocket.send_text(json.dumps({"type": "race_started"}))
                else:
                    await websocket.send_text(json.dumps({"type": "error", "msg": "Not ready"}))
            elif msg_type == "stop_race":
                race_running = False
                controller.stop()
                car.control = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
                await websocket.send_text(json.dumps({"type": "race_stopped"}))
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.discard(websocket)
        log.info("WS client disconnected (%d remaining)", len(ws_clients))


# ===========================  STATIC FILES  ===============================

if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    index = os.path.join(STATIC_DIR, "index.html")
    if os.path.isfile(index):
        return FileResponse(index)
    return JSONResponse({"error": "Frontend not built"}, status_code=404)


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(name)-10s  %(message)s",
        datefmt="%H:%M:%S",
    )
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
