# Build stage
FROM node:20-alpine AS builder

# Enable Corepack to use Yarn version from package.json
RUN corepack enable

WORKDIR /app

# Copy Yarn config first (needed for node_modules linker)
COPY .yarnrc.yml package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
# Copy Prisma config if it exists (Prisma 7 requirement)
COPY prisma.config.ts* ./
# Generate Prisma Client and build
# Note: yarn build already includes prisma generate, but we run it separately for clarity
RUN yarn prisma:generate && yarn build || (echo "Build failed!" && exit 1)
# Verify build output exists
RUN test -d dist && test -f dist/main.js || (echo "ERROR: dist/main.js not found!" && ls -la dist/ 2>&1 && exit 1)

# Production stage
FROM node:20-alpine

# Enable Corepack for Yarn 4.11.0 (needed for Prisma commands)
RUN corepack enable

WORKDIR /app

# Copy Prisma files (needed for migrations)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.yarnrc.yml ./

EXPOSE 3333

# Backend service entrypoint
CMD ["node", "dist/main"]
