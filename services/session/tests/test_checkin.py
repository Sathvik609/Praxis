"""`POST /api/checkin` (10 Oct): the day's check-in, tiered in code (`plan.py`) against the current
prescription's stop level, stored, and flagged to the therapist on a rest day or new symptoms.
The contract is the web's (`web/src/lib/api.ts` CheckinBody / CheckinResult, `lib/day.ts`)."""

import json
from datetime import datetime

import pytest

import praxis_session.main as main
from praxis_session.plan import DAY_ORDER

# What `web/src/lib/day.ts` actually posts (`post()`), field for field.
WEB_NOTES = "where: shoulder · energy: okay · time: 14 min"


@pytest.fixture(autouse=True)
def _pinned(monkeypatch, tmp_path):
    import praxis_session.trace as trace

    monkeypatch.setattr(trace, "DEFAULT_DIR", tmp_path / "traces")
    monkeypatch.setattr(main, "_clock", lambda: datetime(2026, 10, 10, 9, 30))


def _post(client, **body):
    return client.post("/api/checkin", json={"new_symptoms": False, "notes": WEB_NOTES} | body)


def _checkin_flags(client):
    return [f for f in client.get("/api/flags").json()["flags"] if f["rule"].startswith("checkin_")]


def test_pain_0_to_3_is_the_full_day_with_no_flag(client):
    r = _post(client, pain=2)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"tier", "flagged", "reasons", "plan"}
    assert body["tier"] == "full" and body["flagged"] is False
    assert isinstance(body["reasons"], list) and all(isinstance(x, str) for x in body["reasons"])
    assert body["plan"]["tier"] == "full" and [i["id"] for i in body["plan"]["items"]] == list(DAY_ORDER)
    assert _checkin_flags(client) == []


def test_pain_4_to_6_is_the_gentle_day_with_no_flag(client):
    body = _post(client, pain=5).json()
    assert body["tier"] == "gentle" and body["flagged"] is False
    assert body["plan"]["tier"] == "gentle" and body["plan"]["items"]
    assert all(i["tier"] == "gentle" for i in body["plan"]["items"])
    assert any("5" in r for r in body["reasons"])
    assert _checkin_flags(client) == []


def test_pain_at_the_stop_level_is_a_rest_day_and_flags_the_therapist(client):
    body = _post(client, pain=8).json()
    assert body["tier"] == "rest" and body["flagged"] is True
    assert body["plan"]["tier"] == "rest" and body["plan"]["items"] == [] and body["plan"]["weekly"] == []
    assert any("8" in r and "7" in r for r in body["reasons"])
    flags = _checkin_flags(client)
    assert len(flags) == 1
    f = flags[0]
    assert f["rule"] == "checkin_pain" and f["date"] == "2026-10-10" and f["reviewed"] is False
    assert "8/10" in f["detail"] and "stop level 7" in f["detail"]


def test_the_stop_level_comes_from_the_current_prescription_not_a_constant(client):
    """A therapist's stricter stop level (pain_max 5, prescription v+1) makes pain 5 a rest day."""
    rx = main.store.prescription()
    rx["version"] += 1
    rx["stop_rules"]["pain_max"] = 5
    main.store._db.execute("INSERT INTO prescriptions(patient_id, version, json) VALUES(?,?,?)", ("alex", rx["version"], json.dumps(rx)))
    main.store._db.commit()
    body = _post(client, pain=5).json()
    assert body["tier"] == "rest" and body["flagged"] is True
    assert "stop level 5" in _checkin_flags(client)[0]["detail"]
    assert _post(client, pain=4).json()["tier"] == "gentle"


def test_new_or_worse_symptoms_are_a_rest_day_and_a_flag_whatever_the_pain(client):
    body = _post(client, pain=1, new_symptoms=True).json()
    assert body["tier"] == "rest" and body["flagged"] is True
    assert body["plan"]["tier"] == "rest" and body["plan"]["items"] == []
    assert any("symptom" in r for r in body["reasons"])
    assert [f["rule"] for f in _checkin_flags(client)] == ["checkin_symptoms"]


def test_the_same_reason_twice_in_a_day_writes_one_flag(client):
    """The web re-posts an unsynced check-in (`syncCheckin`); a second check-in the same day with
    the same reason must not flag the therapist twice, but still says the therapist was told."""
    first = _post(client, pain=8).json()
    again = _post(client, pain=9).json()
    assert first["flagged"] is True and again["flagged"] is True and again["tier"] == "rest"
    assert len(_checkin_flags(client)) == 1
    # A different reason the same day is a new flag; the same reason tomorrow is too.
    _post(client, pain=8, new_symptoms=True)
    assert sorted(f["rule"] for f in _checkin_flags(client)) == ["checkin_pain", "checkin_symptoms"]


def test_the_same_reason_on_another_day_is_a_new_flag(client, monkeypatch):
    _post(client, pain=8)
    monkeypatch.setattr(main, "_clock", lambda: datetime(2026, 10, 11, 9, 0))
    _post(client, pain=8)
    assert [f["date"] for f in _checkin_flags(client)] == ["2026-10-11", "2026-10-10"]


def test_every_check_in_is_stored_with_its_tier(client):
    _post(client, pain=2, rpe=3)
    _post(client, pain=8)
    rows = main.store.checkins("2026-10-10")
    assert [(c["pain"], c["tier"], c["flagged"]) for c in rows] == [(2, "full", False), (8, "rest", True)]
    assert rows[0]["rpe"] == 3 and rows[0]["notes"] == WEB_NOTES and rows[0]["new_symptoms"] is False
    assert rows[1]["reasons"] and rows[0]["patient_id"] == rows[1]["patient_id"]


def test_a_flag_is_traced_and_reaches_the_event_ring(client, tmp_path):
    from praxis_session.schema import validate_event

    _post(client, pain=8)
    rows = [json.loads(line) for f in (tmp_path / "traces").glob("*.jsonl") for line in f.read_text().splitlines()]
    kinds = [r["kind"] for r in rows]
    assert "checkin" in kinds and "flag" in kinds
    flag = next(r for r in rows if r["kind"] == "flag")
    assert flag["rule"] == "checkin_pain"
    ev = client.get("/events?n=5").json()["events"][-1]
    validate_event(ev)
    assert ev["type"] == "therapist_flag" and ev["rule"] == "checkin_pain"


@pytest.mark.parametrize(
    "body",
    [
        {"pain": 11, "new_symptoms": False},
        {"pain": -1, "new_symptoms": False},
        {"pain": "5", "new_symptoms": False},
        {"pain": 5.5, "new_symptoms": False},
        {"pain": True, "new_symptoms": False},
        {"pain": None, "new_symptoms": False},
        {"new_symptoms": False},
        {"pain": 5},
        {"pain": 5, "new_symptoms": "yes"},
        {"pain": 5, "new_symptoms": False, "rpe": 11},
        {"pain": 5, "new_symptoms": False, "notes": "x" * 2001},
        {"pain": 5, "new_symptoms": False, "side": "middle"},
    ],
)
def test_bad_input_is_422_and_writes_nothing(client, body):
    r = client.post("/api/checkin", json=body)
    assert r.status_code == 422
    assert main.store.checkins("2026-10-10") == [] and _checkin_flags(client) == []


def test_a_non_object_body_is_422(client):
    assert client.post("/api/checkin", json=[1, 2]).status_code == 422
