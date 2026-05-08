"use client";

import { useState } from "react";
import type { CarStatus, BleCar } from "@/lib/admin-types";

interface BleCarPanelProps {
  carStatus: CarStatus;
  knownCars: BleCar[];
  scanResults: BleCar[];
  onScan: () => Promise<void>;
  onConnect: (address: string, name: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export default function BleCarPanel({
  carStatus, knownCars, scanResults, onScan, onConnect, onDisconnect,
}: BleCarPanelProps) {
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const inRangeAddrs = new Set(scanResults.map(c => c.address));
  const knownAddrs = new Set(knownCars.map(c => c.address));
  const cards: (BleCar & { inRange: boolean | null })[] = [
    ...knownCars.map(c => ({ ...c, inRange: scanResults.length ? inRangeAddrs.has(c.address) : null })),
    ...scanResults.filter(c => !knownAddrs.has(c.address)).map(c => ({ ...c, inRange: true })),
  ];

  const handleScan = async () => {
    setScanning(true);
    try { await onScan(); } finally { setScanning(false); }
  };

  const handleConnect = async (address: string, name: string) => {
    setConnecting(address);
    try { await onConnect(address, name); } finally { setConnecting(null); }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try { await onDisconnect(); } finally { setDisconnecting(false); }
  };

  return (
    <div className="bg-[#111] border border-[#222]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1a1a1a]">
        <span className="text-[10px] text-[#888] uppercase tracking-widest">BLE Car</span>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${carStatus.connected ? "bg-[#44ff44] shadow-[0_0_6px_#44ff44]" : "bg-[#444]"}`} />
          <span className="text-[10px] text-[#888]">
            {carStatus.connected ? carStatus.name || "connected" : "disconnected"}
          </span>
        </div>
      </div>

      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="text-[11px] px-3 py-1 border border-[#333] text-[#888] hover:border-[#ff4400]/50 hover:text-[#ff8800] disabled:opacity-30 transition-colors"
          >
            {scanning ? "🔍 SCANNING…" : "🔍 SCAN"}
          </button>
          {carStatus.connected && (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-[11px] px-3 py-1 border border-[#660000] text-[#ff4444] hover:bg-[#ff0000]/10 disabled:opacity-30 transition-colors"
            >
              {disconnecting ? "DISCONNECTING…" : "DISCONNECT"}
            </button>
          )}
          <span className="text-[10px] text-[#555]">
            {scanResults.length > 0 && `${scanResults.length} in range`}
          </span>
        </div>

        {/* Cards */}
        {cards.length === 0 ? (
          <div className="text-[10px] text-[#444] py-2">No known cars yet — run a scan</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {cards.map(c => {
              const isActive = carStatus.address === c.address;
              const isConnecting = connecting === c.address;
              return (
                <button
                  key={c.address}
                  onClick={() => !isActive && !isConnecting && handleConnect(c.address, c.name)}
                  disabled={isActive || isConnecting}
                  className={`text-left p-2 border transition-colors ${
                    isActive ? "border-[#44ff44] bg-[#0d1a0d]" :
                    isConnecting ? "border-[#ff8800] animate-pulse" :
                    c.inRange === false ? "border-[#222] opacity-40" :
                    c.inRange === true  ? "border-[#2a5a2a] hover:border-[#44ff44]" :
                                          "border-[#333] hover:border-[#ff8800]/50"
                  }`}
                >
                  <div className="text-[11px] font-bold truncate">{c.name}</div>
                  <div className="text-[9px] text-[#555] font-mono truncate">{c.address}</div>
                  {c.inRange === true && (
                    <div className="text-[9px] text-[#44ff44]">● IN RANGE</div>
                  )}
                  {c.inRange === false && (
                    <div className="text-[9px] text-[#666]">○ NOT FOUND</div>
                  )}
                  {isActive && <div className="text-[9px] text-[#44ff44]">connected ✓</div>}
                  {isConnecting && <div className="text-[9px] text-[#ff8800]">connecting…</div>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
