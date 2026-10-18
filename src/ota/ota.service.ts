import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { StatusPoste } from '@prisma/client';
import { CATALOGO_FIRMWARE, VERSAO_FIRMWARE_PADRAO } from '../common/firmware';
import { MsgOtaNuvem, topicoNuvem } from '../common/topicos-mqtt';
import type { MsgOtaResultado, MsgResumo } from '../common/topicos-mqtt';
import {
  EVENTO_NUVEM_OTA_RESULTADO,
  EVENTO_NUVEM_RESUMO,
} from '../ingestao/ingestao.events';
import { IngestaoService } from '../ingestao/ingestao.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AmostraPoste,
  alvoDaOnda,
  CriteriosOta,
  DecisaoOta,
  decidir,
  MetricasGrupo,
  metricasGrupo,
  PosteElegivel,
  selecionarRepresentativo,
} from './ota.regras';

export type StatusImplantacao = 'EM_ANDAMENTO' | 'CONCLUIDA' | 'REVERTIDA';

export interface RegistroDecisao {
  em: Date;
  ondaPct: number;
  decisao: DecisaoOta;
  motivo: string;
  razaoConsumo: number | null;
}

interface Implantacao {
  versao: string;
  versaoAnterior: string;
  status: StatusImplantacao;
  iniciadaEm: Date;
  encerradaEm: Date | null;
  ondas: number[];
  ondaAtual: number;
  ondaIniciadaMs: number;
  proximaAvaliacaoMs: number;
  extensoes: number;
  elegiveis: PosteElegivel[];
  /// Consumo normalizado mediano da frota no início (referência sem controle).
  linhaDeBase: number | null;
  /// codigo → instante do envio (aguardando resultado).
  pendentes: Map<string, number>;
  /// codigo → instante em que a instalação foi confirmada.
  instalados: Map<string, number>;
  falhas: Map<string, string>;
  controle: string[];
  revertidos: number;
  metricas: {
    canario: MetricasGrupo;
    controle: MetricasGrupo | null;
    referenciaConsumo: number | null;
    razaoConsumo: number | null;
  } | null;
  decisoes: RegistroDecisao[];
}

const INTERVALO_VERIFICACAO_MS = 5_000;

