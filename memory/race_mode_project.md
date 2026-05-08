---
name: Sol Machine project
description: Current project context for the consolidated Aedonys/Sol-Machine app
type: project
---

User is building "Sol Machine": a hackathon-style autonomous RC racing and betting experience that combines physical cars, camera/perception, spectator betting/voting, Solana/devnet flows, and now an AI-assisted crowd strategy layer.

Current active code lives under `Aedonys/Sol-Machine/`. Older root-level `V2/`, `Submission/`, and `docs/` files are reference/snapshot material unless the user explicitly asks about them.

## Current architecture

- `frontend/`: Next.js 14 app on port `3002`.
  - Public race page: `frontend/app/page.tsx`.
  - Admin page: `frontend/app/admin/page.tsx`.
  - API rewrites in `frontend/next.config.mjs`.
  - Public page includes live camera, car grid, betting/voting panel, status bar, and `ChatPanel`.
- `backend/`: Node/Express betting and race-state backend on port `3001`.
  - Main server: `backend/server.js`.
  - SQLite schema: `backend/schema.sql`.
  - Owns race cycles, bet intents/submits, vote intents/submits, fake race settlement, race result intake, and devnet SOL verification/payout helpers.
- `hardware/`: Python/FastAPI hardware backend on port `3000`.
  - Main server: `hardware/main.py`.
  - Owns BLE scan/connect/control, camera stream, autonomous perception loop, boost state, training endpoints, and crowd strategy endpoints.
  - `hardware/crowd_agent.py` stores per-car chat in memory and periodically asks OpenAI for a structured `CarStrategy`.
- `training/`: frame collection and training scripts for the CNN line follower.
- `solana/`: devnet scripts and placeholder token-related material.

## Current runtime flow

- Next proxies `/api/car/*`, `/api/cars/*`, `/api/camera/*`, `/api/training/*`, `/api/boost/*`, and `/api/chat/*` to the Python hardware backend.
- Next proxies remaining `/api/*` routes to the Node backend.
- Race states are `idle`, `starting`, `voting`, `finalizing`, and `boost`.
- Frontend supports three display/race cars: `Car 1`, `Car 2`, `Car 3`.
- Hardware BLE still connects to one physical car at a time. The connected car's BLE address is used as the key for crowd chat/strategy.
- Node is the race authority. When a voting cycle resolves into the `boost` state, Node calls the Python hardware backend's `/boost/trigger` endpoint so the physical car turbo matches the UI/race state.

## Crowd strategy feature

The latest consolidation added spectator chat and AI strategy extraction:

- `frontend/components/ChatPanel.tsx` lets users send strategy suggestions for the connected car.
- `hardware/crowd_agent.py` keeps per-car chat history and calls OpenAI after every `CROWD_TRIGGER_N` messages.
- Required env: `OPENAI_API_KEY`; optional env: `CROWD_TRIGGER_N` defaults to `5`.
- Model is currently hardcoded as `o4-mini`.
- Output schema is `CarStrategy`:
  - `throttle_aggressiveness`: number 0..1
  - `boost_usage`: `immediate` | `save_straights` | `hold_overtake`
  - `corner_behaviour`: `safe` | `normal` | `tight`
  - `risk_tolerance`: number 0..1
  - `reasoning`: string
- If `OPENAI_API_KEY` is absent, chat posting returns 503 and strategy defaults are served.

## How to apply

- Treat `Aedonys/Sol-Machine` as the active application root.
- Keep frontend/backend/hardware responsibilities separate.
- Do not redesign around the older root-level Race Mode plan unless the user asks.
- Preserve the Next rewrite split: physical/hardware endpoints to port `3000`, betting/race endpoints to port `3001`.
- Preserve the direct Node-to-Python boost bridge via `RACE_BACKEND_URL` rather than merging the backends.
- When changing crowd strategy, consider both UI state and its effect on the hardware perception/boost loops.
