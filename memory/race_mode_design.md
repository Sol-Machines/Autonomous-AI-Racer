---
name: Race Mode design decisions
description: Locked-in architecture choices for Race Mode — perception, boost mechanics, Solana scope, race shape
type: project
---

Decisions reached during planning on 2026-05-08 (do not re-litigate without asking):

- **Perception:** Two interchangeable backends behind a `Perception` protocol — `opencv_line.py` (threshold + centroid) and `cnn_line.py` (tiny CNN trained from collected frames). Selectable via `PERCEPTION_BACKEND=opencv|cnn`.
- **Boost mechanics:** Each $BOOST event = `turbo` byte (BLE byte 6) set to 1 for N seconds. Re-triggering during an active boost extends the timer. Single function, easy to swap later.
- **Race shape:** Free-drive loop, no finish, no lap counting in v1.
- **Solana:** Devnet $BOOST SPL token. Spectator page connects Phantom and transfers to a treasury wallet; backend listens for the transfer and emits a boost event.
- **Spectators:** Web page with WebRTC video + Phantom connect + Send $BOOST button.
- **Cars:** 1 car for the demo (multi-car deferred to v2).

**Why:** User's explicit answers during planning. Keep these in mind so we don't redesign components that already have decisions attached.

**How to apply:** When making implementation choices, prefer the option consistent with these decisions. Flag and ask before deviating.
