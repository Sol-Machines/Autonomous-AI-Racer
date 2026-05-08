"use client";

import { useEffect, useState } from "react";
import type { CarStatus } from "@/lib/admin-types";

interface CameraDriveProps {
  carStatus: CarStatus;
  keys: { w: boolean; a: boolean; s: boolean; d: boolean };
  onToggleAutonomous: () => void;
}

export default function CameraDrive({ carStatus, keys, onToggleAutonomous }: CameraDriveProps) {
  const [feedError, setFeedError] = useState(false);
  const [feedKey, setFeedKey] = useState(0);
  const [raceBackend, setRaceBackend] = useState("http://localhost:3000");
  const auto = carStatus.autonomous ?? false;
  const intent = carStatus.last_intent;

  useEffect(() => {
    setRaceBackend(process.env.NEXT_PUBLIC_RACE_BACKEND || "http://localhost:3000");
  }, []);

  // Direction overlay (in AUTO mode)
  const dirInfo = (() => {
    if (!intent) return { cls: "stopped", text: "—", arrow: "■" };
    if (!intent.forward && !intent.left && !intent.right)
      return { cls: "stopped", text: "STOPPED", arrow: "■" };
    if (intent.left)  return { cls: "left",     text: "LEFT",     arrow: "↖" };
    if (intent.right) return { cls: "right",    text: "RIGHT",    arrow: "↗" };
    return                   { cls: "straight", text: "STRAIGHT", arrow: "↑" };
  })();

  const dirColor = {
    left: "text-[#ff8800]", right: "text-[#ff8800]",
    straight: "text-[#44ff44]", stopped: "text-[#ff4444]",
  }[dirInfo.cls] ?? "text-[#888]";

  // WASD keyboard rendering — highlights based on either pressed key (manual) or AUTO intent
  const keyActive = (k: "w" | "a" | "s" | "d") => {
    if (auto && intent) {
      if (k === "w") return !!intent.forward;
      if (k === "s") return !!intent.reverse;
      if (k === "a") return !!intent.left;
      if (k === "d") return !!intent.right;
    }
    return keys[k];
  };

  return (
    <div className="bg-[#111] border border-[#222] flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1a1a1a]">
        <span className="text-[10px] text-[#888] uppercase tracking-widest">Camera + Drive</span>
        <span className={`text-[10px] tracking-wider ${auto ? "text-[#44ff44]" : "text-[#666]"}`}>
          {auto ? "● AUTO" : "MANUAL"}
        </span>
      </div>

      {/* Live feed */}
      <div className="relative bg-black aspect-video flex items-center justify-center overflow-hidden">
        {!feedError ? (
          <img
            key={feedKey}
            src={`${raceBackend}/camera/stream.mjpeg`}
            alt="Live"
            className="w-full h-full object-contain"
            onError={() => setFeedError(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-[#333]">
            <div className="text-3xl">📷</div>
            <div className="text-xs text-[#444]">Camera offline</div>
            <button
              onClick={() => { setFeedError(false); setFeedKey(k => k + 1); }}
              className="text-[10px] px-2 py-0.5 border border-[#333] text-[#555] hover:text-[#888]"
            >
              RETRY
            </button>
          </div>
        )}

        {/* Direction overlay during AUTO */}
        {auto && intent && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
            <div className={`text-3xl leading-none ${dirColor} drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]`}>
              {dirInfo.arrow}
            </div>
            <div className="text-[9px] tracking-widest text-white/80">{dirInfo.text}</div>
            <div className="w-16 h-0.5 bg-white/20">
              <div
                className={`h-full transition-all ${
                  dirInfo.cls === "straight" ? "bg-[#44ff44]" :
                  dirInfo.cls === "stopped"  ? "bg-[#ff4444]" :
                                               "bg-[#ff8800]"
                }`}
                style={{ width: `${(intent.confidence ?? 0) * 100}%` }}
              />
            </div>
          </div>
        )}

        {!feedError && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/70 px-1.5 py-0.5 pointer-events-none">
            <div className="w-1 h-1 rounded-full bg-[#ff4400] animate-pulse" />
            <span className="text-[8px] text-[#ff8800] tracking-widest">LIVE</span>
          </div>
        )}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-[#1a1a1a]">
        {/* WASD grid */}
        <div className="grid grid-cols-3 grid-rows-2 gap-0.5">
          {(["w", "a", "s", "d"] as const).map(k => (
            <div
              key={k}
              className={`flex items-center justify-center w-6 h-6 text-[10px] font-bold border ${
                keyActive(k)
                  ? "bg-[#ff4400] border-[#ff8800] text-white"
                  : "bg-[#1e1e1e] border-[#333] text-[#555]"
              } ${k === "w" ? "col-start-2 row-start-1" :
                  k === "a" ? "col-start-1 row-start-2" :
                  k === "s" ? "col-start-2 row-start-2" :
                              "col-start-3 row-start-2"}`}
            >
              {k.toUpperCase()}
            </div>
          ))}
        </div>

        <div className="text-[10px] text-[#555] flex-1 leading-tight">
          {auto ? "Autonomous — keys mirror perception intent" : "Manual — hold WASD to steer"}
        </div>

        <button
          onClick={onToggleAutonomous}
          disabled={!carStatus.connected}
          className={`text-[11px] tracking-widest px-3 py-1.5 border transition-colors ${
            auto
              ? "bg-[#0a2a0a] border-[#2a6a2a] text-[#4f4]"
              : "border-[#333] text-[#888] hover:border-[#ff4400]/60 hover:text-[#ff8800]"
          } disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          {auto ? "■ AUTO ON" : "▶▶ AUTO"}
        </button>
      </div>
    </div>
  );
}
