"use client";

import { useState } from "react";
import type { TrainingStats } from "@/lib/admin-types";

interface TrainingPanelProps {
  stats: TrainingStats;
  recording: boolean;
  onToggleRec: () => void;
  onTrain: () => Promise<string>;
  onClear: () => Promise<number>;
}

export default function TrainingPanel({
  stats, recording, onToggleRec, onTrain, onClear,
}: TrainingPanelProps) {
  const [training, setTraining] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [logMsg, setLogMsg] = useState("");

  const handleTrain = async () => {
    setTraining(true);
    setLogMsg("running…");
    try {
      const msg = await onTrain();
      setLogMsg(msg);
    } catch (e: any) {
      setLogMsg(`error: ${e?.message ?? e}`);
    } finally {
      setTraining(false);
    }
  };

  const handleClear = async () => {
    if (!confirm(`Delete all ${stats.total} training frames? This cannot be undone.`)) return;
    setClearing(true);
    try {
      const deleted = await onClear();
      setLogMsg(`Cleared ${deleted} frames`);
      setTimeout(() => setLogMsg(""), 3000);
    } catch (e: any) {
      setLogMsg(`error: ${e?.message ?? e}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="bg-[#111] border border-[#222]">
      <div className="px-3 py-1.5 border-b border-[#1a1a1a]">
        <span className="text-[10px] text-[#888] uppercase tracking-widest">Training (CNN)</span>
      </div>

      <div className="px-3 py-2 flex items-center gap-3 flex-wrap">
        <button
          onClick={onToggleRec}
          className={`text-[11px] tracking-widest px-3 py-1.5 border transition-colors ${
            recording
              ? "bg-[#5a0000] border-[#cc0000] text-[#ff4444] animate-pulse"
              : "bg-[#1e1e1e] border-[#444] text-[#aaa] hover:border-[#ff4400]"
          }`}
        >
          {recording ? "■ STOP" : "● REC"}
        </button>

        <div className="text-[11px] text-[#666] flex gap-3">
          <span>L:<span className="text-[#aaa] ml-1">{stats.left}</span></span>
          <span>S:<span className="text-[#aaa] ml-1">{stats.straight}</span></span>
          <span>R:<span className="text-[#aaa] ml-1">{stats.right}</span></span>
          <span>total:<span className="text-[#ff8800] ml-1 font-bold">{stats.total}</span></span>
        </div>

        <button
          onClick={handleTrain}
          disabled={training || stats.total < 50}
          title={stats.total < 50 ? "Need at least 50 frames" : ""}
          className="text-[11px] px-3 py-1.5 bg-[#0d1f0d] border border-[#1a4a1a] text-[#4c4] hover:bg-[#132813] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {training ? "TRAINING…" : "▶ TRAIN NOW"}
        </button>

        <button
          onClick={handleClear}
          disabled={clearing || stats.total === 0}
          className="text-[11px] px-3 py-1.5 bg-[#1a0d0d] border border-[#4a1a1a] text-[#c44] hover:bg-[#281313] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {clearing ? "CLEARING…" : "🗑 CLEAR"}
        </button>

        {logMsg && (
          <span className="text-[10px] text-[#666] truncate flex-1 min-w-0">{logMsg}</span>
        )}
      </div>
    </div>
  );
}
