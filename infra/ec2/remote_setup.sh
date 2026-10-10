#!/usr/bin/env bash
# Runs ON the COOL Graviton instance (called by deploy.sh). Idempotent.
# - uv (pinned) builds /opt/praxis/venv on COOL's Python 3.12 with every pinned dependency
#   EXCEPT the opencv-python-headless wheel, so `import cv2` resolves to COOL (/opt/cool).
# - fetches the SHA256-pinned OpenCV Zoo ONNX models, installs and (re)starts praxis.service.
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

[ -x "$COOL_PY" ] || { echo "COOL Python 3.12 not found at $COOL_PY"; exit 1; }
[ -d "$VENV" ] || uv venv --python "$COOL_PY" "$VENV"

cd "$APP"
# Pinned deps from uv.lock, minus the OpenCV wheel (COOL provides cv2).
uv export --frozen --no-dev --no-emit-project --no-hashes | grep -viE '^opencv-python' > /opt/praxis/requirements.txt
uv pip install --python "$VENV/bin/python" -r /opt/praxis/requirements.txt --quiet
uv pip uninstall --python "$VENV/bin/python" opencv-python-headless opencv-python >/dev/null 2>&1 || true

# cv2 must come from COOL, with the dnn module our hand / pose models use.
PYTHONPATH="$COOL_SITE" LD_LIBRARY_PATH="$COOL_LIB" "$VENV/bin/python" - <<'PY'
import cv2, sys
print("cv2", cv2.__version__, "from", cv2.__file__)
assert "/opt/cool" in cv2.__file__, "cv2 is not COOL"
assert hasattr(cv2, "dnn") and hasattr(cv2.dnn, "readNetFromONNX"), "COOL build has no cv2.dnn"
assert hasattr(cv2, "aruco"), "COOL build has no cv2.aruco"
PY

PYTHONPATH="$COOL_SITE" LD_LIBRARY_PATH="$COOL_LIB" "$VENV/bin/python" tools/fetch_models.py --dir "$APP/models"

sudo install -m 644 /opt/praxis/praxis.service /etc/systemd/system/praxis.service
sudo mkdir -p /etc/praxis
sudo systemctl daemon-reload
sudo systemctl enable praxis.service >/dev/null
sudo systemctl restart praxis.service
for _ in $(seq 1 30); do curl -fsS localhost:8000/health >/dev/null 2>&1 && break; sleep 1; done
sudo systemctl --no-pager --lines=5 status praxis.service | sed -n 1,8p
