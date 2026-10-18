import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { StatusPoste } from '@prisma/client';
import { connect, MqttClient } from 'mqtt';
import {
  assinaturaNuvem,
  MsgAlerta,
  MsgComandoNuvem,
  MsgEventoNuvem,
  MsgFogEstado,
  MsgFogTrafego,
  MsgResumo,
  parseTopicoNuvem,
  TOPICO_FOG_ESTADO,
  TOPICO_FOG_TRAFEGO,
  topicoNuvem,
} from '../common/topicos-mqtt';
import { EVENTO_POSTE_STATUS_ALTERADO } from '../postes/postes.events';
import type { PosteStatusAlteradoEvent } from '../postes/postes.events';
import { PrismaService } from '../prisma/prisma.service';
import {
  EVENTO_SIM_POSTES_ATUALIZADOS,
  PostesAtualizadosEvent,
  SnapshotPoste,
} from '../simulador/simulador.events';
import { EstadoCamadasService } from './estado-camadas.service';
import {
  AtualizacaoPoste,
  planejarAlerta,
  planejarEvento,
  planejarResumo,
} from './ingestao.mapper';
import {
  lerModoSimulador,
  lerMqttNuvemUrl,
  ModoSimulador,
} from './ingestao.config';

/// Campos do poste que viajam no snapshot de tempo real.
const CAMPOS_SNAPSHOT = {
  id: true,
  codigo: true,
  status: true,
  luminosidadeAtual: true,
  consumoInstantaneoKw: true,
  ultimaLeituraEm: true,
} as const;

/**
 * Camada nuvem: recebe do fog (broker MQTT da nuvem) os resumos, eventos e
 * alertas e os grava no banco. Emite o mesmo evento interno que o simulador
 * emitia, então o WebSocket e o app continuam recebendo o mesmo formato.
 *
 * Também faz o caminho inverso: a manutenção marcada pelo técnico
 * (PATCH /postes/:id/status) vira um comando que desce até o poste.
 *
 * Só atua com `SIMULADOR_MODO=camadas`.
 */
