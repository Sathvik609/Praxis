# Usability test plan — Praxis (moderated, ~30 min per person)

This is the study behind the report's §8.7 (usability) and the "evidence of benefit" part of §2.
It measures whether a first-time user can do the default day **without help**, how hard each
step felt, and the System Usability Scale (SUS). It needs **no video recording**: the app
processes the camera in memory as always, and the moderator writes notes on paper or in the
online form. Nothing here adds to the dataset; it is a usability study, not an accuracy study.

Scored by `evaluation/scripts/usability.py` (tasks + SEQ) and `evaluation/scripts/sus.py` (SUS).

## Who

- **Participants:** 5–8 adults who have not seen Praxis. Friends and classmates are fine (say so
  in the report); one older adult (60+) and one person who rarely uses laptops make the result
  much more useful. Not patients: this is a usability check of a prototype, not a clinical study.
- **Therapists (optional, 1–2):** a physiotherapist or occupational therapist does the therapist
  walkthrough (T9) and the short interview in `therapist_interview.md`. This is the closest we can
  get to "evidence of benefit" before a clinical pilot; report it as expert feedback, not outcomes.
- **Moderator:** one team member reads the script and keeps time. **Observer** (optional): a second
  person fills in the observer sheet. The moderator never touches the participant's laptop and never
  explains the screen; if asked "what do I do?", answer "What would you try?" Only after 2 minutes
  stuck, give the **hint** listed for the task and mark the task *assisted*.

## Setup (before the participant arrives)

- A laptop with a built-in camera, Chrome, the app open at `/details` (local `pnpm dev`, the
  review link, or the AWS link once it is up). Settings › reset today's check-in if you used it.
- Printed sheet `docs/sheets/cup_targets.pdf` at 100 %, a mug with a blue band on its base (tape),
  on a table with the laptop tilted as in the setup guide. If you have no kit, run T5 in **Replay**
  mode instead and write `replay` in the task's `mode` column.
- `observer_sheet.md` printed, or the online study form open on a phone (see the README).
- Consent (verbal is enough; read it out): *"We are testing the app, not you. Nothing is recorded:
  the camera picture is processed and thrown away. You can stop at any time. We'll write down what
  you do and say, under a code name like p03, never your name. Is that OK?"* Mark yes/no on the sheet.

## Script

Say: *"Imagine your therapist gave you this app for your shoulder exercises at home. I'll give you
small tasks. Please think aloud — say what you're looking for and what you expect. There are no wrong
answers."* Start a timer for each task when you finish reading it; stop it when the success criterion
is met, the participant says they are done, or at 4 minutes (then it is *failed*).

After **every task**, ask the Single Ease Question (SEQ, Sauro 2009): *"Overall, how easy or difficult
was that task? 1 is very difficult, 7 is very easy."* Write the number.

| # | Task (read aloud) | Success = | Hint after 2 min (→ assisted) |
|---|---|---|---|
| T1 | "Do today's check-in. Your pain is 2 out of 10 and you are practising your right arm." | Check-in saved with pain 2 and right arm; the app shows today's plan. | "Look on the home screen for where today starts." |
| T2 | "Start the exercise *Arm out to the side*. Watch how it is done first." | Demonstration plays for that exercise. | "Each exercise has a way to see it first." |
| T3 | "Set up the camera for it and start the exercise." | Live screen reached with the red "Live · not recording" marker. Setup never blocks, so success is reaching live. | "Follow the list on the setup screen." |
| T4 | "Do a few lifts. Then tell me how many of your lifts the camera counted as checked." | Participant states the verified count shown on screen (± 0). | "The numbers on the side of the picture." |
| T5 | "You feel a sharp pain in your shoulder. Tell the app." | Pain / feel unwell pressed and a pain score entered; session pauses or stops. | "There are buttons that are always on screen." |
| T6 | "End today's session and find what the coach said about it." | Session report open; participant reads the coach note or a correction aloud. | "The report after the session." |
| T7 | "Do the *Waiter – cup* exercise for one round." (live with kit, else Replay) | At least one reach shown as verified (live), or a replay played to the end with the Replay badge noticed (replay). | live: "Put the cup on the dot that lights up." / replay: "Settings has a way to watch a recorded session." |
| T8 | "Find out how your sessions have gone over the past weeks." | Progress screen open, and participant names one trend. | "Look for progress or history." |
| T9 | *(therapists only)* "You are the therapist. Find which of your patient's sessions had a safety flag and why." | Therapist view open; a flag and its reason named. | "There is a separate view for the therapist." |

Then give the **SUS** (`../sus/questionnaire.md`) on paper or in the online form, and ask the two
open questions:

1. *"What was the most confusing moment?"*
2. *"Would you use this between therapy appointments? Why or why not?"*

## What to record per task

`outcome`: `success` (unaided), `assisted` (after the hint), `failed` (4 min or gave up) ·
`time_s` · `errors` (wrong turns: a click that leads away from the goal, counted) · `seq` 1–7 ·
`mode` (`live`/`replay`) · `notes` (quotes, where they got stuck; never a name).

Type them into `tasks.csv` (copy `tasks_template.csv`), one row per participant per task; SUS
answers go in `../sus/responses.csv`. Then:

```bash
cd services/session
uv run python ../../evaluation/scripts/usability.py   # -> evaluation/results/usability_v0.{md,json}
uv run python ../../evaluation/scripts/sus.py         # -> evaluation/results/sus_v0.{md,json}
```

## Issues and severity

After each session, list every problem you saw in `issues.csv` (copy `issues_template.csv`):
the task, what happened, how many participants hit it, and a severity (Nielsen's 0–4):
**4** stops the task or is unsafe (e.g. could not find the pain button) · **3** major, needed the
hint · **2** minor, slowed them · **1** cosmetic · **0** not a problem. `usability.py` lists them by
severity then frequency. Fix 4s and 3s before the freeze (23 Oct) and note the fix next to the issue.

## How the result is reported (rule #3)

- n, and who took part ("6 adults, 2 aged 60+, no patients"), and the mode of every task.
- Task success rate per task with a Wilson 95 % interval, median time, mean SEQ; SUS mean ± SD.
  With 5–8 people these are rough indications, not benchmarks; say so.
- Issues found and what was fixed. Therapist feedback as quotes and the questionnaire table,
  labelled expert feedback, not evidence of clinical benefit.

## References

Brooke J (1996) SUS — see `../sus/questionnaire.md`. Sauro J, Dumas JS (2009) Comparison of three
one-question, post-task usability questionnaires, CHI '09, 1599–1608 (SEQ). Nielsen J (1994)
Severity ratings for usability problems, Nielsen Norman Group.
