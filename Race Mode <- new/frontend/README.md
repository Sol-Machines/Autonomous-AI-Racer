# Race Mode — Frontend (placeholder)

Spectator web page. Will host:

- A WebRTC `<video>` connected to the Pi's go2rtc stream.
- Phantom wallet connect (Solana devnet).
- A "Send $BOOST" button that calls an SPL transfer to the treasury.
- A live indicator showing when a boost is active on the car.

Not built yet — backend exposes the necessary endpoints
(`/camera/info`, `/boost/status`, `/boost/trigger`).
