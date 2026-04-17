"""
Track-Following Agent — polls the backend for race state and car pose.

Unlike the Agentic Cars DrivingAgent (which uses GPT-4o vision), this agent
is a thin wrapper: the actual driving logic runs in the backend's race_loop
(path_controller + visual_odom). This agent simply monitors the race state
and provides the control interface that the Copilot expects.
"""

import asyncio
import logging
import os

import aiohttp

log = logging.getLogger("agent")

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000").rstrip("/")

ZERO = dict(forward=0, reverse=0, left=0, right=0, lights=0, turbo=0, donut=0)


class TrackAgent:
    def __init__(self):
        self.active = False
        self.running = True
        self.racing = False
        self._http: aiohttp.ClientSession | None = None

    def get_control(self) -> dict:
        # In track mode, the backend's race_loop writes directly to BLE.
        # The copilot's control loop for manual mode still needs this interface,
        # but when racing the backend handles controls directly.
        return dict(ZERO)

    async def check_race_status(self) -> dict:
        if self._http is None:
            self._http = aiohttp.ClientSession()
        try:
            async with self._http.get(
                f"{BACKEND_URL}/track/race-status",
                timeout=aiohttp.ClientTimeout(total=3),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.racing = data.get("racing", False)
                    return data
        except Exception as e:
            log.debug("Race status poll failed: %s", e)
        return {"racing": False}

    async def run(self):
        """Poll race status periodically."""
        log.info("Track agent started")
        while self.running:
            if self.active:
                await self.check_race_status()
            await asyncio.sleep(0.5)

        if self._http:
            await self._http.close()
