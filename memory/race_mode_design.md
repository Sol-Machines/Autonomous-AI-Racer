---
name: Sol Machine design decisions
description: Current design decisions for Aedonys/Sol-Machine, including hardware, betting, and crowd strategy
type: project
---

Decisions and implementation state as of 2026-05-08:

## Architecture

- Active project root is `Aedonys/Sol-Machine/`.
- Frontend is Next.js on port `3002`.
- Betting/race-state backend is Node/Express on port `3001`.
- Hardware/car backend is Python/FastAPI on port `3000`.
- Next rewrites split API traffic:
  - `/api/car`, `/api/cars`, `/api/camera`, `/api/training`, `/api/boost`, `/api/chat` -> Python hardware backend.
  - other `/api/*` -> Node betting backend.
- Node also has a server-side bridge to the Python hardware backend via `RACE_BACKEND_URL` for physical boost triggers.

## Perception and car control

- Perception stays pluggable behind the `Perception` protocol:
  - `opencv_line.py`: threshold + centroid line follower.
  - `cnn_line.py`: tiny CNN inference from training exports.
- Backend selection remains `PERCEPTION_BACKEND=opencv|cnn`.
- Laptop owns BLE and CV/CNN work; Pi/go2rtc remains the camera source.
- BLE control packet is still 8 bytes; turbo is byte 6.
- Autonomous loop refuses stale frames, but the stale threshold is now strategy-adjusted using crowd-derived `risk_tolerance`.

## Boost mechanics

- `BoostManager` holds a single expiry timestamp.
- Triggering boost during active boost extends the timer.
- Manual/Solana/admin boosts still map to turbo byte 6.
- Node race voting now triggers Python `/boost/trigger` when a cycle enters `boost`, using the selected `winnerCarId`.
- Crowd strategy can also trigger boost:
  - `boost_usage` values `save_straights` and `hold_overtake` fire a strategy boost when the car has been going straight for 10 recent perception samples and boost is inactive.

## Betting and race flow

- Node backend owns race cycles: `idle`, `starting`, `voting`, `finalizing`, `boost`.
- The canonical settlement path is `recordRaceResultAndSettleBetsTx()`. Avoid reintroducing separate settlement functions; official `/api/race/result` and mock settlement should share this path.
- Betting supports fixed stake amounts `1`, `5`, `10`.
- Backend supports `winner` and `trifecta` bet types, though the current Next public page primarily exercises winner flow.
- Confirmed bettors receive race-scoped internal boost voting credits; these are not crypto tokens.
- Current devnet payment implementation uses native SOL mapping for stake verification/payout helpers.
- Fake race result settlement exists for local/demo operation.

## Crowd strategy

- Crowd strategy is implemented in `hardware/crowd_agent.py` and surfaced by `frontend/components/ChatPanel.tsx`.
- OpenAI dependency is required by `hardware/requirements.txt`.
- Enable with `OPENAI_API_KEY`; configure trigger threshold with `CROWD_TRIGGER_N` (default `5`).
- The agent stores chat and strategy in memory, keyed by BLE `car_address`.
- The model is currently hardcoded to `o4-mini`.
- Strategy output schema:
  - `throttle_aggressiveness`: adjusts how much confidence is needed before forward motion.
  - `corner_behaviour`: maps to OpenCV deadband (`safe` wider, `tight` narrower).
  - `risk_tolerance`: adjusts stale-frame threshold.
  - `boost_usage`: can defer/trigger boost behavior.
  - `reasoning`: displayed in the UI.
- `GET /chat/strategy` applies the strategy to the connected car when `car.address` matches the requested `car_address`.

## Guardrails

- Do not merge the Node betting backend and Python hardware backend without a clear reason.
- Do not move BLE/CV work onto the Pi for this project shape.
- When adding frontend API calls, route them through Next rewrites unless direct hardware streaming is intentionally needed.
- When changing strategy semantics, update both the Python application logic and the TypeScript `CarStrategy` type.
- Keep v1 scope practical: one connected physical car at a time, three logical display cars, no full lap timing system unless requested.
