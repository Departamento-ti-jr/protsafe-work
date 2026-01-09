# ======================
# Stage 1 — Build
# ======================
FROM node:20-alpine AS builder

WORKDIR /app

# Dependências básicas
RUN apk add --no-cache git

# Ativa corepack (Yarn oficial do Node 20)
RUN corepack enable

COPY package.json yarn.lock ./

# Instala dependências de forma determinística
RUN yarn install --frozen-lockfile

COPY . .

# Build do NestJS
RUN yarn build


# ======================
# Stage 2 — Runtime
# ======================
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000

CMD ["node", "dist/main"]