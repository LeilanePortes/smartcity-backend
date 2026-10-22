-- CreateTable
CREATE TABLE "inquilinos" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquilinos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'bairro',
    "geometria" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'rua',
    "geometria" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dominios" (
    "id" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dominios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfis_dispositivo" (
    "id" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "grandezas" JSONB NOT NULL,
    "intervaloEnvioS" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perfis_dispositivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispositivos" (
    "id" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "dominioId" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "areaId" TEXT,
    "fabricante" TEXT NOT NULL,
    "modelo" TEXT,
    "firmware" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "posteId" TEXT,
    "ultimaMensagemEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispositivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credenciais_dispositivo" (
    "id" TEXT NOT NULL,
    "dispositivoId" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "emitidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm" TIMESTAMP(3),

    CONSTRAINT "credenciais_dispositivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inquilinos_slug_key" ON "inquilinos"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "sites_inquilinoId_slug_key" ON "sites"("inquilinoId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "areas_siteId_slug_key" ON "areas"("siteId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "dominios_inquilinoId_slug_key" ON "dominios"("inquilinoId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "perfis_dispositivo_inquilinoId_slug_key" ON "perfis_dispositivo"("inquilinoId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "dispositivos_posteId_key" ON "dispositivos"("posteId");

-- CreateIndex
CREATE INDEX "dispositivos_dominioId_idx" ON "dispositivos"("dominioId");

-- CreateIndex
CREATE INDEX "dispositivos_siteId_idx" ON "dispositivos"("siteId");

-- CreateIndex
CREATE INDEX "dispositivos_perfilId_idx" ON "dispositivos"("perfilId");

-- CreateIndex
CREATE UNIQUE INDEX "dispositivos_inquilinoId_codigo_key" ON "dispositivos"("inquilinoId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "credenciais_dispositivo_prefixo_key" ON "credenciais_dispositivo"("prefixo");

-- CreateIndex
CREATE INDEX "credenciais_dispositivo_dispositivoId_idx" ON "credenciais_dispositivo"("dispositivoId");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_inquilinoId_fkey" FOREIGN KEY ("inquilinoId") REFERENCES "inquilinos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dominios" ADD CONSTRAINT "dominios_inquilinoId_fkey" FOREIGN KEY ("inquilinoId") REFERENCES "inquilinos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfis_dispositivo" ADD CONSTRAINT "perfis_dispositivo_inquilinoId_fkey" FOREIGN KEY ("inquilinoId") REFERENCES "inquilinos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_inquilinoId_fkey" FOREIGN KEY ("inquilinoId") REFERENCES "inquilinos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_dominioId_fkey" FOREIGN KEY ("dominioId") REFERENCES "dominios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis_dispositivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_posteId_fkey" FOREIGN KEY ("posteId") REFERENCES "postes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credenciais_dispositivo" ADD CONSTRAINT "credenciais_dispositivo_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "dispositivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

