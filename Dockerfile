FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY . .

RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --omit=dev --workspace apps/api --workspace packages/shared --include-workspace-root

COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/apps/web/dist apps/web/dist
COPY --from=builder /app/packages/shared/src packages/shared/src
COPY --from=builder /app/business_profiles.json business_profiles.json

EXPOSE 4000

CMD ["node", "apps/api/dist/index.js"]
