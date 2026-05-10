"use client";

import Image from "next/image";
import Link from "next/link";
import type { Cycle } from "@/lib/types";

interface HeaderProps {
  cycle: Cycle | null;
  countdown: number;
  walletAddress: string;
  walletMode: "phantom" | "demo";
  onConnectWallet: () => void;
}

const STATE_STYLES: Record<string, string> = {
  idle:       "text-[#555] border-[#333]",
  starting:   "text-yellow-400 border-yellow-700",
  voting:     "text-[#44ff44] border-[#2a6a2a]",
  finalizing: "text-[#ff8800] border-[#7a4000]",
  boost:      "text-[#ff4400] border-[#7a1a00]",
};

export default function Header({
  cycle, countdown, walletAddress, walletMode, onConnectWallet,
}: HeaderProps) {
  const state = cycle?.state ?? "idle";
  // Tone the chip down when the boost cycle has no winner (tied / no votes).
  const stateStyle =
    state === "boost" && !cycle?.winnerCarId
      ? "text-[#888] border-[#444]"
      : STATE_STYLES[state] ?? STATE_STYLES.idle;
  const short = walletAddress
    ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
    : "—";

  const timerLabel = () => {
    if (!cycle || state === "idle") return "IDLE";
    if (state === "starting")   return `RACE IN ${countdown}s`;
    if (state === "voting")     return `VOTE ${countdown}s`;
    if (state === "finalizing") return `FINALIZING ${countdown}s`;
    if (state === "boost") {
      // No winner = tied or zero votes. The cycle still ticks for timing
      // consistency, but the label should make it clear no boost fires.
      return cycle.winnerCarId ? `⚡ BOOST ${countdown}s` : `NO BOOST ${countdown}s`;
    }
    return (state as string).toUpperCase();
  };

  return (
    <header className="flex items-center justify-between px-4 py-2 bg-[#111] border-b border-[#222] shrink-0 gap-3">
      {/* Logo + state */}
      <div className="flex items-center gap-3 min-w-0">
        <Image
          src="/sol-machine-logo.png"
          alt="Sol Machine"
          width={140}
          height={36}
          className="object-contain h-8 w-auto shrink-0"
          priority
        />
        <div
          className={`hidden sm:inline-flex items-center text-[10px] tracking-[0.15em] uppercase border px-2 py-0.5 shrink-0 ${stateStyle}`}
        >
          {timerLabel()}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Countdown pill on mobile */}
        <div
          className={`sm:hidden text-[10px] tracking-widest uppercase border px-2 py-0.5 ${stateStyle}`}
        >
          {timerLabel()}
        </div>

        <div className="text-right hidden md:block">
          <div className="text-[9px] text-[#444] uppercase tracking-wider">{walletMode}</div>
          <div className="text-[10px] text-[#666]">{short}</div>
        </div>

        <Link
          href="/admin"
          className="text-[10px] tracking-widest text-[#555] hover:text-[#ff8800] transition-colors px-1"
          title="Operator console"
        >
          ADMIN
        </Link>

        <button
          onClick={onConnectWallet}
          className={`text-[11px] px-3 py-1.5 tracking-widest border transition-colors ${
            walletMode === "phantom"
              ? "border-[#44ff44]/60 text-[#44ff44]"
              : "border-[#ff8800] text-[#ff8800] bg-[#ff4400]/10 hover:bg-[#ff4400]/20 animate-pulse"
          }`}
        >
          {walletMode === "phantom" ? "● CONNECTED" : "CONNECT PHANTOM"}
        </button>
      </div>
    </header>
  );
}
