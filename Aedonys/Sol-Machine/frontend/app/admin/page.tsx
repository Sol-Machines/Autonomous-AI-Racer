"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Cycle, VoteTotals } from "@/lib/types";
import type {
  CarStatus, BleCar, TrainingStats, BoostStatus, RaceResultStatus,
} from "@/lib/admin-types";
import CameraDrive from "@/components/admin/CameraDrive";
import RaceControl from "@/components/admin/RaceControl";
import BleCarPanel from "@/components/admin/BleCarPanel";
import TrainingPanel from "@/components/admin/TrainingPanel";
import StatsPanel from "@/components/admin/StatsPanel";

const STATE_STYLES: Record<string, string> = {
  idle:       "text-[#555] border-[#333]",
  starting:   "text-yellow-400 border-yellow-700",
  voting:     "text-[#44ff44] border-[#2a6a2a]",
  finalizing: "text-[#ff8800] border-[#7a4000]",
  boost:      "text-[#ff4400] border-[#7a1a00]",
};

export default function AdminPage() {
  // ── State ────────────────────────────────────────────────────────────────────
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [voteTotals, setVoteTotals] = useState<VoteTotals>({});
  const [carStatus, setCarStatus] = useState<CarStatus>({ connected: false });
  const [knownCars, setKnownCars] = useState<BleCar[]>([]);
  const [scanResults, setScanResults] = useState<BleCar[]>([]);
  const [trainingStats, setTrainingStats] = useState<TrainingStats>({
    total: 0, left: 0, straight: 0, right: 0,
  });
  const [boost, setBoost] = useState<BoostStatus | null>(null);
  const [countdown, setCountdown] = useState(0);

  // WASD keys
  const [keys, setKeys] = useState({ w: false, a: false, s: false, d: false });
  const keysRef = useRef(keys);
  keysRef.current = keys;

  // REC mode
  const [recording, setRecording] = useState(false);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling ──────────────────────────────────────────────────────────────────
  const pollAll = useCallback(async () => {
    try {
      const res = await fetch(`/api/cycle/current?ts=${Date.now()}`, { cache: "no-store" });
      if (res.ok) setCycle(await res.json());
    } catch (_) {}

    try {
      const res = await fetch("/api/cycle/result", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const totals: VoteTotals = {};
        for (const r of data.totals ?? []) totals[r.car_id] = r.vote_count;
        setVoteTotals(totals);
      }
    } catch (_) {}

    try {
      const res = await fetch("/api/car/status", { cache: "no-store" });
      if (res.ok) setCarStatus(await res.json());
      else setCarStatus({ connected: false });
    } catch (_) {
      setCarStatus({ connected: false });
    }

    try {
      const res = await fetch("/api/boost/status", { cache: "no-store" });
      if (res.ok) setBoost(await res.json());
    } catch (_) {}
  }, []);

  const pollKnownCars = useCallback(async () => {
    try {
      const res = await fetch("/api/cars/known", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setKnownCars(data.cars ?? []);
      }
    } catch (_) {}
  }, []);

  const pollTrainingStats = useCallback(async () => {
    try {
      const res = await fetch("/api/training/stats", { cache: "no-store" });
      if (res.ok) setTrainingStats(await res.json());
    } catch (_) {}
  }, []);

  useEffect(() => {
    pollAll();
    pollKnownCars();
    pollTrainingStats();
    const id = setInterval(pollAll, 800);
    const idCars = setInterval(pollKnownCars, 5000);
    const idTrain = setInterval(pollTrainingStats, 3000);
    return () => { clearInterval(id); clearInterval(idCars); clearInterval(idTrain); };
  }, [pollAll, pollKnownCars, pollTrainingStats]);

  // Countdown
  useEffect(() => {
    if (!cycle?.endsAt) { setCountdown(0); return; }
    const tick = () => {
      const ms = new Date(cycle.endsAt!).getTime() - Date.now();
      setCountdown(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [cycle?.endsAt]);

  // ── WASD keyboard ────────────────────────────────────────────────────────────
  const sendControl = useCallback(async (k: typeof keys) => {
    if (carStatus.autonomous) return;
    try {
      await fetch("/api/car/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forward: (k.w || k.a || k.d) ? 1 : 0,
          reverse: k.s ? 1 : 0,
          left: k.a ? 1 : 0,
          right: k.d ? 1 : 0,
        }),
      });
    } catch (_) {}
  }, [carStatus.autonomous]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!["w","a","s","d"].includes(k)) return;
      // Don't capture if typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      const key = k as "w" | "a" | "s" | "d";
      if (keysRef.current[key]) return;
      const next = { ...keysRef.current, [key]: true };
      setKeys(next);
      sendControl(next);
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!["w","a","s","d"].includes(k)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      const key = k as "w" | "a" | "s" | "d";
      const next = { ...keysRef.current, [key]: false };
      setKeys(next);
      sendControl(next);
    };
    document.addEventListener("keydown", onDown);
    document.addEventListener("keyup", onUp);
    return () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
    };
  }, [sendControl]);

  // ── REC sampling ─────────────────────────────────────────────────────────────
  const sampleFrame = useCallback(async () => {
    let label: number;
    if (carStatus.autonomous && carStatus.last_intent) {
      const i = carStatus.last_intent;
      label = i.left ? 0 : i.right ? 2 : 1;
    } else {
      const k = keysRef.current;
      label = k.a ? 0 : k.d ? 2 : 1;
    }
    try {
      await fetch("/api/training/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
    } catch (_) {}
  }, [carStatus.autonomous, carStatus.last_intent]);

  useEffect(() => {
    if (recording) {
      recTimerRef.current = setInterval(sampleFrame, 200); // 5 Hz
    } else if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, [recording, sampleFrame]);

  // ── Action handlers ──────────────────────────────────────────────────────────

  const startRace = async () => {
    try {
      const res = await fetch("/api/race/start", { method: "POST" });
      const data = await res.json();
      if (!res.ok) alert(data.error || "Failed to start race");
      else await pollAll();
    } catch (e) { alert("Start race failed"); }
  };

  const resetRace = async () => {
    try {
      const res = await fetch("/api/admin/reset-race", { method: "POST" });
      const data = await res.json();
      if (!res.ok) alert(data.error || "Failed to reset");
      else await pollAll();
    } catch (e) { alert("Reset failed"); }
  };

  const initRace = async () => {
    // "Initialize" = create a fresh idle race that users can place bets on,
    // without starting the countdown. Backend-wise this is the same as
    // reset-race (it just creates a new idle cycle), but the UI label
    // separates the intent from the destructive "RESET" affordance.
    try {
      const res = await fetch("/api/admin/reset-race", { method: "POST" });
      const data = await res.json();
      if (!res.ok) alert(data.error || "Failed to initialize race");
      else await pollAll();
    } catch (e) { alert("Initialize failed"); }
  };

  const submitResult = async (winnerCarId: string | null, status: RaceResultStatus) => {
    if (!cycle) return;
    try {
      const body: Record<string, unknown> = {
        raceId: cycle.raceId,
        status,
        source: "admin-ui",
      };
      if (status === "completed") body.winningCarId = winnerCarId;
      const res = await fetch("/api/race/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || "Failed to submit result");
      else alert(`Race result submitted. ${data.result?.settlement
        ? `Won: ${data.result.settlement.wonCount}, Lost: ${data.result.settlement.lostCount}, Refunded: ${data.result.settlement.refundedCount}`
        : ""}`);
    } catch (e) { alert("Submit failed"); }
  };

  const scan = async () => {
    try {
      const res = await fetch("/api/car/scan", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setScanResults(data.cars ?? []);
      }
    } catch (_) {}
    pollKnownCars();
  };

  const connectCar = async (address: string, name: string) => {
    try {
      const res = await fetch("/api/car/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, name }),
      });
      const data = await res.json();
      if (!res.ok || !data.connected) alert(data.error || "Connect failed");
      else { await pollAll(); pollKnownCars(); }
    } catch (e) { alert("Connect failed"); }
  };

  const disconnectCar = async () => {
    try {
      await fetch("/api/car/disconnect", { method: "POST" });
      await pollAll();
    } catch (_) {}
  };

  const toggleAutonomous = async () => {
    const newState = !carStatus.autonomous;
    try {
      await fetch("/api/car/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newState }),
      });
      setCarStatus(prev => ({ ...prev, autonomous: newState }));
    } catch (_) {}
  };

  const trainNow = async (): Promise<string> => {
    const res = await fetch("/api/training/run", { method: "POST" });
    const data = await res.json();
    pollTrainingStats();
    return data.message ?? JSON.stringify(data);
  };

  const clearTraining = async (): Promise<number> => {
    const res = await fetch("/api/training/clear", { method: "POST" });
    const data = await res.json();
    pollTrainingStats();
    return data.deleted_frames ?? 0;
  };

  const triggerBoost = async () => {
    try {
      await fetch("/api/boost/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "admin-manual", duration_s: 3.0 }),
      });
      await pollAll();
    } catch (_) {}
  };

  // ── UI ───────────────────────────────────────────────────────────────────────
  const state = cycle?.state ?? "idle";
  const stateStyle = STATE_STYLES[state] ?? STATE_STYLES.idle;
  const timerLabel = () => {
    if (!cycle || state === "idle") return "IDLE";
    if (state === "starting")   return `RACE IN ${countdown}s`;
    if (state === "voting")     return `VOTE ${countdown}s`;
    if (state === "finalizing") return `FINALIZING ${countdown}s`;
    if (state === "boost")      return `⚡ BOOST ${countdown}s`;
    return (state as string).toUpperCase();
  };

  return (
    <div className="min-h-screen bg-[#080808] text-[#f0f0f0] font-mono flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-[#111] border-b border-[#222] gap-3 sticky top-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <Image
            src="/sol-machine-logo.png"
            alt="Sol Machine"
            width={140}
            height={36}
            className="object-contain h-8 w-auto shrink-0"
            priority
          />
          <span className="text-[10px] tracking-[0.2em] text-[#ff4400] border border-[#ff4400] px-1.5 py-0.5">
            ADMIN
          </span>
          <div className={`hidden sm:inline-flex items-center text-[10px] tracking-[0.15em] uppercase border px-2 py-0.5 ${stateStyle}`}>
            {timerLabel()}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#555]">
            cycle <span className="text-[#888]">{cycle?.id ?? "—"}</span> · race <span className="text-[#888]">{cycle?.raceId ?? "—"}</span>
          </span>
          <Link
            href="/"
            className="text-[10px] tracking-widest px-3 py-1.5 border border-[#333] text-[#888] hover:border-[#ff8800] hover:text-[#ff8800] transition-colors"
          >
            ← PUBLIC
          </Link>
        </div>
      </header>

      {/* Main grid */}
      <main className="p-3 space-y-3 flex-1">
        {/* Top row: camera + race control */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <CameraDrive
            carStatus={carStatus}
            keys={keys}
            onToggleAutonomous={toggleAutonomous}
          />
          <RaceControl
            cycle={cycle}
            countdown={countdown}
            onInitRace={initRace}
            onStartRace={startRace}
            onResetRace={resetRace}
            onSubmitResult={submitResult}
          />
        </div>

        {/* BLE car panel */}
        <BleCarPanel
          carStatus={carStatus}
          knownCars={knownCars}
          scanResults={scanResults}
          onScan={scan}
          onConnect={connectCar}
          onDisconnect={disconnectCar}
        />

        {/* Training panel */}
        <TrainingPanel
          stats={trainingStats}
          recording={recording}
          onToggleRec={() => setRecording(r => !r)}
          onTrain={trainNow}
          onClear={clearTraining}
        />

        {/* Stats panel */}
        <StatsPanel
          cycle={cycle}
          voteTotals={voteTotals}
          boost={boost}
          onManualBoost={triggerBoost}
        />
      </main>

      {/* Footer with full status */}
      <footer className="px-3 py-1.5 border-t border-[#1a1a1a] flex gap-4 flex-wrap text-[9px] text-[#444] tracking-wider uppercase">
        <span>state <span className="text-[#666]">{state}</span></span>
        <span>cycle <span className="text-[#666]">{cycle?.id ?? "—"}</span></span>
        <span>race <span className="text-[#666]">{cycle?.raceId ?? "—"}</span></span>
        <span>cycle# <span className="text-[#666]">{cycle?.cycleNumber ?? "—"}</span></span>
        <span className={carStatus.connected ? "text-[#44ff44]/70" : "text-[#444]"}>
          {carStatus.connected ? "● car online" : "○ car offline"}
        </span>
        <span>auto <span className="text-[#666]">{carStatus.autonomous ? "on" : "off"}</span></span>
        <span>frames <span className="text-[#666]">{trainingStats.total}</span></span>
      </footer>
    </div>
  );
}
