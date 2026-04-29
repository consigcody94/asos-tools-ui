# =============================================================================
# O.W.L. — Observation Watch Log (Next.js UI)
# Multi-stage Docker build for Proxmox / Docker / managed containers.
#
# Stage 1 (deps):    install package.json deps in a clean Node Alpine image.
# Stage 2 (builder): copy source + run `next build` with output:standalone.
# Stage 3 (runtime): minimal runner serving the built standalone bundle.
#
# `next.config.ts` declares `output: "standalone"` which makes Next.js emit
# a self-contained `.next/standalone` directory — no node_modules install
# required at runtime, no source copy needed in the final stage.  Final
# image is ~150 MB.
# =============================================================================

# ----- Stage 1: deps -----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
RUN npm ci --no-audit --no-fund

# ----- Stage 2: builder -----
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ----- Stage 3: runtime -----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as non-root for ACA defaults + general hygiene.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# Copy the standalone bundle (server.js + minimal node_modules).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
