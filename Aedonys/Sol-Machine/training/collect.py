#!/usr/bin/env python3
"""Collect labelled training frames from the running backend.

The backend's OpenCV perception labels every frame automatically, so you
don't need to annotate anything by hand. Just drive the car around the
track (manually or in autonomous mode) while this script runs.

The more variety the better: curves, straights, different tape positions.
Aim for 500-1000 frames with a reasonable left/straight/right balance.

Usage:
    cd Race\ Mode/training
    python collect.py                          # 5 Hz, localhost:3000
    python collect.py --hz 8 --seconds 120    # 8 Hz for 2 minutes
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def fetch(url: str, timeout: float = 1.5):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read(), r.status


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect line-follower training data")
    parser.add_argument("--hz",      type=float, default=5.0,             help="Collection rate (Hz)")
    parser.add_argument("--seconds", type=float, default=0,               help="Stop after N seconds (0 = run until Ctrl+C)")
    parser.add_argument("--backend", default="http://localhost:3000",     help="Backend base URL")
    parser.add_argument("--out",     default=str(Path(__file__).parent / "data"), help="Output directory")
    args = parser.parse_args()

    out_dir   = Path(args.out)
    frame_dir = out_dir / "frames"
    label_csv = out_dir / "labels.csv"
    frame_dir.mkdir(parents=True, exist_ok=True)

    # Find the next free frame index.
    existing = sorted(frame_dir.glob("*.jpg"))
    idx = int(existing[-1].stem) + 1 if existing else 0
    append = label_csv.exists()

    print(f"Backend : {args.backend}")
    print(f"Output  : {out_dir}")
    print(f"Starting from frame #{idx}")
    print("Drive the car around the track. Ctrl+C to stop.\n")

    import json  # stdlib — fine here

    interval  = 1.0 / args.hz
    deadline  = time.time() + args.seconds if args.seconds > 0 else float("inf")
    counts    = {"left": 0, "straight": 0, "right": 0}
    label_map = {0: "left", 1: "straight", 2: "right"}

    with open(label_csv, "a" if append else "w", newline="") as f:
        writer = csv.writer(f)
        if not append:
            writer.writerow(["frame", "label"])

        try:
            while time.time() < deadline:
                t0 = time.time()

                try:
                    snap_bytes, snap_status = fetch(f"{args.backend}/camera/snapshot")
                    status_bytes, _         = fetch(f"{args.backend}/car/status")
                except urllib.error.URLError as e:
                    print(f"\nFetch error: {e} — is the backend running?")
                    time.sleep(1)
                    continue

                if snap_status != 200:
                    time.sleep(0.1)
                    continue

                status = json.loads(status_bytes)
                intent = status.get("last_intent")
                if not intent:
                    # Perception loop hasn't produced an intent yet.
                    time.sleep(0.1)
                    continue

                # Map intent → class label (0=left, 1=straight, 2=right)
                if intent.get("left"):
                    label = 0
                elif intent.get("right"):
                    label = 2
                else:
                    label = 1

                fname = f"{idx:06d}.jpg"
                (frame_dir / fname).write_bytes(snap_bytes)
                writer.writerow([fname, label])
                f.flush()

                counts[label_map[label]] += 1
                idx += 1
                total = sum(counts.values())
                bar   = f"L={counts['left']:4d}  S={counts['straight']:4d}  R={counts['right']:4d}"
                print(f"\r  {total:5d} frames  |  {bar}", end="", flush=True)

                elapsed = time.time() - t0
                time.sleep(max(0.0, interval - elapsed))

        except KeyboardInterrupt:
            pass

    total = sum(counts.values())
    print(f"\n\nDone. {total} frames saved.")
    print(f"  Left={counts['left']}  Straight={counts['straight']}  Right={counts['right']}")
    if counts["straight"] > counts["left"] * 4:
        print("\nWarning: dataset is heavily biased towards straight. Drive more curves!")
    print(f"\nNext step: python train.py")


if __name__ == "__main__":
    main()
