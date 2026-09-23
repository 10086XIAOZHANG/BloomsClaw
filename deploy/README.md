# Deployment configuration

These files mirror the configuration currently used on the Alibaba Cloud ECS server.

## One-command production deployment

From the repository root, run:

```bash
./deploy/deploy-prod.sh
```

The script builds `agent-core`, the NestJS API, the WebUI, and the sandbox locally; synchronizes only build outputs and deployment inputs to the remote application directory; installs workspace dependencies remotely; rebuilds the production sandbox image; restarts the API; and runs API, Nginx, and sandbox health checks.

The default target is `root@47.112.192.143:/opt/blooms-claw`. Override it without editing the script:

```bash
DEPLOY_HOST=example.internal DEPLOY_USER=deploy REMOTE_DIR=/opt/blooms-claw ./deploy/deploy-prod.sh
```

The script asks for confirmation before replacing running `blooms-claw-ws-*` containers. Use `--yes` for an explicitly approved non-interactive deployment:

```bash
./deploy/deploy-prod.sh --yes
```

To build and deploy the image without replacing currently running sandbox containers, use `SKIP_SANDBOX_RESTART=1`. New sessions will use the new image, while existing sessions continue on their current containers:

```bash
SKIP_SANDBOX_RESTART=1 ./deploy/deploy-prod.sh
```

Replacing sandbox containers interrupts active agent sessions. Workspace files are bind-mounted under `/root/.blooms_claw/workspaces` and are preserved. The script does not commit, push, or synchronize production secrets and user configuration.

## Nginx

Install Nginx and copy `nginx/nginx.conf` to `/etc/nginx/conf.d/blooms-claw.conf`, then run:

```bash
rm -f /etc/nginx/conf.d/default.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx
```

The config serves `apps/webui/dist` and proxies `/api/*` to the NestJS API on `127.0.0.1:3000`. The trailing slash on `proxy_pass` intentionally strips `/api/` before forwarding.

## Sandbox

- `docker/Dockerfile` builds the sandbox image.
- `docker/docker-compose.prod.yml` runs the production sandbox with read-only and resource restrictions.
- Production agent-core selects `blooms-claw-sandbox:latest`; local development selects `blooms-claw-sandbox:dev`.

Build the production image from the repository's `sandbox` directory (the Dockerfile is copied there by the deployment script), for example:

```bash
docker build -t blooms-claw-sandbox:latest -f deploy/docker/Dockerfile sandbox
docker network create blooms-claw-sandbox 2>/dev/null || true
docker compose -f deploy/docker/docker-compose.prod.yml up -d
```
