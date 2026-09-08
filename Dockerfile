# PronounceAll — Copyright (C) 2026 Alp Kavaklı
# SPDX-License-Identifier: AGPL-3.0-or-later
# See LICENSE-NOTICE.md at the repository root.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run unprivileged. The node image already ships a `node` user (uid 1000).
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node LICENSE LICENSE-NOTICE.md ./

USER node
EXPOSE 3000

# The container reports unhealthy while MySQL or Redis is unreachable, which is
# what the /health route already distinguishes (503 when degraded).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
