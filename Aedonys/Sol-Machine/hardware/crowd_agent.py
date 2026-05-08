"""Crowd strategy agent.

Spectators send chat messages about a specific car. After every
TRIGGER_N messages the latest thread is fed to o4-mini, which
extracts a consensus CarStrategy as structured JSON. That strategy
is stored in-memory and read by the perception loop in main.py.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from dataclasses import dataclass, field

log = logging.getLogger("crowd")

# ── Data models ───────────────────────────────────────────────────────────────

@dataclass
class CarStrategy:
    throttle_aggressiveness: float = 0.5   # 0=conservative, 1=full send
    boost_usage: str = "immediate"          # immediate | save_straights | hold_overtake
    corner_behaviour: str = "normal"        # safe | normal | tight
    risk_tolerance: float = 0.5            # 0=cautious, 1=aggressive
    reasoning: str = ""

    def to_dict(self) -> dict:
        return {
            "throttle_aggressiveness": self.throttle_aggressiveness,
            "boost_usage": self.boost_usage,
            "corner_behaviour": self.corner_behaviour,
            "risk_tolerance": self.risk_tolerance,
            "reasoning": self.reasoning,
        }


@dataclass
class ChatMessage:
    author: str
    text: str
    ts: float = field(default_factory=time.monotonic)

    def to_dict(self) -> dict:
        return {"author": self.author, "text": self.text, "ts": round(self.ts, 3)}


# ── JSON schema for o4-mini structured output ─────────────────────────────────

_STRATEGY_SCHEMA = {
    "type": "object",
    "properties": {
        "throttle_aggressiveness": {"type": "number"},
        "boost_usage": {"type": "string", "enum": ["immediate", "save_straights", "hold_overtake"]},
        "corner_behaviour": {"type": "string", "enum": ["safe", "normal", "tight"]},
        "risk_tolerance": {"type": "number"},
        "reasoning": {"type": "string"},
    },
    "required": [
        "throttle_aggressiveness", "boost_usage", "corner_behaviour",
        "risk_tolerance", "reasoning",
    ],
    "additionalProperties": False,
}


# ── CrowdAgent ────────────────────────────────────────────────────────────────

class CrowdAgent:
    """In-memory chat store + o4-mini consensus analyser.

    One instance is shared across all cars (keyed by car_address).
    """

    def __init__(self, api_key: str, model: str = "o4-mini", trigger_n: int = 5) -> None:
        from openai import AsyncOpenAI
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model
        self._trigger_n = trigger_n

        self._histories: dict[str, deque[ChatMessage]] = {}
        self._strategies: dict[str, CarStrategy] = {}
        self._msgs_since_check: dict[str, int] = {}
        self._pending: set[str] = set()

    # ── Public API ────────────────────────────────────────────────────────────

    def _ensure(self, car_address: str) -> None:
        if car_address not in self._histories:
            self._histories[car_address] = deque(maxlen=100)
            self._strategies[car_address] = CarStrategy()
            self._msgs_since_check[car_address] = 0

    async def add_message(self, car_address: str, author: str, text: str) -> ChatMessage:
        self._ensure(car_address)
        msg = ChatMessage(author=author, text=text)
        self._histories[car_address].append(msg)
        self._msgs_since_check[car_address] += 1
        asyncio.create_task(self._maybe_trigger(car_address))
        return msg

    def get_messages(self, car_address: str, limit: int = 50) -> list[ChatMessage]:
        self._ensure(car_address)
        msgs = list(self._histories[car_address])
        return msgs[-limit:]

    def get_strategy(self, car_address: str) -> CarStrategy:
        self._ensure(car_address)
        return self._strategies[car_address]

    def is_analyzing(self, car_address: str) -> bool:
        return car_address in self._pending

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _maybe_trigger(self, car_address: str) -> None:
        if self._msgs_since_check.get(car_address, 0) < self._trigger_n:
            return
        if car_address in self._pending:
            return
        self._msgs_since_check[car_address] = 0
        await self._analyze(car_address)

    async def _analyze(self, car_address: str) -> None:
        self._pending.add(car_address)
        try:
            msgs = self.get_messages(car_address, limit=30)
            current = self._strategies[car_address]
            chat_log = "\n".join(f"{m.author}: {m.text}" for m in msgs)

            current_summary = {
                "throttle_aggressiveness": current.throttle_aggressiveness,
                "boost_usage": current.boost_usage,
                "corner_behaviour": current.corner_behaviour,
                "risk_tolerance": current.risk_tolerance,
            }

            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a race strategy analyst for an RC car racing competition. "
                            "Read the crowd discussion and extract the consensus strategy. "
                            "If no clear consensus has emerged, return the current strategy unchanged. "
                            "Output only valid JSON matching the required schema."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Current strategy: {json.dumps(current_summary)}\n\n"
                            f"Recent spectator messages:\n{chat_log}\n\n"
                            "Extract the consensus strategy and explain your reasoning."
                        ),
                    },
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "car_strategy",
                        "strict": True,
                        "schema": _STRATEGY_SCHEMA,
                    },
                },
            )

            data = json.loads(response.choices[0].message.content)
            new_strategy = CarStrategy(
                throttle_aggressiveness=float(
                    max(0.0, min(1.0, data.get("throttle_aggressiveness", 0.5)))
                ),
                boost_usage=data.get("boost_usage", "immediate"),
                corner_behaviour=data.get("corner_behaviour", "normal"),
                risk_tolerance=float(
                    max(0.0, min(1.0, data.get("risk_tolerance", 0.5)))
                ),
                reasoning=data.get("reasoning", ""),
            )
            self._strategies[car_address] = new_strategy
            log.info(
                "Strategy updated for %s: corner=%s boost=%s throttle=%.2f | %s",
                car_address,
                new_strategy.corner_behaviour,
                new_strategy.boost_usage,
                new_strategy.throttle_aggressiveness,
                new_strategy.reasoning,
            )
        except Exception as exc:
            log.warning("CrowdAgent analysis failed for %s: %s", car_address, exc)
        finally:
            self._pending.discard(car_address)
