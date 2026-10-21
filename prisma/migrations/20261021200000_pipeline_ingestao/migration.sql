-- CreateTable
CREATE TABLE "mensagens" (
    "id" TEXT NOT NULL,
    "idMensagem" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "dominioId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "areaId" TEXT,
    "tipo" TEXT NOT NULL,
    "medidoEm" TIMESTAMP(3) NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canal" TEXT NOT NULL,
    "via" TEXT,
    "atrasada" BOOLEAN NOT NULL,
    "conteudo" JSONB NOT NULL,

    CONSTRAINT "mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicoes" (
    "id" BIGSERIAL NOT NULL,
    "mensagemId" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "dominioId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "areaId" TEXT,
    "grandeza" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "unidade" TEXT NOT NULL,
    "medidoEm" TIMESTAMP(3) NOT NULL,
    "suspeita" BOOLEAN NOT NULL DEFAULT false,
    "motivoSuspeita" TEXT,

    CONSTRAINT "medicoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ultimos_valores" (
    "dispositivoId" TEXT NOT NULL,
    "grandeza" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "unidade" TEXT NOT NULL,
    "medidoEm" TIMESTAMP(3) NOT NULL,
    "suspeita" BOOLEAN NOT NULL DEFAULT false,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ultimos_valores_pkey" PRIMARY KEY ("dispositivoId","grandeza")
);

-- CreateTable
CREATE TABLE "mensagens_invalidas" (
    "id" TEXT NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canal" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "erros" JSONB NOT NULL,
    "dispositivo" TEXT,
    "idMensagem" TEXT,
    "topico" TEXT,
    "payload" JSONB,

    CONSTRAINT "mensagens_invalidas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mensagens_idMensagem_key" ON "mensagens"("idMensagem");

-- CreateIndex
CREATE INDEX "mensagens_dispositivoId_medidoEm_idx" ON "mensagens"("dispositivoId", "medidoEm");

-- CreateIndex
CREATE INDEX "mensagens_tipo_medidoEm_idx" ON "mensagens"("tipo", "medidoEm");

-- CreateIndex
CREATE INDEX "medicoes_dispositivoId_grandeza_medidoEm_idx" ON "medicoes"("dispositivoId", "grandeza", "medidoEm");

-- CreateIndex
CREATE INDEX "medicoes_areaId_grandeza_medidoEm_idx" ON "medicoes"("areaId", "grandeza", "medidoEm");

-- CreateIndex
CREATE INDEX "medicoes_siteId_grandeza_medidoEm_idx" ON "medicoes"("siteId", "grandeza", "medidoEm");

-- CreateIndex
CREATE INDEX "mensagens_invalidas_recebidoEm_idx" ON "mensagens_invalidas"("recebidoEm");

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "dispositivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicoes" ADD CONSTRAINT "medicoes_mensagemId_fkey" FOREIGN KEY ("mensagemId") REFERENCES "mensagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ultimos_valores" ADD CONSTRAINT "ultimos_valores_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "dispositivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Série única da plataforma (RF-DAD-01): as medições do pipeline e o histórico
-- de telemetria dos postes (potência e luminosidade), já com dispositivo,
-- domínio, local e área do cadastro. Consultas por dispositivo, grandeza, área
-- e intervalo leem desta view.
CREATE VIEW "serie_medicoes" AS
  SELECT m."inquilinoId", m."dispositivoId", m."dominioId", m."siteId", m."areaId",
         m."grandeza", m."valor", m."unidade", m."medidoEm", m."suspeita"
    FROM "medicoes" m
  UNION ALL
  SELECT d."inquilinoId", d."id", d."dominioId", d."siteId", d."areaId",
         'potencia', l."consumoKw", 'kW', l."timestamp", false
    FROM "leituras_telemetria" l
    JOIN "dispositivos" d ON d."posteId" = l."posteId"
  UNION ALL
  SELECT d."inquilinoId", d."id", d."dominioId", d."siteId", d."areaId",
         'luminosidade', l."luminosidadePct"::double precision, '%', l."timestamp", false
    FROM "leituras_telemetria" l
    JOIN "dispositivos" d ON d."posteId" = l."posteId";
