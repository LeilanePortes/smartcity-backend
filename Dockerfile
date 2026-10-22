# Imagem do backend NestJS (Bun + Prisma). Usada pelo serviço `app` do
# docker-compose.yml — ver README, seção "Rodar tudo com Docker".

# --- build: dependências, cliente Prisma e compilação para dist/ --------------
FROM oven/bun:1.3 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src

RUN bunx prisma generate && bun run build

# --- runtime ------------------------------------------------------------------
FROM oven/bun:1.3
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Os engines do Prisma são linkados contra o OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# node_modules vem do build já com o cliente Prisma gerado. Mantém as
# devDependencies porque o entrypoint usa a CLI do Prisma (migrate deploy) e
# roda seed/backfill, que são TypeScript e importam de src/.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json bun.lock tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY docker ./docker
# Contrato canônico (JSON Schema e AsyncAPI): validação e publicação por URL.
COPY contratos ./contratos

RUN chmod +x docker/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["bun", "run", "dist/main.js"]
