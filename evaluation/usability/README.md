# usability/

Moderated usability test and therapist interview (evidence for report §8.7 and §2). Start with
`PLAN.md`.

| file | use |
|---|---|
| `PLAN.md` | who, setup, consent, the nine tasks with success criteria and hints, how it is reported |
| `observer_sheet.md` | paper sheet, one per participant |
| `therapist_interview.md` | 20–30 min guide + six-item questionnaire for a PT/OT |
| `tasks_template.csv`, `issues_template.csv`, `therapist_template.csv` | copy to `tasks.csv`, `issues.csv`, `therapist.csv` |

**Online form (optional):** https://claude.ai/artifact/Umw2ntQwxSAK6iaBheMAwW. It is the same
tasks, SUS and therapist items on a phone, with per-task timers. It saves to a shared store and
its Results tab gives the three CSVs ready to paste. The page is private to its owner until
shared with the team (Share menu). It holds code names only.

```bash
cd services/session
uv run python ../../evaluation/scripts/usability.py   # tasks, SEQ, issues, therapists
uv run python ../../evaluation/scripts/sus.py         # SUS
```
