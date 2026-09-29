"""Calendar (screen 12, Figma frame `12_calendar`, 28 Sep 2026): day statuses from the
prescription's practice schedule and the stored sessions. Pure functions, no clock of their
own: `today` (and `now` for the clinic visit) come from the caller, so tests pin them.

| status      | when                                                                      |
|-------------|---------------------------------------------------------------------------|
| `done`      | a **live** session that day (the patient at the camera)                    |
| `today`     | today, nothing live yet                                                    |
| `planned`   | a future practice day or peg-test day                                      |
| `missed`    | a past practice / peg-test day with no live session, on or after the first live session |
| `untracked` | a past practice / peg-test day before the first live session (nothing to judge by) |
| `rest`      | not a practice day and not the peg-test day                               |

Replays (a recorded clip through the pipeline) never count and are left out of the days.
Sample sessions (the illustrative seed history) are listed on their day with `sample: true`
and never make a day `done` or count in `week` (a sample day keeps its schedule status, e.g.
`untracked` or `rest`; the web labels it Sample). Future days are never `missed`.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from praxis_session.perception.exercises import EXERCISES
from praxis_session.plan import DAY_ORDER, WEEKLY
from praxis_session.prescription import NextVisit, Schedule, visit_text

MODE_EXERCISE = {"arm": "abduction", "cup": "cup", "nhpt": "nhpt"}  # a bare mode, as the service runs it since 28 Sep
MAX_DAYS = 62  # a month grid is at most 6 weeks


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def short_name(full: str) -> str:
    """A day card's short clinician name: "Dr. Anita Rao, OT" -> "Dr. Rao"; no title, kept."""
    name = full.split(",")[0].strip()
    parts = name.split()
    if len(parts) > 2 and parts[0].endswith("."):
        return f"{parts[0]} {parts[-1]}"
    return name


def _time(t: datetime) -> str:
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def _exercise_id(s: dict[str, Any]) -> str | None:
    ex = s.get("exercise")
    if ex in EXERCISES and EXERCISES[ex].visible:
        return ex
    return MODE_EXERCISE.get(s.get("mode") or "")


def _minutes(s: dict[str, Any]) -> int:
    active = (s.get("summary") or {}).get("camera", {}).get("active_s")
    if active:
        return max(1, round(float(active) / 60))
    try:
        secs = (datetime.fromisoformat(s["ended_at"]) - datetime.fromisoformat(s["started_at"])).total_seconds()
    except (KeyError, TypeError, ValueError):
        return 0
    return max(0, round(secs / 60))


def _entry(s: dict[str, Any]) -> dict[str, Any]:
    ex_id = _exercise_id(s)
    cam = (s.get("summary") or {}).get("camera", {})
    return {
        "id": s["id"], "title": s.get("title"), "exercise": ex_id, "name": EXERCISES[ex_id].name if ex_id else s.get("title"),
        "mode": s.get("mode"), "minutes": _minutes(s), "source": s["source"], "verified": cam.get("verified"),
        "nhpt_total_s": cam.get("nhpt_total_s"),
    }


def _names(ids: tuple[str, ...]) -> list[dict[str, str]]:
    return [{"id": i, "name": EXERCISES[i].name} for i in ids if EXERCISES[i].visible]


def _live(sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [s for s in sessions if s.get("source") == "live"]


def _practice(s: dict[str, Any]) -> bool:
    return s.get("mode") != "nhpt"  # the peg test is an assessment, not practice


def tracking_since(sessions: list[dict[str, Any]]) -> str | None:
    """The first day with a live session: before it the app has nothing to judge a day by."""
    dates = [s["date"] for s in _live(sessions) if s.get("date")]
    return min(dates) if dates else None


def practice_counts(schedule: Schedule, sessions: list[dict[str, Any]], today: date) -> dict[str, Any]:
    """Adherence inputs. `planned`: practice days from the first live session up to yesterday,
    plus today once it is done (None before any live session). `days_done`: those practice
    days with a live practice session. Replays and samples never count."""
    since = tracking_since(sessions)
    if since is None:
        return {"planned": None, "days_done": 0}
    done = {s["date"] for s in _live(sessions) if _practice(s)}
    start, planned, days_done = date.fromisoformat(since), 0, 0
    d = start
    while d <= today:
        iso = d.isoformat()
        if d.weekday() in schedule.practice_days and (d < today or iso in done):
            planned += 1
            days_done += iso in done
        d += timedelta(days=1)
    return {"planned": planned, "days_done": days_done}


def _visit(v: NextVisit | None, now: datetime | None) -> dict[str, Any] | None:
    if v is None:
        return None
    when = v.when()
    return {"at": v.at, "with": v.with_, "with_short": short_name(v.with_), "time": _time(when), "date": when.date().isoformat(),
            "text": visit_text(v), "upcoming": now is None or when >= now}


def build_calendar(schedule: Schedule, sessions: list[dict[str, Any]], start: date, end: date, today: date, now: datetime | None = None) -> dict[str, Any]:
    """Days `start..end` (inclusive) plus this week's numbers (the Mon-Sun week holding `today`)."""
    shown = [s for s in sessions if s.get("source") in ("live", "sample") and s.get("date")]
    by_day: dict[str, list[dict[str, Any]]] = {}
    for s in sorted(shown, key=lambda s: s.get("started_at") or ""):
        by_day.setdefault(s["date"], []).append(s)
    since = tracking_since(sessions)
    visit = _visit(schedule.next_visit, now)
    today_iso = today.isoformat()
    days = []
    d = start
    while d <= end:
        iso = d.isoformat()
        day_sessions = by_day.get(iso, [])
        live = [s for s in day_sessions if s["source"] == "live"]
        planned = d.weekday() in schedule.practice_days
        nhpt_due = d.weekday() == schedule.nhpt_day
        due = planned or nhpt_due
        if live:
            status = "done"
        elif iso == today_iso:
            status = "today"
        elif iso > today_iso:
            status = "planned" if due else "rest"
        elif not due:
            status = "rest"
        else:
            status = "missed" if since is not None and iso >= since else "untracked"
        days.append({
            "date": iso,
            "weekday": d.weekday(),
            "is_today": iso == today_iso,
            "status": status,
            "planned": planned,
            "nhpt_due": nhpt_due,
            "minutes": schedule.minutes_per_day if planned else 0,
            "minutes_done": sum(_minutes(s) for s in live),
            "exercises": (_names(DAY_ORDER) if planned else []) + (_names(WEEKLY) if nhpt_due else []),
            "sessions": [_entry(s) for s in day_sessions],
            "sample": bool(day_sessions) and not live,
            "clinic_visit": {k: visit[k] for k in ("at", "with", "with_short", "time")} if visit and visit["date"] == iso else None,
        })
        d += timedelta(days=1)

    w0 = week_start(today)
    w1 = w0 + timedelta(days=6)
    in_week = [s for s in _live(sessions) if s.get("date") and w0.isoformat() <= s["date"] <= w1.isoformat()]
    practice = [s for s in in_week if _practice(s)]
    week = {
        "from": w0.isoformat(),
        "to": w1.isoformat(),
        "done_days": len({s["date"] for s in practice}),
        "planned_days": len(schedule.practice_days),
        "minutes_done": sum(_minutes(s) for s in practice),
        "minutes_planned": len(schedule.practice_days) * schedule.minutes_per_day,
        "nhpt_done": any(not _practice(s) for s in in_week),
    }
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "today": today_iso,
        "days": days,
        "week": week,
        "schedule": schedule.model_dump(mode="json"),
        "next_visit": visit,
        "tracking_since": since,
    }
