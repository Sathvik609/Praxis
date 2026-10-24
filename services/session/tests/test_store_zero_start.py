"""Start from zero (24 Oct 2026): the product opens with no sample history. The illustrative
seed (Alex M.'s September sessions, the NHPT trend, the 19/22 practice card) loads only when
PRAXIS_SAMPLE_HISTORY=1; the patient record and the prescription always load, so every
exercise still runs."""

import json

from praxis_session.seed_data import SESSIONS
from praxis_session.store import Store, sample_history_enabled


def test_sample_history_is_off_unless_asked_for():
    assert sample_history_enabled({}) is False
    assert sample_history_enabled({"PRAXIS_SAMPLE_HISTORY": "0"}) is False
    assert sample_history_enabled({"PRAXIS_SAMPLE_HISTORY": "1"}) is True


def test_zero_start_has_a_prescription_and_no_metrics(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty(sample=False)
    assert st.sessions() == []
    assert st.flags() == []
    assert st.nhpt_trend() == []
    assert st.patient()["goal_attempts"] == 0
    assert st.rx().version >= 1  # exercises still have their prescription
    p = st.progress()
    assert p["sample"] is None
    assert p["practice"]["done"] == 0
    assert p["verified_per_session"] == [] and p["pain_effort"] == []


def test_zero_start_on_a_sampled_database_drops_only_the_sample(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()  # an older database with the sample history
    st.save_session({"session_id": "real-1", "mode": "arm", "exercise": "abduction", "source": "live",
                     "t_start": 1792791312.0, "t_end": 1792791369.0, "camera": {"verified": 3}}, None, None, [])
    st.seed_if_empty(sample=False)
    ids = {s["id"] for s in st.sessions()}
    assert ids == {"real-1"}
    assert not ids & {s["id"] for s in SESSIONS}
    assert st.nhpt_trend() == []
    assert st.patient()["goal_attempts"] == 0
    assert st.progress()["sample"] is None


def test_an_older_stored_clinician_name_gives_way_to_the_prescription(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty(sample=False)
    row = st._db.execute("SELECT id, json FROM patients LIMIT 1").fetchone()
    p = json.loads(row["json"])
    p["program"]["clinician"] = "Dr. Anita Rao, OT"
    p["program"]["short"] = "Hospital GRASP L2 · v3 · Dr. Rao"
    st._db.execute("UPDATE patients SET json = ? WHERE id = ?", (json.dumps(p), row["id"]))
    me = st.patient()
    assert me["program"]["clinician"] == "your therapist"
    assert me["program"]["short"] == "Hospital GRASP L2 · v3"
