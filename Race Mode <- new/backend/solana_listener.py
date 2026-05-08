from __future__ import annotations

import asyncio
import json
import logging
import urllib.request as _req
from typing import Awaitable, Callable

from boost import BoostEvent

log = logging.getLogger("solana")

OnBoost = Callable[[BoostEvent], Awaitable[None]]


class SolanaListener:
    """Watches the treasury $BOOST token account for incoming transfers.

    Opens a Solana WebSocket RPC `accountSubscribe` subscription on the
    treasury's Associated Token Account (ATA). Each time the balance
    increases (a spectator sent $BOOST), `on_boost` is called.

    Configuration:
      - Set SOLANA_TREASURY_ATA directly (from `solana/mint.ts` output) OR
      - Set SOLANA_TREASURY_PUBKEY + BOOST_TOKEN_MINT and the listener will
        resolve the ATA via getTokenAccountsByOwner at startup.
    """

    def __init__(
        self,
        rpc_url: str,
        treasury_pubkey: str,
        boost_mint: str,
        boost_duration_s: float,
        on_boost: OnBoost,
        treasury_ata: str = "",
    ):
        self.rpc_url = rpc_url
        self.treasury_pubkey = treasury_pubkey
        self.boost_mint = boost_mint
        self.treasury_ata = treasury_ata
        self.boost_duration_s = float(boost_duration_s)
        self.on_boost = on_boost
        self._task: asyncio.Task | None = None
        self._running = False

    @property
    def configured(self) -> bool:
        return bool(self.treasury_ata or (self.treasury_pubkey and self.boost_mint))

    async def start(self) -> None:
        if not self.configured:
            log.warning(
                "Solana listener not configured — $BOOST transfers will not trigger boosts. "
                "Set SOLANA_TREASURY_PUBKEY + BOOST_TOKEN_MINT in .env.",
            )
            return
        if self._task and not self._task.done():
            return
        self._running = True
        self._task = asyncio.create_task(self._run())
        log.info(
            "Solana listener starting (treasury=%s rpc=%s)",
            self.treasury_ata or self.treasury_pubkey,
            self.rpc_url,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        import websockets  # soft import — not needed at module load

        wss_url = (
            self.rpc_url
            .replace("https://", "wss://")
            .replace("http://", "ws://")
        )

        watch_account = self.treasury_ata or await self._resolve_ata()
        if not watch_account:
            log.error("SolanaListener: could not determine treasury ATA — listener disabled")
            return

        log.info("SolanaListener: watching ATA %s", watch_account)
        last_balance: int | None = None

        while self._running:
            try:
                async with websockets.connect(wss_url, ping_interval=20) as ws:
                    await ws.send(json.dumps({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "accountSubscribe",
                        "params": [
                            watch_account,
                            {"commitment": "confirmed", "encoding": "jsonParsed"},
                        ],
                    }))

                    async for raw in ws:
                        if not self._running:
                            break
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        if "result" in msg and isinstance(msg.get("result"), int):
                            log.info("SolanaListener: subscribed (sub_id=%d)", msg["result"])
                            continue

                        if msg.get("method") != "accountNotification":
                            continue

                        try:
                            info = (
                                msg["params"]["result"]["value"]
                                ["data"]["parsed"]["info"]
                            )
                            amount = int(info["tokenAmount"]["amount"])
                        except (KeyError, TypeError, ValueError):
                            continue

                        if last_balance is not None and amount > last_balance:
                            delta = amount - last_balance
                            log.info(
                                "SolanaListener: +%d token-lamports received → boost",
                                delta,
                            )
                            await self.on_boost(BoostEvent(
                                duration_s=self.boost_duration_s,
                                source="solana",
                            ))
                        last_balance = amount

            except Exception as exc:
                log.warning("SolanaListener: WS error (%s) — reconnecting in 5 s", exc)
                await asyncio.sleep(5)

    async def _resolve_ata(self) -> str | None:
        """Resolve the treasury ATA via getTokenAccountsByOwner RPC call."""
        try:
            body = json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getTokenAccountsByOwner",
                "params": [
                    self.treasury_pubkey,
                    {"mint": self.boost_mint},
                    {"encoding": "jsonParsed"},
                ],
            }).encode()
            request = _req.Request(
                self.rpc_url,
                data=body,
                headers={"Content-Type": "application/json"},
            )
            with _req.urlopen(request, timeout=10) as resp:
                data = json.loads(resp.read())
            accounts = data.get("result", {}).get("value", [])
            if accounts:
                ata = accounts[0]["pubkey"]
                log.info("SolanaListener: resolved treasury ATA = %s", ata)
                return ata
        except Exception as exc:
            log.warning("SolanaListener: ATA resolution failed: %s", exc)
        return None

    async def trigger_test_boost(self) -> None:
        """Manual hook for testing — pretend a transfer just landed."""
        await self.on_boost(BoostEvent(duration_s=self.boost_duration_s, source="test"))
