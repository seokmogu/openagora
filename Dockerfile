FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache git curl bash

# Install GitHub CLI
RUN apk add --no-cache github-cli || (curl -sSf https://github.com/cli/cli/releases/download/v2.45.0/gh_2.45.0_linux_amd64.tar.gz | tar xz && mv gh_*/bin/gh /usr/local/bin/)

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY config ./config
COPY registry ./registry

EXPOSE 3000 3001

CMD ["node", "dist/index.js"]
