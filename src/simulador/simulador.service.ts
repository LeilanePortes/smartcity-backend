import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { EVENTO_POSTE_STATUS_ALTERADO } from '../postes/postes.events';
import type { PosteStatusAlteradoEvent } from '../postes/postes.events';
import { PrismaService } from '../prisma/prisma.service';
import {
  EVENTO_SIM_POSTES_ATUALIZADOS,
  PostesAtualizadosEvent,
  SnapshotPoste,
} from './simulador.events';
import { lerSimuladorConfig, SimuladorConfig } from './simulador.config';
import {
  aplicarStatusManual,
  EstadoPoste,
  estadoInicial,
  EventoGerado,
  gerarLeitura,
  LeituraGerada,
  passoSensor,
  passoStatus,
  probDeteccaoPorTick,
} from './simulador.engine';

/**
 * Worker que simula a telemetria IoT da rede: variação de luminosidade por
 * detecção de veículo, eventos do sensor 360°, leituras de consumo e transição
 * de status ao longo do tempo (roadmap Fase 2).
 *
 * O estado vivo dos postes é mantido em memória e sincronizado com o banco a
 * cada tick. Desligue com `SIMULADOR_ENABLED=false`.
 */
@Injectable()
export class SimuladorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimuladorService.name);
  private readonly config: SimuladorConfig;
  private readonly estado = new Map<string, EstadoPoste>();
  private readonly rodando = new Set<string>();
  private readonly intervalos: string[] = [];
  private readonly probDeteccao: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerRegistry,
    private readonly eventEmitter: EventEmitter2,
    configService: ConfigService,
  ) {
    this.config = lerSimuladorConfig(configService);
    this.probDeteccao = probDeteccaoPorTick(this.config.intervaloSensoresMs);
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.habilitado) {
      this.logger.warn('Simulador desabilitado (SIMULADOR_ENABLED=false).');
      return;
    }

    await this.carregarEstado();

    this.registrar('sim:sensores', this.config.intervaloSensoresMs, () =>
      this.tickSensores(),
    );
    this.registrar('sim:telemetria', this.config.intervaloTelemetriaMs, () =>
      this.tickTelemetria(),
    );
    this.registrar('sim:status', this.config.intervaloStatusMs, () =>
      this.tickStatus(),
    );
    this.registrar('sim:limpeza', this.config.intervaloLimpezaMs, () =>
      this.tickLimpeza(),
    );

    this.logger.log(
      `Simulador ativo — ${this.estado.size} postes | sensores ${this.config.intervaloSensoresMs}ms · ` +
        `telemetria ${this.config.intervaloTelemetriaMs}ms · status ${this.config.intervaloStatusMs}ms`,
    );
  }

  onModuleDestroy(): void {
    for (const nome of this.intervalos) {
      if (this.scheduler.doesExist('interval', nome)) {
        this.scheduler.deleteInterval(nome);
      }
    }
  }

  /**
   * Mantém o estado em memória em sincronia quando o status de um poste é
   * alterado manualmente pela API (PATCH /postes/:id/status), evitando que o
   * próximo flush do simulador sobrescreva a mudança.
   */
  @OnEvent(EVENTO_POSTE_STATUS_ALTERADO)
  aoAlterarStatusManual({ posteId, status }: PosteStatusAlteradoEvent): void {
    const estado = this.estado.get(posteId);
    if (estado) aplicarStatusManual(estado, status);
  }

  /** Carrega o estado inicial dos postes a partir do banco (pós-seed). */
  private async carregarEstado(): Promise<void> {
    const postes = await this.prisma.poste.findMany({
      select: {
        id: true,
        codigo: true,
        status: true,
        luminosidadeAtual: true,
        consumoInstantaneoKw: true,
        ultimaLeituraEm: true,
      },
      orderBy: { codigo: 'asc' },
    });

    for (const p of postes) {
      this.estado.set(p.id, estadoInicial(p));
    }
  }

  private registrar(nome: string, ms: number, fn: () => Promise<void>): void {
    const ref = setInterval(() => void this.executarSeguro(nome, fn), ms);
    this.scheduler.addInterval(nome, ref);
    this.intervalos.push(nome);
  }

  /** Evita sobreposição de um mesmo tick e isola falhas de um tick do resto. */
  private async executarSeguro(
    nome: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (this.rodando.has(nome)) return;
    this.rodando.add(nome);
    try {
      await fn();
    } catch (erro) {
      this.logger.error(`Falha no tick ${nome}`, erro as Error);
    } finally {
      this.rodando.delete(nome);
    }
  }

  // --- Ticks ---------------------------------------------------------------

  private async tickSensores(): Promise<void> {
    const agora = new Date();
    const eventos: EventoGerado[] = [];

    for (const estado of this.estado.values()) {
      const evento = passoSensor(estado, agora, this.probDeteccao);
      if (evento) eventos.push(evento);
    }

    if (!eventos.length) return;
    await this.prisma.eventoSensor.createMany({ data: eventos });
    const afetados = eventos
      .map((e) => this.estado.get(e.posteId))
      .filter(Boolean) as EstadoPoste[];
    await this.flushPostes(afetados);
    this.emitirAtualizacao('sensores', afetados);
  }

  private async tickTelemetria(): Promise<void> {
    const agora = new Date();
    const leituras: LeituraGerada[] = [];

    for (const estado of this.estado.values()) {
      const leitura = gerarLeitura(estado, agora);
      if (leitura) leituras.push(leitura);
    }

    if (!leituras.length) return;
    await this.prisma.leituraTelemetria.createMany({ data: leituras });
    // Postes offline não geram leitura: seus campos ficam congelados no banco
    // desde a transição, e `ultimaLeituraEm` envelhece sozinho.
    const afetados = leituras
      .map((l) => this.estado.get(l.posteId))
      .filter(Boolean) as EstadoPoste[];
    await this.flushPostes(afetados);
    this.emitirAtualizacao('telemetria', afetados);
  }

  private async tickStatus(): Promise<void> {
    const mudados = passoStatus([...this.estado.values()], new Date());
    if (!mudados.length) return;
    await this.flushPostes(mudados);
    this.emitirAtualizacao('status', mudados);
    this.logger.log(
      `Transição de status — ${mudados
        .map((e) => `${e.codigo}: ${e.status}`)
        .join(' | ')}`,
    );
  }

  private async tickLimpeza(): Promise<void> {
    const corte = new Date(
      Date.now() - this.config.retencaoDias * 24 * 60 * 60_000,
    );
    const [leituras, eventos] = await Promise.all([
      this.prisma.leituraTelemetria.deleteMany({
        where: { timestamp: { lt: corte } },
      }),
      this.prisma.eventoSensor.deleteMany({
        where: { timestamp: { lt: corte } },
      }),
    ]);
    if (leituras.count || eventos.count) {
      this.logger.log(
        `Limpeza (> ${this.config.retencaoDias}d): ${leituras.count} leituras, ${eventos.count} eventos removidos.`,
      );
    }
  }

  private snapshot(e: EstadoPoste): SnapshotPoste {
    return {
      posteId: e.id,
      codigo: e.codigo,
      status: e.status,
      luminosidadeAtual: e.luminosidadePct,
      consumoInstantaneoKw: e.consumoKw,
      ultimaLeituraEm: e.ultimaLeituraEm,
    };
  }

  /** Publica os postes alterados no barramento para o gateway de tempo real. */
  private emitirAtualizacao(
    origem: PostesAtualizadosEvent['origem'],
    estados: EstadoPoste[],
  ): void {
    if (!estados.length) return;
    this.eventEmitter.emit(EVENTO_SIM_POSTES_ATUALIZADOS, {
      origem,
      postes: estados.map((e) => this.snapshot(e)),
      em: new Date(),
    } satisfies PostesAtualizadosEvent);
  }

  /** Sincroniza os campos "atuais" dos postes (memória → banco). */
  private async flushPostes(estados: EstadoPoste[]): Promise<void> {
    if (!estados.length) return;
    await this.prisma.$transaction(
      estados.map((e) =>
        this.prisma.poste.update({
          where: { id: e.id },
          data: {
            status: e.status,
            luminosidadeAtual: e.luminosidadePct,
            consumoInstantaneoKw: e.consumoKw,
            ultimaLeituraEm: e.ultimaLeituraEm,
          },
        }),
      ),
    );
  }
}
