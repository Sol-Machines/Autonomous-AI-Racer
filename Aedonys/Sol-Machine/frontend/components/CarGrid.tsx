"use client";

import { CARS, type Cycle, type VoteTotals } from "@/lib/types";

interface CarGridProps {
  cycle: Cycle | null;
  voteTotals: VoteTotals;
  selectedCarId: string | null;
  betCarId: string | null;
  votedCycleId: number | null;
  isSubmittingVote: boolean;
  liveCarId: string;
  onCarClick: (carId: string) => void;
}

export default function CarGrid({
  cycle, voteTotals, selectedCarId, betCarId, votedCycleId,
  isSubmittingVote, liveCarId, onCarClick,
}: CarGridProps) {
  const state = cycle?.state ?? "idle";
  const isVoting = state === "voting";
  const isBoost = state === "boost";
  const isBettingOpen = state === "idle" || state === "starting";
  const winner = cycle?.winnerCarId;
  const hasVoted = votedCycleId === cycle?.id;

  const isClickable = (carId: string) => {
    if (isBettingOpen && !betCarId) return true;
    if (isVoting && !hasVoted && !isSubmittingVote) return true;
    return false;
  };

  return (
    <div className="grid grid-cols-3 gap-2 px-3 pt-2 pb-1">
      {CARS.map((carId) => {
        const isLive = carId === liveCarId;
        const isSelected = selectedCarId === carId;
        const isBetOn = betCarId === carId;
        const isWinner = isBoost && winner === carId;
        const votes = voteTotals[carId] ?? 0;
        const clickable = isClickable(carId);

        let borderClass = "border-[#222]";
        if (isWinner) borderClass = "border-[#ff4400]";
        else if (isBetOn || isSelected) borderClass = "border-[#ff8800]";
        else if (isVoting && !hasVoted) borderClass = "border-[#333] hover:border-[#ff4400]/50";

        return (
          <div
            key={carId}
            onClick={() => clickable && onCarClick(carId)}
            className={`relative p-2 bg-[#111] border transition-all ${borderClass} ${
              clickable ? "cursor-pointer hover:bg-[#181818]" : ""
            } ${isWinner ? "car-winner" : ""}`}
          >
            {/* LIVE badge */}
            {isLive && (
              <div className="absolute top-1.5 right-1.5 text-[8px] text-[#44ff44] border border-[#44ff44]/40 px-1 leading-tight">
                LIVE
              </div>
            )}

            {/* Car name */}
            <div className="text-[12px] font-bold text-[#eee] mb-1 pr-8">{carId}</div>

            {/* Vote count */}
            {(isVoting || isBoost || state === "finalizing") && (
              <div className="text-[10px] text-[#ff8800] mb-1">
                {votes} vote{votes !== 1 ? "s" : ""}
              </div>
            )}

            {/* Badges row */}
            <div className="flex flex-wrap gap-1 min-h-4">
              {isBetOn && (
                <span className="text-[8px] text-[#ff8800] border border-[#ff8800]/40 px-1 leading-tight">
                  MY BET
                </span>
              )}
              {isWinner && (
                <span className="text-[8px] text-[#ff4400] border border-[#ff4400]/50 px-1 leading-tight">
                  ⚡ WINNER
                </span>
              )}
              {isVoting && isSelected && !hasVoted && !isBetOn && (
                <span className="text-[8px] text-[#44ff44] border border-[#44ff44]/40 px-1 leading-tight">
                  SELECTED
                </span>
              )}
              {isVoting && hasVoted && isSelected && (
                <span className="text-[8px] text-[#44ff44] border border-[#44ff44]/40 px-1 leading-tight">
                  VOTED ✓
                </span>
              )}
              {isSubmittingVote && isSelected && (
                <span className="text-[8px] text-[#ff8800] animate-pulse px-1 leading-tight">
                  VOTING…
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
