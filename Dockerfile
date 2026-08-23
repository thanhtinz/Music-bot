# Build stage: full dev dependencies, compiled to plain JavaScript.
FROM node:22-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies only.
FROM node:22-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# The canvas cards composite onto these; without them the sakura variant cannot
# render at all.
COPY assets ./assets

# Run unprivileged: the bot needs no filesystem access beyond its own bundle.
USER node

CMD ["node", "dist/src/main.js"]
