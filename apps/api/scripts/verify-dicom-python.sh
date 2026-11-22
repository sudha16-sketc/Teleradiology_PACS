#!/usr/bin/env bash
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${API_DIR}/../.." && pwd)"
POC_DIR="${REPO_ROOT}/tools/dicom-compression-poc"
SITE_DIR="${POC_DIR}/runtime/site-packages"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'python3 is required to verify the DICOM compression worker\n' >&2
  exit 1
fi

if [[ ! -d "${SITE_DIR}" ]]; then
  printf 'DICOM compression runtime is missing; run pnpm run dicom:provision\n' >&2
  exit 1
fi

PYTHONPATH="${SITE_DIR}${PYTHONPATH:+:${PYTHONPATH}}" python3 "${POC_DIR}/verify_deployment.py"
