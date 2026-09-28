"""Local SQLite store (edge mode). Same tables DynamoDB will mirror in W6.

patients, prescriptions(vN), sessions (summary/checkin/feedback JSON), events (non-frame),
flags, goal_log. Raw video is never stored anywhere.
"""
from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from praxis_session.perception.exercises import EXERCISES, HIDDEN_IDS
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.seed_data import NHPT_TREND, PATIENT, SAMPLE_PRACTICE, SESSIONS

DEFAULT_PATH = Path(__file__).resolve().parents[1] / "praxis.db"
SCHEMA = """
CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prescriptions(id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT, version INTEGER, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, patient_id TEXT, mode TEXT, started_at TEXT, ended_at TEXT,
  status TEXT, tracking TEXT, title TEXT, summary_json TEXT, feedback_json TEXT, checkin_json TEXT,
  exercise TEXT, username TEXT);
CREATE TABLE IF NOT EXISTS events(session_id TEXT, seq INTEGER, json TEXT, PRIMARY KEY(session_id, seq));
CREATE TABLE IF NOT EXISTS flags(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, rule TEXT, detail TEXT, t REAL, date TEXT, reviewed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS goal_log(id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT, t REAL, note TEXT);
CREATE TABLE IF NOT EXISTS nhpt_trend(patient_id TEXT, date TEXT, total_s REAL, PRIMARY KEY(patient_id, date));
"""

def _next_practice(summary: dict[str, Any]) -> dict[str, Any]:
    mode = summary.get("mode")
    cam = summary.get("camera", {})
    if summary.get("stopped"):
        return {"text": "Session ended by a stop rule. Continue only after your therapist reviews the flag.", "proposal": "review with clinician", "level_change": False}
    if mode == "cup":
        return {"text": "Continue your assigned plan. Fast arcs stay on. No level change — that needs Dr. Rao.", "proposal": "keep 2 slow + 2 fast arcs; keep the hand clear after each placement", "level_change": False}
    if mode == "arm":
        return {"text": "Continue your assigned plan. No level change — that needs Dr. Rao.", "proposal": "keep hold at 3 s, watch leaning" if cam.get("posture_cues") else "keep hold at 3 s", "level_change": False}
    return {"text": "Assessment recorded. Practice continues on the assigned plan.", "proposal": "repeat the peg test weekly, same board and camera setup", "level_change": False}


