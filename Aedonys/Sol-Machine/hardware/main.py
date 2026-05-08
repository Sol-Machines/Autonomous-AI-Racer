"""Race Mode backend.

Runs on the laptop. Holds the BLE connection to the Shell Racing Legends
car, pulls camera frames from the Pi's go2rtc instance (or the local
webcam in test mode), runs them through the configured perception
backend, and writes BLE control packets at 20 Hz. The current turbo
state is driven by the BoostManager, which is poked by the Solana
listener (or by manual test endpoints).
"""

from __future__ import annotations

import asyncio
import csv
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
import numpy as np
from bleak import BleakClient, BleakScanner
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

from boost import BoostEvent, BoostManager
from crowd_agent import CarStrategy, CrowdAgent
from perception import Perception, SteeringIntent
from perception.opencv_line import OpenCVLineFollower
from perception.cnn_line import CNNLineFollower
from solana_listener import SolanaListener

log = logging.getLogger("race")

# ── Config ──────────────────────────────────────────────────────────────────

PORT = int(os.environ.get("PORT", "3000"))
PI_IP = os.environ.get("PI_IP", "172.20.10.2")
GO2RTC_PORT = int(os.environ.get("GO2RTC_PORT", "1984"))
RTSP_PORT = int(os.environ.get("RTSP_PORT", "8554"))
RTSP_PATH = os.environ.get("RTSP_PATH", "camera")
RTSP_TRANSPORT = os.environ.get("RTSP_TRANSPORT", "tcp")
RTSP_URL = os.environ.get("RTSP_URL", f"rtsp://{PI_IP}:{RTSP_PORT}/{RTSP_PATH}")
GO2RTC_BASE = f"http://{PI_IP}:{GO2RTC_PORT}"
# Maximum age (seconds) before a cached frame is considered stale and the
# perception loop refuses to drive on it.
FRAME_STALE_SEC = float(os.environ.get("FRAME_STALE_SEC", "1.0"))

USE_LAPTOP_CAMERA = os.environ.get("USE_LAPTOP_CAMERA", "0").lower() in (
    "1", "true", "yes", "on",
)
LAPTOP_CAMERA_INDEX = int(os.environ.get("LAPTOP_CAMERA_INDEX", "0"))

PERCEPTION_BACKEND = os.environ.get("PERCEPTION_BACKEND", "opencv").lower()
PERCEPTION_HZ = max(1, int(os.environ.get("PERCEPTION_HZ", "10")))
CAMERA_ROTATE_DEG = int(os.environ.get("CAMERA_ROTATE_DEG", "0"))

OPENCV_THRESHOLD = int(os.environ.get("OPENCV_THRESHOLD", "80"))
OPENCV_ROI_TOP = float(os.environ.get("OPENCV_ROI_TOP", "0.55"))
OPENCV_DEADBAND = float(os.environ.get("OPENCV_DEADBAND", "0.12"))
CNN_WEIGHTS_PATH = os.environ.get(
    "CNN_WEIGHTS_PATH",
    str(Path(__file__).resolve().parent.parent / "training" / "exports" / "line_follower.pt"),
)

MJPEG_QUALITY = int(os.environ.get("MJPEG_QUALITY", "25"))
MJPEG_WIDTH   = int(os.environ.get("MJPEG_WIDTH",   "640"))   # 0 = no resize

BOOST_DURATION_SEC = float(os.environ.get("BOOST_DURATION_SEC", "3.0"))

SOLANA_RPC_URL = os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")
SOLANA_TREASURY_PUBKEY = os.environ.get("SOLANA_TREASURY_PUBKEY", "")
# The treasury Associated Token Account for $BOOST. Either set this directly
# (from the mint.ts output) or leave blank and the listener will resolve it
# via getTokenAccountsByOwner using SOLANA_TREASURY_PUBKEY + BOOST_TOKEN_MINT.
SOLANA_TREASURY_ATA = os.environ.get("SOLANA_TREASURY_ATA", "")
BOOST_TOKEN_MINT = os.environ.get("BOOST_TOKEN_MINT", "")
BOOST_TOKEN_DECIMALS = int(os.environ.get("BOOST_TOKEN_DECIMALS", "0"))

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
CROWD_TRIGGER_N = int(os.environ.get("CROWD_TRIGGER_N", "5"))

