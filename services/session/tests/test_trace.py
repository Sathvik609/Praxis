import json

from praxis_session.trace import Trace


def test_trace_writes_jsonl_and_tails(tmp_path):
    tr = Trace(session_id="s1", directory=tmp_path)
    tr.log("event", type="reach_complete", id=7)
    tr.log("decide", action="instruct", evidence=[7])
    tr.log("action", kind="speak", text="Onto dot four")
    lines = (tmp_path / "s1.jsonl").read_text().splitlines()
    assert len(lines) == 3 and json.loads(lines[1])["kind"] == "decide"
    assert [x["kind"] for x in tr.tail(2)] == ["decide", "action"]
    assert all("ts" in x and "seq" in x for x in tr.tail(3))


def test_trace_opens_its_file_lazily_on_the_first_non_session_row(tmp_path):
    """A setup socket that only ever logs its `session` header leaves no file behind
    (audit 17 Sep, D: every WS connection wrote a trace file)."""
    tr = Trace(session_id="s2", directory=tmp_path / "traces")
    tr.log("session", mode="calibrate")
    assert not (tmp_path / "traces").exists()
    assert [x["kind"] for x in tr.tail(5)] == ["session"]
    tr.log("event", type="reach_complete", id=1)
    lines = (tmp_path / "traces" / "s2.jsonl").read_text().splitlines()
    assert [json.loads(x)["kind"] for x in lines] == ["session", "event"]
    tr.log("decide", action="instruct")
    assert len((tmp_path / "traces" / "s2.jsonl").read_text().splitlines()) == 3
