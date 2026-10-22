import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { AlarmesService } from './alarmes.service';
import { MotorRegrasService } from './motor-regras.service';
import { NotificadorService } from './notificador.service';
import { AlarmesController, RegrasController } from './regras.controller';
import { RegrasService } from './regras.service';

/**
 * Regras e alarmes (RF-PRO-02, 03 e 05): cadastro de regras pela API, motor
 * que avalia cada mensagem do pipeline, ações (alarme, e-mail, comando,
 * webhook, publicação) e o ciclo de vida dos alarmes.
 */
@Module({
  imports: [CatalogoModule, PipelineModule],
  controllers: [RegrasController, AlarmesController],
  providers: [
    RegrasService,
    AlarmesService,
    MotorRegrasService,
    NotificadorService,
  ],
})
export class RegrasModule {}