# Shell Racing Legends BLE protocol
CONTROL_CHAR_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"
BATTERY_CHAR_UUID = "00002a19-0000-1000-8000-00805f9b34fb"
NAME_PREFIX = "SL-"
CONTROL_HZ = 20

# Known cars — shown in the frontend picker without needing a scan.
KNOWN_CARS = [
    {"name": "330 P4 (1967)", "address": "0A:C0:31:25:0F:60"},
    {"name": "Daytona",       "address": "0A:C0:31:24:F5:B5"},
    {"name": "F1",            "address": "0A:C0:31:24:F9:C1"},
]

STATIC_DIR = Path(__file__).resolve().parent / "static"


# ── Car state ────────────────────────────────────────────────────────────────

class CarState:
    def __init__(self) -> None:
        self.ble_client: BleakClient | None = None
        self.connected: bool = False
        self.name: str = ""
        self.address: str = ""
        self.battery: int | None = None
        self.scanning: bool = False
        # Byte 0 is the protocol mode (always 1). Bytes 1-7 are the
        # forward/reverse/left/right/lights/turbo/donut bits.
        self.control: bytearray = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
        self.autonomous: bool = False
        self.last_intent: SteeringIntent | None = None
        self.strategy: CarStrategy = CarStrategy()


car = CarState()
boost = BoostManager(default_duration_s=BOOST_DURATION_SEC)

# Instantiate crowd agent (disabled gracefully if no API key).
if OPENAI_API_KEY:
    crowd_agent: CrowdAgent | None = CrowdAgent(
        api_key=OPENAI_API_KEY,
        model="o4-mini",
        trigger_n=CROWD_TRIGGER_N,
    )
    log.info("CrowdAgent ready (model=o4-mini, trigger_n=%d)", CROWD_TRIGGER_N)
else:
    crowd_agent = None
    log.info("CrowdAgent disabled — set OPENAI_API_KEY in .env to enable")


# ── Perception backend selection ─────────────────────────────────────────────

def build_perception() -> Perception:
    if PERCEPTION_BACKEND == "opencv":
        return OpenCVLineFollower(
            threshold=OPENCV_THRESHOLD,
            roi_top=OPENCV_ROI_TOP,
            deadband=OPENCV_DEADBAND,
        )
    if PERCEPTION_BACKEND == "cnn":
        return CNNLineFollower(weights_path=CNN_WEIGHTS_PATH)
    raise ValueError(f"Unknown PERCEPTION_BACKEND: {PERCEPTION_BACKEND!r}")


perception: Perception = build_perception()


# ── Frame source ─────────────────────────────────────────────────────────────

