"use client";

import { useState, useEffect, useCallback } from "react";
import { CARS, type Cycle, type BetInfo, type VoteTotals } from "@/lib/types";
import Header from "@/components/Header";
import CarBar from "@/components/CarBar";
import ChatPanel from "@/components/ChatPanel";
import LiveFeed from "@/components/LiveFeed";
import CarGrid from "@/components/CarGrid";
import BetPanel from "@/components/BetPanel";
import StatusBar from "@/components/StatusBar";

function getDemoWallet(): string {
  let w = localStorage.getItem("demoWallet");
  if (!w) {
    w = `DemoWallet_${crypto.randomUUID()}`;
    localStorage.setItem("demoWallet", w);
  }
  return w;
}

export default function HomePage() {
  // ── Cycle ────────────────────────────────────────────────────────────────────
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [prevState, setPrevState] = useState<string | null>(null);
  const [voteTotals, setVoteTotals] = useState<VoteTotals>({});
  const [countdown, setCountdown] = useState(0);

  // ── Car / Camera ─────────────────────────────────────────────────────────────
  const [liveCarId, setLiveCarId] = useState("Car 1");
  const [carConnected, setCarConnected] = useState(false);
  const [carName, setCarName] = useState("");
  const [carAddress, setCarAddress] = useState("");
  const [scanResults, setScanResults] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);

  // ── Wallet ───────────────────────────────────────────────────────────────────
  const [demoWallet, setDemoWallet] = useState("");
  const [phantomAddress, setPhantomAddress] = useState("");
  const walletAddress = phantomAddress || demoWallet;
  const walletMode: "phantom" | "demo" = phantomAddress ? "phantom" : "demo";

  // ── Bet ──────────────────────────────────────────────────────────────────────
  const [bet, setBet] = useState<BetInfo>({
    betId: null,
    carId: null,
    stakeAmount: null,
    potentialPayout: null,
    status: null,
  });
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);
  const [selectedStake, setSelectedStake] = useState(1);
  const [isPlacingBet, setIsPlacingBet] = useState(false);

  // ── Vote ─────────────────────────────────────────────────────────────────────
  const [votedCycleId, setVotedCycleId] = useState<number | null>(null);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);

  // ── Init ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setDemoWallet(getDemoWallet());
    const storedCar = localStorage.getItem("liveCarId");
    if (storedCar && (CARS as readonly string[]).includes(storedCar))
      setLiveCarId(storedCar);
    const storedVote = localStorage.getItem("votedCycleId");
    if (storedVote) setVotedCycleId(Number(storedVote));
  }, []);

  // ── Polling ───────────────────────────────────────────────────────────────────
  const pollCycle = useCallback(async () => {
    try {
      const res = await fetch(`/api/cycle/current?ts=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: Cycle = await res.json();
      setCycle((prev) => {
        if (prev?.state !== data.state) setPrevState(prev?.state ?? null);
        return data;
      });
    } catch (_) {}
  }, []);

  const pollVoteTotals = useCallback(async () => {
    try {
      const res = await fetch("/api/cycle/result", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const totals: VoteTotals = {};
      for (const row of data.totals ?? []) totals[row.car_id] = row.vote_count;
      setVoteTotals(totals);
    } catch (_) {}
  }, []);

  const pollCarStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/car/status", { cache: "no-store" });
      if (!res.ok) { setCarConnected(false); return; }
      const data = await res.json();
      setCarConnected(data.connected ?? false);
      if (data.connected && data.name) setCarName(data.name);
      if (data.connected && data.address) setCarAddress(data.address);
      else if (!data.connected) setCarAddress("");
    } catch (_) {
      setCarConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!demoWallet) return;
    pollCycle();
    pollCarStatus();
    const id = setInterval(() => {
      pollCycle();
      pollCarStatus();
    }, 1000);
    return () => clearInterval(id);
  }, [demoWallet, pollCycle, pollCarStatus]);

  useEffect(() => {
    if (!cycle || cycle.state === "idle") return;
    pollVoteTotals();
    const id = setInterval(pollVoteTotals, 2000);
    return () => clearInterval(id);
  }, [cycle?.state, pollVoteTotals]);

  // ── Countdown ─────────────────────────────────────────────────────────────────
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

  // ── Reset on new race ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (prevState && prevState !== "idle" && cycle?.state === "idle") {
      setBet({ betId: null, carId: null, stakeAmount: null, potentialPayout: null, status: null });
      setSelectedCarId(null);
      setVotedCycleId(null);
      setVoteTotals({});
      localStorage.removeItem("votedCycleId");
    }
  }, [cycle?.state, prevState]);

  // ── Recover bet on load ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!walletAddress || !cycle) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/bet/current?wallet=${encodeURIComponent(walletAddress)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.bet) {
          setBet({
            betId: data.bet.id,
            carId: data.bet.car_id,
            stakeAmount: data.bet.stake_amount,
            potentialPayout: data.bet.potential_payout,
            status: data.bet.status,
          });
          setSelectedCarId(data.bet.car_id);
        }
      } catch (_) {}
    })();
  }, [walletAddress, cycle?.raceId]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const connectWallet = async () => {
    const provider =
      (window as any).phantom?.solana ??
      ((window as any).solana?.isPhantom ? (window as any).solana : null);
    if (!provider) {
      alert("Phantom not found — using demo wallet instead.");
      return;
    }
    try {
      const resp = await provider.connect();
      setPhantomAddress(resp.publicKey.toString());
    } catch (e) {
      console.error("Wallet connect failed", e);
    }
  };

  const placeBet = async () => {
    if (!selectedCarId || !walletAddress || isPlacingBet) return;
    setIsPlacingBet(true);
    try {
      const intentRes = await fetch("/api/bet-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          carId: selectedCarId,
          stakeAmount: selectedStake,
        }),
      });
      const intentData = await intentRes.json();
      if (!intentRes.ok) { alert(intentData.error); return; }

      const submitRes = await fetch("/api/bet-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          betId: intentData.betId,
          wallet: walletAddress,
          paymentTxSignature: `mock_bet_tx_${Date.now()}`,
          messageSignature: `mock_bet_msg_${Date.now()}`,
        }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) { alert(submitData.error); return; }

      setBet({
        betId: submitData.betId,
        carId: selectedCarId,
        stakeAmount: selectedStake,
        potentialPayout: submitData.potentialPayout,
        status: "confirmed",
      });
    } catch (e) {
      console.error(e);
      alert("Bet failed — check console");
    } finally {
      setIsPlacingBet(false);
    }
  };

  const submitBoostVote = async (carId: string) => {
    if (!walletAddress || cycle?.state !== "voting") return;
    if (votedCycleId === cycle.id || isSubmittingVote) return;
    setIsSubmittingVote(true);
    try {
      const intentRes = await fetch("/api/vote-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress, carId }),
      });
      const intentData = await intentRes.json();
      if (!intentRes.ok) { alert(intentData.error); return; }

      const submitRes = await fetch("/api/vote-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intentId: intentData.intentId,
          wallet: walletAddress,
          txSignature: `mock_tx_${Date.now()}`,
          messageSignature: `mock_msg_${Date.now()}`,
        }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) { alert(submitData.error); return; }

      setVotedCycleId(submitData.cycleId);
      setSelectedCarId(carId);
      localStorage.setItem("votedCycleId", String(submitData.cycleId));
    } catch (e) {
      console.error(e);
      alert("Vote failed — check console");
    } finally {
      setIsSubmittingVote(false);
    }
  };

  const handleCarClick = (carId: string) => {
    const state = cycle?.state ?? "idle";
    if ((state === "idle" || state === "starting") && bet.status !== "confirmed") {
      setSelectedCarId(carId);
    } else if (state === "voting") {
      submitBoostVote(carId);
    }
  };

  const handleLiveCarChange = (carId: string) => {
    setLiveCarId(carId);
    localStorage.setItem("liveCarId", carId);
  };

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch("/api/car/scan", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const found = new Set<string>(
          (data.cars ?? []).map((c: { name: string }) => c.name)
        );
        setScanResults(found);
      }
    } catch (_) {} finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#080808] text-[#f0f0f0] font-mono overflow-hidden">
      <Header
        cycle={cycle}
        countdown={countdown}
        walletAddress={walletAddress}
        walletMode={walletMode}
        onConnectWallet={connectWallet}
      />
      <CarBar
        liveCarId={liveCarId}
        carConnected={carConnected}
        carName={carName}
        scanResults={scanResults}
        isScanning={isScanning}
        onLiveCarChange={handleLiveCarChange}
        onScan={handleScan}
      />
      <div className="flex-1 flex flex-col min-h-0">
        <LiveFeed cycle={cycle} liveCarId={liveCarId} />
        <ChatPanel carAddress={carAddress} />
        <div className="bg-[#0c0c0c] border-t border-[#1e1e1e] shrink-0">
          <CarGrid
            cycle={cycle}
            voteTotals={voteTotals}
            selectedCarId={selectedCarId}
            betCarId={bet.carId}
            votedCycleId={votedCycleId}
            isSubmittingVote={isSubmittingVote}
            liveCarId={liveCarId}
            onCarClick={handleCarClick}
          />
          <BetPanel
            cycle={cycle}
            bet={bet}
            selectedCarId={selectedCarId}
            selectedStake={selectedStake}
            isPlacingBet={isPlacingBet}
            votedCycleId={votedCycleId}
            isSubmittingVote={isSubmittingVote}
            countdown={countdown}
            onStakeChange={setSelectedStake}
            onPlaceBet={placeBet}
            onBoostVote={() => selectedCarId && submitBoostVote(selectedCarId)}
          />
          <StatusBar
            cycle={cycle}
            walletMode={walletMode}
            walletAddress={walletAddress}
            carConnected={carConnected}
          />
        </div>
      </div>
    </div>
  );
}
