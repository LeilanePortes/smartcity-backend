import { Module } from '@nestjs/common';
import { IngestaoModule } from '../ingestao/ingestao.module';
import { OtaController } from './ota.controller';
import { OtaService } from './ota.service';

/**
 * Domínio: atualização remota de firmware (OTA) com grupo canário.
 * Usa a ingestão para publicar as ordens e receber resumos e resultados do fog.
 */
@Module({
  imports: [IngestaoModule],
  controllers: [OtaController],
  providers: [OtaService],
})
export class OtaModule {}