class FrameSource:
    """Persistent video capture in a background thread.

    `cv2.VideoCapture.read()` is blocking, so a daemon thread holds the
    capture and continuously stashes the latest decoded frame in a
    thread-safe slot. Async readers grab the slot in O(1) — no network
    round trip per frame.

    Source selection:
      USE_LAPTOP_CAMERA=1 → local webcam (testing without the Pi)
      otherwise          → RTSP over TCP from the Pi's go2rtc
    """

    def __init__(self) -> None:
        self._cap: cv2.VideoCapture | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._latest: np.ndarray | None = None
        self._latest_at: float = 0.0
        self._latest_jpeg: bytes | None = None
        self._latest_jpeg_seq: int = 0
        self._url: str = ""
        self._reads_ok: int = 0
        self._reads_failed: int = 0
        self._reconnects: int = 0

    def _open(self) -> cv2.VideoCapture:
        if USE_LAPTOP_CAMERA:
            self._url = f"webcam:{LAPTOP_CAMERA_INDEX}"
            cap = cv2.VideoCapture(LAPTOP_CAMERA_INDEX)
        else:
            # FFmpeg flags must be set before opening the capture.
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                f"rtsp_transport;{RTSP_TRANSPORT}|"
                "fflags;nobuffer|"
                "flags;low_delay|"
                "max_delay;0"
            )
            self._url = RTSP_URL
            cap = cv2.VideoCapture(self._url, cv2.CAP_FFMPEG)
        if not cap or not cap.isOpened():
            raise RuntimeError(f"Cannot open {self._url}")
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        return cap

    async def start(self) -> None:
        self._stop.clear()
        try:
            self._cap = self._open()
            log.info("FrameSource: %s opened", self._url)
        except Exception as exc:
            log.warning("FrameSource: initial open failed (%s) — will retry in reader thread", exc)
        self._thread = threading.Thread(
            target=self._reader, daemon=True, name="frame-reader",
        )
        self._thread.start()

    async def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None
        if self._cap:
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None

    def _reader(self) -> None:
        consec_fail = 0
        while not self._stop.is_set():
            cap = self._cap
            if cap is None:
                try:
                    self._cap = self._open()
                    self._reconnects += 1
                    log.info("FrameSource: %s opened", self._url)
                except Exception:
                    time.sleep(2.0)
                continue
            try:
                ok, frame = cap.read()
            except Exception as exc:
                log.warning("FrameSource: read raised %s", exc)
                ok, frame = False, None
            if not ok or frame is None:
                self._reads_failed += 1
                consec_fail += 1
                if consec_fail >= 10:
                    log.warning(
                        "FrameSource: %d consecutive read failures — reconnecting to %s",
                        consec_fail, self._url,
                    )
                    try:
                        cap.release()
                    except Exception:
                        pass
                    try:
                        self._cap = self._open()
                        self._reconnects += 1
                    except Exception as exc:
                        log.error("FrameSource: reopen failed: %s", exc)
                        time.sleep(1.0)
                    consec_fail = 0
                else:
                    time.sleep(0.05)
                continue
            consec_fail = 0
            self._reads_ok += 1
            frame = _rotate(frame, CAMERA_ROTATE_DEG)
            # Pre-encode display JPEG in the reader thread so the async
            # MJPEG endpoint just ships bytes without blocking the event loop.
            display = frame
            if MJPEG_WIDTH > 0 and frame.shape[1] > MJPEG_WIDTH:
                scale = MJPEG_WIDTH / frame.shape[1]
                display = cv2.resize(frame, (MJPEG_WIDTH, int(frame.shape[0] * scale)),
                                     interpolation=cv2.INTER_LINEAR)
            ok_j, buf = cv2.imencode(".jpg", display,
                                     [cv2.IMWRITE_JPEG_QUALITY, MJPEG_QUALITY])
            with self._lock:
                self._latest = frame
                self._latest_at = time.monotonic()
                if ok_j:
                    self._latest_jpeg = buf.tobytes()
                    self._latest_jpeg_seq += 1

    async def read_bgr(self) -> np.ndarray | None:
        with self._lock:
            return None if self._latest is None else self._latest.copy()

    def latest_age(self) -> float:
        with self._lock:
            return float("inf") if self._latest_at == 0 else time.monotonic() - self._latest_at

    def latest_jpeg(self) -> tuple[bytes | None, int]:
        with self._lock:
            return self._latest_jpeg, self._latest_jpeg_seq

    def stats(self) -> dict:
        return {
            "url": self._url,
            "reads_ok": self._reads_ok,
            "reads_failed": self._reads_failed,
            "reconnects": self._reconnects,
            "latest_age_s": (None if (a := self.latest_age()) == float("inf") else round(a, 3)),
        }


def _rotate(frame: np.ndarray, deg: int) -> np.ndarray:
    if deg == 0:
        return frame
    if deg == 90:
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    if deg == 180:
        return cv2.rotate(frame, cv2.ROTATE_180)
    if deg == 270:
        return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return frame


frame_source = FrameSource()


# ── Control loop (20 Hz BLE writer) ──────────────────────────────────────────

async def control_loop() -> None:
    """Writes the current control state to the car at 20 Hz."""
    period = 1.0 / CONTROL_HZ
    while True:
        # Apply boost: byte 6 (turbo) is 1 whenever a boost is active.
        car.control[6] = 1 if boost.is_active() else 0

        if car.connected and car.ble_client and car.ble_client.is_connected:
            try:
                await car.ble_client.write_gatt_char(
                    CONTROL_CHAR_UUID, bytes(car.control), response=False,
                )
            except Exception as exc:
                log.warning("BLE write failed, marking disconnected: %s", exc)
                car.connected = False
                car.ble_client = None
                car.name = ""
                car.battery = None
                car.control = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
        await asyncio.sleep(period)


