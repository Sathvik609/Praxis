#!/usr/bin/env bash
# Runs ON the COOL Graviton instance (called by deploy.sh). Idempotent.
# - uv (pinned) builds /opt/praxis/venv on COOL's Python 3.12 with every pinned dependency
#   EXCEPT the opencv-python-headless wheel, so `import cv2` resolves to COOL (/opt/cool).
# - fetches the SHA256-pinned OpenCV Zoo ONNX models, installs and (re)starts praxis.service.
# - log file /var/log/praxis/session.log + logrotate; with PRAXIS_CLOUDWATCH=1 (deploy.sh
#   --cloudwatch) the pinned CloudWatch agent that ships it (see README "Observability").
set -euo pipefail

APP=/opt/praxis/app
VENV=/opt/praxis/venv
COOL_PY=/opt/cool/venvs/python_3.12/bin/python
COOL_SITE=/opt/cool/python_3.12/site-packages
COOL_LIB=/opt/cool/cpp_sdk/lib
UV_VERSION=0.12.13

if ! command -v uv >/dev/null || [ "$(uv --version | awk '{print $2}')" != "$UV_VERSION" ]; then
  curl -LsSf "https://astral.sh/uv/$UV_VERSION/install.sh" | sh >/dev/null
fi
export PATH="$HOME/.local/bin:$PATH"

# Mode: COOL when the COOL AMI is present (/opt/cool), else the pinned opencv-python-headless
# wheel (stock mode, deploy.sh --stock) so a plain Graviton Ubuntu box can run the service.
sudo mkdir -p /etc/praxis
cd "$APP"
if [ -x "$COOL_PY" ]; then
  MODE=cool
  [ -d "$VENV" ] || uv venv --python "$COOL_PY" "$VENV"
  # Pinned deps from uv.lock, minus the OpenCV wheel (COOL provides cv2).
  uv export --frozen --no-dev --no-emit-project --no-hashes | grep -viE '^opencv-python' > /opt/praxis/requirements.txt
  uv pip install --python "$VENV/bin/python" -r /opt/praxis/requirements.txt --quiet
  uv pip uninstall --python "$VENV/bin/python" opencv-python-headless opencv-python >/dev/null 2>&1 || true
  printf 'PYTHONPATH=%s\nLD_LIBRARY_PATH=%s\n' "$COOL_SITE" "$COOL_LIB" | sudo tee /etc/praxis/opencv.env >/dev/null
else
  MODE=stock
  [ -d "$VENV" ] || uv venv --python 3.12 "$VENV"
  uv export --frozen --no-dev --no-emit-project --no-hashes > /opt/praxis/requirements.txt
  uv pip install --python "$VENV/bin/python" -r /opt/praxis/requirements.txt --quiet
  : | sudo tee /etc/praxis/opencv.env >/dev/null
fi
echo "OpenCV mode: $MODE"

# cv2 must have the dnn module (hand / pose models) and aruco (sheet markers); in COOL mode it
# must come from /opt/cool.
set -a; . /etc/praxis/opencv.env; set +a
PRAXIS_OPENCV_MODE="$MODE" "$VENV/bin/python" - <<'PY'
import os, cv2
print("cv2", cv2.__version__, "from", cv2.__file__)
if os.environ["PRAXIS_OPENCV_MODE"] == "cool":
    assert "/opt/cool" in cv2.__file__, "cv2 is not COOL"
assert hasattr(cv2, "dnn") and hasattr(cv2.dnn, "readNetFromONNX"), "this OpenCV build has no cv2.dnn"
assert hasattr(cv2, "aruco"), "this OpenCV build has no cv2.aruco"
PY

"$VENV/bin/python" tools/fetch_models.py --dir "$APP/models"

# Service log file (praxis.service appends stdout + stderr here) and its rotation.
sudo install -d -m 755 /var/log/praxis
[ -f /var/log/praxis/session.log ] || sudo install -m 644 /dev/null /var/log/praxis/session.log
sudo install -m 644 /opt/praxis/praxis.logrotate /etc/logrotate.d/praxis

sudo install -m 644 /opt/praxis/praxis.service /etc/systemd/system/praxis.service
sudo systemctl daemon-reload
sudo systemctl enable praxis.service >/dev/null
sudo systemctl restart praxis.service
for _ in $(seq 1 30); do curl -fsS localhost:8000/health >/dev/null 2>&1 && break; sleep 1; done
sudo systemctl --no-pager --lines=5 status praxis.service | sed -n 1,8p

# CloudWatch agent (deploy.sh --cloudwatch -> PRAXIS_CLOUDWATCH=1). Pinned arm64 .deb from the
# official bucket, SHA-256 checked before install; tails /var/log/praxis/session.log into the
# log group /praxis/session (EMF lines become Praxis metrics) and sends CPU/mem/disk to
# CWAgent. Credentials come from the instance profile set by cloudwatch_setup.sh.
CWA_VERSION=1.300073.0b1828
CWA_SHA256=1ad75de6df5a65d997abf3321693f083c90975b1db6fd02e85f86a0dc146202b
CWA_DIR=/opt/aws/amazon-cloudwatch-agent
if [ "${PRAXIS_CLOUDWATCH:-0}" = 1 ]; then
  [ "$(uname -m)" = aarch64 ] || { echo "CloudWatch agent: this script pins the arm64 package" >&2; exit 1; }
  if [ "$(cat "$CWA_DIR/bin/CWAGENT_VERSION" 2>/dev/null || true)" != "$CWA_VERSION" ]; then
    tmp="$(mktemp -d)"
    curl -fsSLo "$tmp/cwa.deb" "https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/arm64/$CWA_VERSION/amazon-cloudwatch-agent.deb"
    echo "$CWA_SHA256  $tmp/cwa.deb" | sha256sum -c - >/dev/null || { echo "CloudWatch agent checksum mismatch" >&2; exit 1; }
    sudo dpkg -i -E "$tmp/cwa.deb" >/dev/null
    rm -rf "$tmp"
  fi
  sudo install -m 644 /opt/praxis/cloudwatch/agent.json "$CWA_DIR/etc/praxis-agent.json"
  sudo "$CWA_DIR/bin/amazon-cloudwatch-agent-ctl" -a fetch-config -m ec2 -s -c "file:$CWA_DIR/etc/praxis-agent.json" >/dev/null
  # IMDSv2: is an instance profile attached? Without it the agent runs but cannot ship.
  tok="$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)"
  if curl -fsS -H "X-aws-ec2-metadata-token: $tok" http://169.254.169.254/latest/meta-data/iam/info >/dev/null 2>&1; then
    echo "CloudWatch agent $CWA_VERSION running; instance profile present"
  else
    echo "WARNING: no instance profile: run infra/ec2/cloudwatch_setup.sh in CloudShell first" >&2
  fi
  sudo "$CWA_DIR/bin/amazon-cloudwatch-agent-ctl" -a status | grep -E '"status"|"version"' || true
fi
