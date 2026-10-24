"""Calendar (screen 12, 28 Sep 2026): pure day statuses + GET /api/calendar."""
from datetime import date, datetime

import pytest

from praxis_session.calendar_view import build_calendar, practice_counts, short_name
from praxis_session.prescription import SEED_PRESCRIPTION, NextVisit, Schedule

TODAY = date(2026, 9, 28)  # a Monday
SCHED = SEED_PRESCRIPTION.schedule  # Mon-Fri practice, peg test Sun, visit Thu 1 Oct 2:30 PM


def _s(sid, day, source="live", mode="cup", exercise=None, active_s=600.0, nhpt=None, title=None):
    cam = {"active_s": active_s, "verified": 8}
    if nhpt is not None:
        cam["nhpt_total_s"] = nhpt
    return {
        "id": sid, "date": day, "mode": mode, "exercise": exercise, "source": source,
        "started_at": f"{day}T09:00:00", "ended_at": f"{day}T09:10:00", "title": title or mode,
        "summary": {"camera": cam}, "illustrative": source == "sample", "replay": source == "replay",
    }


def _days(cal):
    return {d["date"]: d for d in cal["days"]}


def test_statuses_for_a_week_with_done_missed_today_planned_rest_and_the_peg_test():
    sessions = [_s("a", "2026-09-21"), _s("b", "2026-09-23", mode="arm", exercise="abduction", active_s=660)]
    cal = build_calendar(SCHED, sessions, date(2026, 9, 21), date(2026, 10, 4), TODAY)
    d = _days(cal)
    assert d["2026-09-21"]["status"] == "done" and d["2026-09-21"]["minutes_done"] == 10
    assert d["2026-09-22"]["status"] == "missed"  # a past practice day after the first real session
    assert d["2026-09-23"]["status"] == "done" and [s["name"] for s in d["2026-09-23"]["sessions"]] == ["Arm out to the side"]
    assert d["2026-09-26"]["status"] == "rest" and d["2026-09-26"]["planned"] is False  # Saturday
    assert d["2026-09-27"]["nhpt_due"] is True and d["2026-09-27"]["status"] == "missed"  # peg-test Sunday, not done
    assert d["2026-09-28"]["status"] == "today" and d["2026-09-28"]["is_today"] is True
    assert d["2026-09-29"]["status"] == "planned" and d["2026-09-29"]["minutes"] == 10
    assert [e["name"] for e in d["2026-09-29"]["exercises"]] == ["Arm out to the side", "Waiter – cup"]
    assert d["2026-10-03"]["status"] == "rest"
    assert d["2026-10-04"]["status"] == "planned" and [e["name"] for e in d["2026-10-04"]["exercises"]] == ["Nine-Hole Peg Test"]
    assert all(x["status"] != "missed" for x in cal["days"] if x["date"] > "2026-09-28")  # future is never red


def test_the_next_clinic_visit_is_on_its_day():
    cal = build_calendar(SCHED, [], date(2026, 9, 28), date(2026, 10, 4), TODAY)
    d = _days(cal)
    visit = d["2026-10-01"]["clinic_visit"]
    assert visit == {"at": "2026-10-01T14:30", "with": "your therapist", "with_short": "your therapist", "time": "2:30 PM"}
    assert d["2026-10-01"]["status"] == "planned"  # a practice day that also has the visit
    assert sum(1 for x in cal["days"] if x["clinic_visit"]) == 1


def test_replays_never_count_and_sample_days_are_labelled_not_done():
    sessions = [
        _s("rp", "2026-09-22", source="replay"),
        _s("smp", "2026-09-10", source="sample", title="Waiter – cup"),
        _s("smp2", "2026-09-12", source="sample", mode="nhpt", nhpt=41.2),
    ]
    cal = build_calendar(SCHED, sessions, date(2026, 9, 7), date(2026, 9, 28), TODAY)
    d = _days(cal)
    assert d["2026-09-22"]["status"] == "untracked" and d["2026-09-22"]["sessions"] == []  # a replay is not practice
    assert d["2026-09-10"]["sample"] is True and d["2026-09-10"]["status"] == "untracked"
    assert d["2026-09-10"]["sessions"][0]["source"] == "sample"
    assert d["2026-09-12"]["sessions"][0]["nhpt_total_s"] == 41.2
    assert all(x["status"] != "done" for x in cal["days"])
    assert cal["tracking_since"] is None


def test_past_practice_days_before_the_first_real_session_are_not_called_missed():
    cal = build_calendar(SCHED, [_s("a", "2026-09-24")], date(2026, 9, 21), date(2026, 9, 27), TODAY)
    d = _days(cal)
    assert d["2026-09-22"]["status"] == "untracked" and d["2026-09-23"]["status"] == "untracked"
    assert d["2026-09-24"]["status"] == "done" and d["2026-09-25"]["status"] == "missed"
    assert cal["tracking_since"] == "2026-09-24"


