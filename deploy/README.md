# Deployment configuration

These files mirror the configuration currently used on the Alibaba Cloud ECS server.

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