# ── Perception loop (PERCEPTION_HZ) ──────────────────────────────────────────

_DEADBAND_MAP = {"safe": 0.20, "normal": 0.12, "tight": 0.06}


async def perception_loop() -> None:
    """Pulls frames, runs perception, updates car.control bits.

    Skips ticks when the latest frame is older than the strategy-adjusted
    stale threshold — a stalled video stream must not produce a stale
    steering command that keeps the car driving into a wall.
    """
    period = 1.0 / PERCEPTION_HZ
    while True:
        start = time.monotonic()
        try:
            if car.autonomous and car.connected:
                s = car.strategy
                stale_threshold = FRAME_STALE_SEC * (0.5 + s.risk_tolerance)
                if frame_source.latest_age() > stale_threshold:
                    car.control[1] = 0
                    car.control[2] = 0
                    car.control[3] = 0
                    car.control[4] = 0
                    car.last_intent = SteeringIntent.stop("stale frame")
                else:
                    # Apply corner behaviour to perception deadband dynamically.
                    if hasattr(perception, "deadband"):
                        perception.deadband = _DEADBAND_MAP.get(s.corner_behaviour, 0.12)
                    frame = await frame_source.read_bgr()
                    if frame is not None:
                        intent = perception.predict(frame)
                        # Apply throttle aggressiveness: gate forward on confidence.
                        conf_threshold = (1.0 - s.throttle_aggressiveness) * 0.6
                        if intent.forward and intent.confidence < conf_threshold:
                            intent = SteeringIntent.stop("conservative strategy")
                        car.last_intent = intent
                        car.control[1] = intent.forward
                        car.control[2] = intent.reverse
                        car.control[3] = intent.left
                        car.control[4] = intent.right
        except Exception as exc:
            log.exception("Perception tick failed: %s", exc)
        elapsed = time.monotonic() - start
        await asyncio.sleep(max(0.0, period - elapsed))


async def strategy_boost_loop() -> None:
    """Auto-fires boost when boost_usage=save_straights and the car has
    been going straight continuously for 10 consecutive perception ticks."""
    from collections import deque
    recent: deque = deque(maxlen=10)
    while True:
        await asyncio.sleep(0.5)
        if not car.autonomous or not car.connected:
            recent.clear()
            continue
        intent = car.last_intent
        if intent is not None:
            recent.append(intent)
        if (
            car.strategy.boost_usage in ("save_straights", "hold_overtake")
            and len(recent) == 10
            and all(i.forward and not i.left and not i.right for i in recent)
            and not boost.is_active()
        ):
            boost.trigger(BoostEvent(duration_s=BOOST_DURATION_SEC, source="strategy"))
            recent.clear()
            log.info("Strategy boost fired (save_straights)")


# ── Solana listener wiring ───────────────────────────────────────────────────

async def _on_boost(event: BoostEvent) -> None:
    boost.trigger(event)


solana = SolanaListener(
    rpc_url=SOLANA_RPC_URL,
    treasury_pubkey=SOLANA_TREASURY_PUBKEY,
    boost_mint=BOOST_TOKEN_MINT,
    treasury_ata=SOLANA_TREASURY_ATA,
    boost_duration_s=BOOST_DURATION_SEC,
    on_boost=_on_boost,
)


# ── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Race Mode backend on :%d", PORT)
    log.info("Perception: %s @ %d Hz", perception.name, PERCEPTION_HZ)
    log.info(
        "Camera source: %s",
        f"webcam index {LAPTOP_CAMERA_INDEX}" if USE_LAPTOP_CAMERA else RTSP_URL,
    )

    await frame_source.start()
    control_task = asyncio.create_task(control_loop())
    perception_task = asyncio.create_task(perception_loop())
    boost_strategy_task = asyncio.create_task(strategy_boost_loop())
    await solana.start()
    try:
        yield
    finally:
        await solana.stop()
        control_task.cancel()
        perception_task.cancel()
        boost_strategy_task.cancel()
        for task in (control_task, perception_task, boost_strategy_task):
            try:
                await task
            except asyncio.CancelledError:
                pass
        if car.ble_client and car.connected:
            try:
                await car.ble_client.disconnect()
            except Exception:
                pass
        await frame_source.stop()


# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True}


# ── Car endpoints ────────────────────────────────────────────────────────────

@app.get("/cars/known")
async def cars_known():
    return {"cars": KNOWN_CARS}


@app.post("/car/scan")
async def car_scan():
    if car.scanning:
        return JSONResponse({"error": "Already scanning"}, status_code=409)
    car.scanning = True
    try:
        devices = await BleakScanner.discover(timeout=10)
        found = [
            {"name": d.name, "address": d.address}
            for d in devices
            if d.name and d.name.startswith(NAME_PREFIX)
        ]
        return {"cars": found[:5]}
    finally:
        car.scanning = False


@app.post("/car/connect")
async def car_connect(payload: dict):
    address = payload.get("address")
    if not address:
        return JSONResponse({"error": "address required"}, status_code=400)
    if car.connected:
        return JSONResponse({"error": "Already connected"}, status_code=409)
    try:
        client = BleakClient(address)
        await client.connect()
        battery = None
        try:
            raw = await client.read_gatt_char(BATTERY_CHAR_UUID)
            battery = raw[0]
        except Exception:
            pass
        car.ble_client = client
        car.connected = True
        car.name = payload.get("name", "Unknown")
        car.address = address
        car.battery = battery
        car.control = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
        return {"connected": True, "name": car.name, "address": car.address, "battery": battery}
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/car/disconnect")
async def car_disconnect():
    if not car.connected:
        return JSONResponse({"error": "Not connected"}, status_code=409)
    try:
        if car.ble_client:
            await car.ble_client.disconnect()
    except Exception:
        pass
    car.connected = False
    car.ble_client = None
    car.name = ""
    car.address = ""
    car.battery = None
    car.autonomous = False
    car.control = bytearray([1, 0, 0, 0, 0, 0, 0, 0])
    return {"connected": False}


@app.get("/car/status")
async def car_status():
    intent = car.last_intent
    return {
        "connected": car.connected,
        "name": car.name,
        "address": car.address,
        "battery": car.battery,
        "autonomous": car.autonomous,
        "boost_active": boost.is_active(),
        "boost_remaining_s": round(boost.remaining(), 2),
        "perception": perception.name,
        "strategy": car.strategy.to_dict(),
        "last_intent": (
            None if intent is None
            else {
                "forward": intent.forward,
                "reverse": intent.reverse,
                "left": intent.left,
                "right": intent.right,
                "confidence": round(intent.confidence, 3),
                "reason": intent.reason,
            }
        ),
    }


class AutonomousInput(BaseModel):
    enabled: bool


@app.post("/car/autonomous")
async def car_autonomous(inp: AutonomousInput):
    car.autonomous = bool(inp.enabled)
    if not car.autonomous:
        # Stop the car when leaving autonomous mode.
        for i in range(1, 5):
            car.control[i] = 0
    return {"autonomous": car.autonomous}


class ControlInput(BaseModel):
    forward: int = 0
    reverse: int = 0
    left: int = 0
    right: int = 0
    lights: int = 0
    donut: int = 0


@app.post("/car/control")
async def car_control(inp: ControlInput):
    """Manual override. Has no effect while autonomous mode is on, since
    the perception loop overwrites bytes 1-4 every tick."""
    if not car.connected:
        return JSONResponse({"error": "Not connected"}, status_code=409)
    if car.autonomous:
        return JSONResponse({"error": "Autonomous mode active"}, status_code=409)
    car.control[1] = 1 if inp.forward else 0
    car.control[2] = 1 if inp.reverse else 0
    car.control[3] = 1 if inp.left else 0
    car.control[4] = 1 if inp.right else 0
    car.control[5] = 1 if inp.lights else 0
    car.control[7] = 1 if inp.donut else 0
    return {"ok": True}


# ── Boost endpoints ──────────────────────────────────────────────────────────

class BoostInput(BaseModel):
    duration_s: float | None = None
    source: str = "manual"


