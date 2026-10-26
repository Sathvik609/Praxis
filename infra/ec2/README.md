# Praxis on AWS Graviton with COOL (EC2)

Status 26 Oct 2026: **latest code deployed (through 3040eea), instance running until 10 Nov 2026** (`PRAXIS_AGENT_DAILY_RUNS=300` in `/etc/praxis/agent.env`).
One instance (`praxis-cool`, c8g.large, us-east-2) from the COOL AMI
`ami-005a9f90c70ba8d9b` (COOL v3, OpenCV 5.1.0-dev), an Elastic IP (so the
address survives stop/start), a CloudFront-only security group, HTTPS at
**https://d235zashbh751z.cloudfront.net** (CloudFront). `/health` shows
`"cool": true`, `aarch64`; a replay through the judge link ran 3 real Claude runs, 0 errors.

## Region, start / stop and spend
- **Region:** us-east-2 (Ohio). Account ids, sign-in URLs and owner emails are not in the repo.
- **Start / stop** (CloudShell): `aws ec2 start-instances --instance-ids <instance-id>` /
  `aws ec2 stop-instances --instance-ids <instance-id>`. The Elastic IP keeps the address,
  so CloudFront needs no change. Redeploy from the laptop: `infra/ec2/deploy.sh <elastic-ip> --agent`.
- **Spend:** a $50/month AWS budget with email alerts. COOL is billed through Marketplace
  ($0.01/h for c8g.large).

## What it builds
- One **c8g.large** (Graviton4, 2 vCPU, 4 GiB) in **us-east-2** (the account's project region), launched from the AWS Marketplace
  AMI *Cloud Optimized OpenCV For AWS Graviton4* (COOL v3, OpenCV 5.1.0-dev, Ubuntu 24.04, `/opt/cool`; 60 GB root minimum).
- The session service (FastAPI + OpenCV 5 + stop rules + coach) under systemd as `praxis.service`,
  on port 8000, serving the built web app, `/api`, `/health` and the session WebSocket.
- `cv2` is **COOL's** build: the venv (`/opt/praxis/venv`, uv on COOL's Python 3.12) gets every
  pinned dependency from `services/session/uv.lock` except the `opencv-python-headless` wheel, and
  the unit sets `PYTHONPATH=/opt/cool/python_3.12/site-packages` and
  `LD_LIBRARY_PATH=/opt/cool/cpp_sdk/lib`. `remote_setup.sh` refuses to continue unless
  `cv2.__file__` is under `/opt/cool` and `cv2.dnn` + `cv2.aruco` exist. `/health` reports
  `opencv_build {version, path, cool, dnn, arch}` as live evidence.
- HTTPS for judges (browsers only open the webcam on a secure origin): a CloudFront distribution
  in front of the instance's Elastic IP DNS name (origin HTTP port 8000, managed policies
  CachingDisabled + AllViewerExceptHostHeader so WebSockets upgrade, HTTP -> HTTPS redirect).
  Security group: 8000 only from the CloudFront origin-facing prefix list + one admin IP.

