# Sol Machine

## Judges Quick Intro

**Live deployment:** https://solmachines.wiktor.uk (hosted on **DigitalOcean**)

**One-line pitch:** Spectators pay a Solana SPL token (`$BOOST`) on devnet to physically turbo a self-driving RC car in real time, while an AI agent reads the spectator chat to update the car's driving strategy on the fly.

**Why it's interesting:**
- An on-chain `$BOOST` SPL transfer on Solana devnet causes a real-world physical action (BLE turbo packet to the RC car) within ~1–2 seconds via a `accountSubscribe` WebSocket subscription on the treasury ATA.
- A computer-vision-driven RC car (OpenCV or PyTorch CNN) follows a tape track autonomously, with **DAgger online learning** — human keyboard corrections during autonomous driving auto-retrain the CNN every 20 corrections and hot-reload weights with no restart.
- An OpenAI `o4-mini` "CrowdAgent" reads spectator chat every N messages and emits a structured `CarStrategy` (throttle aggressiveness, boost policy, etc.) that is applied live to the perception loop.

**Tech stack at a glance:** Solana devnet + `$BOOST` SPL token, Phantom Wallet, `@solana/web3.js`, `@solana/spl-token`, OpenAI `o4-mini`, PyTorch (TorchScript) + DAgger, OpenCV, Python FastAPI, `bleak` BLE, Node.js + Express + SQLite, Next.js + React + TypeScript + Tailwind, Raspberry Pi Zero 2 W + Pi Camera Module 3, `go2rtc` + RTSP/H.264, DigitalOcean for deployment, Claude Code as the primary AI dev tool.

**Live $BOOST token (Solana devnet):**
- Mint: `3rTR28PEaZRxGdXxsqAV7jQFjhB5v76bE2PqZv9rnCV9`
- Treasury: `CGKs9nAfT8GZFsk6Fr2MvYGaDdLqFc1P83rippv1Frmp`
- Decimals: `0` · Supply: 1,000,000 in treasury + 100,000 in faucet

**Where to look first (judges):**
1. Open https://solmachines.wiktor.uk to see the deployed spectator UI.
2. Read [`Aedonys/Sol-Machine/hardware/main.py`](Aedonys/Sol-Machine/hardware/main.py) — the FastAPI hub for BLE, perception, boost, Solana listener, DAgger, and chat.
3. Read [`Aedonys/Sol-Machine/hardware/solana_listener.py`](Aedonys/Sol-Machine/hardware/solana_listener.py) — the Solana → physical-action bridge.
4. Read [`Aedonys/Sol-Machine/hardware/crowd_agent.py`](Aedonys/Sol-Machine/hardware/crowd_agent.py) — the OpenAI structured-output strategy agent.
5. Read [`Aedonys/Sol-Machine/solana/mint.ts`](Aedonys/Sol-Machine/solana/mint.ts) and [`faucet.ts`](Aedonys/Sol-Machine/solana/faucet.ts) — token + faucet setup.

> Physical hardware (Pi + RC car) is **not** part of the deployed website — that is the live demo at the venue. The deployed site shows the spectator/admin UI, Solana payment flow, betting cycle, and chat agent, with the hardware backend stubbed when the car is not connected.

---

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

### Linux / macOS (bash)

Install frontend dependencies:

```bash
cd Aedonys/Sol-Machine/frontend
npm install
```

Install race backend dependencies:

```bash
cd Aedonys/Sol-Machine/backend
npm install
```

Create a Python environment for the hardware backend:

```bash
cd Aedonys/Sol-Machine/hardware
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Optional: install PyTorch (CPU build) only if you plan to use the CNN perception backend
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

Create local environment configuration:

```bash
cd Aedonys/Sol-Machine
cp .env.example .env
```

Then edit `.env` for your hardware, camera, Solana, and OpenAI settings.

### Windows (PowerShell)

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

### Linux / macOS (bash)

Terminal 1, hardware backend:

```bash
cd Aedonys/Sol-Machine/hardware
source .venv/bin/activate
python main.py
```

Default URL: `http://localhost:3000`

Terminal 2, race backend:

