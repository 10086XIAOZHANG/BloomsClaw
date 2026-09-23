#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)

DEPLOY_USER=${DEPLOY_USER:-root}
DEPLOY_HOST=${DEPLOY_HOST:-47.112.192.143}
REMOTE_DIR=${REMOTE_DIR:-/opt/blooms-claw}
SSH_CONNECT_TIMEOUT=${SSH_CONNECT_TIMEOUT:-10}
SKIP_SANDBOX_RESTART=${SKIP_SANDBOX_RESTART:-0}
ASSUME_YES=0

usage() {
  cat <<'EOF'
Usage: ./deploy/deploy-prod.sh [--yes]

Build and deploy agent-core, API, WebUI, and the production sandbox image.

Environment overrides:
  DEPLOY_USER              SSH user (default: root)
  DEPLOY_HOST              SSH host (default: 47.112.192.143)
  REMOTE_DIR               Remote application directory (default: /opt/blooms-claw)
  SSH_CONNECT_TIMEOUT      SSH connection timeout in seconds (default: 10)
  SKIP_SANDBOX_RESTART=1  Build the image but keep running sandbox containers

--yes, -y                  Skip the confirmation before replacing sandbox containers
EOF
}

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

run_remote() {
  ssh -o BatchMode=yes \
    -o ConnectTimeout="${SSH_CONNECT_TIMEOUT}" \
    -o StrictHostKeyChecking=accept-new \
    "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

confirm_sandbox_restart() {
  if [[ "${SKIP_SANDBOX_RESTART}" == "1" || "${ASSUME_YES}" == "1" ]]; then
    return
  fi

  printf '\nWARNING: this deployment will stop all running blooms-claw-ws-* containers.\n'
  printf 'Active sandbox sessions will be interrupted; mounted workspace data is preserved.\n'
  read -r -p "Continue deploying to ${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}? [y/N] " answer
  case "${answer}" in
    y|Y|yes|YES) ;;
    *) fail "deployment cancelled" ;;
  esac
}

while (($# > 0)); do
  case "$1" in
    --yes|-y)
      ASSUME_YES=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "unknown argument: $1"
      ;;
  esac
done

cd "${REPO_ROOT}"

for command in pnpm rsync ssh; do
  require_command "${command}"
done

log "Target: ${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}"
log "Checking SSH connectivity"
run_remote 'printf "remote=%s host=%s\\n" "$(whoami)" "$(hostname)"'
confirm_sandbox_restart

log "Installing and validating local workspace dependencies"
pnpm install --frozen-lockfile

log "Building agent-core"
pnpm --filter @blooms-claw/agent-core build

log "Building API"
pnpm --dir apps/api build

log "Building WebUI"
pnpm --filter @blooms-claw/webui build

log "Building sandbox"
pnpm --dir sandbox build

RSYNC=(rsync -az --omit-dir-times)
RSYNC_DELETE=(rsync -az --delete --omit-dir-times)
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

log "Syncing generated artifacts and deployment inputs"
"${RSYNC_DELETE[@]}" "${REPO_ROOT}/packages/agent-core/dist/" "${REMOTE}:${REMOTE_DIR}/packages/agent-core/dist/"
"${RSYNC[@]}" "${REPO_ROOT}/packages/agent-core/package.json" "${REMOTE}:${REMOTE_DIR}/packages/agent-core/package.json"
"${RSYNC_DELETE[@]}" "${REPO_ROOT}/apps/api/dist/" "${REMOTE}:${REMOTE_DIR}/apps/api/dist/"
"${RSYNC[@]}" "${REPO_ROOT}/apps/api/package.json" "${REMOTE}:${REMOTE_DIR}/apps/api/package.json"
"${RSYNC_DELETE[@]}" "${REPO_ROOT}/apps/webui/dist/" "${REMOTE}:${REMOTE_DIR}/apps/webui/dist/"
"${RSYNC_DELETE[@]}" "${REPO_ROOT}/sandbox/src/" "${REMOTE}:${REMOTE_DIR}/sandbox/src/"
"${RSYNC[@]}" \
  "${REPO_ROOT}/sandbox/package.json" \
  "${REPO_ROOT}/sandbox/package-lock.json" \
  "${REPO_ROOT}/sandbox/tsconfig.json" \
  "${REPO_ROOT}/sandbox/nest-cli.json" \
  "${REPO_ROOT}/deploy/docker/Dockerfile" \
  "${REMOTE}:${REMOTE_DIR}/sandbox/"
"${RSYNC[@]}" "${REPO_ROOT}/package.json" "${REPO_ROOT}/pnpm-lock.yaml" "${REMOTE}:${REMOTE_DIR}/"

log "Building image and restarting production services"
run_remote "REMOTE_DIR='${REMOTE_DIR}' SKIP_SANDBOX_RESTART='${SKIP_SANDBOX_RESTART}' bash -s" <<'REMOTE_SCRIPT'
set -Eeuo pipefail
cd "${REMOTE_DIR}"

pnpm install --frozen-lockfile

# The sandbox image runs as UID/GID 1000 and workspaces are bind-mounted.
find /root/.blooms_claw/workspaces -mindepth 1 -maxdepth 1 -type d \
  -exec chown -R 1000:1000 {} + 2>/dev/null || true

# Build first; running containers are not touched if this fails.
docker build -t blooms-claw-sandbox:latest -f sandbox/Dockerfile sandbox

docker network create blooms-claw-sandbox >/dev/null 2>&1 || true
pm2 restart blooms-claw-api >/dev/null

if [[ "${SKIP_SANDBOX_RESTART}" != "1" ]]; then
  mapfile -t ws_containers < <(docker ps -aq --filter 'name=^blooms-claw-ws')
  if ((${#ws_containers[@]} > 0)); then
    docker rm -f "${ws_containers[@]}"
  fi
  echo "replaced_sandbox_containers=${#ws_containers[@]}"
else
  echo "replaced_sandbox_containers=0 (SKIP_SANDBOX_RESTART=1)"
fi
REMOTE_SCRIPT

log "Running deployment checks"
run_remote 'set -Eeuo pipefail
sleep 5
pm2 list | grep -E "blooms-claw-api.*online"
curl -fsS -o /dev/null http://127.0.0.1:3000/
curl -fsS -o /dev/null http://127.0.0.1/
nginx -t >/dev/null
docker image inspect blooms-claw-sandbox:latest >/dev/null
printf "deployment_checks=ok\\n"'

log "Starting a temporary sandbox health check"
run_remote 'set -Eeuo pipefail
name="blooms-claw-deploy-check-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --rm --name "$name" --network blooms-claw-sandbox \
  -p 127.0.0.1::8080 --cap-drop ALL --security-opt no-new-privileges:true \
  blooms-claw-sandbox:latest >/dev/null
for attempt in $(seq 1 20); do
  port=$(docker port "$name" 8080/tcp 2>/dev/null | sed "s/.*://" || true)
  if [[ -n "$port" ]] && curl -fsS "http://127.0.0.1:${port}/health" >/dev/null; then
    printf "sandbox_health=ok\\n"
    exit 0
  fi
  sleep 1
docker logs "$name" 2>&1 || true
exit 1'

log "Deployment completed"
