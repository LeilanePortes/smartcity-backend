#!/bin/sh
# Prepara o banco antes de subir a API dentro do container.
#
# DB_BOOTSTRAP controla o seed + backfill de histórico:
#   auto   (default) roda apenas quando o banco ainda não tem postes
#   force  roda sempre — recria a rede e o histórico do zero
#   skip   nunca roda (só aplica as migrations)
set -e

echo "[entrypoint] aplicando migrations..."
bunx prisma migrate deploy

bootstrap() {
  echo "[entrypoint] populando a rede de postes (seed)..."
  bun run prisma/seed.ts
  echo "[entrypoint] gerando histórico (backfill)... pode levar alguns minutos"
  bun run prisma/backfill-historico.ts
}

case "${DB_BOOTSTRAP:-auto}" in
  skip)
    echo "[entrypoint] DB_BOOTSTRAP=skip — seed/backfill ignorados."
    ;;
  force)
    bootstrap
    ;;
  *)
    if [ "$(bun run docker/contar-postes.ts)" = "0" ]; then
      bootstrap
    else
      echo "[entrypoint] banco já populado — seed/backfill ignorados."
    fi
    ;;
esac

# Catálogo (inquilino, domínio, perfil, locais, áreas e um dispositivo por
# poste). Idempotente: roda sempre e não apaga nada.
echo "[entrypoint] atualizando o catálogo de dispositivos..."
bun run prisma/catalogo.ts

echo "[entrypoint] iniciando a API na porta ${PORT:-3000}..."
exec "$@"
