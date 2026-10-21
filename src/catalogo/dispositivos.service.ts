import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { janelaPagina, lerOrdenacao, montarPagina } from '../common/paginacao';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogoService, conflito, porRef } from './catalogo.service';
import { estadoConexao, inicioJanelaOnline } from './conexao';
import { gerarCredencial, prefixoDoToken, tokenConfere } from './credenciais';
import {
  AtualizarDispositivoDto,
  CriarDispositivoDto,
  ListarDispositivosQuery,
  ORDENACAO_DISPOSITIVOS,
} from './dto/dispositivo.dto';

/// Códigos que colidem com rotas de /dispositivos.
const CODIGOS_RESERVADOS = new Set(['eu']);

const RESUMO = { select: { id: true, slug: true, nome: true } } as const;

const INCLUIR = {
  inquilino: RESUMO,
  dominio: RESUMO,
  perfil: {
    select: { id: true, slug: true, nome: true, intervaloEnvioS: true },
  },
  site: RESUMO,
  area: RESUMO,
  credenciais: {
    where: { revogadaEm: null },
    orderBy: { emitidaEm: 'desc' },
    take: 1,
    select: { prefixo: true, emitidaEm: true },
  },
} satisfies Prisma.DispositivoInclude;

type DispositivoCompleto = Prisma.DispositivoGetPayload<{
  include: typeof INCLUIR;
}>;

const AVISO_TOKEN =
  'Guarde este token agora: ele não é mostrado de novo. Se perder, emita outro (o anterior é revogado).';

/**
 * Dispositivos do inquilino (RF-DIS-01, 02 e 06): cadastro com perfil,
 * domínio, local, área, fabricante e firmware; credencial única por aparelho
 * (emitida uma vez e revogável); online/offline pelo intervalo do perfil.
 */
