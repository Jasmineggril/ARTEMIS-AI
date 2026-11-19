# ARTEMIS AI — API + web (Node 22). Multi-stage; final image runs as non-root.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --legacy-peer-deps

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=5000 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/package.json ./package.json
# INMET raw archives (named volume inherits this ownership when first created)
RUN mkdir -p /app/data/raw/inmet && chown -R node:node /app/data
USER node
EXPOSE 5000
# Health check with Node itself (no curl/apt in the runtime image)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.cjs"]
