import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { IngestaoHttpController } from './ingestao-http.controller';
import { IngestaoMqttService } from './ingestao-mqtt.service';
import { InvalidasService } from './invalidas.service';
import { PipelineService } from './pipeline.service';
import { SeriesController } from './series.controller';
import { SeriesService } from './series.service';

/**
 * Pipeline de ingestão da plataforma (Pipes and Filters): HTTP, lote e MQTT
 * entram pelo mesmo caminho até a série temporal, o último valor e o evento
 * interno que o motor de regras escuta.
 */
@Module({
  imports: [CatalogoModule],
  controllers: [IngestaoHttpController, SeriesController],
  providers: [
    PipelineService,
    IngestaoMqttService,
    InvalidasService,
    SeriesService,
  ],
  exports: [PipelineService],
})
export class PipelineModule {}