## Deploy / redeploy (one command)
```bash
infra/ec2/deploy.sh <instance-public-dns>            # agent off
infra/ec2/deploy.sh <instance-public-dns> --agent    # Claude agent on (key from services/session/.env)
```
Needs the ssh key `~/.ssh/praxis-aws` (its public half is imported into EC2 as key pair
`praxis-aws`) and the instance's security group allowing port 22 from your IP and 8000 from
CloudFront. The script builds the web app, rsyncs the service, installs, restarts and prints:
`opencv 5.1.0-dev · aarch64 · COOL=True · dnn=True` (COOL's own build).

## Therapist-only writes (21 Oct)
Edit practice days and Mark reviewed need `PRAXIS_THERAPIST_TOKEN` (header
`X-Praxis-Therapist-Token`). Nothing to set for the judge build: unset, every request through
CloudFront gets 403 and the therapist view is read-only ("Therapist only … Nothing was changed").
To allow edits from a browser, add `PRAXIS_THERAPIST_TOKEN=<random>` to the root-only
`/etc/praxis/agent.env`, `sudo systemctl restart praxis`, and in that browser's console run
`localStorage.setItem('praxis.therapistToken', '<random>')`. `/health` shows
`therapist_writes: token | local_only`.

## Cost controls (10 Oct)
Budget `praxis-monthly-50` (alerts only); c8g.large $0.0798/h + COOL $0.01/h after the
7-day trial + public IPv4 $0.005/h; stopped between work sessions; on 24/7 from submission to 10 Nov (~$41). The agent
has a daily run cap (`PRAXIS_AGENT_DAILY_RUNS`) and an Anthropic console spend limit.

## Observability: CloudWatch (built 12 Oct, **not yet verified on AWS**)
What exists in the repo:
- **Service** (`services/session/praxis_session/ops.py`): one JSON line per `session_start` /
  `session_end` (mode, exercise, live|replay, duration, verified / unverified reps, per-frame
  processing p50/p95, fps, event-to-cue p50/p95, stop-rule actions, perception losses), per
  `stop_rule`, `therapist_flag`, `perception_lost`, `ws_error`, and a `heartbeat` every 60 s.
  Agent runs keep their `agent_run` / `agent_error` lines (now with `provider`). No frames,
  usernames, free text, pain scores or flag details (`ops.clean`, tested). With `PRAXIS_EMF=1`
  (set in `praxis.service`) the lines carry **CloudWatch Embedded Metric Format** blocks:
  namespace `Praxis`, per-session metrics by `Exercise` × `Mode`, service-wide ones by
  `Service=session` (`ops.METRICS` lists every name).
- **Host**: `praxis.service` appends stdout + stderr to `/var/log/praxis/session.log` (rotated
  by `/etc/logrotate.d/praxis`, `copytruncate`; `journalctl -u praxis` now shows only start and
  stop). `deploy.sh --cloudwatch` installs the pinned arm64 CloudWatch agent
  (`1.300073.0b1828`, SHA-256 checked) with `cloudwatch/agent.json`: the log file goes to the
  log group **`/praxis/session`** (one stream per instance id), and CPU / memory / root disk go
  to `CWAgent` every 60 s.
- **Account** (`cloudwatch_setup.sh`, AWS CLI only, idempotent): IAM role + instance profile
  `praxis-ec2-role` (`CloudWatchAgentServerPolicy`) attached to the instance; the log group with
  30-day retention; SNS topic `praxis-alarms` → your email; alarms `praxis-heartbeat-missing`,
  `praxis-cpu-high` (> 80 % for 15 min), `praxis-status-check-failed`, `praxis-agent-fallbacks`
  (≥ 5 rule-coach fallbacks in 15 min); dashboard **`Praxis`** (`cloudwatch/dashboard.json`:
  sessions, verified vs unverified reps, frame-processing p50/p95, fps, event-to-cue, agent
  runs / fallbacks / errors / cost / first action, stop-rule actions, perception losses, socket
  errors, heartbeat, CPU / memory / disk, CloudFront requests and 5xx %, recent sessions);
  Logs Insights queries `Praxis/Sessions`, `Praxis/Safety and errors`, `Praxis/Agent runs`.

### Turn it on (in this order)
```bash
# 1. AWS CloudShell (us-east-2). The script needs only itself and cloudwatch/dashboard.json:
#    Actions > Upload file for both, then: mkdir -p ec2/cloudwatch && mv cloudwatch_setup.sh ec2/ && mv dashboard.json ec2/cloudwatch/
#    (and run bash ec2/cloudwatch_setup.sh ... below), or clone the repo.
bash infra/ec2/cloudwatch_setup.sh <your-budget-alert-email> --instance <instance-id> --distribution <cloudfront-id>
#    then click "Confirm subscription" in the AWS Notifications email.
# 2. Start the instance (as usual), then on the laptop:
infra/ec2/deploy.sh <instance-public-dns> --skip-web --cloudwatch   # add --agent as before if wanted
```
The setup script never starts or stops the instance; it can attach the profile while the
instance is stopped. If the instance already has a different instance profile it stops and
asks for `--replace-profile`. If an SCP refuses `iam:CreateRole` or `iam:PassRole`, run it
from the management account or relax that SCP for this role.

### Verify
```bash
aws logs tail /praxis/session --follow --region us-east-2           # heartbeat lines within ~1 min
aws cloudwatch list-metrics --namespace Praxis --region us-east-2   # Heartbeat; Sessions... after a session
aws cloudwatch get-metric-statistics --namespace AWS/Logs --metric-name EMFValidationErrors \
  --dimensions Name=LogGroupName,Value=/praxis/session --statistics Sum --period 3600 \
  --start-time "$(date -u -d '-1 hour' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" --region us-east-2  # expect none
```
Dashboard: CloudWatch console → Dashboards → `Praxis`
(`https://us-east-2.console.aws.amazon.com/cloudwatch/home?region=us-east-2#dashboards/dashboard/Praxis`).
On the box: `tail -f /var/log/praxis/session.log`;
`sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status`; the agent's
own log is `/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log`.

While the instance is stopped the heartbeat alarm goes to ALARM (missing data counts as
breaching, so a dead service is never silent). To stop the emails between work sessions:
`aws cloudwatch disable-alarm-actions --alarm-names praxis-heartbeat-missing --region us-east-2`
(and `enable-alarm-actions` once it runs 24/7).

### Expected cost
Close to $0 a month inside the CloudWatch always-free tier (10 custom metrics, 10 alarms,
3 dashboards of up to 50 metrics, 5 GB log ingestion and storage, 1,000 SNS emails). Five custom
metrics are always present: `Heartbeat`, `ActiveSessions`, `cpu_usage_active`,
`mem_used_percent` and `disk_used_percent`. The per-session and agent metrics (10 names for each
exercise/mode pair in use, plus 5 agent names) are billed pro rata only for the hours they get
data. A judging month of a few dozen sessions therefore adds well under $1, even beyond the free
tier ($0.30 per metric-month). Logs are about 1 MB a day (heartbeats plus access logs) at
$0.50/GB, a few cents a month. So the expected cost is under $1 a month. If nothing were free,
the worst case would be about $5–6 a month: $3 for the dashboard, $0.40 for the four alarms,
$1.50 for the five always-present metrics and under $1 for the rest. The CPU and status-check
alarms use the free `AWS/EC2` metrics.
