# Race Mode — Training pipeline (placeholder)

Offline pipeline for the tiny CNN line-follower. Out of scope until the
OpenCV backend is validated on real hardware.

Planned files:

- `record.py` — drive the car manually via `/car/control`, save each
  frame plus the active steering bits as a labelled sample.
- `dataset.py` — load labelled samples for training.
- `model.py` — small CNN regressor (PilotNet-style) outputting a single
  steering scalar in [-1, 1].
- `train.py` — train and save weights.
- `export.py` — write the trained weights to `exports/line_follower.pt`,
  which `backend/perception/cnn_line.py` loads when
  `PERCEPTION_BACKEND=cnn`.
