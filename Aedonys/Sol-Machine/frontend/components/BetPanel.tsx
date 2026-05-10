"use client";

import type { Cycle, BetInfo } from "@/lib/types";

interface BetPanelProps {
  cycle: Cycle | null;
  bet: BetInfo;
  selectedCarId: string | null;
  selectedStake: number;
  isPlacingBet: boolean;
  votedCycleId: number | null;
  isSubmittingVote: boolean;
  countdown: number;
  boostTokens: { granted: number; spent: number; remaining: number } | null;
  onStakeChange: (stake: number) => void;
  onPlaceBet: () => void;
  onBoostVote: () => void;
}

const STAKES = [1, 5, 10];

export default function BetPanel({
  cycle, bet, selectedCarId, selectedStake, isPlacingBet,
  votedCycleId, isSubmittingVote, countdown, boostTokens,
  onStakeChange, onPlaceBet, onBoostVote,
}: BetPanelProps) {
  const state = cycle?.state ?? null;
  // Betting is open from the moment a race is initialized (idle) through the
  // pre-race countdown (starting). Voting takes over once the countdown ends.
  const isAwaitingRace = cycle === null;
  const isBettingOpen = !!cycle && (state === "idle" || state === "starting");
  const isVoting = state === "voting";
  const isBoost = state === "boost";
  const isFinalizing = state === "finalizing";
  const hasBet = bet.status === "confirmed" || bet.status === "won" || bet.status === "lost";
  const hasVoted = votedCycleId === cycle?.id;
  const tokensRemaining = boostTokens?.remaining ?? null;
  const noTokensLeft = tokensRemaining !== null && tokensRemaining <= 0;

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
          cycle?.winnerCarId ? (
            <div className="text-[11px] text-[#ff4400] animate-pulse tracking-widest">
              ⚡ BOOSTING {cycle.winnerCarId} · {countdown}s
            </div>
          ) : (
            <div className="text-[11px] text-[#888] tracking-widest">
              TIED — NO BOOST · {countdown}s
            </div>
          )
        ) : isFinalizing ? (
          <div className="text-[11px] text-[#ff8800] animate-pulse tracking-widest">
            AUTHENTICATING…
          </div>
        ) : isVoting ? (
          <div className="flex items-center gap-3 text-[11px] tracking-wider">
            <span className="text-[#44ff44]">VOTE OPEN — {countdown}s</span>
            {boostTokens && (
              <span
                className={`text-[10px] uppercase tracking-widest border px-1.5 py-0.5 ${
                  noTokensLeft
                    ? "border-[#5a3a00] text-[#aa7733]"
                    : "border-[#2a6a2a] text-[#88dd88]"
                }`}
                title="Each confirmed bet grants 1 boost token per race."
              >
                Tokens {boostTokens.remaining}/{boostTokens.granted}
              </span>
            )}
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
            disabled={!selectedCarId || hasVoted || isSubmittingVote || noTokensLeft}
            className="text-[12px] px-5 py-1.5 tracking-widest btn-boost disabled:opacity-30"
            title={noTokensLeft ? "You have used all your boost tokens for this race." : undefined}
          >
            {isSubmittingVote
              ? "VOTING…"
              : hasVoted
              ? "VOTED ✓"
              : noTokensLeft
              ? "NO TOKENS LEFT"
              : "⚡ BOOST VOTE"}
          </button>
        )}
      </div>
    </div>
  );
}
