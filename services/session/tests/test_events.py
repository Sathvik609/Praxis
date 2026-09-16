import json

from praxis_session.events import EventRing, make_event


def test_make_event_has_type_time_and_payload():
    e = make_event("heartbeat", frame_index=3)
    d = e.to_dict()
    assert d["type"] == "heartbeat"
    assert d["frame_index"] == 3
    assert isinstance(d["t"], float)
    assert isinstance(d["id"], int)


def test_to_json_roundtrip():
    e = make_event("x", a=1)
    assert json.loads(e.to_json())["a"] == 1


def test_ring_keeps_latest_n_and_capacity():
    ring = EventRing(capacity=3)
    for i in range(5):
        ring.append(make_event("n", i=i))
    assert len(ring) == 3
    assert [e.to_dict()["i"] for e in ring.latest(2)] == [3, 4]


def test_ids_are_monotonic():
    a, b = make_event("a"), make_event("b")
    assert b.id > a.id
