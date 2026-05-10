"use client";

import { useState, useEffect, useCallback } from "react";
import { CARS, type Cycle, type BetInfo, type VoteTotals } from "@/lib/types";
import { useToast } from "@/components/Toast";
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
  const toast = useToast();

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
      const data: Cycle | null = await res.json();
      setCycle((prev) => {
        if (prev?.state !== (data?.state ?? null)) setPrevState(prev?.state ?? null);
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
    // Reset whenever we transition out of an active race back to either a
    // fresh idle cycle (admin re-initialized) or to no cycle at all
    // (auto-init disabled — site goes back to "AWAITING NEXT RACE").
    const goneIdle = prevState && prevState !== "idle" && cycle?.state === "idle";
    const goneAway = prevState && prevState !== "idle" && cycle === null;
    if (goneIdle || goneAway) {
      setBet({ betId: null, carId: null, stakeAmount: null, potentialPayout: null, status: null });
      setSelectedCarId(null);
      setVotedCycleId(null);
      setVoteTotals({});
      localStorage.removeItem("votedCycleId");
    }
  }, [cycle, prevState]);

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
      toast({
        variant: "warning",
        title: "Phantom not detected",
        message: "Install Phantom from https://phantom.app and reload.",
      });
      return;
    }
    try {
      // Make sure any stale session is cleared before reconnecting; Phantom
      // sometimes throws "Unexpected error" if a previous session is still
      // half-attached on a refreshed page.
      try { await provider.disconnect(); } catch (_) {}
      const resp = await provider.connect({ onlyIfTrusted: false });
      const pk = resp?.publicKey?.toString?.() ?? provider.publicKey?.toString?.();
      if (!pk) throw new Error("Phantom did not return a public key");
      setPhantomAddress(pk);
      toast({
        variant: "success",
        title: "Wallet connected",
        message: `${pk.slice(0, 4)}…${pk.slice(-4)}`,
      });
    } catch (e: any) {
      console.error("Wallet connect failed", e);
      const msg = e?.message || e?.toString?.() || "Unknown error";
      // User rejected the request — quietly ignore.
      if (e?.code === 4001 || /reject|denied/i.test(msg)) return;
      toast({
        variant: "error",
        title: "Phantom connect failed",
        message: msg + "\nTry: unlock Phantom, switch to Devnet, then reload.",
        durationMs: 8000,
      });
    }
  };

  const placeBet = async () => {
    if (!selectedCarId || !walletAddress || isPlacingBet) return;
    if (!cycle) {
      toast({
        variant: "warning",
        title: "No race scheduled",
        message: "Wait for an admin to initialize the next race.",
      });
      return;
    }
    if (cycle.state !== "idle" && cycle.state !== "starting") {
      toast({
        variant: "warning",
        title: "Betting closed",
        message: "The race has already started — bets are no longer accepted.",
      });
      return;
    }
    if (walletMode !== "phantom") {
      toast({
        variant: "warning",
        title: "Connect Phantom",
        message: "You need to connect a Phantom wallet to place a bet.",
      });
      return;
    }
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
      if (!intentRes.ok) {
        toast({ variant: "error", title: "Bet rejected", message: intentData.error || "Unknown error" });
        return;
      }

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
      if (!submitRes.ok) {
        toast({ variant: "error", title: "Bet rejected", message: submitData.error || "Unknown error" });
        return;
      }

      setBet({
        betId: submitData.betId,
        carId: selectedCarId,
        stakeAmount: selectedStake,
        potentialPayout: submitData.potentialPayout,
        status: "confirmed",
      });
      toast({
        variant: "success",
        title: "Bet placed",
        message: `${selectedStake} on ${selectedCarId} · pot ${submitData.potentialPayout}`,
      });
    } catch (e) {
      console.error(e);
      toast({ variant: "error", title: "Bet failed", message: "Network error — check console for details." });
    } finally {
      setIsPlacingBet(false);
    }
  };

  const submitBoostVote = async (carId: string) => {
    if (!walletAddress || cycle?.state !== "voting") return;
    if (votedCycleId === cycle.id || isSubmittingVote) return;
    if (walletMode !== "phantom") {
      toast({
        variant: "warning",
        title: "Connect Phantom",
        message: "You need to connect a Phantom wallet to vote.",
      });
      return;
    }
    setIsSubmittingVote(true);
    try {
      const intentRes = await fetch("/api/vote-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress, carId }),
      });
      const intentData = await intentRes.json();
      if (!intentRes.ok) {
        toast({ variant: "error", title: "Vote rejected", message: intentData.error || "Unknown error" });
        return;
      }

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
      if (!submitRes.ok) {
        toast({ variant: "error", title: "Vote rejected", message: submitData.error || "Unknown error" });
        return;
      }

      setVotedCycleId(submitData.cycleId);
      setSelectedCarId(carId);
      localStorage.setItem("votedCycleId", String(submitData.cycleId));
      toast({
        variant: "success",
        title: "Boost vote cast",
        message: `Voted for ${carId}`,
      });
    } catch (e) {
      console.error(e);
      toast({ variant: "error", title: "Vote failed", message: "Network error — check console for details." });
    } finally {
      setIsSubmittingVote(false);
    }
  };

  const handleCarClick = (carId: string) => {
    const state = cycle?.state ?? null;
    if (cycle && (state === "idle" || state === "starting") && bet.status !== "confirmed") {
      setSelectedCarId(carId);
    } else if (state === "voting") {
      submitBoostVote(carId);
    }
  };

  const handleLiveCarChange = (carId: string) => {
    setLiveCarId(carId);
    localStorage.setItem("liveCarId", carId);
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
        onLiveCarChange={handleLiveCarChange}
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
