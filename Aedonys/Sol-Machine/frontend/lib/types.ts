export type CycleState =
  | "idle"
  | "starting"
  | "voting"
  | "finalizing"
  | "boost";

export interface Cycle {
  id: number;
  raceId: number;
  cycleNumber: number;
  state: CycleState;
  endsAt: string | null;
  winnerCarId: string | null;
}

export interface BetInfo {
  betId: string | null;
  carId: string | null;
  stakeAmount: number | null;
  potentialPayout: number | null;
  status:
    | "pending_payment"
    | "confirmed"
    | "won"
    | "lost"
    | "refunded"
    | null;
}

export type VoteTotals = Record<string, number>;

export const CARS = ["Car 1", "Car 2", "Car 3"] as const;

export interface CarStrategy {
  throttle_aggressiveness: number;
  boost_usage: "immediate" | "save_straights" | "hold_overtake";
  corner_behaviour: "safe" | "normal" | "tight";
  risk_tolerance: number;
  reasoning: string;
}
