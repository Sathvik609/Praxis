# evaluation

Labeled dataset, scripts that regenerate every number, result tables and failure cases.

- `dataset_v0/` — synthetic NHPT clip rendered with OpenCV 5 from the sheet spec (`"synthetic": true`). Real recordings are added by hand to `manifest.json` with `"synthetic": false` and a `labels.json` in the same schema (`reps[{rep, hole, t_lift, t_seated, t_clear}]`, `nhpt{t_start, t_end, total_s}`). Real `.mp4` files are git-ignored (consented clips are never committed).
- `scripts/make_dataset_v0.py` — regenerates the synthetic clip and labels.
- `scripts/eval.py` — replays every manifest entry through the identical pipeline **at product defaults** (`--debounce 2 --clear 3`, the values the app ships; change them only to study sensitivity, never for the headline table); rep F1 (hole match within ±tol s of the labeled seat), NHPT MAE, cup reach F1 and reach-time MAE, arm rep F1 and peak-angle MAE; writes `results/dataset_v0.{json,md}` with the settings recorded in both.
- `failure_cases/` — every miss on a real clip, with the frames and the reason (from Phase 2 real recordings on).

```bash
cd services/session
uv run python ../../evaluation/scripts/make_dataset_v0.py
uv run python ../../evaluation/scripts/eval.py
```

Synthetic numbers validate the pipeline only; they are not evidence about real-world accuracy.