```bash
cd Aedonys/Sol-Machine/backend
npm start
```

Default URL: `http://localhost:3001`

Terminal 3, frontend:

```bash
cd Aedonys/Sol-Machine/frontend
npm run dev
```

Default URL: `http://localhost:3002`

> Tip: Backend boot takes ~30s while it tries the first RTSP connection. Requests are served normally during that window — it will retry in the background if the Pi/camera is offline.

### Windows (PowerShell)

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

## Solana Devnet Setup

The `$BOOST` SPL token is already deployed on devnet (see addresses in the [Judges Quick Intro](#judges-quick-intro)). To redeploy or run the faucet locally:

```bash
cd Aedonys/Sol-Machine/solana
npm install

# Mint a fresh $BOOST token (idempotent — re-running loads existing keypairs/mint from disk)
npm run mint

# Airdrop $BOOST to a Phantom wallet (devnet)
npm run faucet -- <PHANTOM_PUBKEY>
```

After minting, copy the printed mint/treasury addresses into your `.env` (`BOOST_TOKEN_MINT`, `SOLANA_TREASURY_PUBKEY`, `SOLANA_TREASURY_ATA`).

> Devnet airdrops are rate-limited per IP per day. If `solana airdrop` fails, top up keypairs manually at https://faucet.solana.com.

## Deployment

The spectator UI and Node backend are deployed on **DigitalOcean** at https://solmachines.wiktor.uk. The Python hardware backend runs locally next to the RC car at the demo venue (BLE + camera require physical hardware) and connects to the deployed services over the network.

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
- `POST /training/dagger_correction` — DAgger online correction (`{label: 0|1|2}` for left/straight/right)
- `POST /chat/message`
- `GET /chat/messages`
- `GET /chat/strategy`
- `WS /camera/ws` — pull-mode JPEG stream (client sends `"ready"`, server returns current frame). Eliminates TCP-buffer lag from MJPEG push streams.

## DAgger Online Learning

While the car drives autonomously with the CNN perception backend, pressing `A`/`W`/`D` in AUTO mode submits a human correction:

| Key | Label | Meaning |
|---|---|---|
| A | 0 | steer left |
| W | 1 | go straight |
| D | 2 | steer right |

Each correction saves the current frame + label to `training/data/` and applies a 400ms steering override. After `DAGGER_RETRAIN_EVERY` corrections (default 20), the CNN auto-retrains in the background via `train.py` and hot-reloads weights — no server restart required.

The driver UI (`hardware/static/index.html`) and admin console show live correction count and "Retraining…" / "Model updated ✓" status.

## Demo Walkthrough (for judges)

1. **Spectator flow (deployed):** Open https://solmachines.wiktor.uk, connect Phantom (devnet), and observe the live race cycle and BOOST button.
2. **Solana payment → physical action:** A click on BOOST sends 1 `$BOOST` SPL token to the treasury ATA. The Python `SolanaListener` watches the ATA via `accountSubscribe` WebSocket and triggers a turbo packet over BLE to the RC car within ~1–2 seconds.
3. **Crowd-driven AI strategy:** Type messages in the chat panel — every `CROWD_TRIGGER_N` messages the OpenAI `o4-mini` agent re-reads the chat and emits a structured `CarStrategy` JSON applied to the live perception loop.
4. **Online learning (admin console):** With perception set to `cnn`, drift the car off the line, press `A`/`D` to correct — watch the DAgger counter increment and the model hot-reload after 20 corrections.
5. **Perception tuning:** `http://localhost:3000/camera/debug` shows the live binary threshold, ROI, and centroid overlay used by the OpenCV backend.

## Validation

### Linux / macOS (bash)

Frontend build:

```bash
cd Aedonys/Sol-Machine/frontend
npm run build
```

Node syntax check:

```bash
cd Aedonys/Sol-Machine/backend
node --check server.js
```

Python syntax check:

```bash
cd Aedonys/Sol-Machine/hardware
python -m py_compile main.py crowd_agent.py boost.py solana_listener.py perception/base.py perception/opencv_line.py perception/cnn_line.py
```

### Windows (PowerShell)

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
