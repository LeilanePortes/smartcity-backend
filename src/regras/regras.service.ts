import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Regra, StatusAlarme } from '@prisma/client';
import { CatalogoService, porRef } from '../catalogo/catalogo.service';
import { janelaPagina, lerOrdenacao, montarPagina } from '../common/paginacao';
import { PrismaService } from '../prisma/prisma.service';
import { erroAcoes } from './acoes';
import { erroCondicao } from './condicoes';
import {
  AtualizarRegraDto,
  CriarRegraDto,
  ListarRegrasQuery,
  ORDENACAO_REGRAS,
} from './dto/regras.dto';
import { MotorRegrasService } from './motor-regras.service';

type Escopo = Pick<
  Regra,
  'dominioId' | 'siteId' | 'areaId' | 'perfilId' | 'dispositivoId'
>;

/** Cadastro de regras condição → ação (RF-PRO-02), pela API. */
@Injectable()
export class RegrasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogo: CatalogoService,
    private readonly motor: MotorRegrasService,
  ) {}

  async listar(query: ListarRegrasQuery) {
    const { id: inquilinoId } = await this.catalogo.inquilinoAtual();
    const where: Prisma.RegraWhereInput = { inquilinoId };
    if (query.ativa !== undefined) where.ativa = query.ativa;
    const { campo, direcao } = lerOrdenacao(
      query.ordenar,
      ORDENACAO_REGRAS,
      'nome',
    );
    const [total, itens] = await this.prisma.$transaction([
      this.prisma.regra.count({ where }),
      this.prisma.regra.findMany({
        where,
        orderBy: { [campo]: direcao },
        ...janelaPagina(query),
      }),
    ]);
    return montarPagina(await this.respostas(itens), total, query);
  }

  async buscar(id: string) {
    return (await this.respostas([await this.carregar(id)]))[0];
  }

  async criar(dto: CriarRegraDto) {
    validar(dto);
    const { id: inquilinoId } = await this.catalogo.inquilinoAtual();
    const escopo = await this.escopo(dto, inquilinoId);
    const r = await this.prisma.regra.create({
      data: {
        inquilinoId,
        nome: dto.nome,
        descricao: dto.descricao,
        ativa: dto.ativa ?? true,
        severidade: dto.severidade,
        condicao: dto.condicao as Prisma.InputJsonValue,
        acoes: dto.acoes as Prisma.InputJsonValue,
        ...escopo,
      },
    });
    await this.motor.recarregar();
    return this.buscar(r.id);
  }

  async atualizar(id: string, dto: AtualizarRegraDto) {
    const atual = await this.carregar(id);
    validar(dto);
    const escopo = await this.escopo(dto, atual.inquilinoId);
    await this.prisma.regra.update({
      where: { id },
      data: {
        nome: dto.nome,
        descricao: dto.descricao,
        ativa: dto.ativa,
        severidade: dto.severidade,
        ...(dto.condicao
          ? { condicao: dto.condicao as Prisma.InputJsonValue }
          : {}),
        ...(dto.acoes ? { acoes: dto.acoes as Prisma.InputJsonValue } : {}),
        ...escopo,
      },
    });
    await this.motor.recarregar(id);
    return this.buscar(id);
  }

  async remover(id: string) {
    await this.carregar(id);
    await this.prisma.regra.delete({ where: { id } });
    await this.motor.recarregar(id);
    return { removida: id };
  }

  async execucoes(id: string, query: ListarRegrasQuery) {
    await this.carregar(id);
    const where = { regraId: id };
    const [total, itens] = await this.prisma.$transaction([
      this.prisma.execucaoAcao.count({ where }),
      this.prisma.execucaoAcao.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        ...janelaPagina(query),
      }),
    ]);
    return montarPagina(itens, total, query);
  }

  private async carregar(id: string): Promise<Regra> {
    const { id: inquilinoId } = await this.catalogo.inquilinoAtual();
    const r = await this.prisma.regra.findFirst({ where: { id, inquilinoId } });
    if (!r) throw new NotFoundException(`Regra ${id} não encontrada.`);
    return r;
  }

  /** Converte as referências do escopo (id ou slug) em ids; null remove o filtro. */
  private async escopo(
    dto: AtualizarRegraDto,
    inquilinoId: string,
  ): Promise<Partial<Escopo>> {
    const um = async (
      ref: string | null | undefined,
      nome: string,
      buscar: (
        r: { id: string } | { slug: string },
      ) => Promise<{ id: string }[]>,
    ): Promise<string | null | undefined> => {
      if (ref === undefined || ref === null) return ref;
      const achados = await buscar(porRef(ref));
      if (!achados.length)
        throw new BadRequestException(`${nome} "${ref}" não encontrado.`);
      if (achados.length > 1) {
        throw new BadRequestException(
          `${nome} "${ref}" existe em mais de um local: informe o site.`,
        );
      }
      return achados[0].id;
    };
    const sel = { select: { id: true } } as const;
    const siteId = await um(dto.site, 'Local', (r) =>
      this.prisma.site.findMany({ where: { inquilinoId, ...r }, ...sel }),
    );
    return {
      siteId,
      dominioId: await um(dto.dominio, 'Domínio', (r) =>
        this.prisma.dominio.findMany({ where: { inquilinoId, ...r }, ...sel }),
      ),
      perfilId: await um(dto.perfil, 'Perfil', (r) =>
        this.prisma.perfilDispositivo.findMany({
          where: { inquilinoId, ...r },
          ...sel,
        }),
      ),
      areaId: await um(dto.area, 'Área', (r) =>
        this.prisma.area.findMany({
          where: {
            site: { inquilinoId, ...(siteId ? { id: siteId } : {}) },
            ...r,
          },
          ...sel,
        }),
      ),
      dispositivoId: await um(dto.dispositivo, 'Dispositivo', (r) =>
        this.prisma.dispositivo.findMany({
          where: { inquilinoId, ...('id' in r ? r : { codigo: r.slug }) },
          ...sel,
        }),
      ),
    };
  }

  /** Regra com o escopo por extenso e quantos alarmes ela tem abertos. */
  private async respostas(regras: Regra[]) {
    const ids = (k: keyof Escopo) => [
      ...new Set(regras.map((r) => r[k]).filter((x): x is string => !!x)),
    ];
    const sel = { id: true, slug: true, nome: true } as const;
    const [dominios, sites, areas, perfis, dispositivos, abertos] =
      await Promise.all([
        this.prisma.dominio.findMany({
          where: { id: { in: ids('dominioId') } },
          select: sel,
        }),
        this.prisma.site.findMany({
          where: { id: { in: ids('siteId') } },
          select: sel,
        }),
        this.prisma.area.findMany({
          where: { id: { in: ids('areaId') } },
          select: sel,
        }),
        this.prisma.perfilDispositivo.findMany({
          where: { id: { in: ids('perfilId') } },
          select: sel,
        }),
        this.prisma.dispositivo.findMany({
          where: { id: { in: ids('dispositivoId') } },
          select: { id: true, codigo: true, nome: true },
        }),
        this.prisma.alarme.groupBy({
          by: ['regraId'],
          where: {
            regraId: { in: regras.map((r) => r.id) },
            status: { in: [StatusAlarme.ATIVO, StatusAlarme.RECONHECIDO] },
          },
          _count: true,
        }),
      ]);
    const mapa = <T extends { id: string }>(l: T[]) =>
      new Map(l.map((x) => [x.id, x]));
    const [md, ms, ma, mp, mdi] = [
      mapa(dominios),
      mapa(sites),
      mapa(areas),
      mapa(perfis),
      mapa(dispositivos),
    ];
    const ab = new Map(abertos.map((a) => [a.regraId, a._count]));
    return regras.map((r) => ({
      id: r.id,
      nome: r.nome,
      descricao: r.descricao,
      ativa: r.ativa,
      escopo: {
        dominio: (r.dominioId && md.get(r.dominioId)) || null,
        site: (r.siteId && ms.get(r.siteId)) || null,
        area: (r.areaId && ma.get(r.areaId)) || null,
        perfil: (r.perfilId && mp.get(r.perfilId)) || null,
        dispositivo: (r.dispositivoId && mdi.get(r.dispositivoId)) || null,
      },
      condicao: r.condicao,
      severidade: r.severidade,
      acoes: r.acoes,
      alarmesAbertos: ab.get(r.id) ?? 0,
      criadoEm: r.criadoEm,
      atualizadoEm: r.atualizadoEm,
    }));
  }
}

function validar(dto: AtualizarRegraDto): void {
  const erro =
    (dto.condicao !== undefined ? erroCondicao(dto.condicao) : null) ??
    (dto.acoes !== undefined ? erroAcoes(dto.acoes) : null);
  if (erro) throw new BadRequestException(erro);
}
