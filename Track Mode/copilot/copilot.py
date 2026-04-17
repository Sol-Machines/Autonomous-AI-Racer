#!/usr/bin/env python3
"""
Track Mode Copilot — main orchestrator.

Connects to the backend's REST API, integrates the Zapbox Link for
manual driving, and monitors the track-following race via the TrackAgent.

Modes:
  idle    — no car connected
  manual  — user driving via ZapBox controllers
  track   — autonomous track-following (backend handles controls)
"""

import asyncio
import logging
import os
import signal
import socket

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import aiohttp

from agent import TrackAgent
from zapbox_link import ZapboxLink

log = logging.getLogger("copilot")

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000").rstrip("/")


class Copilot:
    def __init__(self):
        self.http: aiohttp.ClientSession | None = None
        self.zapbox = ZapboxLink()
        self.agent = TrackAgent()
        self.mode = "idle"
        self.car_connected = False
        self.car_name = ""
        self.car_battery: int | None = None
        self.running = True

    async def _post(self, path: str, body: dict | None = None) -> dict | None:
        if self.http is None:
            return None
        try:
            async with self.http.post(
                f"{BACKEND_URL}{path}", json=body,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                return await resp.json()
        except Exception as e:
            log.warning("POST %s failed: %s", path, e)
            return None

    async def _get(self, path: str) -> dict | None:
        if self.http is None:
            return None
        try:
            async with self.http.get(
                f"{BACKEND_URL}{path}",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                return await resp.json()
        except Exception as e:
            log.warning("GET %s failed: %s", path, e)
            return None

    async def _scan_and_connect(self):
        log.info("Scanning for cars...")
        result = await self._post("/car/scan")
        if not result or not result.get("cars"):
            log.warning("No cars found")
            return
        cars = result["cars"]
        log.info("Found %d car(s): %s", len(cars), ", ".join(c["name"] for c in cars))
        resp = await self._post(f"/car/connect/{cars[0]['number']}")
        if resp and resp.get("connected"):
            self.car_connected = True
            self.car_name = resp.get("name", "")
            self.car_battery = resp.get("battery")
            log.info("Car connected: %s  battery=%s%%", self.car_name, self.car_battery)

    async def _run_status_poller(self):
        while self.running:
            status = await self._get("/car/status")
            if status:
                prev = self.car_connected
                self.car_connected = status.get("connected", False)
                self.car_name = status.get("name", "")
                self.car_battery = status.get("battery")
                if self.car_connected and not prev:
                    log.info("Car connected: %s", self.car_name)
                elif not self.car_connected and prev:
                    log.info("Car disconnected")
            await asyncio.sleep(2)

    async def _run_auto_connect(self):
        await asyncio.sleep(2)
        while self.running:
            if not self.car_connected:
                await self._scan_and_connect()
            await asyncio.sleep(10)

    async def _run_mode_switcher(self):
        while self.running:
            if not self.car_connected:
                if self.mode != "idle":
                    self.mode = "idle"
                    self.agent.active = False
                await asyncio.sleep(0.5)
                continue

            # Check if a race is running
            race_status = await self.agent.check_race_status()
            is_racing = race_status.get("racing", False)

            if is_racing:
                if self.zapbox.is_active():
                    # Manual override — stop race
                    log.info("Manual override — stopping race")
                    await self._post("/track/stop-race")
                    self.mode = "manual"
                    self.agent.active = False
                elif self.mode != "track":
                    self.mode = "track"
                    self.agent.active = True
                    log.info("-> TRACK (race in progress)")
            elif self.zapbox.is_active():
                if self.mode != "manual":
                    self.mode = "manual"
                    self.agent.active = False
                    log.info("-> MANUAL")
            else:
                if self.mode != "idle":
                    self.mode = "idle"
                    self.agent.active = False
                    log.info("-> IDLE")

            await asyncio.sleep(0.1)

    async def _run_control_loop(self):
        """POST /car/control at 20 Hz for manual mode only."""
        ZERO = dict(forward=0, reverse=0, left=0, right=0, lights=0, turbo=0, donut=0)
        while self.running:
            if not self.car_connected or self.http is None:
                await asyncio.sleep(0.1)
                continue

            if self.mode == "manual":
                ctrl = self.zapbox.get_control()
            elif self.mode == "track":
                # Backend handles controls during race — don't interfere
                await asyncio.sleep(0.1)
                continue
            else:
                ctrl = ZERO

            await self._post("/car/control", ctrl)
            await asyncio.sleep(1.0 / 20)

    @staticmethod
    def _local_ip() -> str:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    async def run(self):
        local_ip = self._local_ip()
        log.info("Track Mode Copilot starting")
        log.info("  BACKEND_URL = %s", BACKEND_URL)
        log.info("  Controller -> http://%s:%d", local_ip, self.zapbox.port)

        self.http = aiohttp.ClientSession()
        tasks = [
            self._run_status_poller(),
            self._run_auto_connect(),
            self._run_mode_switcher(),
            self._run_control_loop(),
            self.zapbox.run(),
            self.agent.run(),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            await self.http.close()


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(name)-10s  %(message)s",
        datefmt="%H:%M:%S",
    )

    copilot = Copilot()

    def _shutdown(*_):
        log.info("Shutting down...")
        copilot.running = False
        copilot.zapbox.running = False
        copilot.agent.running = False

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    asyncio.run(copilot.run())


if __name__ == "__main__":
    main()
