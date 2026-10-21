import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { INQUILINO } from '../common/contrato';
import { janelaPagina, lerOrdenacao, montarPagina } from '../common/paginacao';
import { PrismaService } from '../prisma/prisma.service';
import { limiteOfflineS } from './conexao';
import {
  CriarDominioDto,
  CriarLocalDto,
  CriarPerfilDto,
  ListarCatalogoQuery,
  ORDENACAO_CATALOGO,
} from './dto/catalogo.dto';
import { erroGeometria } from './geojson';

export interface InquilinoAtual {
  id: string;
  slug: string;
  nome: string;
}

/** `{ id }` se a referência é um uuid; senão, o slug/código. */
export const porRef = (ref: string): { id: string } | { slug: string } =>
  isUUID(ref) ? { id: ref } : { slug: ref };

/** Converte violação de chave única do Prisma em 409. */
export function conflito(e: unknown, mensagem: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new ConflictException(mensagem);
  }
  throw e;
}

function validarGeometria(g: Record<string, unknown> | undefined) {
  if (!g) return undefined;
  const erro = erroGeometria(g);
  if (erro) throw new BadRequestException(erro);
  return g as Prisma.InputJsonValue;
}

const contagem = { _count: { select: { dispositivos: true } } } as const;

/**
 * Catálogo do inquilino (RF-CEN-01 a 03): domínios, perfis de dispositivo e a
 * hierarquia de locais (sites) e áreas, com geometria GeoJSON. Tudo é dado:
 * criar um domínio novo não exige mudar código.
 */
@Injectable()
export class CatalogoService {
  private inquilino: InquilinoAtual | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inquilino das requisições. Por enquanto há um só, a Prefeitura de
   * Itaguari; com o login (branch de segurança) ele passa a vir do token.
   */
  async inquilinoAtual(): Promise<InquilinoAtual> {
    if (this.inquilino) return this.inquilino;
    const i = await this.prisma.inquilino.findUnique({
      where: { slug: INQUILINO },
      select: { id: true, slug: true, nome: true },
    });
    if (!i) {
      throw new ServiceUnavailableException(
        'Catálogo ainda não inicializado (o entrypoint roda prisma/catalogo.ts).',
      );
    }
    return (this.inquilino = i);
  }

  private async filtro(query: ListarCatalogoQuery) {
    const { id: inquilinoId } = await this.inquilinoAtual();
    const where = { inquilinoId } as {
      inquilinoId: string;
      OR?: object[];
    };
    if (query.busca) {
      where.OR = [
        { slug: { contains: query.busca, mode: 'insensitive' } },
        { nome: { contains: query.busca, mode: 'insensitive' } },
      ];
    }
    const { campo, direcao } = lerOrdenacao(
      query.ordenar,
      ORDENACAO_CATALOGO,
      'slug',
    );
    return {
      where,
      orderBy: { [campo]: direcao },
      ...janelaPagina(query),
    };
  }

  // --- Domínios -------------------------------------------------------------

  async listarDominios(query: ListarCatalogoQuery) {
    const args = await this.filtro(query);
    const [total, itens] = await this.prisma.$transaction([
      this.prisma.dominio.count({ where: args.where }),
      this.prisma.dominio.findMany({ ...args, include: contagem }),
    ]);
    return montarPagina(itens.map(respostaDominio), total, query);
  }

  async buscarDominio(ref: string) {
    const { id: inquilinoId } = await this.inquilinoAtual();
    const d = await this.prisma.dominio.findFirst({
      where: { inquilinoId, ...porRef(ref) },
      include: contagem,
    });
    if (!d) throw new NotFoundException(`Domínio "${ref}" não encontrado.`);
    return respostaDominio(d);
  }

  async criarDominio(dto: CriarDominioDto) {
    const { id: inquilinoId } = await this.inquilinoAtual();
    const d = await this.prisma.dominio
      .create({ data: { ...dto, inquilinoId }, include: contagem })
      .catch((e) => conflito(e, `Já existe o domínio "${dto.slug}".`));
    return respostaDominio(d);
  }

  // --- Perfis de dispositivo ------------------------------------------------

  async listarPerfis(query: ListarCatalogoQuery) {
    const args = await this.filtro(query);
    const [total, itens] = await this.prisma.$transaction([
      this.prisma.perfilDispositivo.count({ where: args.where }),
      this.prisma.perfilDispositivo.findMany({ ...args, include: contagem }),
    ]);
    return montarPagina(itens.map(respostaPerfil), total, query);
  }

  async buscarPerfil(ref: string) {
    const { id: inquilinoId } = await this.inquilinoAtual();
    const p = await this.prisma.perfilDispositivo.findFirst({
      where: { inquilinoId, ...porRef(ref) },
      include: contagem,
    });
    if (!p) throw new NotFoundException(`Perfil "${ref}" não encontrado.`);
    return respostaPerfil(p);
  }