def test_today_that_is_done_is_done_and_still_marked_today():
    cal = build_calendar(SCHED, [_s("a", "2026-09-28")], date(2026, 9, 28), date(2026, 9, 28), TODAY)
    (d,) = cal["days"]
    assert d["status"] == "done" and d["is_today"] is True


def test_this_week_numbers_come_from_the_program_and_live_practice_only():
    sessions = [
        _s("a", "2026-09-28", active_s=720),
        _s("b", "2026-09-28", mode="arm", exercise="abduction", active_s=300),
        _s("rp", "2026-09-28", source="replay", active_s=900),
        _s("n", "2026-09-28", mode="nhpt", nhpt=38.0, active_s=40),
    ]
    cal = build_calendar(SCHED, sessions, date(2026, 9, 1), date(2026, 9, 30), TODAY)
    assert cal["week"] == {"from": "2026-09-28", "to": "2026-10-04", "done_days": 1, "planned_days": 5, "minutes_done": 17, "minutes_planned": 50, "nhpt_done": True}


def test_week_view_follows_a_therapist_schedule():
    sched = Schedule(practice_days=[0, 2, 4], nhpt_day=5, next_visit=None)
    cal = build_calendar(sched, [], date(2026, 9, 28), date(2026, 10, 4), TODAY)
    planned = [x["date"] for x in cal["days"] if x["planned"]]
    assert planned == ["2026-09-28", "2026-09-30", "2026-10-02"]
    assert [x["date"] for x in cal["days"] if x["nhpt_due"]] == ["2026-10-03"]
    assert cal["week"]["planned_days"] == 3 and cal["week"]["minutes_planned"] == 30
    assert cal["next_visit"] is None and all(x["clinic_visit"] is None for x in cal["days"])


def test_next_visit_block_says_whether_it_is_upcoming():
    cal = build_calendar(SCHED, [], TODAY, TODAY, TODAY, now=datetime(2026, 9, 28, 9, 0))
    assert cal["next_visit"]["upcoming"] is True and cal["next_visit"]["text"] == "Thu 1 Oct, 2:30 PM"
    past = Schedule(practice_days=[0], nhpt_day=6, next_visit=NextVisit(at="2026-09-18T14:30", with_="Dr. Anita Rao, OT"))
    assert build_calendar(past, [], TODAY, TODAY, TODAY, now=datetime(2026, 9, 28, 9, 0))["next_visit"]["upcoming"] is False


def test_practice_counts_for_adherence():
    # First real session Wed 23 Sep; today Mon 28 Sep. Practice days since then, excluding
    # today until it is done: Wed, Thu, Fri = 3. Done practice days: Wed, Fri.
    sessions = [_s("a", "2026-09-23"), _s("b", "2026-09-25"), _s("c", "2026-09-26"), _s("rp", "2026-09-24", source="replay"), _s("smp", "2026-09-24", source="sample")]
    assert practice_counts(SCHED, sessions, TODAY) == {"planned": 3, "days_done": 2}
    sessions.append(_s("d", "2026-09-28"))
    assert practice_counts(SCHED, sessions, TODAY) == {"planned": 4, "days_done": 3}
    assert practice_counts(SCHED, [_s("smp", "2026-09-24", source="sample")], TODAY) == {"planned": None, "days_done": 0}


@pytest.mark.parametrize("full, short", [("Dr. Anita Rao, OT", "Dr. Rao"), ("Sam Lee", "Sam Lee"), ("Dr. Rao", "Dr. Rao")])
def test_short_name(full, short):
    assert short_name(full) == short


# ---- API -------------------------------------------------------------------------------------


@pytest.fixture
def at_28_sep(monkeypatch):
    import praxis_session.main as main

    monkeypatch.setattr(main, "_clock", lambda: datetime(2026, 9, 28, 9, 0))


def test_api_calendar_defaults_to_this_week_from_the_clock(client, at_28_sep):
    cal = client.get("/api/calendar").json()
    assert cal["today"] == "2026-09-28" and cal["from"] == "2026-09-28" and cal["to"] == "2026-10-04"
    assert len(cal["days"]) == 7 and cal["schedule"]["practice_days"] == [0, 1, 2, 3, 4]
    assert cal["schedule"]["next_visit"] == {"at": "2026-10-01T14:30", "with": "your therapist"}
    assert cal["week"]["planned_days"] == 5 and cal["week"]["done_days"] == 0


def test_api_calendar_sample_visit_follows_the_clock_and_says_sample(client, monkeypatch):
    import praxis_session.main as main

    monkeypatch.setattr(main, "_clock", lambda: datetime(2026, 10, 10, 9, 0))
    cal = client.get("/api/calendar").json()
    assert cal["next_visit"]["date"] == "2026-10-13" and cal["next_visit"]["upcoming"] is True and cal["next_visit"]["sample"] is True
    assert client.get("/api/prescription").json()["schedule"]["next_visit"]["sample"] is True
    assert client.get("/api/patients/me").json()["program"]["next_visit"] == "Tue 13 Oct, 2:30 PM"


