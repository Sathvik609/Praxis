"""Failure handling and human control (10 Oct): a resume is only offered when a fresh OpenCV
setup check passes, and praise after clean sets is rate-limited in code."""
import numpy as np
import pytest

from praxis_session.agent import tools as T
from praxis_session.events import make_event
from praxis_session.perception.board_spec import CUP_TARGETS
from praxis_session.perception.synth import camera_frame
from praxis_session.pipeline import SessionPipeline
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import RULE_LABEL_WITH_AGENT, CoachSession

CUP0 = CUP_TARGETS.targets_mm[0]


def clean_frame():
    return camera_frame(CUP_TARGETS, cup_mm=CUP0)[0]


def dark_frame():
    return (clean_frame().astype(np.float32) * 0.22).astype(np.uint8)


def handle(reg, tmp_path, mode="cup"):
    if mode == "arm":
        p = SessionPipeline(mode="arm", sheet="none", use_hand=False, use_pose=False, exercise="abduction")
    else:
        p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    s = CoachSession(mode=mode, prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="hc", exercise="abduction" if mode == "arm" else None, rule_label=RULE_LABEL_WITH_AGENT)
    return reg.register(T.SessionHandle(session=s, pipeline=p, label="Claude agent · scripted (test)"))


def call(reg, name, **args):
    return T.invoke(name, {"session_id": "hc", **args}, "direct", registry=reg)


def unverified(t):
    return make_event("reach_complete", t=t, to_dot=1, from_dot=0, verified=False, reason="marker_lost", reach_ms=900, arc=1, phase="slow")


def paused(reg, tmp_path, frame):
    h = handle(reg, tmp_path)
    h.pipeline.process(frame, 0.0, 0)
    h.session.on_events([unverified(float(i)) for i in range(1, 4)], snapshot={}, t=3.0)
    assert h.session.paused
    h.begin_run("pause:failed_reps")
    return h, h.session.recent_events(types=["pause"])[-1]


# ---- B3: resume only after a fresh passing check ------------------------------------------
def test_resume_is_refused_while_the_fresh_check_still_fails(tmp_path):
    reg = T.Registry()
    h, pause = paused(reg, tmp_path, dark_frame())
    r = call(reg, "request_resume", reason="Lighting fixed.", evidence=[pause.id])
    assert r["ok"] is False and r["reason"] == "setup still failing: lighting"
    assert r["resume_offered"] is False and "dark" in r["hint"].lower()
    assert not any(e.type == "coach" for e in h.drain(4.0))  # nothing shown
    assert h.session.paused and not h.session.prompts
    assert any(row["kind"] == "resume_blocked" for row in h.session.trace.tail(30))


def test_resume_is_offered_once_the_fresh_check_passes(tmp_path):
    reg = T.Registry()
    h, pause = paused(reg, tmp_path, dark_frame())
    assert call(reg, "request_resume", reason="r", evidence=[pause.id])["ok"] is False
    h.pipeline.process(clean_frame(), 4.0, 1)  # the patient turned a light on
    r = call(reg, "request_resume", reason="The light is good now.", evidence=[pause.id])
    assert r["ok"] is True and r["prompt_id"].startswith("resume-")
    assert any(e.type == "coach" and e.payload["ui"].get("prompt", {}).get("kind") == "resume" for e in h.drain(5.0))


def test_after_a_refused_resume_the_fix_may_be_said_again_once(tmp_path):
    reg = T.Registry()
    h, pause = paused(reg, tmp_path, dark_frame())
    call(reg, "speak", text="It's too dark: add a light in front of you.", cue="correct", evidence=[pause.id])
    with pytest.raises(T.ToolRejected, match="rate"):
        call(reg, "speak", text="Again.", cue="correct", evidence=[pause.id])
    call(reg, "request_resume", reason="r", evidence=[pause.id])
    assert call(reg, "speak", text="Still too dark: turn on a lamp in front of you.", cue="correct", evidence=[pause.id])["ok"]
    with pytest.raises(T.ToolRejected, match="rate"):
        call(reg, "speak", text="And again.", cue="correct", evidence=[pause.id])


def test_resume_without_any_frame_is_refused(tmp_path):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    h.session.on_events([unverified(float(i)) for i in range(1, 4)], snapshot={}, t=3.0)
    pause = h.session.recent_events(types=["pause"])[-1]
    h.begin_run("pause:failed_reps")
    r = call(reg, "request_resume", reason="r", evidence=[pause.id])
    assert r["ok"] is False and "could not be checked" in r["reason"]


# ---- B4: praise rate limit -------------------------------------------------------------
def arc(h, k, unverified_n=0):
    evs = [make_event("reach_complete", t=10.0 * k + i, to_dot=1, from_dot=0, verified=i >= unverified_n, reason=None if i >= unverified_n else "cup_occluded", reach_ms=900, arc=k, phase="slow") for i in range(4)]
    evs.append(make_event("arc_complete", t=10.0 * k + 4, arc=k, reaches=4, unverified=unverified_n))
    h.session.on_events(evs, snapshot={}, t=10.0 * k + 4)
    if h.session.paused:
        h.session.resume(10.0 * k + 4.5)
    return evs[-1]


def review(reg, h, k, text="Nice arc.", unverified_n=0):
    e = arc(h, k, unverified_n)
    h.session._tick(10.0 * k + 5)
    h.begin_run("arc_complete")
    try:
        return call(reg, "speak", text=text, cue="instruct", evidence=[e.id])
    finally:
        h.end_run()
        h.drain(10.0 * k + 5)


def test_praise_after_clean_sets_is_limited_to_one_per_three(tmp_path):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    got = [review(reg, h, k) for k in range(1, 8)]
    allowed = [not r.get("suppressed") for r in got]
    assert allowed == [True, False, False, True, False, False, True]
    sup = got[1]
    assert sup["ok"] is True and sup["suppressed"] is True and "clean" in sup["reason"]
    assert sum(1 for r in h.session.trace.tail(200) if r["kind"] == "praise_suppressed") == 4


def test_praise_is_allowed_when_something_changed(tmp_path):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    assert not review(reg, h, 1).get("suppressed")  # first arc
    assert review(reg, h, 2).get("suppressed")
    assert not review(reg, h, 3, unverified_n=1).get("suppressed")  # an unverified reach


def test_corrections_are_never_rate_limited_as_praise(tmp_path):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    review(reg, h, 1)
    e = arc(h, 2)
    h.session._tick(30.0)
    h.begin_run("arc_complete")
    r = call(reg, "speak", text="Keep the cup low as you move.", cue="correct", evidence=[e.id])
    assert r["ok"] and not r.get("suppressed")


def test_checkin_lines_are_not_praise(tmp_path):
    reg = T.Registry()
    h = handle(reg, tmp_path)
    e = arc(h, 1)
    h.begin_run("checkin")
    assert not call(reg, "speak", text="Slow arcs today.", cue="instruct", evidence=[e.id]).get("suppressed")
