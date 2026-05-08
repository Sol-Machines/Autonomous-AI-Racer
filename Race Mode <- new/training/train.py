#!/usr/bin/env python3
"""Train the line-follower CNN on frames collected by collect.py.

Input : training/data/frames/*.jpg  +  training/data/labels.csv
Output: training/exports/line_follower.pt  (TorchScript — load with torch.jit.load)

The model is tiny (~100k params) so it trains in seconds on CPU.

Usage:
    cd Race\ Mode/training
    pip install torch          # if not already installed
    python train.py
    python train.py --epochs 50 --lr 5e-4
"""
from __future__ import annotations

import argparse
import csv
import os
import random
import sys
import time
from pathlib import Path

# ── Config (must match collect.py and cnn_line.py) ────────────────────────────
ROI_TOP = float(os.environ.get("OPENCV_ROI_TOP", "0.55"))
IMG_W, IMG_H = 64, 48   # resize target (width, height)
NUM_CLASSES  = 3         # 0=left  1=straight  2=right


def main() -> None:
    parser = argparse.ArgumentParser(description="Train line-follower CNN")
    parser.add_argument("--epochs", type=int,   default=40)
    parser.add_argument("--lr",     type=float, default=1e-3)
    parser.add_argument("--batch",  type=int,   default=32)
    parser.add_argument("--data",   default=str(Path(__file__).parent / "data"))
    parser.add_argument("--out",    default=str(Path(__file__).parent / "exports"))
    args = parser.parse_args()

    try:
        import torch
        import torch.nn as nn
        from torch.utils.data import Dataset, DataLoader
        import cv2
        import numpy as np
    except ImportError as e:
        sys.exit(f"Missing dependency: {e}\nRun: pip install torch opencv-python numpy")

    # ── Dataset ───────────────────────────────────────────────────────────────

    class LineDataset(Dataset):
        def __init__(self, items: list, augment: bool = False):
            self.items   = items
            self.augment = augment

        def __len__(self):
            return len(self.items)

        def __getitem__(self, i):
            path, label = self.items[i]
            img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
            h, w = img.shape
            roi  = img[int(h * ROI_TOP):, :]
            roi  = cv2.resize(roi, (IMG_W, IMG_H))

            # Horizontal flip: left ↔ right, straight stays straight
            if self.augment and random.random() < 0.5:
                roi   = cv2.flip(roi, 1)
                label = 2 - label

            # Brightness jitter
            if self.augment:
                delta = random.uniform(-30, 30)
                roi   = np.clip(roi.astype(np.float32) + delta, 0, 255).astype(np.uint8)

            # Normalize to [-1, 1]
            x = (roi.astype(np.float32) / 255.0 - 0.5) / 0.5
            x = torch.from_numpy(x).unsqueeze(0)   # (1, H, W)
            return x, label

    # ── Model ─────────────────────────────────────────────────────────────────

    class LineCNN(nn.Module):
        def __init__(self):
            super().__init__()
            self.net = nn.Sequential(
                # (1, 48, 64)
                nn.Conv2d(1, 8, 3, padding=1), nn.BatchNorm2d(8), nn.ReLU(), nn.MaxPool2d(2),
                # (8, 24, 32)
                nn.Conv2d(8, 16, 3, padding=1), nn.BatchNorm2d(16), nn.ReLU(), nn.MaxPool2d(2),
                # (16, 12, 16)
                nn.Conv2d(16, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(), nn.MaxPool2d(2),
                # (32, 6, 8)
                nn.Flatten(),
                nn.Linear(32 * 6 * 8, 64), nn.ReLU(), nn.Dropout(0.3),
                nn.Linear(64, NUM_CLASSES),
            )

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            return self.net(x)

    # ── Load data ─────────────────────────────────────────────────────────────

    data_dir  = Path(args.data)
    label_csv = data_dir / "labels.csv"

    if not label_csv.exists():
        sys.exit(f"No labels.csv found at {label_csv}\nRun collect.py first.")

    with open(label_csv) as f:
        rows = list(csv.reader(f))[1:]   # skip header

    items = [(data_dir / "frames" / r[0], int(r[1])) for r in rows if len(r) == 2]
    items = [(p, l) for p, l in items if p.exists()]

    if len(items) < 50:
        sys.exit(f"Only {len(items)} frames — need at least 50. Collect more data.")

    counts = [sum(1 for _, l in items if l == c) for c in range(NUM_CLASSES)]
    print(f"Dataset : {len(items)} frames  L={counts[0]} S={counts[1]} R={counts[2]}")
    print(f"ROI_TOP : {ROI_TOP}   IMG: {IMG_W}x{IMG_H}")

    # Weighted sampling to counter class imbalance
    weights = [1.0 / (counts[l] + 1) for _, l in items]
    sampler = torch.utils.data.WeightedRandomSampler(weights, len(items))

    random.shuffle(items)
    split    = int(0.8 * len(items))
    train_ds = LineDataset(items[:split], augment=True)
    val_ds   = LineDataset(items[split:], augment=False)
    train_dl = DataLoader(train_ds, batch_size=args.batch, sampler=sampler)
    val_dl   = DataLoader(val_ds,   batch_size=args.batch)

    # ── Train ─────────────────────────────────────────────────────────────────

    device    = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model     = LineCNN().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    criterion = nn.CrossEntropyLoss()

    print(f"Device  : {device}")
    params    = sum(p.numel() for p in model.parameters())
    print(f"Params  : {params:,}")
    print()

    exports_dir = Path(args.out)
    exports_dir.mkdir(parents=True, exist_ok=True)
    out_path    = exports_dir / "line_follower.pt"

    best_acc = 0.0
    t0 = time.time()

    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss = 0.0
        for x, y in train_dl:
            x, y = x.to(device), y.to(device)
            optimizer.zero_grad()
            loss = criterion(model(x), y)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()
        scheduler.step()

        model.eval()
        correct = total = 0
        with torch.no_grad():
            for x, y in val_dl:
                x, y = x.to(device), y.to(device)
                correct += (model(x).argmax(1) == y).sum().item()
                total   += len(y)
        val_acc = correct / total if total else 0.0

        if val_acc >= best_acc:
            best_acc = val_acc
            example  = torch.zeros(1, 1, IMG_H, IMG_W).to(device)
            traced   = torch.jit.trace(model, example)
            traced.save(str(out_path))

        if epoch % 10 == 0 or epoch == args.epochs:
            elapsed = time.time() - t0
            print(f"Epoch {epoch:3d}/{args.epochs}  val_acc={val_acc:.3f}  best={best_acc:.3f}  {elapsed:.0f}s")

    print(f"\nSaved  → {out_path}")
    print(f"Best val accuracy: {best_acc:.1%}")
    print()
    print("Next steps:")
    print("  1. Set PERCEPTION_BACKEND=cnn in Race Mode/.env")
    print("  2. Restart the backend — it will load the weights automatically")
    print("  3. Watch /camera/debug to verify CNN steering decisions")


if __name__ == "__main__":
    main()
