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

# Han, kana and Hangul. A music bot is asked for anime openings and K-pop, and
# node:22-slim ships no CJK font at all, so without this every such title
# renders on the cards as a row of empty boxes.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# The canvas cards composite onto these; without them the sakura variant cannot
# render at all.
COPY assets ./assets

# Run unprivileged: the bot needs no filesystem access beyond its own bundle.
USER node

CMD ["node", "dist/src/main.js"]
