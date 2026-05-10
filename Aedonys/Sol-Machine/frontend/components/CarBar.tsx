"use client";

import { useState } from "react";
import { CARS } from "@/lib/types";

interface CarBarProps {
  liveCarId: string;
  carConnected: boolean;
  carName: string;
  onLiveCarChange: (carId: string) => void;
}

export default function CarBar({
  liveCarId, carConnected, carName, onLiveCarChange,
}: CarBarProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-[#111] border-b border-[#222] shrink-0">
      {/* Bar header — always visible, clickable to toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-[#161616] transition-colors"
      >
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            carConnected
              ? "bg-[#44ff44] shadow-[0_0_6px_#44ff44]"
              : "bg-[#444]"
          }`}
        />
        <span className="text-[12px] flex-1 truncate">
          {carConnected ? (
            <span className="text-[#44ff44]">
              ● {carName || liveCarId} — connected
            </span>
          ) : (
            <span className="text-[#555]">
              LIVE: <span className="text-[#888]">{liveCarId}</span> — not connected
            </span>
          )}
        </span>
        <span className="text-[10px] text-[#444]">{open ? "▲" : "▼"}</span>
      </button>

      {/* Expandable panel */}
      {open && (
        <div className="px-4 pb-3 pt-2 border-t border-[#1a1a1a]">
          <div className="text-[9px] text-[#444] uppercase tracking-[0.15em] mb-2">
            Select live car (camera + feed)
          </div>

          <div className="flex gap-2 flex-wrap">
            {CARS.map((carId) => {
              const isLive = carId === liveCarId;
              return (
                <button
                  key={carId}
                  onClick={() => onLiveCarChange(carId)}
                  className={`text-[11px] px-3 py-1 border transition-colors ${
                    isLive
                      ? "border-[#ff4400] text-[#ff4400] bg-[#ff4400]/10"
                      : "border-[#333] text-[#777] hover:border-[#ff4400]/50 hover:text-[#aaa]"
                  }`}
                >
                  {carId}
                  {isLive && <span className="ml-1 text-[9px]">● LIVE</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
