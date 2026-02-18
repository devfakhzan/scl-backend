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
# Generate Prisma Client and build NestJS application
RUN yarn prisma:generate
RUN npx nest build
RUN test -f dist/src/main.js || (echo "ERROR: dist/src/main.js not found!" && exit 1)

# Production stage
FROM node:20-alpine

# Install Chromium for Puppeteer (needed by @retconned/kick-js)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Create a wrapper that injects --no-sandbox (required when running as root in Docker)
# kick-js hardcodes puppeteer.launch() without --no-sandbox, so we wrap the binary
RUN mv /usr/bin/chromium-browser /usr/bin/chromium-browser-unwrapped \
    && printf '#!/bin/sh\nexec /usr/bin/chromium-browser-unwrapped --no-sandbox --disable-setuid-sandbox --disable-gpu --disable-dev-shm-usage "$@"\n' > /usr/bin/chromium-browser \
    && chmod +x /usr/bin/chromium-browser

# Tell Puppeteer to use the installed Chromium instead of downloading its own
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Enable Corepack for Yarn 4.11.0 (needed for Prisma commands)
RUN corepack enable

WORKDIR /app

# Copy Prisma files (needed for migrations)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# Check for migrations folder (non-fatal - init container has fallback to db push)
RUN if [ -d prisma/migrations ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then \
      echo "✅ Migrations folder found"; \
    else \
      echo "⚠️ WARNING: Migrations folder missing - init container will use 'prisma db push' as fallback"; \
      ls -la prisma/ || true; \
    fi
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.yarnrc.yml ./

EXPOSE 3333

# Backend service entrypoint (NestJS outputs to dist/src/main.js)
CMD ["node", "dist/src/main"]
