import { Module } from '@nestjs/common';
import { ArquiteturaController } from './arquitetura.controller';
import { EstadoCamadasService } from './estado-camadas.service';
import { IngestaoService } from './ingestao.service';

/**
 * Domínio: camada nuvem da arquitetura edge · fog · nuvem — ingestão MQTT do
 * fog, comandos para o campo e `GET /arquitetura`.
 * Depende do PrismaModule (global) e do EventEmitterModule (AppModule).
 */
@Module({
  controllers: [ArquiteturaController],
  providers: [IngestaoService, EstadoCamadasService],
})
export class IngestaoModule {}
