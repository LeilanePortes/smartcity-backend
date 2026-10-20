import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { PostesModule } from './postes/postes.module';
import { TelemetriaModule } from './telemetria/telemetria.module';
import { EventosModule } from './eventos/eventos.module';
import { AgregadosModule } from './agregados/agregados.module';
import { SimuladorModule } from './simulador/simulador.module';
import { TempoRealModule } from './tempo-real/tempo-real.module';
import { IngestaoModule } from './ingestao/ingestao.module';
import { OtaModule } from './ota/ota.module';
import { ContratosModule } from './contratos/contratos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    PrismaModule,
    PostesModule,
    TelemetriaModule,
    EventosModule,
    AgregadosModule,
    SimuladorModule,
    TempoRealModule,
    IngestaoModule,
    OtaModule,
    ContratosModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
