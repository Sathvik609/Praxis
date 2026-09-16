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
