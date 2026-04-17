# Track Mode

Autonomous track-following for Shell Racing Legends cars using virtual tracks
drawn in ZapBox AR and monocular visual odometry for localization.

## How It Works

1. **Draw** a track in ZapBox AR (edit mode) — draw a closed loop on the floor
2. **Validate** the track — checks for closed loop, minimum turn radius, etc.
3. **Calibrate** — place the car at the start, mark its position and heading in ZapBox
4. **Race** — the car drives itself, staying within the virtual track boundaries

The car's camera stream is processed on the laptop using floor-plane visual
odometry (OpenCV ORB features + homography) to track the car's real-world
position, which is mapped into ZapBox's coordinate space via the calibration.

## Setup

### Prerequisites

- Raspberry Pi Zero 2 W with Pi Camera v3, running go2rtc
- Shell Racing Legends BLE car
- ZapBox headset
- Python 3.11+

### Backend (laptop)

```bash
cd backend
pip install -r requirements.txt
cp ../.env.example ../.env   # edit with your settings
python main.py
```

### Copilot (laptop, separate terminal)

```bash
cd copilot
pip install -r requirements.txt
python copilot.py
```

### ZapBox

Open `http://<laptop-ip>:8080` in the ZapBox browser, tap "Enter XR".

## Configuration

See `.env.example` for all settings. Key values to measure:

- `CAMERA_HEIGHT_CM` — distance from camera lens to floor (~8-10cm)
- `CAMERA_TILT_DEG` — camera angle from horizontal (~10-20 degrees)
- `PI_IP` — your Pi's IP address on the local network
