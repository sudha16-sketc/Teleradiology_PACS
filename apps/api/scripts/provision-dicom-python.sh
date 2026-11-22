#!/usr/bin/env bash
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${API_DIR}/../.." && pwd)"
POC_DIR="${REPO_ROOT}/tools/dicom-compression-poc"
RUNTIME_DIR="${POC_DIR}/runtime"
SITE_DIR="${RUNTIME_DIR}/site-packages"
REQUIREMENTS="${POC_DIR}/requirements.txt"
SCRIPT="${POC_DIR}/compress_for_ingest.py"
VERIFY="${POC_DIR}/verify_deployment.py"

if [[ ! -f "${REQUIREMENTS}" || ! -f "${SCRIPT}" || ! -f "${VERIFY}" ]]; then
  printf 'DICOM compression source tree is incomplete\n' >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  printf 'python3 is required to build the DICOM compression worker\n' >&2
  exit 1
fi

if ! python3 -m pip --version >/dev/null 2>&1; then
  printf 'python3 pip is required to build the DICOM compression worker\n' >&2
  exit 1
fi

python3 - <<'PY'
import sys

if sys.version_info < (3, 10):
    raise SystemExit(
        f"Python 3.10+ is required for the DICOM worker; found {sys.version.split()[0]}"
    )
print(f"DICOM worker build Python: {sys.executable} {sys.version.split()[0]}")
PY

mkdir -p "${SITE_DIR}"
python3 -m pip install \
  --disable-pip-version-check \
  --no-input \
  --only-binary=:all: \
  --upgrade \
  --target "${SITE_DIR}" \
  -r "${REQUIREMENTS}"
PYTHONPATH="${SITE_DIR}${PYTHONPATH:+:${PYTHONPATH}}" python3 "${VERIFY}"