function lista(raw: string | undefined, padrao: number[]): number[] {
  const n = (raw ?? '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0 && x <= 100);
  return n.length ? [...new Set(n)].sort((a, b) => a - b) : padrao;
}

function numero(raw: string | undefined, padrao: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/**
 * Atualização remota (OTA) da frota com grupo canário, conduzida pela nuvem.
 *
 * A versão nova vai primeiro a um grupo pequeno e representativo (canário),
 * comparado com um grupo de controle que segue na versão antiga. A cada janela
 * de observação um "portão" decide: avançar para a próxima onda, estender a
 * observação, concluir ou reverter a frota (reenviar a versão anterior).
 *
 * As ordens descem nuvem → fog → poste; os resultados e as métricas (resumos
 * do fog) sobem pelo mesmo caminho. Só funciona com SIMULADOR_MODO=camadas.
 */
@Injectable()
export class OtaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OtaService.name);
  readonly criterios: CriteriosOta;
  readonly ondasPadrao: number[];
  readonly janelaMs: number;
  private readonly timeoutInstalacaoMs: number;
  private readonly amostras = new Map<string, AmostraPoste>();
  private implantacao: Implantacao | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestao: IngestaoService,
    config: ConfigService,
  ) {
    this.ondasPadrao = lista(config.get('OTA_ONDAS'), [5, 25, 50, 100]);
    this.janelaMs = numero(config.get('OTA_JANELA_S'), 120) * 1000;
    this.timeoutInstalacaoMs =
      numero(config.get('OTA_TIMEOUT_INSTALACAO_S'), 60) * 1000;
    this.criterios = {
      limiarFalhaInstalacaoPct: numero(config.get('OTA_LIMIAR_FALHA_PCT'), 5),
      limiarRazaoConsumo: numero(config.get('OTA_LIMIAR_RAZAO_CONSUMO'), 1.5),
      minReportePct: 60,
      maxExtensoes: 2,
    };
  }

  onModuleInit(): void {
    if (this.ingestao.modo !== 'camadas') return;
    this.timer = setInterval(() => {
      void this.verificar().catch((erro: Error) =>
        this.logger.error(`Falha na verificação do OTA: ${erro.message}`),
      );
    }, INTERVALO_VERIFICACAO_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // --- Entradas vindas do fog ---------------------------------------------

  @OnEvent(EVENTO_NUVEM_RESUMO)
  aoResumo(msg: MsgResumo): void {
    const inicioMs = new Date(msg.inicio).getTime();
    const fimMs = new Date(msg.fim).getTime();
    for (const p of msg.postes) {
      const normalizado =
        p.leituras > 0 &&
        p.consumoMedioKw !== null &&
        p.luminosidadeMediaPct !== null &&
        p.luminosidadeMediaPct > 0
          ? p.consumoMedioKw / (p.luminosidadeMediaPct / 100)
          : null;
      this.amostras.set(p.codigo, {
        normalizado: p.leituras > 0 ? normalizado : null,
        status: p.status,
        versao: p.versaoFirmware,
        inicioMs,
        fimMs,
      });
    }
  }

  @OnEvent(EVENTO_NUVEM_OTA_RESULTADO)
  aoResultado(msg: MsgOtaResultado): void {
    const imp = this.implantacao;
    if (!imp) return;

    // Resultado da reversão (versão anterior reenviada).
    if (msg.versaoAlvo === imp.versaoAnterior && msg.sucesso) {
      imp.revertidos++;
      return;
    }
    if (msg.versaoAlvo !== imp.versao) return;

    // Aparelho que terminou de instalar depois da reversão também volta.
    if (imp.status === 'REVERTIDA') {
      const poste = imp.elegiveis.find((p) => p.codigo === msg.codigo);
      if (msg.sucesso && poste) {
        this.enviarOta(poste, imp.versaoAnterior, Date.now());
      }
      return;
    }
    if (imp.status !== 'EM_ANDAMENTO') return;
    if (!imp.pendentes.delete(msg.codigo)) return;

    if (msg.sucesso) {
      imp.instalados.set(msg.codigo, new Date(msg.em).getTime());
    } else {
      imp.falhas.set(msg.codigo, msg.motivo);
      this.logger.warn(`OTA ${msg.codigo}: ${msg.motivo}`);
    }

    // Todos responderam e a falha já passou do limite: não espera a janela.
    const tentativas = imp.instalados.size + imp.falhas.size;
    if (
      imp.pendentes.size === 0 &&
      (imp.falhas.size / tentativas) * 100 >
        this.criterios.limiarFalhaInstalacaoPct
    ) {
      void this.avaliar(Date.now());
    }
  }

  // --- API -----------------------------------------------------------------

  async iniciar(versao: string): Promise<ReturnType<OtaService['estado']>> {
    if (this.ingestao.modo !== 'camadas') {
      throw new ConflictException(
        'OTA exige SIMULADOR_MODO=camadas (os aparelhos ficam na camada edge).',
      );
    }
    if (this.implantacao?.status === 'EM_ANDAMENTO') {
      throw new ConflictException(
        `Já existe uma implantação em andamento (versão ${this.implantacao.versao}).`,
      );
    }
    const versaoAnterior = this.versaoPredominante();
    if (versao === versaoAnterior) {
      throw new BadRequestException(`A frota já está na versão ${versao}.`);
    }

    const postes = await this.prisma.poste.findMany({
      where: {
        status: { notIn: [StatusPoste.MANUTENCAO, StatusPoste.FALHA_OFFLINE] },
      },
      select: { codigo: true, bairro: true, status: true },
      orderBy: { codigo: 'asc' },
    });
    if (!postes.length) {
      throw new ConflictException('Nenhum poste elegível para atualização.');
    }

    const agora = Date.now();
    const linhaDeBase = mediana(
      postes
        .map((p) => this.amostras.get(p.codigo)?.normalizado)
        .filter((n): n is number => typeof n === 'number'),
    );

    this.implantacao = {
      versao,
      versaoAnterior,
      status: 'EM_ANDAMENTO',
      iniciadaEm: new Date(agora),
      encerradaEm: null,
      ondas: this.ondasPadrao,
      ondaAtual: -1,
      ondaIniciadaMs: agora,
      proximaAvaliacaoMs: agora,
      extensoes: 0,
      elegiveis: postes.map(({ codigo, bairro }) => ({ codigo, bairro })),
      linhaDeBase,
      pendentes: new Map(),
      instalados: new Map(),
      falhas: new Map(),
      controle: [],
      revertidos: 0,
      metricas: null,
      decisoes: [],
    };
    // Na primeira onda, o canário sai só dos postes saudáveis (NORMAL).
    const saudaveis = new Set(
      postes
        .filter((p) => p.status === StatusPoste.NORMAL)
        .map((p) => p.codigo),
    );
    this.proximaOnda(agora, saudaveis);
    this.logger.log(
      `OTA ${versaoAnterior} → ${versao} iniciada · ondas ${this.ondasPadrao.join('% → ')}% · ` +
        `janela ${this.janelaMs / 1000}s · ${postes.length} postes elegíveis`,
    );
    return this.estado();
  }

  reverterManual(): ReturnType<OtaService['estado']> {
    const imp = this.implantacao;
    if (!imp || imp.status !== 'EM_ANDAMENTO') {
      throw new ConflictException('Não há implantação em andamento.');
    }
    this.registrar(imp, {
      decisao: 'REVERTER',
      motivo: 'reversão manual pela equipe',
      razaoConsumo: null,
    });
    this.reverter(imp);
    return this.estado();
  }

  /** Estado para `GET /ota`. */
  estado() {
    const versoes: Record<string, number> = {};
    for (const a of this.amostras.values()) {
      const v = a.versao ?? 'desconhecida';
      versoes[v] = (versoes[v] ?? 0) + 1;
    }
    const imp = this.implantacao;
    return {
      modo: this.ingestao.modo,
      catalogo: CATALOGO_FIRMWARE.map(({ versao, descricao }) => ({
        versao,
        descricao,
      })),
      versoesEmCampo: versoes,
      criterios: {
        ondas: this.ondasPadrao,
        janelaS: this.janelaMs / 1000,
        limiarFalhaInstalacaoPct: this.criterios.limiarFalhaInstalacaoPct,
        limiarRazaoConsumo: this.criterios.limiarRazaoConsumo,
        minReportePct: this.criterios.minReportePct,
        maxExtensoes: this.criterios.maxExtensoes,
      },
      implantacao: imp
        ? {
            versao: imp.versao,
            versaoAnterior: imp.versaoAnterior,
            status: imp.status,
            iniciadaEm: imp.iniciadaEm,
            encerradaEm: imp.encerradaEm,
            ondas: imp.ondas,
            ondaAtual: imp.ondaAtual,
            ondaAtualPct: imp.ondas[imp.ondaAtual] ?? null,
            proximaAvaliacaoEm:
              imp.status === 'EM_ANDAMENTO'
                ? new Date(imp.proximaAvaliacaoMs)
                : null,
            aparelhos: {
              elegiveis: imp.elegiveis.length,
              enviados:
                imp.pendentes.size + imp.instalados.size + imp.falhas.size,
              instalados: imp.instalados.size,
              falhas: imp.falhas.size,
              pendentes: imp.pendentes.size,
              revertidos: imp.revertidos,
            },
            grupos: {
              canario: [...imp.instalados.keys()],
              controle: imp.controle,
            },
            metricas: imp.metricas,
            falhas: [...imp.falhas.entries()]
              .slice(0, 20)
              .map(([codigo, motivo]) => ({ codigo, motivo })),
            decisoes: imp.decisoes,
          }
        : null,
    };
  }

  // --- Ciclo das ondas -----------------------------------------------------

  private async verificar(): Promise<void> {
    const imp = this.implantacao;
    if (!imp || imp.status !== 'EM_ANDAMENTO') return;
    const agora = Date.now();

    // Aparelho que não respondeu a tempo conta como falha de instalação.
    for (const [codigo, enviadoMs] of imp.pendentes) {
      if (agora - enviadoMs > this.timeoutInstalacaoMs) {
        imp.pendentes.delete(codigo);
        imp.falhas.set(codigo, 'sem resposta do aparelho');
      }
    }
    if (agora >= imp.proximaAvaliacaoMs) await this.avaliar(agora);
  }

  private async avaliar(agora: number): Promise<void> {
    const imp = this.implantacao;
    if (!imp || imp.status !== 'EM_ANDAMENTO') return;

    const canario = metricasGrupo(
      imp.instalados.keys(),
      this.amostras,
      (codigo) => imp.instalados.get(codigo) ?? Infinity,
    );
    const controle = imp.controle.length
      ? metricasGrupo(imp.controle, this.amostras, () => imp.ondaIniciadaMs)
      : null;
    const referenciaConsumo =
      controle?.consumoNormalizadoMedio ?? imp.linhaDeBase;

    const resultado = decidir(
      {
        tentativas: imp.instalados.size + imp.falhas.size,
        falhas: imp.falhas.size,
        canario,
        referenciaConsumo,
        extensoes: imp.extensoes,
        ultimaOnda: imp.ondaAtual === imp.ondas.length - 1,
      },
      this.criterios,
    );
    imp.metricas = {
      canario,
      controle,
      referenciaConsumo,
      razaoConsumo: resultado.razaoConsumo,
    };
    this.registrar(imp, resultado);

    switch (resultado.decisao) {
      case 'AVANCAR':
        this.proximaOnda(agora);
        break;
      case 'ESTENDER':
        imp.extensoes++;
        imp.proximaAvaliacaoMs = agora + this.janelaMs / 2;
        break;
      case 'CONCLUIR':
        imp.status = 'CONCLUIDA';
        imp.encerradaEm = new Date(agora);
        this.logger.log(`OTA ${imp.versao} concluída em toda a frota.`);
        break;
      case 'REVERTER':
        this.reverter(imp);
        break;
    }
  }

  /** Envia a versão a mais aparelhos até o alvo da próxima onda. */
  private proximaOnda(agora: number, apenas?: Set<string>): void {
    const imp = this.implantacao!;
    imp.ondaAtual++;
    imp.extensoes = 0;
    imp.ondaIniciadaMs = agora;
    imp.proximaAvaliacaoMs = agora + this.janelaMs;

    const jaEnviados = new Set([
      ...imp.pendentes.keys(),
      ...imp.instalados.keys(),
      ...imp.falhas.keys(),
    ]);
    const restantes = imp.elegiveis.filter((p) => !jaEnviados.has(p.codigo));
    const preferidos = apenas
      ? restantes.filter((p) => apenas.has(p.codigo))
      : restantes;
    const alvo = alvoDaOnda(imp.ondas[imp.ondaAtual], imp.elegiveis.length);
    const novos = selecionarRepresentativo(
      preferidos,
      Math.max(0, alvo - jaEnviados.size),
    );

    // Controle: aparelhos parecidos que seguem na versão antiga nesta onda.
    const novosSet = new Set(novos.map((p) => p.codigo));
    const foraDaOnda = preferidos.filter((p) => !novosSet.has(p.codigo));
    imp.controle = selecionarRepresentativo(
      foraDaOnda,
      Math.min(foraDaOnda.length, Math.max(novos.length, imp.instalados.size)),
    ).map((p) => p.codigo);

    for (const p of novos) this.enviarOta(p, imp.versao, agora);
    this.logger.log(
      `OTA onda ${imp.ondas[imp.ondaAtual]}%: +${novos.length} aparelhos ` +
        `(${jaEnviados.size + novos.length}/${imp.elegiveis.length}) · controle ${imp.controle.length}`,
    );
  }

  /** Reverte a frota: reenvia a versão anterior a quem instalou a nova. */
  private reverter(imp: Implantacao): void {
    imp.status = 'REVERTIDA';
    imp.encerradaEm = new Date();
    imp.pendentes.clear();
    const porCodigo = new Map(imp.elegiveis.map((p) => [p.codigo, p]));
    for (const codigo of imp.instalados.keys()) {
      const poste = porCodigo.get(codigo);
      if (poste) this.enviarOta(poste, imp.versaoAnterior, Date.now());
    }
    this.logger.warn(
      `OTA ${imp.versao} REVERTIDA — ${imp.versaoAnterior} reenviada a ${imp.instalados.size} aparelhos.`,
    );
  }

  private enviarOta(poste: PosteElegivel, versao: string, agora: number): void {
    const imp = this.implantacao!;
    if (versao === imp.versao) imp.pendentes.set(poste.codigo, agora);
    const msg: MsgOtaNuvem = {
      codigo: poste.codigo,
      versao,
      em: new Date(agora).toISOString(),
    };
    this.ingestao.publicar(topicoNuvem(poste.bairro, 'ota'), msg);
  }

  private registrar(
    imp: Implantacao,
    r: { decisao: DecisaoOta; motivo: string; razaoConsumo: number | null },
  ): void {
    imp.decisoes.push({
      em: new Date(),
      ondaPct: imp.ondas[imp.ondaAtual] ?? 0,
      ...r,
    });
    this.logger.log(
      `OTA portão (onda ${imp.ondas[imp.ondaAtual]}%): ${r.decisao} — ${r.motivo}`,
    );
  }

  private versaoPredominante(): string {
    const contagem = new Map<string, number>();
    for (const a of this.amostras.values()) {
      if (a.versao) contagem.set(a.versao, (contagem.get(a.versao) ?? 0) + 1);
    }
    let melhor = VERSAO_FIRMWARE_PADRAO;
    let max = 0;
    for (const [v, n] of contagem) {
      if (n > max) [melhor, max] = [v, n];
    }
    return melhor;
  }
}