@Injectable()
export class IngestaoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestaoService.name);
  readonly modo: ModoSimulador;
  private readonly brokerUrl: string;
  private cliente: MqttClient | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly estado: EstadoCamadasService,
    config: ConfigService,
  ) {
    this.modo = lerModoSimulador(config);
    this.brokerUrl = lerMqttNuvemUrl(config);
  }

  onModuleInit(): void {
    if (this.modo !== 'camadas') {
      this.logger.log(
        'SIMULADOR_MODO=interno — dados vindos do simulador embutido.',
      );
      return;
    }

    this.cliente = connect(this.brokerUrl, {
      clientId: 'itaguari-nuvem-api',
      reconnectPeriod: 2_000,
    });

    this.cliente.on('connect', () => {
      this.estado.brokerConectado = true;
      this.logger.log(
        `Ingestão conectada ao broker da nuvem ${this.brokerUrl}`,
      );
      this.cliente?.subscribe(
        [
          assinaturaNuvem('resumo'),
          assinaturaNuvem('evento'),
          assinaturaNuvem('alerta'),
          TOPICO_FOG_ESTADO,
          TOPICO_FOG_TRAFEGO,
        ],
        { qos: 1 },
      );
    });
    this.cliente.on('offline', () => {
      this.estado.brokerConectado = false;
      this.logger.warn('Broker da nuvem indisponível — reconectando...');
    });
    this.cliente.on('error', (erro) =>
      this.logger.warn(`Erro MQTT: ${erro.message}`),
    );
    this.cliente.on('message', (topico, payload) => {
      void this.processar(topico, payload.toString()).catch((erro: Error) =>
        this.logger.error(`Falha ao processar ${topico}: ${erro.message}`),
      );
    });

    this.logger.log(
      'SIMULADOR_MODO=camadas — dados vindos do fog (edge → fog → nuvem).',
    );
  }

  onModuleDestroy(): void {
    this.cliente?.end(true);
  }

  /** Manutenção marcada pelo técnico → comando para o poste, via fog. */
  @OnEvent(EVENTO_POSTE_STATUS_ALTERADO)
  async aoAlterarStatusManual({
    posteId,
    status,
  }: PosteStatusAlteradoEvent): Promise<void> {
    if (!this.cliente) return;
    if (status !== StatusPoste.MANUTENCAO && status !== StatusPoste.NORMAL) {
      return;
    }
    const poste = await this.prisma.poste.findUnique({
      where: { id: posteId },
      select: { codigo: true, bairro: true },
    });
    if (!poste) return;

    const comando: MsgComandoNuvem = {
      codigo: poste.codigo,
      status,
      em: new Date().toISOString(),
    };
    // QoS 1: se o broker estiver fora, o cliente guarda e envia ao reconectar.
    this.cliente.publish(
      topicoNuvem(poste.bairro, 'comando'),
      JSON.stringify(comando),
      { qos: 1 },
    );
    this.logger.log(`Comando enviado ao campo: ${poste.codigo} → ${status}`);
  }

  // --- Mensagens do fog ----------------------------------------------------

  private async processar(topico: string, payload: string): Promise<void> {
    const msg = JSON.parse(payload) as unknown;

    if (topico === TOPICO_FOG_ESTADO) {
      this.estado.fog = msg as MsgFogEstado;
      return;
    }
    if (topico === TOPICO_FOG_TRAFEGO) {
      this.estado.trafego = msg as MsgFogTrafego;
      return;
    }

    const alvo = parseTopicoNuvem(topico);
    if (!alvo) return;
    if (alvo.grandeza === 'resumo') await this.aoResumo(msg as MsgResumo);
    else if (alvo.grandeza === 'evento') {
      await this.aoEvento(msg as MsgEventoNuvem);
    } else if (alvo.grandeza === 'alerta') {
      await this.aoAlerta(msg as MsgAlerta);
    }
  }

  private async aoResumo(msg: MsgResumo): Promise<void> {
    const plano = planejarResumo(msg);

    // `atualizar` ignora postes que a nuvem não conhece (ex.: fog provisionado
    // antes de um novo seed); as leituras seguem o mesmo filtro.
    const atualizados = await this.atualizar(plano.atualizacoes);
    const conhecidos = new Set(atualizados.map((p) => p.posteId));
    const ignorados = plano.atualizacoes.length - conhecidos.size;
    if (ignorados > 0) {
      this.logger.warn(
        `Resumo ${msg.bairro}: ${ignorados} postes desconhecidos ignorados ` +
          '(reinicie edge e fog após um novo seed).',
      );
    }

    const leituras = plano.leituras.filter((l) => conhecidos.has(l.posteId));
    if (leituras.length) {
      await this.prisma.leituraTelemetria.createMany({ data: leituras });
    }
    this.emitir('telemetria', atualizados);
  }

  private async aoEvento(msg: MsgEventoNuvem): Promise<void> {
    const { evento, atualizacao } = planejarEvento(msg);
    const [poste] = await this.atualizar([atualizacao]);
    if (!poste) return; // poste desconhecido
    await this.prisma.eventoSensor.create({ data: evento });
    this.emitir('sensores', [poste]);
  }

  private async aoAlerta(msg: MsgAlerta): Promise<void> {
    this.estado.registrarAlerta(msg);
    this.logger.log(
      `Alerta do fog (${msg.bairro}) · ${msg.codigo}: ${msg.statusAnterior} → ${msg.status} — ${msg.motivo}`,
    );
    const atualizados = await this.atualizar([planejarAlerta(msg)]);
    this.emitir('status', atualizados);
  }

  /** Atualiza os postes que existem e devolve os snapshots resultantes. */
  private async atualizar(
    atualizacoes: AtualizacaoPoste[],
  ): Promise<SnapshotPoste[]> {
    if (!atualizacoes.length) return [];
    const ids = atualizacoes.map((a) => a.posteId);
    const existentes = new Set(
      (
        await this.prisma.poste.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    const validas = atualizacoes.filter((a) => existentes.has(a.posteId));
    if (!validas.length) return [];

    const postes = await this.prisma.$transaction(
      validas.map((a) =>
        this.prisma.poste.update({
          where: { id: a.posteId },
          data: a.data,
          select: CAMPOS_SNAPSHOT,
        }),
      ),
    );
    return postes.map((p) => ({
      posteId: p.id,
      codigo: p.codigo,
      status: p.status,
      luminosidadeAtual: p.luminosidadeAtual,
      consumoInstantaneoKw: p.consumoInstantaneoKw,
      ultimaLeituraEm: p.ultimaLeituraEm,
    }));
  }

  private emitir(
    origem: PostesAtualizadosEvent['origem'],
    postes: SnapshotPoste[],
  ): void {
    if (!postes.length) return;
    this.eventEmitter.emit(EVENTO_SIM_POSTES_ATUALIZADOS, {
      origem,
      postes,
      em: new Date(),
    } satisfies PostesAtualizadosEvent);
  }
}
