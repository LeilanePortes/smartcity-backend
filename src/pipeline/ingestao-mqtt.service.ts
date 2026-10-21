import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, MqttClient } from 'mqtt';
import { INQUILINO, parseTopicoDispositivo } from '../common/contrato';
import { lerMqttNuvemUrl } from '../ingestao/ingestao.config';
import { PipelineService } from './pipeline.service';

/// Tipos que o dispositivo publica (comando é só da plataforma para ele).
const TIPOS_ENTRADA = ['telemetria', 'evento', 'estado'] as const;

/**
 * Entrada MQTT do pipeline (RF-ING-01): assina os tópicos canônicos
 * `{inquilino}/{site}/{dominio}/{dispositivo}/{telemetria|evento|estado}` no
 * broker da nuvem e manda cada mensagem para o mesmo pipeline do HTTP.
 * Os postes continuam chegando pelo resumo do fog (IngestaoService).
 */
@Injectable()
export class IngestaoMqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestaoMqttService.name);
  private readonly brokerUrl: string;
  private cliente: MqttClient | null = null;

  constructor(
    private readonly pipeline: PipelineService,
    config: ConfigService,
  ) {
    this.brokerUrl = lerMqttNuvemUrl(config);
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.cliente = connect(this.brokerUrl, {
      clientId: 'itaguari-nuvem-pipeline',
      reconnectPeriod: 5_000,
    });
    this.cliente.on('connect', () => {
      this.cliente?.subscribe(
        TIPOS_ENTRADA.map((t) => `${INQUILINO}/+/+/+/${t}`),
        { qos: 1 },
      );
      this.logger.log(
        `Pipeline assinando ${INQUILINO}/+/+/+/{${TIPOS_ENTRADA.join('|')}} em ${this.brokerUrl}`,
      );
    });
    this.cliente.on('error', (e) =>
      this.logger.warn(`Erro MQTT do pipeline: ${e.message}`),
    );
    this.cliente.on('message', (topico, payload) => {
      const t = parseTopicoDispositivo(topico);
      if (!t) return;
      void this.pipeline
        .processar([payload], {
          canal: 'mqtt',
          inquilino: t.inquilino,
          topico: t,
          topicoTexto: topico,
        })
        .catch((e: Error) =>
          this.logger.error(`Falha no pipeline (${topico}): ${e.message}`),
        );
    });
  }

  onModuleDestroy(): void {
    this.cliente?.end(true);
  }
}
