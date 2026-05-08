# Sol Machine

Sol Machine is an autonomous RC racing and spectator-control project. It combines a physical camera-equipped racing car, computer vision line following, a betting/voting race interface, Solana devnet payment helpers, and an AI-assisted crowd strategy chat.

The active application lives in `Aedonys/Sol-Machine/`.

Older root-level folders such as `V2/`, `Submission/`, and `docs/` are reference snapshots unless you are specifically working on firmware or legacy UI files.

## What It Does

- Streams a live camera feed from the car setup.
- Connects to and controls Shell Racing Legends BLE cars.
- Runs autonomous line following with OpenCV or a small CNN backend.
- Lets spectators place race bets and vote for boost targets.
- Tracks race cycles, votes, bets, settlement, and payouts in a Node/SQLite backend.
- Lets spectators discuss car strategy; the Python hardware backend can summarize that discussion into a structured strategy with OpenAI and apply it to driving behavior.
- Bridges race-state boost decisions from the Node backend to the Python hardware backend so UI boost state and physical turbo can stay aligned.

## Architecture

```text
Aedonys/Sol-Machine/
|-- frontend/       Next.js public/admin UI, runs on port 3002
|-- backend/        Node/Express race, betting, SQLite, Solana helpers, runs on port 3001
|-- hardware/       Python/FastAPI BLE, camera, perception, boost, chat strategy, runs on port 3000
|-- training/       Frame collection and CNN training scripts
|-- solana/         Devnet scripts and token-related helpers
`-- docs/           Legacy/static UI reference
```

The frontend hides most of the split-backend setup through Next rewrites:

- `/api/car/*`, `/api/cars/*`, `/api/camera/*`, `/api/training/*`, `/api/boost/*`, and `/api/chat/*` proxy to the Python hardware backend.
- Other `/api/*` routes proxy to the Node race/betting backend.

The Node backend is the race authority. The Python backend is the hardware authority.

## Services

### Frontend

Path: `Aedonys/Sol-Machine/frontend`

Runs the public spectator page and admin page.

- Public UI: `http://localhost:3002/`
- Admin UI: `http://localhost:3002/admin`

### Race Backend

Path: `Aedonys/Sol-Machine/backend`

Owns:

- race cycle state: `idle`, `starting`, `voting`, `finalizing`, `boost`
- bet intents and confirmations
- vote intents and confirmations
- internal race-scoped boost voting credits
- race result intake and bet settlement
- SQLite persistence
- devnet SOL payment verification and payout helpers
- bridge call to Python `/boost/trigger` when a vote cycle enters boost

### Hardware Backend

Path: `Aedonys/Sol-Machine/hardware`

Owns:

- BLE car scan/connect/disconnect/control
- 20 Hz control packet writer
- camera ingest and MJPEG/debug streams
- OpenCV/CNN perception loop
- turbo/boost state
- training sample capture
- OpenAI-powered crowd strategy chat

## Prerequisites

- Node.js `20.18+`
- Python `3.11+`
- Bluetooth-capable laptop for BLE car control
- Raspberry Pi camera/go2rtc setup or a local webcam test mode
- Optional: Phantom wallet and Solana devnet configuration
- Optional: `OPENAI_API_KEY` for crowd strategy analysis

## Setup

Install frontend dependencies:

```powershell
cd Aedonys\Sol-Machine\frontend
npm install
```

Install race backend dependencies:

```powershell
cd Aedonys\Sol-Machine\backend
npm install
```

Create a Python environment for the hardware backend:

```powershell
cd Aedonys\Sol-Machine\hardware
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create local environment configuration:

```powershell
cd Aedonys\Sol-Machine
Copy-Item .env.example .env
```

Then edit `.env` for your hardware, camera, Solana, and OpenAI settings.

## Running Locally

Use three terminals.

Terminal 1, hardware backend:

```powershell
cd Aedonys\Sol-Machine\hardware
.\.venv\Scripts\Activate.ps1
python main.py
```

Default URL: `http://localhost:3000`

Terminal 2, race backend:

```powershell
cd Aedonys\Sol-Machine\backend
npm start
```

Default URL: `http://localhost:3001`

Terminal 3, frontend:

```powershell
cd Aedonys\Sol-Machine\frontend
npm run dev
```

Default URL: `http://localhost:3002`

## Important Environment Variables

Shared or integration:

- `RACE_BACKEND_URL`: Node-to-Python hardware backend URL. Defaults to `http://localhost:3000`.
- `AEDONYS_BACKEND_URL`: frontend rewrite target for the Node backend. Defaults to `http://localhost:3001`.
- `NEXT_PUBLIC_RACE_BACKEND`: browser-visible hardware backend URL for camera streaming. Defaults to `http://localhost:3000`.

Hardware/camera:

- `PORT`: Python hardware backend port. Defaults to `3000`.
- `PI_IP`: Raspberry Pi address.
- `GO2RTC_PORT`: go2rtc HTTP port. Defaults to `1984`.
- `RTSP_PORT`: go2rtc RTSP port. Defaults to `8554`.
- `RTSP_PATH`: RTSP stream path. Defaults to `camera`.
- `USE_LAPTOP_CAMERA`: set to `1` to use a local webcam.
- `LAPTOP_CAMERA_INDEX`: webcam index for local testing.

Perception:

- `PERCEPTION_BACKEND`: `opencv` or `cnn`.
- `PERCEPTION_HZ`: perception loop rate.
- `CAMERA_ROTATE_DEG`: `0`, `90`, `180`, or `270`.
- `OPENCV_THRESHOLD`, `OPENCV_ROI_TOP`, `OPENCV_DEADBAND`: OpenCV line follower tuning.
- `CNN_WEIGHTS_PATH`: optional path to CNN weights.

Boost and strategy:

- `BOOST_DURATION_SEC`: hardware boost duration.
- `OPENAI_API_KEY`: enables crowd strategy analysis.
- `CROWD_TRIGGER_N`: number of chat messages before strategy analysis. Defaults to `5`.

Race/backend:

- `PORT`: Node backend port when set in the backend process. Defaults to `3001`.
- `DB_PATH`: SQLite database path. Defaults to `./data/sol-machine.sqlite`.
- `APP_MODE`: `demo` or `devnet`.
- `DEMO_MODE`: set to `false` to require real verification paths.
- `AUTO_FAKE_RACE_RESULTS`: local helper for automatic mock race settlement.
- `ADMIN_TOKEN`: optional token required for admin endpoints outside relaxed local development.

Solana/devnet:

- `SOLANA_RPC_URL`: defaults to devnet.
- `SOLANA_CLUSTER`: defaults to `devnet`.
- `TREASURY_WALLET`: public treasury wallet for Node devnet SOL flows.
- `TREASURY_SECRET_KEY`: treasury private key for payouts.
- `TOKEN_SYMBOL`: display symbol, defaults to `BOOST`.
- `TOKEN_MINT`: optional token mint address.
- `SOLANA_TREASURY_PUBKEY`, `SOLANA_TREASURY_ATA`, `BOOST_TOKEN_MINT`, `BOOST_TOKEN_DECIMALS`: used by the hardware Solana listener/token flow.

## Core API Surfaces

Frontend routes through Next rewrites, so prefer `/api/...` from UI code.

Node race backend:

- `GET /api/config`
- `GET /api/cycle/current`
- `GET /api/cycle/result`
- `POST /api/race/start`
- `POST /api/bet-intent`
- `POST /api/bet-submit`
- `GET /api/bet/current?wallet=...`
- `GET /api/bet/latest-settled?wallet=...`
- `POST /api/vote-intent`
- `POST /api/vote-submit`
- `GET /api/boost-balance?wallet=...`
- `GET /api/boost-power/current`
- `POST /api/race/result`
- `POST /api/admin/reset-race`

Python hardware backend:

- `GET /health`
- `GET /cars/known`
- `POST /car/scan`
- `POST /car/connect`
- `POST /car/disconnect`
- `GET /car/status`
- `POST /car/autonomous`
- `POST /car/control`
- `POST /boost/trigger`
- `GET /boost/status`
- `GET /camera/info`
- `GET /camera/snapshot`
- `GET /camera/stream.mjpeg`
- `GET /camera/debug`
- `POST /training/sample`
- `GET /training/stats`
- `POST /training/clear`
- `POST /training/run`
- `POST /chat/message`
- `GET /chat/messages`
- `GET /chat/strategy`

## Validation

Frontend build:

```powershell
cd Aedonys\Sol-Machine\frontend
npm run build
```

Node syntax check:

```powershell
cd Aedonys\Sol-Machine\backend
node --check server.js
```

Python syntax check:

```powershell
cd Aedonys\Sol-Machine\hardware
python -m py_compile main.py crowd_agent.py boost.py solana_listener.py perception\base.py perception\opencv_line.py perception\cnn_line.py
```

## Current Design Notes

- Keep the Node and Python backends separate unless there is a strong reason to merge them.
- Node is responsible for authoritative race, betting, voting, and settlement state.
- Python is responsible for hardware, camera, perception, and physical boost execution.
- The current direct bridge is Node calling Python `/boost/trigger` when a vote cycle resolves into boost.
- The canonical Node settlement path is `recordRaceResultAndSettleBetsTx()`.
- Do not reintroduce separate settlement functions for manual/admin results.

## Known Limits

- Hardware behavior depends on BLE availability, car firmware, camera setup, and local network conditions.
- Crowd strategy is in-memory and requires `OPENAI_API_KEY`.
- Solana code is devnet/demo oriented.
- Public frontend currently focuses on winner-style betting, while backend support for trifecta settlement exists.
