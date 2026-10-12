#!/usr/bin/env bash
# One-command deploy of the Praxis session service to an AWS Graviton (c8g) instance launched
# from the COOL AMI ("Cloud Optimized OpenCV For AWS Graviton4", Ubuntu, /opt/cool).
#
#   infra/ec2/deploy.sh <public-ip-or-dns> [--agent] [--skip-web] [--stock] [--cloudwatch]
#
# --stock     allow a plain Graviton Ubuntu instance (no COOL AMI): cv2 from the pinned
#             opencv-python-headless wheel. Without it the target must be the COOL AMI.
# --agent     copy ANTHROPIC_API_KEY from services/session/.env to /etc/praxis/agent.env on the
#             host (root-only, never printed) and turn the Claude agent coach on.
# --skip-web  reuse the last web/dist build.
# --cloudwatch install/refresh the pinned CloudWatch agent (logs -> /praxis/session, EMF
#             metrics, CPU/mem/disk). Run infra/ec2/cloudwatch_setup.sh in CloudShell first.
#
# Idempotent: re-run it to ship a new version. Needs ssh key ~/.ssh/praxis-aws (user ubuntu).
set -euo pipefail

HOST="${1:?usage: deploy.sh <host> [--agent] [--skip-web] [--cloudwatch]}"; shift || true
AGENT=0; SKIP_WEB=0; STOCK=0; CLOUDWATCH=0
for a in "$@"; do
  case "$a" in
    --agent) AGENT=1 ;;
    --skip-web) SKIP_WEB=1 ;;
    --stock) STOCK=1 ;;
    --cloudwatch) CLOUDWATCH=1 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEY="${PRAXIS_SSH_KEY:-$HOME/.ssh/praxis-aws}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "ubuntu@$HOST")
RSYNC_SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"

echo "== 1/5 reach $HOST"
"${SSH[@]}" "uname -m; if test -d /opt/cool; then echo 'COOL found at /opt/cool'; elif [ $STOCK = 1 ]; then echo 'no COOL: stock OpenCV wheel (--stock)'; else echo 'no /opt/cool: use the COOL AMI or pass --stock'; exit 1; fi"

if [ "$SKIP_WEB" = 0 ]; then
  echo "== 2/5 build the web app"
  (cd "$ROOT/web" && pnpm install --frozen-lockfile >/dev/null && pnpm build >/dev/null)
fi

echo "== 3/5 copy the service, web build and replay clips"
"${SSH[@]}" 'sudo mkdir -p /opt/praxis/app /opt/praxis/data && sudo chown -R ubuntu:ubuntu /opt/praxis'
rsync -az --delete -e "$RSYNC_SSH" \
  --exclude '__pycache__' --exclude '.venv' --exclude '.env' --exclude '*.db' --exclude 'models/' \
  "$ROOT/services/session/praxis_session" "$ROOT/services/session/tools" \
  "$ROOT/services/session/pyproject.toml" "$ROOT/services/session/uv.lock" \
  "ubuntu@$HOST:/opt/praxis/app/"
rsync -az --delete -e "$RSYNC_SSH" "$ROOT/web/dist/" "ubuntu@$HOST:/opt/praxis/app/web_dist/"
rsync -az -e "$RSYNC_SSH" "$ROOT/evaluation/dataset_v0" "ubuntu@$HOST:/opt/praxis/app/evaluation/"
rsync -az -e "$RSYNC_SSH" "$ROOT/infra/ec2/remote_setup.sh" "$ROOT/infra/ec2/praxis.service" "$ROOT/infra/ec2/praxis.logrotate" "ubuntu@$HOST:/opt/praxis/"
rsync -az --delete -e "$RSYNC_SSH" "$ROOT/infra/ec2/cloudwatch/" "ubuntu@$HOST:/opt/praxis/cloudwatch/"

if [ "$AGENT" = 1 ]; then
  echo "== 3b agent key -> /etc/praxis/agent.env (not printed)"
  KEYLINE="$(grep -E '^ANTHROPIC_API_KEY=' "$ROOT/services/session/.env" || true)"
  [ -n "$KEYLINE" ] || { echo "no ANTHROPIC_API_KEY in services/session/.env" >&2; exit 1; }
  printf '%s\nPRAXIS_AGENT=anthropic\n' "$KEYLINE" | "${SSH[@]}" \
    'sudo mkdir -p /etc/praxis && sudo tee /etc/praxis/agent.env >/dev/null && sudo chmod 600 /etc/praxis/agent.env'
fi

echo "== 4/5 install on the host (COOL OpenCV, pinned deps, models, systemd)"
"${SSH[@]}" "PRAXIS_CLOUDWATCH=$CLOUDWATCH bash /opt/praxis/remote_setup.sh"

echo "== 5/5 health"
"${SSH[@]}" 'curl -fsS localhost:8000/health' | STOCK="$STOCK" python3 -c '
import json, os, sys
stock = os.environ.get("STOCK") == "1"
h = json.load(sys.stdin)
b = h["opencv_build"]
print("opencv %s · %s · COOL=%s · dnn=%s" % (b["version"], b["arch"], b["cool"], b["dnn"]))
print("models", h["models"], "· agent", h["agent"].get("mode"), "ready" if h["agent"].get("ready") else "off")
sys.exit(0 if (b["cool"] or stock) else 1)' 
echo "deployed: http://$HOST:8000/health"
