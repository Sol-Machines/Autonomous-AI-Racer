# Race Mode

AI-driven Shell Racing Legends car that follows a black-tape track, streams
its camera over WebRTC, and accepts speed boosts paid for in $BOOST tokens
on Solana devnet.

## How it works

1. The Pi runs `go2rtc` and streams its camera feed over WebRTC.
2. The laptop backend pulls frames, runs them through a perception module
   (OpenCV line-follower or a tiny CNN — selectable at runtime), and
   produces steering decisions.
3. A 20 Hz control loop merges those steering decisions with the current
   boost state and writes an 8-byte BLE packet to the car.
4. Spectators open a web page, watch the WebRTC stream, connect Phantom
   on devnet, and send $BOOST tokens. The backend's Solana listener
   translates each transfer into a temporary turbo boost.

## Layout

```
Race Mode/
├── backend/                 Laptop-side: BLE, AI loop, Solana, WS server
│   ├── main.py              FastAPI app + 20 Hz control loop
│   ├── perception/          Pluggable perception backends
│   │   ├── base.py
│   │   ├── opencv_line.py   Threshold + centroid line follower
│   │   └── cnn_line.py      Tiny CNN inference (loads exported weights)
│   ├── boost.py             Turbo timer state machine
│   └── solana_listener.py   Watches devnet treasury for $BOOST transfers
├── frontend/                Spectator web page (WebRTC + Phantom)
├── training/                Offline: record frames, train tiny CNN
└── solana/                  Scripts to mint $BOOST on devnet
```

## Setup

### Prerequisites

- Raspberry Pi Zero 2 W with Pi Camera v3, running `go2rtc` (see
  `Shell-Racing-Legends-Car-Control/pi/setup.sh`).
- Shell Racing Legends BLE car.
- Laptop with Bluetooth (the laptop holds the BLE connection, not the Pi).
- Python 3.11+.

### Backend (laptop)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env   # edit values
python main.py
```

## Configuration

See `.env.example` for all settings. Key values:

- `PI_IP` — your Pi's IP on the local network.
- `PERCEPTION_BACKEND` — `opencv` or `cnn`.
- `CAMERA_ROTATE_DEG` — `0`, `90`, `180`, `270` if the camera is mounted
  rotated.
- `SOLANA_TREASURY_PUBKEY` — the wallet that receives $BOOST transfers.

## Status

Skeleton stage — perception, boost manager, and BLE control loop are in
place. Solana listener and frontend are stubs.
