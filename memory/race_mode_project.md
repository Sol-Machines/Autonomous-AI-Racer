---
name: Race Mode hackathon project
description: Project context for the Colloseum hackathon — AI car following black tape, Solana-funded boosts
type: project
---

User is building "Race Mode" for the Colloseum hackathon: an AI-driven Shell Racing Legends car that follows a black-tape track, streams its camera over WebRTC, and accepts speed boosts paid for in a devnet SPL token called $BOOST.

**Why:** Hackathon submission combining physical RC cars, computer vision, and Solana. Vertical slice: 1 car, free-drive loop (no laps/finish), spectators boost via Phantom on a web page.

**How to apply:**
- Reuse the Pi side from `Shell-Racing-Legends-Car-Control/pi/` (go2rtc + agent.py) unchanged.
- BLE lives on the laptop (mirror the `Agentic Cars/backend/main.py` pattern), not the Pi, since the laptop has more horsepower for CV/CNN and the Pi Zero 2W is weak.
- All new code goes under `Race Mode/` so existing demos stay intact.
- Don't over-engineer for v2 features (multi-car, lap detection, mainnet, stacked boosts) — the user explicitly scoped those out for v1.
