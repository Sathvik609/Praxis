import struct

from praxis_session.latency import LatencyStats, percentile, split_capture_prefix


def test_percentile_empty_and_nearest_rank():
    assert percentile([], 50) is None
    assert percentile([7.0], 95) == 7.0
    xs = [float(x) for x in range(1, 101)]
    assert percentile(xs, 50) == 50.0
    assert percentile(xs, 95) == 95.0


def test_split_capture_prefix_reads_float64_le_and_accepts_bare_jpeg():
    jpeg = b"\xff\xd8\xff\xe0rest"
    t = 1_758_000_000_123.5
    t_capture, body = split_capture_prefix(struct.pack("<d", t) + jpeg)
    assert t_capture == t and body == jpeg
    t_capture, body = split_capture_prefix(jpeg)
    assert t_capture is None and body == jpeg
    assert split_capture_prefix(b"") == (None, b"")


def test_latency_stats_percentiles_frames_and_dropped():
    st = LatencyStats()
    assert st.summary() == {
        "capture_to_event_p50": None,
        "capture_to_event_p95": None,
        "proc_p50": None,
        "proc_p95": None,
        "event_to_cue_p50": None,
        "event_to_cue_p95": None,
        "frames": 0,
        "dropped": 0,
        "cues": 0,
    }
    for i in range(1, 21):
        st.frame(capture_to_event_ms=float(10 * i), proc_ms=float(i), dropped=1 if i == 5 else 0)
    st.cue(event_to_cue_ms=2.0)
    st.cue(event_to_cue_ms=4.0)
    s = st.summary()
    assert s["frames"] == 20 and s["dropped"] == 1 and s["cues"] == 2
    assert s["capture_to_event_p50"] == 100.0 and s["capture_to_event_p95"] == 190.0
    assert s["proc_p50"] == 10.0 and s["proc_p95"] == 19.0
    assert s["event_to_cue_p50"] == 2.0 and s["event_to_cue_p95"] == 4.0


def test_latency_stats_skips_unknown_capture_time():
    st = LatencyStats()
    st.frame(capture_to_event_ms=None, proc_ms=3.0, dropped=0)
    s = st.summary()
    assert s["frames"] == 1 and s["capture_to_event_p50"] is None and s["proc_p50"] == 3.0