@app.post("/boost/trigger")
async def boost_trigger(inp: BoostInput):
    """Manual boost trigger — useful for demo and integration testing."""
    duration = inp.duration_s if inp.duration_s is not None else BOOST_DURATION_SEC
    boost.trigger(BoostEvent(duration_s=duration, source=inp.source))
    return {"active": boost.is_active(), "remaining_s": round(boost.remaining(), 2)}


@app.get("/boost/status")
async def boost_status():
    return {"active": boost.is_active(), "remaining_s": round(boost.remaining(), 2)}


# ── Camera endpoints ─────────────────────────────────────────────────────────

@app.get("/camera/info")
async def camera_info():
    if USE_LAPTOP_CAMERA:
        return {"source": "laptop", "stats": frame_source.stats()}
    return {
        "source": "pi",
        "pi_ip": PI_IP,
        "rtsp_url": RTSP_URL,
        "go2rtc_port": GO2RTC_PORT,
        "stream_url": f"{GO2RTC_BASE}/api/stream.mp4?src=camera",
        "webrtc_url": f"{GO2RTC_BASE}/api/ws?src=camera",
        "stats": frame_source.stats(),
    }


@app.get("/camera/snapshot")
async def camera_snapshot():
    frame = await frame_source.read_bgr()
    if frame is None:
        return JSONResponse({"error": "No frame"}, status_code=503)
    ok, encoded = cv2.imencode(".jpg", frame)
    if not ok:
        return JSONResponse({"error": "Encode failed"}, status_code=500)
    headers = {"X-Frame-Age-Ms": str(int(frame_source.latest_age() * 1000))}
    return Response(content=encoded.tobytes(), media_type="image/jpeg", headers=headers)


@app.get("/camera/stream.mjpeg")
async def camera_mjpeg():
    """MJPEG stream. Frames are pre-encoded in the reader thread; this
    generator just ships the bytes as soon as a new sequence number appears."""
    header = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
    tail   = b"\r\n"

    async def generate():
        last_seq = -1
        while True:
            jpeg, seq = frame_source.latest_jpeg()
            if jpeg is not None and seq != last_seq:
                last_seq = seq
                yield header + jpeg + tail
            else:
                await asyncio.sleep(0.005)  # 5 ms poll — yields control without busy-waiting

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.websocket("/camera/ws")
async def camera_ws(websocket: WebSocket):
    """Pull-based frame stream over WebSocket.

    Client sends any text message when it is ready for the next frame;
    server immediately responds with the latest pre-encoded JPEG bytes.
    Because the client drives the loop, there is no TCP queue accumulation —
    every frame delivered is the most recent one available.
    """
    await websocket.accept()
    try:
        while True:
            await websocket.receive_text()  # wait for "ready" signal
            # Spin briefly if the camera is still warming up.
            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                jpeg, _ = frame_source.latest_jpeg()
                if jpeg is not None:
                    await websocket.send_bytes(jpeg)
                    break
                await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.debug("camera_ws closed: %s", exc)


@app.get("/camera/debug")
async def camera_debug():
    """Live-updating HTML page — open in a browser for real-time tuning."""
    html = """<!DOCTYPE html>
<html>
<head>
  <title>Race Mode — Debug</title>
  <style>
    body{background:#111;color:#eee;font-family:monospace;margin:0;padding:12px}
    img{max-width:100%;display:block;image-rendering:pixelated;border:1px solid #333}
    h3{margin:0 0 8px}
    #info{margin-top:6px;font-size:13px;color:#9f9}
  </style>
</head>
<body>
  <h3>Perception Debug — <span id="fps">–</span> fps</h3>
  <img id="frame" src="/camera/debug.jpg">
  <div id="info">loading…</div>
  <script>
    const img=document.getElementById('frame');
    const info=document.getElementById('info');
    const fpsEl=document.getElementById('fps');
    let t0=Date.now(),frames=0;
    function refresh(){
      const url='/camera/debug.jpg?t='+Date.now();
      img.src=url;
    }
    img.onload=()=>{
      frames++;
      const now=Date.now();
      if(now-t0>=1000){fpsEl.textContent=(frames*1000/(now-t0)).toFixed(1);frames=0;t0=now;}
      fetch('/car/status').then(r=>r.json()).then(s=>{
        info.textContent=
          'intent: '+(s.last_intent?JSON.stringify(s.last_intent):'none')+
          '  boost: '+(s.boost_active?'ON '+s.boost_remaining_s+'s':'off');
      }).catch(()=>{});
      setTimeout(refresh,100);
    };
    img.onerror=()=>setTimeout(refresh,500);
    refresh();
  </script>
</body>
</html>"""
    return Response(content=html, media_type="text/html")