  async criarPerfil(dto: CriarPerfilDto) {
    const nomes = new Set<string>();
    for (const g of dto.grandezas) {
      if (nomes.has(g.grandeza)) {
        throw new BadRequestException(`Grandeza "${g.grandeza}" repetida.`);
      }
      nomes.add(g.grandeza);
      if (
        g.minimo !== undefined &&
        g.maximo !== undefined &&
        g.minimo > g.maximo
      ) {
        throw new BadRequestException(
          `Grandeza "${g.grandeza}": mínimo maior que o máximo.`,
        );
      }
    }
    const { id: inquilinoId } = await this.inquilinoAtual();
    const p = await this.prisma.perfilDispositivo
      .create({
        data: {
          ...dto,
          grandezas: dto.grandezas.map((g) => ({ ...g })),
          inquilinoId,
        },
        include: contagem,
      })
      .catch((e) => conflito(e, `Já existe o perfil "${dto.slug}".`));
    return respostaPerfil(p);
  }

  // --- Locais (sites) e áreas -----------------------------------------------

  async listarSites(query: ListarCatalogoQuery) {
    const args = await this.filtro(query);
    const [total, itens] = await this.prisma.$transaction([
      this.prisma.site.count({ where: args.where }),
      this.prisma.site.findMany({
        ...args,
        include: { _count: { select: { dispositivos: true, areas: true } } },
      }),
    ]);
    return montarPagina(itens.map(respostaSite), total, query);
  }

  /** Site do inquilino pela referência (404 se não existir). */
  async site(ref: string) {
    const { id: inquilinoId } = await this.inquilinoAtual();
    const s = await this.prisma.site.findFirst({
      where: { inquilinoId, ...porRef(ref) },
      include: { _count: { select: { dispositivos: true, areas: true } } },
    });
    if (!s) throw new NotFoundException(`Local "${ref}" não encontrado.`);
    return s;
  }

  async buscarSite(ref: string) {
    return respostaSite(await this.site(ref));
  }

  async criarSite(dto: CriarLocalDto) {
    const { id: inquilinoId } = await this.inquilinoAtual();
    const s = await this.prisma.site
      .create({
        data: {
          ...dto,
          geometria: validarGeometria(dto.geometria),
          inquilinoId,
        },
        include: { _count: { select: { dispositivos: true, areas: true } } },
      })
      .catch((e) => conflito(e, `Já existe o local "${dto.slug}".`));
    return respostaSite(s);
  }

  async listarAreas(siteRef: string, query: ListarCatalogoQuery) {
    const site = await this.site(siteRef);
    const { where, ...resto } = await this.filtro(query);
    const whereArea = { siteId: site.id, OR: where.OR };
    const [total, itens] = await this.prisma.$transaction([
      this.prisma.area.count({ where: whereArea }),
      this.prisma.area.findMany({
        ...resto,
        where: whereArea,
        include: contagem,
      }),
    ]);
    return montarPagina(
      itens.map((a) => respostaArea(a, site)),
      total,
      query,
    );
  }

  async criarArea(siteRef: string, dto: CriarLocalDto) {
    const site = await this.site(siteRef);
    const a = await this.prisma.area
      .create({
        data: {
          ...dto,
          tipo: dto.tipo ?? 'area',
          geometria: validarGeometria(dto.geometria),
          siteId: site.id,
        },
        include: contagem,
      })
      .catch((e) =>
        conflito(e, `Já existe a área "${dto.slug}" em ${site.nome}.`),
      );
    return respostaArea(a, site);
  }
}

type ComContagem = { _count: { dispositivos: number } };

function respostaDominio(d: Prisma.DominioGetPayload<object> & ComContagem) {
  const { _count, inquilinoId: _i, ...resto } = d;
  return { ...resto, dispositivos: _count.dispositivos };
}

function respostaPerfil(
  p: Prisma.PerfilDispositivoGetPayload<object> & ComContagem,
) {
  const { _count, inquilinoId: _i, ...resto } = p;
  return {
    ...resto,
    limiteOfflineS: limiteOfflineS(p.intervaloEnvioS),
    dispositivos: _count.dispositivos,
  };
}

function respostaSite(
  s: Prisma.SiteGetPayload<object> & {
    _count: { dispositivos: number; areas: number };
  },
) {
  const { _count, inquilinoId: _i, ...resto } = s;
  return { ...resto, areas: _count.areas, dispositivos: _count.dispositivos };
}

function respostaArea(
  a: Prisma.AreaGetPayload<object> & ComContagem,
  site: { id: string; slug: string; nome: string },
) {
  const { _count, siteId: _s, ...resto } = a;
  return {
    ...resto,
    site: { id: site.id, slug: site.slug, nome: site.nome },
    dispositivos: _count.dispositivos,
  };
}
