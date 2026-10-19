import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, StatusPoste } from '@prisma/client';
import { TARIFA_B4A_KWH } from '../common/constants';
import { arredondar } from '../common/numeros';
import {
  inicioDoDiaUtc,
  Intervalo,
  janelaKpi,
  PeriodoKpi,
} from '../common/periodo';
import { PrismaService } from '../prisma/prisma.service';
import { diasFechadosRecentes, diasSemAgregado } from './recuperacao';

const MS_DIA = 24 * 60 * 60_000;

/** Variação percentual de `atual` frente a `anterior` (null se não há base). */
function variacaoPct(atual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return arredondar(((atual - anterior) / anterior) * 100, 1);
}

interface BucketRaw {
  bucket: Date;
  kwh: number;
}

@Injectable()
export class AgregadosService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgregadosService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- KPIs -------------------------------------------------------------

  /** GET /kpis — consumo/custo do período e variação frente ao anterior. */
  async resumo(periodo: PeriodoKpi) {
    const { atual, anterior, granularidade } = janelaKpi(periodo);
    const hoje: Intervalo = { inicio: atual.fim, fim: new Date() };

    const [redeAtual, redeAnterior, redeHoje, serieAtual, serieAnterior] =
      await Promise.all([
        this.consumoRede(atual),
        this.consumoRede(anterior),
        this.consumoRede(hoje),
        this.serieConsumo(atual, granularidade),
        this.serieConsumo(anterior, granularidade),
      ]);

    return {
      periodo,
      geradoEm: new Date(),
      tarifa: {
        classe: 'B4a',
        descricao: 'Iluminação pública',
        valorKwh: TARIFA_B4A_KWH,
      },
      atual: { ...atual, ...redeAtual },
      anterior: { ...anterior, ...redeAnterior },
      variacao: {
        consumoPct: variacaoPct(redeAtual.consumoKwh, redeAnterior.consumoKwh),
        custoPct: variacaoPct(redeAtual.custoReais, redeAnterior.custoReais),
      },
      parcialHoje: { ...hoje, ...redeHoje },
      serie: { granularidade, atual: serieAtual, anterior: serieAnterior },
    };
  }

  /** GET /kpis/maior-consumo — ranking dos postes de maior consumo no período. */
  async maiorConsumo(periodo: PeriodoKpi, limite: number) {
    const { atual } = janelaKpi(periodo);
    const porPoste = await this.consumoPorPoste(atual);

    const top = [...porPoste.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limite);

    const postes = await this.prisma.poste.findMany({
      where: { id: { in: top.map(([id]) => id) } },
      select: { id: true, codigo: true, endereco: true, bairro: true },
    });
    const porId = new Map(postes.map((p) => [p.id, p]));

    return {
      periodo,
      inicio: atual.inicio,
      fim: atual.fim,
      ranking: top.map(([id, kwh], i) => {
        const poste = porId.get(id);
        return {
          posicao: i + 1,
          posteId: id,
          codigo: poste?.codigo ?? null,
          endereco: poste?.endereco ?? null,
          bairro: poste?.bairro ?? null,
          consumoKwh: arredondar(kwh, 2),
          custoReais: arredondar(kwh * TARIFA_B4A_KWH, 2),
        };
      }),
    };
  }

  /** GET /kpis/postes-por-status — contagem absoluta por categoria. */
  async postesPorStatus() {
    const rows = await this.prisma.poste.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const contagem = new Map(rows.map((r) => [r.status, r._count._all]));

    const porStatus = Object.values(StatusPoste).map((status) => ({
      status,
      quantidade: contagem.get(status) ?? 0,
    }));

    return {
      total: porStatus.reduce((s, p) => s + p.quantidade, 0),
      porStatus,
    };
  }

  // --- Primitivas de consumo ------------------------------------------

  /** Consumo (kWh) e custo (R$) da rede inteira no intervalo. */
  private async consumoRede(intervalo: Intervalo) {
    const porPoste = await this.consumoPorPoste(intervalo);
    let consumoKwh = 0;
    for (const kwh of porPoste.values()) consumoKwh += kwh;
    consumoKwh = arredondar(consumoKwh, 3);
    return {
      consumoKwh,
      custoReais: arredondar(consumoKwh * TARIFA_B4A_KWH, 2),
    };
  }

  /**
   * kWh por poste no intervalo: dias já consolidados vêm de `AgregadoConsumo`,
   * o pedaço do dia corrente é calculado da telemetria bruta.
   */
  private async consumoPorPoste({
    inicio,
    fim,
  }: Intervalo): Promise<Map<string, number>> {
    const corte = inicioDoDiaUtc();
    const mapa = new Map<string, number>();

    const fimConsolidado = fim < corte ? fim : corte;
    if (inicio < fimConsolidado) {
      const rows = await this.prisma.agregadoConsumo.groupBy({
        by: ['posteId'],
        where: {
          posteId: { not: null },
          periodo: 'DIA',
          periodoInicio: { gte: inicio, lt: fimConsolidado },
        },
        _sum: { consumoTotalKwh: true },
      });
      for (const r of rows) {
        if (r.posteId) mapa.set(r.posteId, r._sum.consumoTotalKwh ?? 0);
      }
    }

    if (fim > corte) {
      const desde = inicio > corte ? inicio : corte;
      for (const [id, kwh] of await this.consumoRawPorPoste(desde, fim)) {
        mapa.set(id, (mapa.get(id) ?? 0) + kwh);
      }
    }

    return mapa;
  }

  /** kWh por poste direto da telemetria: média de potência × horas da janela. */
  private async consumoRawPorPoste(
    inicio: Date,
    fim: Date,
  ): Promise<Map<string, number>> {
    const horas = (fim.getTime() - inicio.getTime()) / 3_600_000;
    if (horas <= 0) return new Map();

    const rows = await this.prisma.$queryRaw<
      { posteId: string; media_kw: number }[]
    >`
      SELECT "posteId", avg("consumoKw")::float8 AS media_kw
      FROM leituras_telemetria
      WHERE "timestamp" >= ${inicio} AND "timestamp" < ${fim}
      GROUP BY "posteId"
    `;
    return new Map(rows.map((r) => [r.posteId, r.media_kw * horas]));
  }

  /** Série de consumo da rede para o gráfico comparativo do dashboard. */
  private async serieConsumo(
    { inicio, fim }: Intervalo,
    granularidade: 'hora' | 'dia' | 'mes',
  ): Promise<Array<{ inicio: Date; consumoKwh: number }>> {
    if (granularidade === 'hora') {
      const linhas = await this.prisma.$queryRaw<BucketRaw[]>`
        SELECT bucket, sum(media_kw)::float8 AS kwh FROM (
          SELECT date_trunc('hour', "timestamp") AS bucket,
                 "posteId", avg("consumoKw") AS media_kw
          FROM leituras_telemetria
          WHERE "timestamp" >= ${inicio} AND "timestamp" < ${fim}
          GROUP BY 1, 2
        ) t
        GROUP BY bucket ORDER BY bucket
      `;
      return linhas.map((l) => ({
        inicio: l.bucket,
        consumoKwh: arredondar(l.kwh, 3),
      }));
    }

    // Janelas de KPI nunca alcançam o dia corrente, então basta o consolidado.
    const unidade = granularidade === 'mes' ? 'month' : 'day';
    const linhas = await this.prisma.$queryRaw<BucketRaw[]>`
      SELECT date_trunc(${unidade}::text, "periodoInicio") AS bucket,
             sum("consumoTotalKwh")::float8 AS kwh
      FROM agregados_consumo
      WHERE "posteId" IS NULL AND "periodo" = 'DIA'
        AND "periodoInicio" >= ${inicio} AND "periodoInicio" < ${fim}
      GROUP BY 1 ORDER BY 1
    `;

    return linhas.map((l) => ({
      inicio: l.bucket,
      consumoKwh: arredondar(l.kwh, 3),
    }));
  }

  // --- Consolidação diária (rollup) ---------------------------------

  /**
   * Recalcula os últimos dias fechados a partir da telemetria, para que os
   * dados que o simulador vai gerando entrem nos KPIs.
   */
  @Cron('15 0 * * *')
  async consolidarDiariamente(): Promise<void> {
    const ontem = new Date(Date.now() - MS_DIA);
    const anteontem = new Date(Date.now() - 2 * MS_DIA);
    const total =
      (await this.rollupDia(anteontem)) + (await this.rollupDia(ontem));
    if (total)
      this.logger.log(`Consolidação diária: ${total} agregados gravados.`);
  }

  /**
   * Ao subir, consolida os dias fechados que ficaram sem agregado — o cron das
   * 00:15 não roda com a API desligada (ex.: o computador desligado de
   * madrugada), e sem o agregado o KPI do dia aparece zerado. Roda em segundo
   * plano para não atrasar a inicialização.
   */
  onApplicationBootstrap(): void {
    void this.recuperarDiasFaltantes().catch((erro: Error) =>
      this.logger.error(`Falha ao recuperar agregados: ${erro.message}`),
    );
  }

  /** Consolida os últimos dias fechados que estão sem agregado da rede. */
  async recuperarDiasFaltantes(agora = new Date()): Promise<Date[]> {
    const dias = diasFechadosRecentes(agora);
    const existentes = await this.prisma.agregadoConsumo.findMany({
      where: {
        posteId: null,
        periodo: 'DIA',
        periodoInicio: { in: dias },
      },
      select: { periodoInicio: true },
    });
    const faltantes = diasSemAgregado(
      dias,
      new Set(existentes.map((e) => e.periodoInicio.getTime())),
    );

    const recuperados: Date[] = [];
    for (const dia of faltantes) {
      // Dia sem leitura nenhuma (ex.: antes do histórico) não gera agregado.
      if (await this.rollupDia(dia)) recuperados.push(dia);
    }
    if (recuperados.length) {
      this.logger.log(
        `Agregados recuperados na inicialização: ${recuperados
          .map((d) => d.toISOString().slice(0, 10))
          .join(', ')}`,
      );
    }
    return recuperados;
  }

  /** Consolida um dia (UTC) em AgregadoConsumo. Idempotente. */
  async rollupDia(dia: Date): Promise<number> {
    const inicio = inicioDoDiaUtc(dia);
    const fim = new Date(inicio.getTime() + MS_DIA);

    const porPoste = await this.consumoRawPorPoste(inicio, fim);
    if (!porPoste.size) return 0;

    const linhas: Prisma.AgregadoConsumoCreateManyInput[] = [];
    let redeKwh = 0;
    for (const [posteId, kwh] of porPoste) {
      redeKwh += kwh;
      linhas.push({
        posteId,
        periodo: 'DIA',
        periodoInicio: inicio,
        periodoFim: fim,
        consumoTotalKwh: arredondar(kwh, 4),
        custoTotalReais: arredondar(kwh * TARIFA_B4A_KWH, 4),
      });
    }
    linhas.push({
      posteId: null,
      periodo: 'DIA',
      periodoInicio: inicio,
      periodoFim: fim,
      consumoTotalKwh: arredondar(redeKwh, 4),
      custoTotalReais: arredondar(redeKwh * TARIFA_B4A_KWH, 4),
    });

    await this.prisma.$transaction([
      this.prisma.agregadoConsumo.deleteMany({
        where: { periodo: 'DIA', periodoInicio: inicio },
      }),
      this.prisma.agregadoConsumo.createMany({ data: linhas }),
    ]);
    return linhas.length;
  }
}
