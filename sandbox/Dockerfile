FROM python:3.12-slim

ENV NODE_ENV=production \
  HOME=/home/sandbox \
  LANG=C.UTF-8 \
  PORT=8080 \
  PYTHONUNBUFFERED=1

WORKDIR /sandbox

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs bash coreutils findutils grep python3 \
  && node -v && npm -v \
  && npm config set registry https://registry.npmmirror.com \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* tsconfig.json nest-cli.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY src ./src
RUN npm install --include=dev && npm run build && npm prune --omit=dev && npm cache clean --force

RUN useradd --create-home --shell /bin/bash sandbox \
  && mkdir -p /workspace \
  && chown -R sandbox:sandbox /workspace /sandbox

USER sandbox
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "/sandbox/dist/main.js"]