def test_api_calendar_range_shows_the_labelled_seed_history(client, at_28_sep):
    cal = client.get("/api/calendar?from=2026-09-07&to=2026-09-13").json()
    d = _days(cal)
    assert d["2026-09-10"]["sample"] is True and d["2026-09-10"]["status"] == "untracked"
    assert d["2026-09-12"]["sample"] is True and {s["mode"] for s in d["2026-09-12"]["sessions"]} == {"nhpt", "cup"}
    assert not any(x["status"] == "done" for x in cal["days"])


@pytest.mark.parametrize("q", ["?from=2026-09-10", "?from=2026-09-30&to=2026-09-01", "?from=2026-01-01&to=2026-12-31", "?from=x&to=y"])
def test_api_calendar_rejects_a_bad_range(client, q):
    assert client.get(f"/api/calendar{q}").status_code in (400, 422)


# ---- therapist edit + adherence --------------------------------------------------------------


def test_put_schedule_stores_a_new_version_and_the_calendar_follows(client, at_28_sep, therapist):
    body = {"practice_days": [0, 2, 4], "nhpt_day": 5, "next_visit": {"at": "2026-10-09T10:00", "with": "Dr. Anita Rao, OT"}}
    r = client.put("/api/prescription/schedule", json=body, headers=therapist)
    assert r.status_code == 200
    rx = r.json()
    assert rx["version"] == 4 and rx["schedule"]["practice_days"] == [0, 2, 4] and rx["edited"]["by"] == "therapist"
    assert client.get("/api/prescription").json()["version"] == 4
    cal = client.get("/api/calendar").json()
    assert [x["date"] for x in cal["days"] if x["planned"]] == ["2026-09-28", "2026-09-30", "2026-10-02"]
    assert cal["days"][4]["clinic_visit"] is None and cal["next_visit"]["text"] == "Fri 9 Oct, 10:00 AM"
    assert client.get("/api/patients/me").json()["program"]["next_visit"] == "Fri 9 Oct, 10:00 AM"
    events = client.get("/events?n=5").json()["events"]
    assert any(e["type"] == "prescription_changed" and e["to_version"] == 4 for e in events)


@pytest.mark.parametrize(
    "body",
    [
        {"practice_days": [], "nhpt_day": 6, "next_visit": None},
        {"practice_days": [1, 1], "nhpt_day": 6, "next_visit": None},
        {"practice_days": [8], "nhpt_day": 6, "next_visit": None},
        {"practice_days": [1], "nhpt_day": 9, "next_visit": None},
        {"practice_days": [1], "nhpt_day": 6, "next_visit": {"at": "soon", "with": "Dr. Rao"}},
    ],
)
def test_put_schedule_validates_and_changes_nothing_when_invalid(client, body, therapist):
    r = client.put("/api/prescription/schedule", json=body, headers=therapist)
    assert r.status_code == 422
    assert client.get("/api/prescription").json()["version"] == 3


def _live(sid, t_start, mode="cup"):
    return {"session_id": sid, "mode": mode, "source": "live", "clock": "wall", "t_start": t_start, "t_end": t_start + 600,
            "camera": {"reps_total": 10, "verified": 9, "unverified": 1, "corrections": 0, "active_s": 600.0},
            "told_us": {}, "exertion": {"level": "low", "reasons": [], "method": "behavioural"},
            "coach": {"label": "Rule-based coach · LLM agent pending", "notes": [], "decisions": 1}, "flags": [], "stopped": False}


def test_progress_and_therapist_adherence_come_from_the_schedule(tmp_path):
    from praxis_session.store import Store

    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    today = date(2026, 9, 28)
    p = st.progress(today=today)
    assert p["practice"]["planned"] is None and p["adherence_pct"] is None  # no live session yet
    for sid, day in (("a", 23), ("b", 25)):
        st.save_session(_live(sid, datetime(2026, 9, day, 9, 0).timestamp()), checkin={}, feedback={}, events=[])
    p = st.progress(today=today)
    assert p["practice"] == {"done": 2, "planned": 3, "days_done": 2, "hours": 0.3}
    assert p["adherence_pct"] == 67
    assert st.therapist_patients(today=today)[0]["adherence_pct"] == 67


def test_api_progress_reads_today_from_the_clock(client, at_28_sep):
    import praxis_session.main as main

    main.store.save_session(_live("a", datetime(2026, 9, 25, 9, 0).timestamp()), checkin={}, feedback={}, events=[])
    p = client.get("/api/progress").json()
    assert p["practice"]["planned"] == 1 and p["practice"]["days_done"] == 1 and p["adherence_pct"] == 100
    assert client.get("/api/therapist/patients").json()["patients"][0]["adherence_pct"] == 100