@app.get("/camera/debug.jpg")
async def camera_debug_jpg():
    """JPEG frame with perception overlay: ROI line, centroid dot, binary blend."""
    frame = await frame_source.read_bgr()
    if frame is None:
        return JSONResponse({"error": "No frame"}, status_code=503)
    intent = perception.predict(frame)
    h, w = frame.shape[:2]
    roi_y = int(h * OPENCV_ROI_TOP)

    # Draw ROI boundary and centre guide lines.
    cv2.line(frame, (0, roi_y), (w, roi_y), (0, 255, 255), 2)
    cv2.line(frame, (w // 2, 0), (w // 2, h), (0, 255, 255), 1)

    if PERCEPTION_BACKEND == "opencv":
        roi = frame[roi_y:, :]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, OPENCV_THRESHOLD, 255, cv2.THRESH_BINARY_INV)
        # Blend binary mask into the ROI region so tape is visible.
        binary_bgr = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
        frame[roi_y:, :] = cv2.addWeighted(frame[roi_y:, :], 0.55, binary_bgr, 0.45, 0)
        # Draw centroid dot if tape was found.
        moments = cv2.moments(binary)
        if moments["m00"] > 0:
            cx = int(moments["m10"] / moments["m00"])
            cy = int(moments["m01"] / moments["m00"]) + roi_y
            cv2.circle(frame, (cx, cy), 8, (0, 0, 255), -1)
            cv2.line(frame, (w // 2, cy), (cx, cy), (255, 80, 0), 2)

    age_ms = int(frame_source.latest_age() * 1000)
    label = f"{intent.reason}  conf={intent.confidence:.2f}  age={age_ms}ms"
    cv2.putText(frame, label, (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 2)
    ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return JSONResponse({"error": "Encode failed"}, status_code=500)
    return Response(content=encoded.tobytes(), media_type="image/jpeg")


# ── Training endpoints ───────────────────────────────────────────────────────

TRAINING_DATA_DIR = Path(__file__).resolve().parent.parent / "training" / "data"
_training_lock = threading.Lock()


class SampleInput(BaseModel):
    label: int  # 0=left  1=straight  2=right


@app.post("/training/sample")
async def training_sample(inp: SampleInput):
    """Grab the current camera frame and save it with the given label.

    Called by the frontend's REC mode every tick (5 Hz) with the label
    derived from whichever WASD keys are currently held.
    """
    if inp.label not in (0, 1, 2):
        return JSONResponse({"error": "label must be 0, 1, or 2"}, status_code=400)

    frame = await frame_source.read_bgr()
    if frame is None:
        return JSONResponse({"error": "No frame"}, status_code=503)

    frame_dir = TRAINING_DATA_DIR / "frames"
    label_csv = TRAINING_DATA_DIR / "labels.csv"

    with _training_lock:
        frame_dir.mkdir(parents=True, exist_ok=True)
        existing = sorted(frame_dir.glob("*.jpg"))
        idx = int(existing[-1].stem) + 1 if existing else 0

        fname = f"{idx:06d}.jpg"
        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            return JSONResponse({"error": "Encode failed"}, status_code=500)
        (frame_dir / fname).write_bytes(encoded.tobytes())

        write_header = not label_csv.exists()
        with open(label_csv, "a", newline="") as f:
            w = csv.writer(f)
            if write_header:
                w.writerow(["frame", "label"])
            w.writerow([fname, inp.label])

    return {"frame": fname, "label": inp.label, "idx": idx}


@app.get("/training/stats")
async def training_stats():
    """Return the current frame count broken down by label."""
    label_csv = TRAINING_DATA_DIR / "labels.csv"
    if not label_csv.exists():
        return {"total": 0, "left": 0, "straight": 0, "right": 0}
    counts = [0, 0, 0]
    with open(label_csv) as f:
        for row in csv.reader(f):
            if row[0] == "frame":
                continue
            try:
                counts[int(row[1])] += 1
            except (ValueError, IndexError):
                pass
    return {
        "total": sum(counts),
        "left": counts[0],
        "straight": counts[1],
        "right": counts[2],
    }


@app.post("/training/clear")
async def training_clear():
    """Delete all training frames and labels.csv."""
    frame_dir = TRAINING_DATA_DIR / "frames"
    label_csv = TRAINING_DATA_DIR / "labels.csv"
    deleted = 0
    with _training_lock:
        if frame_dir.exists():
            for f in frame_dir.glob("*.jpg"):
                f.unlink()
                deleted += 1
        if label_csv.exists():
            label_csv.unlink()
    return {"deleted_frames": deleted}


@app.post("/training/run")
async def training_run():
    """Kick off train.py in a subprocess and stream back the result.

    Runs in a thread so it doesn't block the event loop.
    """
    import subprocess
    train_script = Path(__file__).resolve().parent.parent / "training" / "train.py"
    python = Path(__file__).resolve().parent / ".venv" / "bin" / "python"
    if not train_script.exists():
        return JSONResponse({"error": "training/train.py not found"}, status_code=404)

    def _run():
        result = subprocess.run(
            [str(python), str(train_script)],
            capture_output=True, text=True, timeout=300,
        )
        return result

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, _run)
        output = (result.stdout + result.stderr).strip()
        lines  = [l for l in output.splitlines() if l.strip()]
        if result.returncode == 0:
            return {"ok": True, "message": lines[-1] if lines else "Done"}
        return JSONResponse({"ok": False, "message": output[-500:]}, status_code=500)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


# ── Chat / crowd strategy endpoints ─────────────────────────────────────────

class ChatMessageInput(BaseModel):
    car_address: str
    author: str
    text: str


@app.post("/chat/message")
async def chat_message(inp: ChatMessageInput):
    if not inp.text.strip():
        return JSONResponse({"error": "empty message"}, status_code=400)
    if not crowd_agent:
        return JSONResponse({"error": "CrowdAgent not configured (missing OPENAI_API_KEY)"}, status_code=503)
    msg = await crowd_agent.add_message(inp.car_address, inp.author.strip() or "Anonymous", inp.text.strip())
    return {
        "message": msg.to_dict(),
        "analyzing": crowd_agent.is_analyzing(inp.car_address),
    }


@app.get("/chat/messages")
async def chat_messages(car_address: str, limit: int = 50):
    if not crowd_agent:
        return {"messages": [], "analyzing": False}
    msgs = crowd_agent.get_messages(car_address, limit=limit)
    return {
        "messages": [m.to_dict() for m in msgs],
        "analyzing": crowd_agent.is_analyzing(car_address),
    }


@app.get("/chat/strategy")
async def chat_strategy(car_address: str):
    if not crowd_agent:
        return CarStrategy().to_dict() | {"analyzing": False}
    strategy = crowd_agent.get_strategy(car_address)
    # Apply the consensus strategy to the connected car if addresses match.
    if car.connected and car.address == car_address:
        car.strategy = strategy
    return strategy.to_dict() | {"analyzing": crowd_agent.is_analyzing(car_address)}


# ── Frontend config ──────────────────────────────────────────────────────────

@app.get("/config")
async def frontend_config():
    """Config values the spectator frontend needs at startup."""
    return {
        "pi_ip": PI_IP,
        "go2rtc_port": GO2RTC_PORT,
        "camera_rotate_deg": CAMERA_ROTATE_DEG,
        "solana_configured": bool(SOLANA_TREASURY_PUBKEY and BOOST_TOKEN_MINT),
        "solana_rpc_url": SOLANA_RPC_URL,
        "treasury_pubkey": SOLANA_TREASURY_PUBKEY,
        "boost_token_mint": BOOST_TOKEN_MINT,
        "boost_token_decimals": BOOST_TOKEN_DECIMALS,
        "boost_duration_s": BOOST_DURATION_SEC,
    }


# ── Static spectator page ─────────────────────────────────────────────────────

if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


# ── Entrypoint ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(name)-14s  %(message)s",
        datefmt="%H:%M:%S",
    )
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
