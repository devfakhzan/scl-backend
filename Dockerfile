# Build stage
FROM node:20-alpine AS builder

# Enable Corepack to use Yarn version from package.json
RUN corepack enable

WORKDIR /app

# Copy Yarn config first (needed for node_modules linker)
COPY .yarnrc.yml package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
# Generate Prisma Client and build
RUN yarn prisma:generate && yarn build

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

EXPOSE 3333

CMD ["node", "dist/main"]
