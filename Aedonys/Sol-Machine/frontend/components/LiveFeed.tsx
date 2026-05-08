"use client";

import { useState, useEffect } from "react";
import type { Cycle } from "@/lib/types";

interface LiveFeedProps {
  cycle: Cycle | null;
  liveCarId: string;
}

export default function LiveFeed({ cycle, liveCarId }: LiveFeedProps) {
  const [feedError, setFeedError] = useState(false);
  const [feedKey, setFeedKey] = useState(0);
  const [raceBackend, setRaceBackend] = useState("http://localhost:3000");

  useEffect(() => {
    // Read NEXT_PUBLIC_RACE_BACKEND only on client
    const rb = process.env.NEXT_PUBLIC_RACE_BACKEND || "http://localhost:3000";
    setRaceBackend(rb);
  }, []);

  const isBoost = cycle?.state === "boost";
  const isFinalizing = cycle?.state === "finalizing";
  const winner = cycle?.winnerCarId;

  const retry = () => {
    setFeedError(false);
    setFeedKey((k) => k + 1);
  };

  return (
    <div className="flex-1 relative bg-black min-h-0 flex items-center justify-center overflow-hidden">
      {!feedError ? (
        <img
          key={feedKey}
          src={`${raceBackend}/camera/stream.mjpeg`}
          alt="Live camera feed"
          className="live-feed-img"
          onError={() => setFeedError(true)}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 text-[#333]">
          <div className="text-5xl">📷</div>
          <div className="text-sm text-[#444]">
            Camera offline — {liveCarId}
          </div>
          <button
            onClick={retry}
            className="text-[11px] px-3 py-1 border border-[#333] text-[#555] hover:border-[#555] hover:text-[#888] transition-colors"
          >
            RETRY
          </button>
        </div>
      )}

      {/* Boost overlay */}
      {isBoost && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="boost-banner text-[clamp(28px,8vw,64px)] font-bold tracking-[6px] text-white px-8 py-4"
            style={{
              textShadow: "0 0 20px #ff4400, 0 0 50px #ff4400",
              background: "rgba(255,68,0,0.10)",
            }}
          >
            ⚡ BOOST ⚡
          </div>
        </div>
      )}

      {/* Winner label during boost */}
      {isBoost && winner && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#111]/90 border border-[#ff4400] px-4 py-1.5 text-[12px] tracking-widest text-[#ff8800] pointer-events-none">
          {winner.toUpperCase()} BOOSTED
        </div>
      )}

      {/* Finalizing overlay */}
      {isFinalizing && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
          <div className="text-[#ff8800] text-sm tracking-[0.2em] animate-pulse">
            AUTHENTICATING…
          </div>
        </div>
      )}

      {/* Live badge on feed */}
      {!feedError && (
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/70 px-2 py-0.5 pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-[#ff4400] animate-pulse" />
          <span className="text-[9px] text-[#ff8800] tracking-widest">LIVE — {liveCarId}</span>
        </div>
      )}
    </div>
  );
}
