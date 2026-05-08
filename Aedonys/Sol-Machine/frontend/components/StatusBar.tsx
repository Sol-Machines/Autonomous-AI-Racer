"use client";

import type { Cycle } from "@/lib/types";

interface StatusBarProps {
  cycle: Cycle | null;
  walletMode: "phantom" | "demo";
  walletAddress: string;
  carConnected: boolean;
}

export default function StatusBar({ cycle, walletMode, walletAddress, carConnected }: StatusBarProps) {
  const short = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : "—";

  return (
    <div className="flex items-center gap-4 px-3 py-1 border-t border-[#161616] flex-wrap text-[9px] text-[#444] tracking-wider uppercase">
      <span>
        race <span className="text-[#666]">{cycle?.raceId ?? "—"}</span>
      </span>
      <span>
        cycle <span className="text-[#666]">{cycle?.id ?? "—"}</span>
      </span>
      <span>
        #{cycle?.cycleNumber ?? "—"}
      </span>
      <span className={carConnected ? "text-[#44ff44]/70" : "text-[#444]"}>
        {carConnected ? "● CAR ONLINE" : "○ CAR OFFLINE"}
      </span>
      <span className="ml-auto">
        {walletMode}{" "}
        <span className="text-[#555] normal-case">{short}</span>
      </span>
    </div>
  );
}
