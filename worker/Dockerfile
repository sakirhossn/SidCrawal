# Build from repository root:
#   docker build -f worker/Dockerfile -t sidcrawal-worker .
FROM node:22-bookworm-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY src/lib/ip-ranges.ts ./src/lib/ip-ranges.ts
COPY src/lib/crawler/fingerprint.ts ./src/lib/crawler/fingerprint.ts
COPY src/lib/crawler/normalization.ts ./src/lib/crawler/normalization.ts
COPY src/lib/crawler/persist-run.ts ./src/lib/crawler/persist-run.ts
COPY src/lib/crawler/retry.ts ./src/lib/crawler/retry.ts
COPY src/lib/crawler/types.ts ./src/lib/crawler/types.ts
COPY src/lib/preview/types.ts ./src/lib/preview/types.ts
COPY worker/package.json worker/package-lock.json ./worker/

WORKDIR /app/worker
RUN npm ci --include=dev \
  && npx playwright-core install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*

COPY worker/tsconfig.json ./tsconfig.json
COPY worker/src ./src

ENV NODE_ENV=production
ENV PORT=4001
ENV PLAYWRIGHT_NO_SANDBOX=true

EXPOSE 4001
CMD ["npm", "run", "start"]
