FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci --workspace @footwear/api --workspace @footwear/database --include-workspace-root --no-audit --no-fund
COPY apps/api apps/api
COPY packages/database packages/database
RUN ./node_modules/.bin/prisma generate --schema=packages/database/prisma/schema.prisma
RUN npm run build -w @footwear/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
