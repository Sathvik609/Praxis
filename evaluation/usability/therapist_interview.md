# Therapist interview guide (20–30 min, semi-structured)

For 1–2 physiotherapists or occupational therapists. Goal: expert judgement of whether Praxis would
be **useful and safe** between appointments, and what would stop them prescribing it. This is expert
feedback on a prototype; report it as quotes and a small table, never as evidence of clinical benefit.

**Consent (read aloud):** "We'd like your professional opinion of a student prototype. We will take
notes, no recording. We'll quote you as 'a physiotherapist with N years' experience' unless you say
otherwise. You can skip any question." Code them t01, t02.

## 1. Context (5 min)
1. What upper-limb home programmes do you prescribe most (stroke, shoulder, hand)?
2. How do you find out today whether a patient did their home exercises, and did them well?
3. What goes wrong most often at home (not doing them, doing them wrong, overdoing, pain)?

## 2. Walkthrough (10 min)
Show, or let them drive: check-in with pain tiers → Arm out to the side live (angle band, verified
count, "Sit tall" correction) → a stop-rule pause → Waiter – cup (replay is fine) → session report
→ therapist view (flags, trends). Then the Nine-Hole Peg Test screen. Think aloud. Note quotes.

Ask while they look:
4. The pain tiers are 0–3 full dose, 4–6 gentle, ≥ 7 rest advised (or continue gently) and a flag to you. Are those cut-offs sensible?
5. The camera reports "verified" and "unverified" reps and never a score out of 100. Is that the
   right level of information for you? For the patient?
6. The coach may suggest an easier or harder dose, only within adaptations you allowed, and the patient
   must tap Yes. What would you want to allow, and what never?
7. A home NHPT on a printed sheet is not the standardised board. Would the trend still be useful to you?

## 3. Questionnaire (2 min) — 1 strongly disagree … 5 strongly agree
| # | Statement |
|---|---|
| q1 | The information in the therapist view would help me review a patient's home practice. |
| q2 | The stop rules (pain, new symptoms, repeated lean, tracking lost) are appropriate for home use. |
| q3 | I would trust the verified rep counts enough to discuss them with a patient. |
| q4 | Patients I see could set up the camera and sheets on their own. |
| q5 | The coach's corrections are the kind of feedback I would give. |
| q6 | I would consider prescribing a tool like this between appointments. |

`would_recommend`: "How likely are you to recommend it to a colleague, 0–10?"

## 4. Close (3 min)
8. What is the one thing that would stop you using it?
9. What is missing that you would need first?

Enter answers in `therapist.csv` (copy `therapist_template.csv`): role (PT/OT), years, q1–q6, the
0–10 answer, and short notes. `usability.py` adds a therapist table when the file exists. The six
items are our own (not a validated scale); say so wherever they are reported.
