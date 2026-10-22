-- CreateEnum
CREATE TYPE "SeveridadeAlarme" AS ENUM ('INFO', 'AVISO', 'CRITICO');

-- CreateEnum
CREATE TYPE "StatusAlarme" AS ENUM ('ATIVO', 'RECONHECIDO', 'RESOLVIDO');

-- CreateTable
CREATE TABLE "regras" (
    "id" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "dominioId" TEXT,
    "siteId" TEXT,
    "areaId" TEXT,
    "perfilId" TEXT,
    "dispositivoId" TEXT,
    "condicao" JSONB NOT NULL,
    "severidade" "SeveridadeAlarme" NOT NULL DEFAULT 'AVISO',
    "acoes" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarmes" (
    "id" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "regraId" TEXT,
    "dispositivoId" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "severidade" "SeveridadeAlarme" NOT NULL,
    "status" "StatusAlarme" NOT NULL DEFAULT 'ATIVO',
    "titulo" TEXT NOT NULL,
    "detalhe" TEXT,
    "grandeza" TEXT,
    "valor" DOUBLE PRECISION,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconhecidoEm" TIMESTAMP(3),
    "reconhecidoPor" TEXT,
    "resolvidoEm" TIMESTAMP(3),
    "resolvidoPor" TEXT,
    "comentario" TEXT,

    CONSTRAINT "alarmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execucoes_acao" (
    "id" TEXT NOT NULL,
    "regraId" TEXT,
    "alarmeId" TEXT,
    "tipo" TEXT NOT NULL,
    "destino" TEXT,
    "status" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "execucoes_acao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regras_inquilinoId_ativa_idx" ON "regras"("inquilinoId", "ativa");

-- CreateIndex
CREATE INDEX "alarmes_status_severidade_idx" ON "alarmes"("status", "severidade");

-- CreateIndex
CREATE INDEX "alarmes_dispositivoId_status_idx" ON "alarmes"("dispositivoId", "status");

-- CreateIndex
CREATE INDEX "alarmes_regraId_status_idx" ON "alarmes"("regraId", "status");

-- CreateIndex
CREATE INDEX "execucoes_acao_regraId_criadoEm_idx" ON "execucoes_acao"("regraId", "criadoEm");

-- AddForeignKey
ALTER TABLE "alarmes" ADD CONSTRAINT "alarmes_regraId_fkey" FOREIGN KEY ("regraId") REFERENCES "regras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alarmes" ADD CONSTRAINT "alarmes_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "dispositivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execucoes_acao" ADD CONSTRAINT "execucoes_acao_regraId_fkey" FOREIGN KEY ("regraId") REFERENCES "regras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execucoes_acao" ADD CONSTRAINT "execucoes_acao_alarmeId_fkey" FOREIGN KEY ("alarmeId") REFERENCES "alarmes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

