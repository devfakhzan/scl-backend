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
RUN yarn prisma:generate
# Build NestJS application - use npx nest build directly since yarn build script isn't working
# Run with verbose output to see what's happening
RUN npx nest build 2>&1 | tee /tmp/build.log || (echo "NestJS build failed! Build log:" && cat /tmp/build.log && exit 1)
# Verify build output exists (NestJS outputs to dist/src/main.js, not dist/main.js)
RUN test -f dist/src/main.js || (echo "ERROR: dist/src/main.js not found!" && echo "Contents of dist:" && find dist -name "*.js" -type f | head -10 && exit 1)

# Production stage
FROM node:20-alpine

# Enable Corepack for Yarn 4.11.0 (needed for Prisma commands)
RUN corepack enable

WORKDIR /app

# Copy Prisma files (needed for migrations)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# Verify migrations folder exists (critical for production)
RUN test -d prisma/migrations && echo "✅ Migrations folder found" || (echo "⚠️ WARNING: Migrations folder missing!" && ls -la prisma/ && exit 1)
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.yarnrc.yml ./

EXPOSE 3333

# Backend service entrypoint (NestJS outputs to dist/src/main.js)
CMD ["node", "dist/src/main"]
