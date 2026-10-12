"""The CloudWatch files in infra/ec2 agree with what the service emits (12 Oct): every Praxis
metric the dashboard or an alarm reads is one `ops.METRICS` registers, with the same
dimensions; the agent, unit and logrotate name the same log file; the log group and alarm names
match across the setup script and the dashboard."""
import json
import re
from pathlib import Path

from praxis_session import ops

EC2 = Path(__file__).resolve().parents[3] / "infra" / "ec2"
PLACEHOLDERS = {"REGION", "INSTANCE_ID", "DISTRIBUTION_ID", "ACCOUNT_ID"}
SUBS = {"REGION": "us-east-2", "INSTANCE_ID": "i-0123456789abcdef0", "DISTRIBUTION_ID": "E123", "ACCOUNT_ID": "123456789012"}


def dashboard_text() -> str:
    return (EC2 / "cloudwatch" / "dashboard.json").read_text()


def setup_script() -> str:
    return (EC2 / "cloudwatch_setup.sh").read_text()


def praxis_metrics_in_dashboard() -> list[tuple[str, tuple[str, ...]]]:
    """(metric name, dimension names) for every Praxis metric the dashboard reads."""
    out = []
    for w in json.loads(dashboard_text())["widgets"]:
        for row in w.get("properties", {}).get("metrics", []):
            if isinstance(row[0], dict):  # an expression row
                expr = row[0]["expression"]
                for schema, name in re.findall(r"\{Praxis,([^}]*)\} MetricName=\"(\w+)\"", expr):
                    out.append((name, tuple(schema.split(","))))
            elif row[0] == "Praxis":
                strs = [x for x in row[2:] if isinstance(x, str)]
                out.append((row[1], tuple(strs[0::2])))
    return out


def test_dashboard_is_valid_json_with_only_known_placeholders():
    text = dashboard_text()
    assert set(re.findall(r"\$\{(\w+)\}", text)) <= PLACEHOLDERS
    for k, v in SUBS.items():
        text = text.replace("${" + k + "}", v)
    body = json.loads(text)
    assert len(body["widgets"]) >= 10
    assert all(w["x"] + w["width"] <= 24 for w in body["widgets"])


def test_every_praxis_metric_on_the_dashboard_is_emitted_with_those_dimensions():
    seen = praxis_metrics_in_dashboard()
    assert len(seen) >= 15
    for name, dims in seen:
        assert name in ops.METRICS, f"dashboard reads {name}, which the service never emits"
        assert dims == ops.METRICS[name][1], f"{name}: dashboard dims {dims} != emitted {ops.METRICS[name][1]}"
    names = {n for n, _ in seen}
    # the brief: sessions, verified reps, frame latency p50/p95, event-to-cue, agent runs/fallbacks/cost, stop rules
    assert {"Sessions", "RepsVerified", "RepsUnverified", "FrameProcP50Ms", "FrameProcP95Ms", "EventToCueP95Ms", "AgentRuns", "AgentFallbacks", "AgentCostUSD", "StopRuleActions", "Heartbeat"} <= names


def test_alarms_read_emitted_metrics_and_match_the_dashboard_alarm_widget():
    script = setup_script()
    alarms = re.findall(r"--alarm-name (\S+)", script)
    assert len(alarms) == 4 and len(set(alarms)) == 4
    for name, dims in re.findall(r"--namespace Praxis --metric-name (\w+) --dimensions (\S+)", script):
        assert name in ops.METRICS and ops.METRICS[name][1] == ops.SERVICE_DIMS
        assert dims == f"Name=Service,Value={ops.SERVICE}"
    widget = next(w for w in json.loads(dashboard_text())["widgets"] if w["type"] == "alarm")
    assert sorted(a.rsplit(":", 1)[1] for a in widget["properties"]["alarms"]) == sorted(alarms)


def test_agent_unit_and_logrotate_name_the_same_log_file_and_group():
    agent = json.loads((EC2 / "cloudwatch" / "agent.json").read_text())
    (entry,) = agent["logs"]["logs_collected"]["files"]["collect_list"]
    path = entry["file_path"]
    unit = (EC2 / "praxis.service").read_text()
    assert f"StandardOutput=append:{path}" in unit and f"StandardError=append:{path}" in unit
    assert "Environment=PRAXIS_EMF=1" in unit
    assert (EC2 / "praxis.logrotate").read_text().count(path) == 1
    assert entry["log_group_name"] == "/praxis/session"
    assert "LOG_GROUP=/praxis/session" in setup_script()
    assert "SOURCE '/praxis/session'" in dashboard_text()
    assert set(agent["metrics"]["metrics_collected"]) == {"cpu", "mem", "disk"}


def test_the_cloudwatch_agent_package_is_pinned_and_checksummed():
    setup = (EC2 / "remote_setup.sh").read_text()
    assert re.search(r"^CWA_VERSION=\d+\.\d+\.\w+$", setup, re.M)
    assert re.search(r"^CWA_SHA256=[0-9a-f]{64}$", setup, re.M)
    assert "sha256sum -c" in setup and "arm64/latest" not in setup


def test_the_instance_role_gets_cloudwatch_permissions_only():
    script = setup_script()
    assert "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy" in script
    assert "put-role-policy" not in script and "bedrock" not in script.lower()
    assert script.count("attach-role-policy") == 1