class Store:
    def __init__(self, path: Path | str = DEFAULT_PATH) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(self.path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(SCHEMA)
        self._migrate()

    def _migrate(self) -> None:
        """Columns added after a database was first written (Sprint E: which exercise a session
        was, and whose it is). SQLite has no IF NOT EXISTS for ADD COLUMN."""
        have = {r["name"] for r in self._db.execute("PRAGMA table_info(sessions)")}
        for col in ("exercise", "username"):
            if col not in have:
                self._db.execute(f"ALTER TABLE sessions ADD COLUMN {col} TEXT")
        self._db.commit()

    # ---- seed --------------------------------------------------------------------------
    def _refresh_seed_prescription(self) -> None:
        """The seed prescription lives in code (`prescription.SEED_PRESCRIPTION`). When the
        newest stored row is that same version but older content (e.g. pain_max 5 and the
        pre-23-Sep exercise list), rewrite it so the API shows the rules the service enforces.
        A newer version is left alone."""
        row = self._db.execute("SELECT id, version, json FROM prescriptions ORDER BY version DESC, id DESC LIMIT 1").fetchone()
        seed = SEED_PRESCRIPTION.model_dump_json()
        if row is None or row["version"] != SEED_PRESCRIPTION.version or json.loads(row["json"]) == json.loads(seed):
            return
        self._db.execute("UPDATE prescriptions SET json=? WHERE id=?", (seed, row["id"]))
        self._db.commit()

    def _refresh_seed_sessions(self) -> None:
        """The illustrative seed history is code too. Rewrite each seed row (by its seed id) from
        `seed_data.SESSIONS`, so a database seeded before 28 Sep stops naming Arm to the front.
        Rows that are not seed ids (real sessions) are never touched."""
        for s in SESSIONS:
            if self._db.execute("SELECT 1 FROM sessions WHERE id=?", (s["id"],)).fetchone() is None:
                continue
            self._db.execute(
                "UPDATE sessions SET mode=?, title=?, summary_json=?, exercise=? WHERE id=?",
                (s["mode"], s["title"], json.dumps(s["summary"]), s.get("exercise"), s["id"]),
            )
        self._db.commit()

    def seed_if_empty(self) -> None:
        """Seed an empty database; on an existing one, bring the seed prescription and the
        illustrative seed history up to date."""
        if self._db.execute("SELECT COUNT(*) FROM patients").fetchone()[0]:
            self._refresh_seed_prescription()
            self._refresh_seed_sessions()
            return
        self._db.execute("INSERT INTO patients(id, json) VALUES(?, ?)", (PATIENT["id"], json.dumps(PATIENT)))
        self._db.execute("INSERT INTO prescriptions(patient_id, version, json) VALUES(?, ?, ?)", (PATIENT["id"], SEED_PRESCRIPTION.version, SEED_PRESCRIPTION.model_dump_json()))
        for d, s in NHPT_TREND:
            self._db.execute("INSERT INTO nhpt_trend(patient_id, date, total_s) VALUES(?, ?, ?)", (PATIENT["id"], d, s))
        for s in SESSIONS:
            self._insert_session(s["id"], s["mode"], s["started_at"], s["ended_at"], s["status"], s["tracking"], s["title"], s["summary"], s["feedback"], s["checkin"], s["events"], s["started_at"][:10], s.get("exercise"), s.get("username"))
        self._db.commit()

    def _insert_session(self, sid, mode, started_at, ended_at, status, tracking, title, summary, feedback, checkin, events, date, exercise=None, username=None) -> None:
        self._db.execute(
            "INSERT OR REPLACE INTO sessions(id, patient_id, mode, started_at, ended_at, status, tracking, title, summary_json, feedback_json, checkin_json, exercise, username) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, PATIENT["id"], mode, started_at, ended_at, status, tracking, title, json.dumps(summary), json.dumps(feedback or {}), json.dumps(checkin or {}), exercise, username),
        )
        self._db.execute("DELETE FROM events WHERE session_id=?", (sid,))
        for i, e in enumerate(events):
            self._db.execute("INSERT INTO events(session_id, seq, json) VALUES(?,?,?)", (sid, i, json.dumps(e)))
        self._db.execute("DELETE FROM flags WHERE session_id=?", (sid,))
        for f in summary.get("flags", []):
            self._db.execute("INSERT INTO flags(session_id, rule, detail, t, date) VALUES(?,?,?,?,?)", (sid, f.get("rule"), f.get("detail"), f.get("t"), date))

    # ---- reads -------------------------------------------------------------------------
    def patient(self) -> dict[str, Any]:
        row = self._db.execute("SELECT json FROM patients LIMIT 1").fetchone()
        p = json.loads(row["json"])
        p["goal_attempts"] = p.get("goal_attempts", 0) + self._db.execute("SELECT COUNT(*) FROM goal_log").fetchone()[0]
        return p

    def prescription(self) -> dict[str, Any]:
        row = self._db.execute("SELECT json FROM prescriptions ORDER BY version DESC LIMIT 1").fetchone()
        return json.loads(row["json"])

    def _row(self, r: sqlite3.Row, with_events: bool = False) -> dict[str, Any]:
        d = {
            "id": r["id"], "mode": r["mode"], "exercise": r["exercise"], "username": r["username"],
            "started_at": r["started_at"], "ended_at": r["ended_at"], "status": r["status"],
            "tracking": r["tracking"], "title": r["title"], "date": (r["started_at"] or "")[:10],
            "summary": json.loads(r["summary_json"] or "{}"), "feedback": json.loads(r["feedback_json"] or "{}"), "checkin": json.loads(r["checkin_json"] or "{}"),
        }
        d["next_practice"] = _next_practice(d["summary"])
        d["delivery"] = d["summary"].get("delivery", "queued · not yet delivered")
        d["illustrative"] = bool(d["summary"].get("illustrative"))  # seed history, never real
        if with_events:
            d["events"] = [json.loads(e["json"]) for e in self._db.execute("SELECT json FROM events WHERE session_id=? ORDER BY seq", (r["id"],))]
        return d

    def sessions(self, limit: int = 50, username: str | None = None) -> list[dict[str, Any]]:
        """Newest first. Sessions of a hidden exercise (28 Sep) stay stored but are not listed,
        so no screen, total or coach history names one."""
        hidden = ",".join("?" * len(HIDDEN_IDS)) or "''"
        visible = f"(exercise IS NULL OR exercise NOT IN ({hidden}))"
        if username is None:
            rows = self._db.execute(f"SELECT * FROM sessions WHERE {visible} ORDER BY started_at DESC LIMIT ?", (*HIDDEN_IDS, limit)).fetchall()
        else:
            rows = self._db.execute(f"SELECT * FROM sessions WHERE username=? AND {visible} ORDER BY started_at DESC LIMIT ?", (username.lower(), *HIDDEN_IDS, limit)).fetchall()
        return [self._row(r) for r in rows]

    def session(self, sid: str) -> dict[str, Any] | None:
        r = self._db.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
        if r is None or r["exercise"] in HIDDEN_IDS:
            return None  # a hidden exercise's session stays stored but is never shown (28 Sep)
        return self._row(r, with_events=True)

    def flags(self, reviewed: bool | None = None) -> list[dict[str, Any]]:
        q = "SELECT * FROM flags" + ("" if reviewed is None else f" WHERE reviewed={1 if reviewed else 0}") + " ORDER BY date DESC, id DESC"
        return [{"id": r["id"], "session_id": r["session_id"], "rule": r["rule"], "detail": r["detail"], "t": r["t"], "date": r["date"], "reviewed": bool(r["reviewed"])} for r in self._db.execute(q)]

    def mark_reviewed(self, flag_id: int) -> None:
        self._db.execute("UPDATE flags SET reviewed=1 WHERE id=?", (flag_id,))
        self._db.commit()

    def nhpt_trend(self) -> list[dict[str, Any]]:
        return [{"date": r["date"], "total_s": r["total_s"]} for r in self._db.execute("SELECT date, total_s FROM nhpt_trend ORDER BY date")]

    def _practice(self, sessions: list[dict[str, Any]]) -> dict[str, Any]:
        """Practice numbers from real sessions only. `planned` needs a schedule the
        prescription does not carry yet, so it (and adherence) is None rather than invented."""
        real = [s for s in sessions if not s["illustrative"]]
        hours = sum(float(s["summary"].get("camera", {}).get("active_s") or 0) for s in real) / 3600
        return {"done": len(real), "planned": None, "hours": round(hours, 1)}

    @staticmethod
    def _adherence(practice: dict[str, Any]) -> int | None:
        planned = practice.get("planned")
        return None if not planned else round(100 * practice["done"] / planned)

    def progress(self) -> dict[str, Any]:
        sessions = self.sessions(100)
        per = [{"date": s["date"], "verified": s["summary"].get("camera", {}).get("verified", 0), "limited": s["tracking"] != "usable", "mode": s["mode"], "illustrative": s["illustrative"]} for s in reversed(sessions) if s["mode"] != "nhpt"]
        pain = [{"date": s["date"], "pain_after": s["feedback"].get("pain_after"), "effort": s["feedback"].get("effort"), "ended_early": s["status"] == "ended_early", "illustrative": s["illustrative"]} for s in reversed(sessions)]
        practice = self._practice(sessions)
        return {
            "nhpt_trend": self.nhpt_trend(),
            "verified_per_session": per,
            "practice": practice,
            "adherence_pct": self._adherence(practice),
            "sample": dict(SAMPLE_PRACTICE) | {"illustrative": True},
            "pain_effort": pain,
            "goal_log_count": self._db.execute("SELECT COUNT(*) FROM goal_log").fetchone()[0],
        }

    # ---- writes ------------------------------------------------------------------------
    def save_session(self, summary: dict[str, Any], checkin: dict[str, Any] | None, feedback: dict[str, Any] | None, events: list[dict[str, Any]]) -> str:
        sid = summary.get("session_id") or f"s-{int(time.time())}"
        cam = summary.get("camera", {})
        t_start, t_end = summary.get("t_start"), summary.get("t_end")
        now = time.time()
        if summary.get("clock") == "clip" or (t_start is not None and t_start < 1e9):
            # Replay runs on clip time (seconds from 0), which is not an epoch: date the
            # session by when it was played, keeping its duration.
            duration = max(0.0, float(t_end or 0) - float(t_start or 0))
            t_start, t_end = now, now + duration
        started = datetime.fromtimestamp(t_start or now).isoformat(timespec="seconds")
        ended = datetime.fromtimestamp(t_end or now).isoformat(timespec="seconds")
        status = "ended_early" if summary.get("stopped") else "complete"
        total = max(1, cam.get("reps_total", 0))
        tracking = "usable" if cam.get("unverified", 0) / total <= 0.3 else "limited"
        if summary.get("mode") == "nhpt" and (summary.get("tracking_lost_events") or cam.get("tracking_lost_events")):
            tracking = "limited"  # pegs seated while tracking was lost cannot be verified
        names = {"nhpt": "Nine-Hole Peg Test", "cup": "Waiter – cup", "arm": EXERCISES["abduction"].name}
        exercise = summary.get("exercise")
        username = (summary.get("username") or "").lower() or None
        title = names.get(summary.get("mode"), summary.get("mode", "session"))
        if summary.get("mode") == "arm" and exercise in EXERCISES:
            title = EXERCISES[exercise].name
        if summary.get("mode") == "nhpt" and cam.get("nhpt_total_s"):
            title += f" · {cam['nhpt_total_s']:.1f} s"
        self._insert_session(sid, summary.get("mode", ""), started, ended, status, tracking, title, summary, feedback, checkin, events, started[:10], exercise, username)
        if summary.get("mode") == "nhpt" and cam.get("nhpt_total_s"):
            self._db.execute("INSERT OR REPLACE INTO nhpt_trend(patient_id, date, total_s) VALUES(?,?,?)", (PATIENT["id"], started[:10], float(cam["nhpt_total_s"])))
        self._db.commit()
        return sid

    def log_goal(self, note: str) -> int:
        self._db.execute("INSERT INTO goal_log(patient_id, t, note) VALUES(?,?,?)", (PATIENT["id"], time.time(), note))
        self._db.commit()
        return self.patient()["goal_attempts"]

    # ---- coach tools -------------------------------------------------------------------
    def read_patient_model(self, patient_id: str) -> dict[str, Any]:
        return {
            "patient_id": patient_id,
            "history": [{"id": s["id"], "date": s["date"], "mode": s["mode"], "status": s["status"], "tracking": s["tracking"], "camera": s["summary"].get("camera", {}), "feedback": s["feedback"], "illustrative": s["illustrative"]} for s in self.sessions(20)],
            "nhpt_trend": self.nhpt_trend(),
            "open_flags": self.flags(reviewed=False),
        }

    def write_session_summary(self, summary: dict[str, Any]) -> dict[str, Any]:
        sid = self.save_session(summary, summary.get("told_us"), None, [])
        return {"ok": True, "session_id": sid}

    def therapist_patients(self) -> list[dict[str, Any]]:
        p = self.patient()
        trend = self.nhpt_trend()
        return [{
            "id": p["id"], "name": p["name"], "program": f"GRASP L{p['program']['level']} · {p['side']} · wk 6",
            "open_flags": len(self.flags(reviewed=False)), "adherence_pct": self._adherence(self._practice(self.sessions(100))),
            "nhpt_last_s": trend[-1]["total_s"] if trend else None, "nhpt_first_s": trend[0]["total_s"] if trend else None,
        }, {"id": "priya", "name": "Priya S.", "program": "GRASP L3 · right · wk 3", "open_flags": 0, "adherence_pct": 92, "nhpt_last_s": None, "nhpt_first_s": None, "illustrative": True},
            {"id": "tom", "name": "Tom K.", "program": "GRASP L1 · left · wk 9", "open_flags": 1, "adherence_pct": 71, "nhpt_last_s": None, "nhpt_first_s": None, "illustrative": True},
            {"id": "june", "name": "June O.", "program": "GRASP L2 · right · wk 1", "open_flags": 0, "adherence_pct": 100, "nhpt_last_s": None, "nhpt_first_s": None, "illustrative": True}]
