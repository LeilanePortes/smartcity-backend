import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CatalogoService, porRef } from '../catalogo/catalogo.service';
import type { GrandezaPerfil } from '../catalogo/grandezas';
import { PrismaService } from '../prisma/prisma.service';
import type { JanelaSerieQuery, SerieQuery } from './dto/serie.query';
import { JanelaResolvida, resolverJanela } from './janela-serie';

/// Teto de pontos brutos numa resposta (acima disso, use uma agregação).
const MAX_PONTOS_BRUTOS = 10_000;

export interface Filtro {
  inquilinoId: string;
  grandeza: string;
  dispositivoIds?: string[];
  areaIds?: string[];
  siteIds?: string[];
  dominioIds?: string[];
}

export interface Balde {
  inicio: Date;
  media: number;
  minimo: number;
  maximo: number;
  amostras: number;
  suspeitas: number;
}

export interface Bruto {
  em: Date;
  valor: number;
  suspeita: boolean;
  dispositivoId: string;
}

/**
 * Séries temporais por dispositivo, grandeza, área e intervalo (RF-DAD-01) e
 * o último valor de cada grandeza (RF-DAD-02). Lê a view `serie_medicoes`, que
 * junta as medições do pipeline com o histórico dos postes.
 */
@Injectable()
export class SeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogo: CatalogoService,
  ) {}

  private janela(q: JanelaSerieQuery): JanelaResolvida {
    try {
      return resolverJanela(q, new Date());
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** GET /series — por dispositivo, área, local e/ou domínio. */
  async consultar(q: SerieQuery) {
    const janela = this.janela(q);
    const { id: inquilinoId } = await this.catalogo.inquilinoAtual();
    const filtro: Filtro = { inquilinoId, grandeza: q.grandeza };

    const ids = async (
      ref: string | undefined,
      nome: string,
      buscar: () => Promise<{ id: string }[]>,
    ) => {
      if (!ref) return undefined;
      const achados = (await buscar()).map((r) => r.id);
      if (!achados.length) {
        throw new NotFoundException(`${nome} "${ref}" não encontrado.`);
      }
      return achados;
    };
    const site = q.site ? porRef(q.site) : undefined;
    filtro.siteIds = await ids(q.site, 'Local', () =>
      this.prisma.site.findMany({
        where: { inquilinoId, ...site },
        select: { id: true },
      }),
    );
    filtro.areaIds = await ids(q.area, 'Área', () =>
      this.prisma.area.findMany({
        where: { site: { inquilinoId, ...site }, ...porRef(q.area!) },
        select: { id: true },
      }),
    );
    filtro.dominioIds = await ids(q.dominio, 'Domínio', () =>
      this.prisma.dominio.findMany({
        where: { inquilinoId, ...porRef(q.dominio!) },
        select: { id: true },
      }),
    );
    filtro.dispositivoIds = await ids(q.dispositivo, 'Dispositivo', () =>
      this.prisma.dispositivo.findMany({
        where: { inquilinoId, ...refDispositivo(q.dispositivo!) },
        select: { id: true },
      }),
    );

    return {
      grandeza: q.grandeza,
      filtros: {
        dispositivo: q.dispositivo ?? null,
        area: q.area ?? null,
        site: q.site ?? null,
        dominio: q.dominio ?? null,
      },
      ...(await this.serie(filtro, janela)),
    };
  }

  /** GET /dispositivos/:ref/telemetria — uma série por grandeza do perfil. */
  async porDispositivo(
    ref: string,
    q: JanelaSerieQuery & { grandeza?: string },
  ) {
    const janela = this.janela(q);
    const d = await this.dispositivo(ref);
    const grandezas = q.grandeza
      ? [q.grandeza]
      : (d.perfil.grandezas as unknown as GrandezaPerfil[]).map(
          (g) => g.grandeza,
        );
    const series = [];
    for (const grandeza of grandezas) {
      const s = await this.serie(
        { inquilinoId: d.inquilinoId, grandeza, dispositivoIds: [d.id] },
        janela,
      );
      series.push({ grandeza, ...s });
    }
    return {
      dispositivo: { id: d.id, codigo: d.codigo, nome: d.nome },
      inicio: janela.inicio,
      fim: janela.fim,
      intervalo: janela.intervalo,
      series,
    };
  }

  /** GET /dispositivos/:ref/ultimos-valores — sem consultar o histórico. */
  async ultimosValores(ref: string) {
    const d = await this.dispositivo(ref);
    const linhas = await this.prisma.ultimoValor.findMany({
      where: { dispositivoId: d.id },
      orderBy: { grandeza: 'asc' },
      select: {
        grandeza: true,
        valor: true,
        unidade: true,
        medidoEm: true,
        suspeita: true,
      },
    });
    const valores = new Map(linhas.map((l) => [l.grandeza, l]));
    // Luminárias: o estado atual fica no próprio poste (atualizado pelo fog).
    if (d.poste?.ultimaLeituraEm) {
      const em = d.poste.ultimaLeituraEm;
      for (const v of [
        {
          grandeza: 'potencia',
          valor: d.poste.consumoInstantaneoKw,
          unidade: 'kW',
        },
        {
          grandeza: 'luminosidade',
          valor: d.poste.luminosidadeAtual,
          unidade: '%',
        },
      ]) {
        const ja = valores.get(v.grandeza);
        if (!ja || ja.medidoEm < em) {
          valores.set(v.grandeza, { ...v, medidoEm: em, suspeita: false });
        }
      }
    }
    return {
      dispositivo: { id: d.id, codigo: d.codigo, nome: d.nome },
      valores: [...valores.values()].sort((a, b) =>
        a.grandeza.localeCompare(b.grandeza),
      ),
    };
  }

  private async dispositivo(ref: string) {
    const { id: inquilinoId } = await this.catalogo.inquilinoAtual();
    const d = await this.prisma.dispositivo.findFirst({
      where: { inquilinoId, ...refDispositivo(ref) },
      select: {
        id: true,
        codigo: true,
        nome: true,
        inquilinoId: true,
        perfil: { select: { grandezas: true } },
        poste: {
          select: {
            consumoInstantaneoKw: true,
            luminosidadeAtual: true,
            ultimaLeituraEm: true,
          },
        },
      },
    });
    if (!d) throw new NotFoundException(`Dispositivo "${ref}" não encontrado.`);
    return d;
  }

  private async serie(f: Filtro, j: JanelaResolvida) {
    const condicoes = [
      Prisma.sql`"inquilinoId" = ${f.inquilinoId}`,
      Prisma.sql`grandeza = ${f.grandeza}`,
      Prisma.sql`"medidoEm" >= ${j.inicio}`,
      Prisma.sql`"medidoEm" < ${j.fim}`,
    ];
    const em = (coluna: string, ids?: string[]) => {
      if (ids)
        condicoes.push(
          Prisma.sql`${Prisma.raw(`"${coluna}"`)} IN (${Prisma.join(ids)})`,
        );
    };
    em('dispositivoId', f.dispositivoIds);
    em('areaId', f.areaIds);
    em('siteId', f.siteIds);
    em('dominioId', f.dominioIds);
    const where = Prisma.join(condicoes, ' AND ');

    const unidades = (
      await this.prisma.$queryRaw<{ unidade: string }[]>`
        SELECT DISTINCT unidade FROM serie_medicoes WHERE ${where}`
    ).map((u) => u.unidade);

    if (!j.balde) {
      const linhas = await this.prisma.$queryRaw<Bruto[]>`
        SELECT "medidoEm" AS em, valor::float8 AS valor, suspeita, "dispositivoId"
          FROM serie_medicoes WHERE ${where}
         ORDER BY "medidoEm" LIMIT ${MAX_PONTOS_BRUTOS + 1}`;
      return {
        inicio: j.inicio,
        fim: j.fim,
        intervalo: j.intervalo,
        unidades,
        truncada: linhas.length > MAX_PONTOS_BRUTOS,
        pontos: linhas.slice(0, MAX_PONTOS_BRUTOS),
      };
    }

    const baldes = await this.prisma.$queryRaw<Balde[]>`
      SELECT date_bin(${j.balde}::interval, "medidoEm", TIMESTAMP '2000-01-01') AS inicio,
             avg(valor)::float8 AS media, min(valor)::float8 AS minimo,
             max(valor)::float8 AS maximo, count(*)::int AS amostras,
             (count(*) FILTER (WHERE suspeita))::int AS suspeitas
        FROM serie_medicoes WHERE ${where}
       GROUP BY 1 ORDER BY 1`;
    return {
      inicio: j.inicio,
      fim: j.fim,
      intervalo: j.intervalo,
      unidades,
      truncada: false,
      pontos: baldes.map((b) => ({ ...b, media: Number(b.media.toFixed(4)) })),
    };
  }
}

/** Dispositivo pelo id (uuid) ou pelo código. */
function refDispositivo(ref: string): { id: string } | { codigo: string } {
  const r = porRef(ref);
  return 'id' in r ? r : { codigo: r.slug };
}
