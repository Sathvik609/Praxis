# System Usability Scale (SUS) — Praxis

Give this **after** the participant has used Praxis for a full default day (check-in → Arm out to
the side → Waiter – cup → feedback, plus one NHPT if it is their NHPT day), on paper or read
aloud. Ask for their first reaction; do not explain the items. Every item must be answered: if
the participant cannot answer one, mark the middle point (3).

Say: *"Please answer about the Praxis app you just used. For each statement, choose 1 if you
strongly disagree and 5 if you strongly agree."*

| # | Statement | Strongly disagree 1 | 2 | 3 | 4 | Strongly agree 5 |
|---|---|---|---|---|---|---|
| 1 | I think that I would like to use this system frequently. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 2 | I found the system unnecessarily complex. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 3 | I thought the system was easy to use. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 4 | I think that I would need the support of a technical person to be able to use this system. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 5 | I found the various functions in this system were well integrated. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 6 | I thought there was too much inconsistency in this system. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 7 | I would imagine that most people would learn to use this system very quickly. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 8 | I found the system very cumbersome to use. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 9 | I felt very confident using the system. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 10 | I needed to learn a lot of things before I could get going with this system. | ☐ | ☐ | ☐ | ☐ | ☐ |

Participant pseudonym: ______ Date: __________ Session: (live / replay demo) ______

## Entering the answers

Copy `responses_template.csv` to `responses.csv` (once) and add one row per participant:
pseudonym, date (YYYY-MM-DD), the ten answers 1–5 in item order, and a short note
(e.g. "used tap fallback for check-in"). Never a name. Then:

```bash
cd services/session
uv run python ../../evaluation/scripts/sus.py      # -> evaluation/results/sus_v0.{md,json}
```

## Scoring (what `sus.py` does)

Odd items (positive): score − 1. Even items (negative): 5 − score. Sum the ten contributions
(0–40) and multiply by 2.5: a SUS score from 0 to 100 per participant. The report gives n, mean,
standard deviation (sample, n − 1), min and max. The project target is a mean of **≥ 75**. A SUS
score is not a percentage, and with five to ten participants the mean is a rough indication,
not a benchmark.

## Source and licence

Brooke, J. (1996). SUS: A "quick and dirty" usability scale. In P. W. Jordan, B. Thomas,
B. A. Weerdmeester & I. L. McClelland (Eds.), *Usability Evaluation in Industry* (pp. 189–194).
London: Taylor & Francis. The item wording above is Brooke's standard wording, used unchanged;
the scale is free to use with this acknowledgement ("system" may be read as "the Praxis app").
See `docs/LICENSES.md`.
