# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS runner

WORKDIR /app

# Install production deps only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/build ./build

# Non-root user for security
RUN addgroup -S mcp && adduser -S mcp -G mcp
USER mcp

# Fargate will route traffic to this port via the task definition
EXPOSE 3001

# Default to HTTP transport for remote/container deployments.
# Override via ECS task environment variables.
ENV MCP_TRANSPORT=http \
    MCP_PORT=3001 \
    MCP_HOST=0.0.0.0 \
    NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/_health || exit 1

CMD ["node", "build/index.js"]
