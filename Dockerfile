# One Dockerfile for every Node service. Build with, for example:
#   docker build --build-arg PACKAGE=@aetheria/auth-service -t aetheria-auth .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG PACKAGE
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter="${PACKAGE}..."
RUN pnpm deploy --legacy --filter="${PACKAGE}" --prod /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
CMD ["node", "dist/server.js"]
