"use client";

import { useState } from "react";
import type { Cycle } from "@/lib/types";
import { CARS } from "@/lib/types";
import type { RaceResultStatus } from "@/lib/admin-types";

interface RaceControlProps {
  cycle: Cycle | null;
  countdown: number;
  onStartRace: () => Promise<void>;
  onResetRace: () => Promise<void>;
  onSubmitResult: (winnerCarId: string | null, status: RaceResultStatus) => Promise<void>;
}

export default function RaceControl({
  cycle, countdown, onStartRace, onResetRace, onSubmitResult,
}: RaceControlProps) {
  const [working, setWorking] = useState<string | null>(null);
  const [winnerCarId, setWinnerCarId] = useState<string>("Car 1");
  const [resultStatus, setResultStatus] = useState<RaceResultStatus>("completed");

  const state = cycle?.state ?? "idle";
  const isIdle = state === "idle";

  const wrap = async (key: string, fn: () => Promise<void>) => {
    setWorking(key);
    try { await fn(); } finally { setWorking(null); }
  };

  return (
    <div className="bg-[#111] border border-[#222] flex flex-col">
      <div className="px-3 py-1.5 border-b border-[#1a1a1a]">
        <span className="text-[10px] text-[#888] uppercase tracking-widest">Race Control</span>
      </div>

      <div className="px-3 py-3 space-y-3 flex-1">
        {/* Current state */}
        <div className="text-[11px] text-[#888]">
          State: <span className="text-[#ff8800] uppercase">{state}</span>
          {!isIdle && <> · {countdown}s</>}
          {cycle && <> · race <span className="text-[#aaa]">{cycle.raceId}</span> · cycle <span className="text-[#aaa]">{cycle.cycleNumber}</span></>}
        </div>

        {/* Start + Reset buttons */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => wrap("start", onStartRace)}
            disabled={!isIdle || working === "start"}
            className="text-[11px] tracking-widest px-3 py-1.5 btn-accent"
          >
            {working === "start" ? "STARTING…" : "FORCE START RACE"}
          </button>
          <button
            onClick={() => {
              if (!confirm("Reset to a new idle race? Current state will be wiped.")) return;
              wrap("reset", onResetRace);
            }}
            disabled={working === "reset"}
            className="text-[11px] tracking-widest px-3 py-1.5 border border-[#660000] text-[#ff4444] hover:bg-[#ff0000]/10 transition-colors disabled:opacity-30"
          >
            {working === "reset" ? "RESETTING…" : "RESET RACE"}
          </button>
        </div>

        {/* Submit Result */}
        <div className="border border-[#1a1a1a] p-2.5">
          <div className="text-[9px] text-[#666] uppercase tracking-widest mb-2">Submit Race Result</div>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-[#555] uppercase">Status</span>
              <select
                value={resultStatus}
                onChange={(e) => setResultStatus(e.target.value as RaceResultStatus)}
                className="text-[11px] bg-[#0a0a0a] border border-[#222] text-[#aaa] px-2 py-1"
              >
                <option value="completed">completed</option>
                <option value="cancelled">cancelled</option>
                <option value="invalid">invalid</option>
              </select>
            </label>
            <label className={`flex flex-col gap-0.5 ${resultStatus !== "completed" ? "opacity-30" : ""}`}>
              <span className="text-[9px] text-[#555] uppercase">Winner</span>
              <select
                value={winnerCarId}
                onChange={(e) => setWinnerCarId(e.target.value)}
                disabled={resultStatus !== "completed"}
                className="text-[11px] bg-[#0a0a0a] border border-[#222] text-[#aaa] px-2 py-1"
              >
                {CARS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <button
            onClick={() => {
              if (!cycle) return;
              const winner = resultStatus === "completed" ? winnerCarId : null;
              const msg = winner
                ? `Submit ${winner} as winner of race ${cycle.raceId}?`
                : `Submit race ${cycle.raceId} as ${resultStatus}?`;
              if (!confirm(msg + " This will settle all confirmed bets.")) return;
              wrap("submit", () => onSubmitResult(winner, resultStatus));
            }}
            disabled={working === "submit"}
            className="w-full text-[11px] tracking-widest px-3 py-1.5 btn-accent"
          >
            {working === "submit" ? "SUBMITTING…" : "SUBMIT RESULT"}
          </button>
        </div>
      </div>
    </div>
  );
}
