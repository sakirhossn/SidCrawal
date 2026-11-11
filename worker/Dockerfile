# Build from repository root:
#   docker build -f worker/Dockerfile -t sidcrawal-worker .
FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

COPY src/lib/ip-ranges.ts ./src/lib/ip-ranges.ts
COPY worker/package.json ./worker/package.json

WORKDIR /app/worker
RUN npm install --omit=dev

COPY worker/tsconfig.json ./tsconfig.json
COPY worker/src ./src

ENV NODE_ENV=production
ENV PORT=4001
ENV PLAYWRIGHT_NO_SANDBOX=true

EXPOSE 4001
CMD ["npm", "run", "start"]
