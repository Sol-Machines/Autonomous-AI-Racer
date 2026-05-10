"use client";

import type { Cycle, BetInfo } from "@/lib/types";
import { BETTING_ENABLED } from "@/lib/flags";

interface BetPanelProps {
  cycle: Cycle | null;
  bet: BetInfo;
  selectedCarId: string | null;
  selectedStake: number;
  isPlacingBet: boolean;
  votedCycleId: number | null;
  isSubmittingVote: boolean;
  countdown: number;
  onStakeChange: (stake: number) => void;
  onPlaceBet: () => void;
  onBoostVote: () => void;
}

const STAKES = [1, 5, 10];

export default function BetPanel({
  cycle, bet, selectedCarId, selectedStake, isPlacingBet,
  votedCycleId, isSubmittingVote, countdown,
  onStakeChange, onPlaceBet, onBoostVote,
}: BetPanelProps) {
  const state = cycle?.state ?? "idle";
  const bettingPhase = state === "idle" || state === "starting";
  const isBettingOpen = BETTING_ENABLED && bettingPhase;
  const isAwaitingRace = !BETTING_ENABLED && bettingPhase;
  const isVoting = state === "voting";
  const isBoost = state === "boost";
  const isFinalizing = state === "finalizing";
  const hasBet = bet.status === "confirmed" || bet.status === "won" || bet.status === "lost";
  const hasVoted = votedCycleId === cycle?.id;

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-t border-[#1a1a1a] flex-wrap min-h-[44px]">

      {/* Left side: bet info or stake selector */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {hasBet ? (
          <div className="text-[11px] text-[#888] truncate">
            Bet:{" "}
            <span className="text-[#ff8800]">{bet.carId}</span>
            {" · "}
            <span className="text-[#f0f0f0]">{bet.stakeAmount}</span> token
            {" · "}pot{" "}
            <span className="text-[#44ff44]">{bet.potentialPayout}</span>
          </div>
        ) : isBettingOpen ? (
          <>
            <span className="text-[9px] text-[#444] uppercase tracking-widest shrink-0">Stake</span>
            <div className="flex gap-1">
              {STAKES.map((s) => (
                <button
                  key={s}
                  onClick={() => onStakeChange(s)}
                  className={`text-[11px] w-8 h-7 border transition-colors ${
                    selectedStake === s
                      ? "border-[#ff4400] text-[#ff4400] bg-[#ff4400]/10"
                      : "border-[#2a2a2a] text-[#555] hover:border-[#444] hover:text-[#888]"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        ) : isAwaitingRace ? (
          <div className="text-[11px] text-[#888] tracking-widest">
            ⏳ AWAITING NEXT RACE
          </div>
        ) : isBoost ? (
          <div className="text-[11px] text-[#ff4400] animate-pulse tracking-widest">
            ⚡ BOOSTING {countdown}s
          </div>
        ) : isFinalizing ? (
          <div className="text-[11px] text-[#ff8800] animate-pulse tracking-widest">
            AUTHENTICATING…
          </div>
        ) : isVoting ? (
          <div className="text-[11px] text-[#44ff44] tracking-wider">
            VOTE OPEN — {countdown}s remaining
          </div>
        ) : null}
      </div>

      {/* Right side: action button */}
      <div className="shrink-0">
        {isBettingOpen && !hasBet && (
          <button
            onClick={onPlaceBet}
            disabled={!selectedCarId || isPlacingBet}
            className="text-[11px] px-4 py-1.5 tracking-widest btn-accent"
          >
            {isPlacingBet
              ? "PLACING…"
              : selectedCarId
              ? `BACK ${selectedCarId}`
              : "SELECT A CAR"}
          </button>
        )}

        {isAwaitingRace && (
          <button
            disabled
            className="text-[11px] px-4 py-1.5 tracking-widest border border-[#2a2a2a] text-[#444] cursor-not-allowed"
            title="Bets open once the next race is scheduled"
          >
            BETS LOCKED
          </button>
        )}

        {isVoting && (
          <button
            onClick={onBoostVote}
            disabled={!selectedCarId || hasVoted || isSubmittingVote}
            className="text-[12px] px-5 py-1.5 tracking-widest btn-boost"
          >
            {isSubmittingVote
              ? "VOTING…"
              : hasVoted
              ? "VOTED ✓"
              : "⚡ BOOST VOTE"}
          </button>
        )}
      </div>
    </div>
  );
}
