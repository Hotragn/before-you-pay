# Real Gemini Nano runs, Kaggle CPU machine, Nov 24 2026

Every run: a Kaggle notebook machine with 4 CPU cores, 31 GB RAM and no GPU, Chrome 158.0.8127.88 stable, headed on Xvfb, Prompt API and on-device model flags on (plus the flag that skips Chrome's speed check). The script is [scripts/nano-kaggle.py](../../scripts/nano-kaggle.py). It opens the live panel, presses "Try the demo store" and "Check this page" twice, and saves the status line, the cards, the totals and Nano's raw answer to the first read.

| Run | Live code | Read | Time on the status line | First-year total |
|---|---|---|---|---|
| 1 | 3367895 (before the Nano fixes) | 1 | 60.0 s | $277.63 |
| 2 | 204e718 | 1 | 144.0 s | $355.39 |
| 2 | 204e718 | 2 | 109.0 s | $355.39 |
| 3 | 959b2a6 | 1 | not captured (about 106 s wall clock) | $307.51 |
| 3 | 959b2a6 | 2 | 69.3 s | $355.39 |
| 4 | 9fa48be | 1 | 113.6 s | $355.39 |
| 4 | 9fa48be | 2 | 89.5 s | $355.39 |

Files: `*-summary.json` (everything the script read off the panel), `*-log.txt` (machine specs, download progress, console), `kaggle-2026-11-24-run2.json` and `-run3.json` (Nano's raw answers, used as unit tests), and `kaggle-2026-11-24-run2-screen.mp4` (the full screen recording of run 2, used in the demo video). Run 1 has no raw answer because the logging was added after it.

Times are wall clock for one short page on CPU. They vary a lot between runs and are not a benchmark.
