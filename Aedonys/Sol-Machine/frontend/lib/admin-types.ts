export interface CarStatus {
  connected: boolean;
  name?: string;
  address?: string;
  battery?: number | null;
  autonomous?: boolean;
  last_intent?: {
    forward: number;
    reverse: number;
    left: number;
    right: number;
    confidence: number;
    reason: string;
  } | null;
}

export interface BleCar {
  name: string;
  address: string;
}

export interface TrainingStats {
  total: number;
  left: number;
  straight: number;
  right: number;
}

export interface BoostStatus {
  active: boolean;
  remaining_s: number;
}

export type RaceResultStatus = "completed" | "cancelled" | "invalid";
