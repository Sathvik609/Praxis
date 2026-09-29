"""Practice schedule in the prescription (screen 12 · Calendar, 28 Sep 2026)."""
import json

import pytest
from pydantic import ValidationError

from praxis_session.prescription import SEED_PRESCRIPTION, Prescription, Schedule, visit_text
from praxis_session.store import Store


def test_seed_schedule_is_mon_to_fri_peg_test_sunday_and_the_next_visit():
    s = SEED_PRESCRIPTION.schedule
    assert s.practice_days == [0, 1, 2, 3, 4] and s.nhpt_day == 6
    assert s.next_visit is not None and s.next_visit.at == "2026-10-02T14:30" and s.next_visit.with_ == "Dr. Anita Rao, OT"
    assert s.minutes_per_day == 10


def test_minutes_per_day_matches_the_day_plan():
    from praxis_session.plan import DAY_MINUTES

    assert SEED_PRESCRIPTION.schedule.minutes_per_day == DAY_MINUTES


def test_schedule_round_trips_through_json_with_the_with_key():
    blob = json.loads(SEED_PRESCRIPTION.model_dump_json())
    assert blob["schedule"]["next_visit"] == {"at": "2026-10-02T14:30", "with": "Dr. Anita Rao, OT"}
    again = Prescription.model_validate(blob)
    assert again.schedule == SEED_PRESCRIPTION.schedule


def test_old_prescription_json_without_a_schedule_parses_with_the_seed_default():
    blob = json.loads(SEED_PRESCRIPTION.model_dump_json())
    blob.pop("schedule")
    rx = Prescription.model_validate(blob)
    assert rx.schedule == SEED_PRESCRIPTION.schedule


@pytest.mark.parametrize(
    "bad",
    [
        {"practice_days": [], "nhpt_day": 6},  # at least one practice day
        {"practice_days": [0, 0, 1], "nhpt_day": 6},  # unique
        {"practice_days": [0, 7], "nhpt_day": 6},  # 0-6
        {"practice_days": [0, -1], "nhpt_day": 6},
        {"practice_days": [0], "nhpt_day": 7},
        {"practice_days": [0], "nhpt_day": 6, "next_visit": {"at": "next thursday", "with": "Dr. Rao"}},
        {"practice_days": [0], "nhpt_day": 6, "next_visit": {"at": "2026-10-02T14:30", "with": "  "}},
        {"practice_days": [0], "nhpt_day": 6, "minutes_per_day": 0},
    ],
)
def test_schedule_validation(bad):
    with pytest.raises(ValidationError):
        Schedule.model_validate(bad)


def test_practice_days_are_stored_sorted():
    assert Schedule.model_validate({"practice_days": [4, 0, 2], "nhpt_day": 6}).practice_days == [0, 2, 4]


def test_visit_text_reads_like_the_old_patient_label():
    assert visit_text(SEED_PRESCRIPTION.schedule.next_visit) == "Fri 2 Oct, 2:30 PM"  # 2 Oct 2026 is a Friday
    assert visit_text(None) is None


# ---- store -----------------------------------------------------------------------------------


def test_store_serves_the_schedule_and_a_patient_next_visit_derived_from_it(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    assert st.prescription()["schedule"]["practice_days"] == [0, 1, 2, 3, 4]
    assert st.patient()["program"]["next_visit"] == "Fri 2 Oct, 2:30 PM"  # the old seed said Thu 18 Sep (past on 28 Sep)


def test_an_old_database_without_a_schedule_is_brought_up_to_the_seed(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    old = st.prescription()
    old.pop("schedule")
    st._db.execute("UPDATE prescriptions SET json=?", (json.dumps(old),))
    st._db.commit()
    assert st.prescription()["schedule"]["nhpt_day"] == 6  # served with the seed default even before the refresh
    st.seed_if_empty()
    assert json.loads(st._db.execute("SELECT json FROM prescriptions").fetchone()["json"])["schedule"]["nhpt_day"] == 6


def test_a_therapist_schedule_edit_is_a_new_version_and_survives_a_restart(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    new = st.update_schedule({"practice_days": [0, 2, 4], "nhpt_day": 5, "next_visit": {"at": "2026-10-09T10:00", "with": "Dr. Anita Rao, OT"}}, by="therapist")
    assert new["version"] == 4 and new["schedule"]["practice_days"] == [0, 2, 4] and new["schedule"]["nhpt_day"] == 5
    assert new["edited"]["by"] == "therapist" and new["edited"]["from_version"] == 3
    assert new["exercises"] == SEED_PRESCRIPTION.model_dump()["exercises"]  # dose is carried over unchanged
    again = Store(tmp_path / "p.db")  # the service restarts
    again.seed_if_empty()
    rx = again.prescription()
    assert rx["version"] == 4 and rx["schedule"]["practice_days"] == [0, 2, 4] and rx["schedule"]["nhpt_day"] == 5
    assert again.patient()["program"]["next_visit"] == "Fri 9 Oct, 10:00 AM"
    assert again.patient()["program"]["version"] == 4
    log = again.schedule_log()
    assert len(log) == 1 and log[0]["from_version"] == 3 and log[0]["to_version"] == 4 and log[0]["by"] == "therapist"


def test_an_edited_row_at_the_seed_version_is_never_rewritten_from_the_seed(tmp_path):
    """Defence in depth: even if the seed version in code ever catches up with an edited row,
    a row marked `edited` is the therapist's and the refresh leaves it alone."""
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    rx = st.prescription() | {"edited": {"by": "therapist", "at": "2026-09-28T10:00:00", "what": "schedule", "from_version": 2}}
    rx["schedule"] = rx["schedule"] | {"practice_days": [1, 3]}
    st._db.execute("UPDATE prescriptions SET json=?", (json.dumps(rx),))
    st._db.commit()
    st.seed_if_empty()
    assert st.prescription()["schedule"]["practice_days"] == [1, 3]


def test_update_schedule_rejects_a_bad_schedule_and_keeps_the_version(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    with pytest.raises(ValidationError):
        st.update_schedule({"practice_days": [], "nhpt_day": 6, "next_visit": None}, by="therapist")
    assert st.prescription()["version"] == 3 and st.schedule_log() == []


def test_clearing_the_next_visit(tmp_path):
    st = Store(tmp_path / "p.db")
    st.seed_if_empty()
    st.update_schedule({"practice_days": [0, 1, 2, 3, 4], "nhpt_day": 6, "next_visit": None}, by="therapist")
    assert st.prescription()["schedule"]["next_visit"] is None
    assert st.patient()["program"]["next_visit"] is None
