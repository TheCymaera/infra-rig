# syntax=docker/dockerfile:1

FROM oven/bun:1.4.5-alpine AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY src ./src

FROM base AS dev
ENV NODE_ENV=development
USER bun
CMD ["bun", "--hot", "src/index.ts"]

FROM base AS production
ENV NODE_ENV=production
ENV PORT=3000
USER bun
EXPOSE 3000
CMD ["bun", "src/index.ts"]
