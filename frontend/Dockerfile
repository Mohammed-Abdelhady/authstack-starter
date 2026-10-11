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

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter frontend run build

FROM deps AS development

WORKDIR /app/frontend
EXPOSE 3000
CMD ["pnpm", "run", "dev"]

FROM node:22-alpine AS production

RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 -S nextjs && \
    adduser -S nextjs -u 1001

WORKDIR /app
COPY --from=builder --chown=nextjs:nextjs /app/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=nextjs:nextjs /app/frontend/public ./frontend/public

WORKDIR /app/frontend
USER nextjs
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
