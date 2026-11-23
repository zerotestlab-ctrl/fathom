FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# The published heimdall binary needs glibc 2.39. Bookworm has 2.36, so the
# runtime stage is Ubuntu 24.04 and reuses the Node binary from the build stage.
FROM ubuntu:24.04 AS run
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libssl3 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /usr/local/lib/node_modules /usr/local/lib/node_modules
ADD https://github.com/Jon-Becker/heimdall-rs/releases/download/0.9.3/heimdall-linux-amd64 /usr/local/bin/heimdall
RUN chmod +x /usr/local/bin/heimdall && heimdall --version && node --version
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=43123
ENV HOSTNAME=0.0.0.0
ENV HEIMDALL_BIN=/usr/local/bin/heimdall
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p /app/generated
EXPOSE 43123
CMD ["node", "server.js"]