@Injectable()
export class DispositivosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogo: CatalogoService,
  ) {}

  async listar(query: ListarDispositivosQuery) {
    const { id: inquilinoId } = await this.catalogo.inquilinoAtual();
    const agora = new Date();
    const and: Prisma.DispositivoWhereInput[] = [{ inquilinoId }];

    if (query.dominio) and.push({ dominio: porRef(query.dominio) });
    if (query.perfil) and.push({ perfil: porRef(query.perfil) });
    if (query.site) and.push({ site: porRef(query.site) });
    if (query.area) and.push({ area: porRef(query.area) });
    if (query.busca) {
      and.push({
        OR: [
          { codigo: { contains: query.busca, mode: 'insensitive' } },
          { nome: { contains: query.busca, mode: 'insensitive' } },
        ],
      });
    }
    if (query.conexao) {
      // O limite de online depende do intervalo de cada perfil.
      const perfis = await this.prisma.perfilDispositivo.findMany({
        where: { inquilinoId },
        select: { id: true, intervaloEnvioS: true },
      });
      and.push({
        OR: perfis.map((p) => {
          const desde = inicioJanelaOnline(p.intervaloEnvioS, agora);
          return query.conexao === 'online'
            ? { perfilId: p.id, ultimaMensagemEm: { gte: desde } }
            : {
                perfilId: p.id,
                OR: [
                  { ultimaMensagemEm: null },
                  { ultimaMensagemEm: { lt: desde } },
                ],
              };
        }),
      });
    }

    const where: Prisma.DispositivoWhereInput = { AND: and };
    const { campo, direcao } = lerOrdenacao(
      query.ordenar,
      ORDENACAO_DISPOSITIVOS,
      'codigo',
    );
    const [total, itens] = await this.prisma.$transaction([
      this.prisma.dispositivo.count({ where }),
      this.prisma.dispositivo.findMany({
        where,
        orderBy: [
          campo === 'ultimaMensagemEm'
            ? { ultimaMensagemEm: { sort: direcao, nulls: 'last' } }
            : { [campo]: direcao },
          { id: 'asc' },
        ],
        ...janelaPagina(query),
        include: INCLUIR,
      }),
    ]);
    return montarPagina(
      itens.map((d) => resposta(d, agora)),
      total,
      query,
    );
  }

  async buscar(ref: string) {
    return resposta(await this.carregar(ref), new Date());
  }

  /** Cadastra o dispositivo e devolve a credencial (a única vez em que ela aparece). */
  async criar(dto: CriarDispositivoDto) {
    if (CODIGOS_RESERVADOS.has(dto.codigo)) {
      throw new BadRequestException(`O código "${dto.codigo}" é reservado.`);
    }
    const { id: inquilinoId } = await this.catalogo.inquilinoAtual();
    const refs = await this.resolverRefs(dto);
    const cred = gerarCredencial();

    const d = await this.prisma.dispositivo
      .create({
        data: {
          inquilinoId,
          codigo: dto.codigo,
          nome: dto.nome,
          fabricante: dto.fabricante,
          modelo: dto.modelo,
          firmware: dto.firmware,
          latitude: dto.latitude,
          longitude: dto.longitude,
          dominioId: refs.dominioId!,
          perfilId: refs.perfilId!,
          siteId: refs.siteId!,
          areaId: refs.areaId ?? null,
          credenciais: { create: { prefixo: cred.prefixo, hash: cred.hash } },
        },
        include: INCLUIR,
      })
      .catch((e) => conflito(e, `Já existe o dispositivo "${dto.codigo}".`));

    return {
      dispositivo: resposta(d, new Date()),
      credencial: {
        token: cred.token,
        prefixo: cred.prefixo,
        emitidaEm: d.credenciais[0]?.emitidaEm ?? new Date(),
        aviso: AVISO_TOKEN,
      },
    };
  }

  async atualizar(ref: string, dto: AtualizarDispositivoDto) {
    const atual = await this.carregar(ref);
    // Trocar de local sem dizer a área tira a área (ela é de outro local).
    const area =
      dto.area !== undefined ? dto.area : dto.site ? null : undefined;
    const refs = await this.resolverRefs(
      { ...dto, area },
      dto.site ? undefined : atual.siteId,
    );
    const d = await this.prisma.dispositivo.update({
      where: { id: atual.id },
      data: {
        nome: dto.nome,
        fabricante: dto.fabricante,
        modelo: dto.modelo,
        firmware: dto.firmware,
        latitude: dto.latitude,
        longitude: dto.longitude,
        dominioId: refs.dominioId,
        perfilId: refs.perfilId,
        siteId: refs.siteId,
        areaId: refs.areaId,
      },
      include: INCLUIR,
    });
    return resposta(d, new Date());
  }

  /** Emite uma credencial nova e revoga a anterior (uma ativa por aparelho). */
  async emitirCredencial(ref: string) {
    const d = await this.carregar(ref);
    const cred = gerarCredencial();
    const agora = new Date();
    const [revogadas, nova] = await this.prisma.$transaction([
      this.prisma.credencialDispositivo.updateMany({
        where: { dispositivoId: d.id, revogadaEm: null },
        data: { revogadaEm: agora },
      }),
      this.prisma.credencialDispositivo.create({
        data: { dispositivoId: d.id, prefixo: cred.prefixo, hash: cred.hash },
      }),
    ]);
    return {
      dispositivo: d.codigo,
      token: cred.token,
      prefixo: cred.prefixo,
      emitidaEm: nova.emitidaEm,
      anterioresRevogadas: revogadas.count,
      aviso: AVISO_TOKEN,
    };
  }

  /** Revoga a credencial ativa: a próxima conexão com ela é recusada. */
  async revogarCredencial(ref: string) {
    const d = await this.carregar(ref);
    const agora = new Date();
    const { count } = await this.prisma.credencialDispositivo.updateMany({
      where: { dispositivoId: d.id, revogadaEm: null },
      data: { revogadaEm: agora },
    });
    if (!count) {
      throw new NotFoundException(
        `O dispositivo "${d.codigo}" não tem credencial ativa.`,
      );
    }
    return { dispositivo: d.codigo, revogadas: count, revogadaEm: agora };
  }

  /**
   * Dispositivo dono do token, ou null se o token não existe, não confere ou
   * foi revogado. É a checagem que a ingestão usa em cada conexão.
   */
  async autenticar(token: string): Promise<DispositivoCompleto | null> {
    const prefixo = prefixoDoToken(token);
    if (!prefixo) return null;
    const cred = await this.prisma.credencialDispositivo.findUnique({
      where: { prefixo },
      select: { hash: true, revogadaEm: true, dispositivoId: true },
    });
    if (!cred || cred.revogadaEm || !tokenConfere(token, cred.hash)) {
      return null;
    }
    return this.prisma.dispositivo.findUnique({
      where: { id: cred.dispositivoId },
      include: INCLUIR,
    });
  }

  respostaDe(d: DispositivoCompleto) {
    return resposta(d, new Date());
  }

  private async carregar(ref: string): Promise<DispositivoCompleto> {
    const { id: inquilinoId } = await this.catalogo.inquilinoAtual();
    const { id, slug } = porRef(ref) as { id?: string; slug?: string };
    const d = await this.prisma.dispositivo.findFirst({
      where: { inquilinoId, ...(id ? { id } : { codigo: slug }) },
      include: INCLUIR,
    });
    if (!d) throw new NotFoundException(`Dispositivo "${ref}" não encontrado.`);
    return d;
  }

  /**
   * Converte as referências (id ou slug) do corpo em ids do inquilino. A área
   * precisa pertencer ao local informado (ou ao atual, numa atualização).
   */
  private async resolverRefs(
    dto: {
      dominio?: string;
      perfil?: string;
      site?: string;
      area?: string | null;
    },
    siteAtualId?: string,
  ) {
    const { id: inquilinoId } = await this.catalogo.inquilinoAtual();
    const achar = async <T extends { id: string }>(
      ref: string | undefined,
      nome: string,
      busca: (where: object) => Promise<T | null>,
    ) => {
      if (ref === undefined) return undefined;
      const r = await busca({ inquilinoId, ...porRef(ref) });
      if (!r) throw new BadRequestException(`${nome} "${ref}" não encontrado.`);
      return r.id;
    };

    const dominioId = await achar(dto.dominio, 'Domínio', (where) =>
      this.prisma.dominio.findFirst({ where, select: { id: true } }),
    );
    const perfilId = await achar(dto.perfil, 'Perfil', (where) =>
      this.prisma.perfilDispositivo.findFirst({ where, select: { id: true } }),
    );
    const siteId = await achar(dto.site, 'Local', (where) =>
      this.prisma.site.findFirst({ where, select: { id: true } }),
    );

    let areaId: string | null | undefined;
    if (dto.area === null) areaId = null;
    else if (dto.area !== undefined) {
      const doSite = siteId ?? siteAtualId;
      const a = await this.prisma.area.findFirst({
        where: { siteId: doSite, ...porRef(dto.area) },
        select: { id: true },
      });
      if (!a) {
        throw new BadRequestException(
          `Área "${dto.area}" não encontrada nesse local.`,
        );
      }
      areaId = a.id;
    }
    return { dominioId, perfilId, siteId, areaId };
  }
}

function resposta(d: DispositivoCompleto, agora: Date) {
  const cred = d.credenciais[0];
  return {
    id: d.id,
    codigo: d.codigo,
    nome: d.nome,
    inquilino: d.inquilino,
    dominio: d.dominio,
    perfil: { id: d.perfil.id, slug: d.perfil.slug, nome: d.perfil.nome },
    site: d.site,
    area: d.area,
    fabricante: d.fabricante,
    modelo: d.modelo,
    firmware: d.firmware,
    geo:
      d.latitude !== null && d.longitude !== null
        ? { type: 'Point', coordinates: [d.longitude, d.latitude] }
        : null,
    posteId: d.posteId,
    conexao: estadoConexao(d.ultimaMensagemEm, d.perfil.intervaloEnvioS, agora),
    credencial: cred
      ? { ativa: true, prefixo: cred.prefixo, emitidaEm: cred.emitidaEm }
      : { ativa: false },
    criadoEm: d.criadoEm,
    atualizadoEm: d.atualizadoEm,
  };
}
