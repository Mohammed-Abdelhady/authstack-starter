FROM node:22-alpine AS base

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

WORKDIR /app
# feature:mongodb:start
# Containers use the configured database, not the test-only downloaded binary.
ENV MONGOMS_DISABLE_POSTINSTALL=1
# feature:mongodb:end

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile

FROM deps AS builder

RUN pnpm --filter backend run build
# Deploy reads registry metadata for its lockfile check; packages come from the fetched store.
RUN pnpm --filter backend deploy --prod --frozen-lockfile /out/backend

FROM deps AS development

WORKDIR /app/backend
EXPOSE 5000
CMD ["pnpm", "run", "start:dev"]

FROM node:22-alpine AS production

RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 -S nestjs && \
    adduser -S nestjs -u 1001

WORKDIR /app
COPY --from=builder --chown=nestjs:nestjs /out/backend ./
COPY --from=builder --chown=nestjs:nestjs /app/backend/dist ./dist

USER nestjs
EXPOSE 5000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]
