# usability/

Moderated usability test and therapist interview (evidence for report §8.7 and §2). Start with
`PLAN.md`.

| file | use |
|---|---|
| `PLAN.md` | who, setup, consent, the nine tasks with success criteria and hints, how it is reported |
| `observer_sheet.md` | paper sheet, one per participant |
| `therapist_interview.md` | 20–30 min guide + six-item questionnaire for a PT/OT |
| `tasks_template.csv`, `issues_template.csv`, `therapist_template.csv` | copy to `tasks.csv`, `issues.csv`, `therapist.csv` |

**Not run for this submission** (no SUS responses, no sessions; `docs/TECHNICAL_REPORT.md` §8.7).

```bash
cd services/session
uv run python ../../evaluation/scripts/usability.py   # tasks, SEQ, issues, therapists
uv run python ../../evaluation/scripts/sus.py         # SUS
```
