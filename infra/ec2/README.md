# Praxis on AWS Graviton with COOL (EC2)

Status 11 Oct 2026: **live.** `<instance-id>` (c8g.large, us-east-2) from the COOL AMI
`ami-005a9f90c70ba8d9b` (COOL v3, OpenCV 5.1.0-dev), Elastic IP `[redacted-ip]`, HTTPS at
**https://dl8xykmg8ki61.cloudfront.net** (CloudFront `<cloudfront-id>`). `/health` shows
`"cool": true`. Evidence: `docs/TECHNICAL_REPORT.md` §5; benchmark: `benchmark/results/`.

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
`opencv 5.0.0 · aarch64 · COOL=True · dnn=True`.

## Cost controls (10 Oct)
Paid plan; budget `praxis-monthly-50` whose action stops this instance at 100 % of $50; SCPs
allow only small Graviton types in us-east-1/2; c8g.large $0.0798/h + COOL $0.01/h after the
7-day trial + public IPv4 $0.005/h; stopped between work sessions; on 24/7 from submission to 9 Nov (~$40). The agent
has a daily run cap (`PRAXIS_AGENT_DAILY_RUNS`) and an Anthropic console spend limit.
