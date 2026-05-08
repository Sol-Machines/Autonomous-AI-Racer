"use client";

import { useState } from "react";
import { CARS, type Cycle, type VoteTotals } from "@/lib/types";
import type { BoostStatus } from "@/lib/admin-types";

interface StatsPanelProps {
  cycle: Cycle | null;
  voteTotals: VoteTotals;
  boost: BoostStatus | null;
  onManualBoost: () => Promise<void>;
}

export default function StatsPanel({
  cycle, voteTotals, boost, onManualBoost,
}: StatsPanelProps) {
  const [boosting, setBoosting] = useState(false);

  const handleBoost = async () => {
    setBoosting(true);
    try { await onManualBoost(); } finally {
      setTimeout(() => setBoosting(false), 1000);
    }
  };

  const totalVotes = Object.values(voteTotals).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-[#111] border border-[#222]">
      <div className="px-3 py-1.5 border-b border-[#1a1a1a]">
        <span className="text-[10px] text-[#888] uppercase tracking-widest">Live Stats</span>
      </div>

      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] text-[#555] uppercase tracking-widest">Votes:</span>
          {CARS.map(c => {
            const v = voteTotals[c] ?? 0;
            const pct = totalVotes > 0 ? (v / totalVotes) * 100 : 0;
            return (
              <div key={c} className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#aaa]">{c}:</span>
                <span className="text-[11px] text-[#ff8800] font-bold">{v}</span>
                <div className="w-16 h-1 bg-[#1a1a1a]">
                  <div className="h-full bg-gradient-to-r from-[#ff4400] to-[#ff8800]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] text-[#555] uppercase tracking-widest">Boost:</span>
          {boost?.active ? (
            <span className="text-[11px] text-[#ff4400] animate-pulse">⚡ ACTIVE — {boost.remaining_s.toFixed(1)}s</span>
          ) : (
            <span className="text-[11px] text-[#444]">— idle</span>
          )}

          <button
            onClick={handleBoost}
            disabled={boosting || !!boost?.active}
            className="ml-auto text-[11px] tracking-widest px-3 py-1 btn-boost"
            title="Trigger a boost on the car without paying tokens (testing only)"
          >
            {boosting ? "TRIGGERED" : "⚡ MANUAL BOOST"}
          </button>
        </div>

        {cycle && (
          <div className="text-[10px] text-[#444] tracking-wider uppercase">
            race <span className="text-[#666]">{cycle.raceId}</span> · cycle <span className="text-[#666]">{cycle.id}</span> · #<span className="text-[#666]">{cycle.cycleNumber}</span> · winner <span className="text-[#666]">{cycle.winnerCarId ?? "—"}</span>
          </div>
        )}
      </div>
    </div>
  );
}
