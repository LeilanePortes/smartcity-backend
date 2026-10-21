import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, SeveridadeAlarme, StatusAlarme } from '@prisma/client';
import { CatalogoService, porRef } from '../catalogo/catalogo.service';
import { janelaPagina, lerOrdenacao, montarPagina } from '../common/paginacao';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListarAlarmesQuery,
  ORDENACAO_ALARMES,
  TransicaoAlarmeDto,
} from './dto/alarmes.dto';
import { EVENTO_ALARME_ALTERADO } from './regras.events';

const ABERTOS: StatusAlarme[] = [StatusAlarme.ATIVO, StatusAlarme.RECONHECIDO];

const INCLUIR = {
  dispositivo: { select: { id: true, codigo: true, nome: true } },
  regra: { select: { id: true, nome: true } },
} satisfies Prisma.AlarmeInclude;

type AlarmeCompleto = Prisma.AlarmeGetPayload<{ include: typeof INCLUIR }>;

export interface NovoAlarme {
  inquilinoId: string;
  regraId: string | null;
  dispositivoId: string;
  origem: 'regra' | 'borda';
  severidade: SeveridadeAlarme;
  titulo: string;
  detalhe?: string;
  grandeza?: string;
  valor?: number;
  ocorridoEm: Date;
}

/**
 * Alarmes com ciclo de vida e severidade (RF-PRO-05): ATIVO → RECONHECIDO →
 * RESOLVIDO. Um alarme aberto não se repete: enquanto ele estiver ativo ou
 * reconhecido, o mesmo problema no mesmo dispositivo não abre outro.
 */
@Injectable()
export class AlarmesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogo: CatalogoService,
    private readonly eventos: EventEmitter2,
  ) {}

  /** Abre o alarme ou devolve o que já está aberto para o mesmo problema. */
  async abrir(n: NovoAlarme): Promise<{ id: string; novo: boolean }> {
    const aberto = await this.prisma.alarme.findFirst({
      where: {
        dispositivoId: n.dispositivoId,
        status: { in: ABERTOS },
        ...(n.regraId
          ? { regraId: n.regraId }
          : { origem: n.origem, titulo: n.titulo }),
      },
      select: { id: true },
    });
    if (aberto) return { id: aberto.id, novo: false };
    const a = await this.prisma.alarme.create({ data: n, include: INCLUIR });
    this.avisar(a);
    return { id: a.id, novo: true };
  }

  /** Resolve sozinho os alarmes abertos quando a condição deixa de valer. */
  async resolverAutomatico(where: Prisma.AlarmeWhereInput): Promise<number> {
    const abertos = await this.prisma.alarme.findMany({
      where: { ...where, status: { in: ABERTOS } },
      select: { id: true },
    });
    for (const { id } of abertos) {
      const a = await this.prisma.alarme.update({
        where: { id },
        data: {
          status: StatusAlarme.RESOLVIDO,
          resolvidoEm: new Date(),
          resolvidoPor: 'automático',
        },
        include: INCLUIR,
      });
      this.avisar(a);
    }
    return abertos.length;
  }

  async listar(query: ListarAlarmesQuery) {
    const { id: inquilinoId } = await this.catalogo.inquilinoAtual();
    const where: Prisma.AlarmeWhereInput = { inquilinoId };
    if (query.status) where.status = query.status;
    if (query.severidade) where.severidade = query.severidade;
    if (query.origem) where.origem = query.origem;
    if (query.regra) where.regraId = query.regra;
    if (query.dispositivo) {
      const r = porRef(query.dispositivo);
      where.dispositivo = 'id' in r ? r : { codigo: r.slug };
    }
    const { campo, direcao } = lerOrdenacao(
      query.ordenar,
      ORDENACAO_ALARMES,
      '-ocorridoEm',
    );
    const [total, itens] = await this.prisma.$transaction([
      this.prisma.alarme.count({ where }),
      this.prisma.alarme.findMany({
        where,
        orderBy: [{ [campo]: direcao }, { criadoEm: 'desc' }],
        ...janelaPagina(query),
        include: INCLUIR,
      }),
    ]);
    return montarPagina(itens.map(resposta), total, query);
  }

  async buscar(id: string) {
    const a = await this.carregar(id);
    const execucoes = await this.prisma.execucaoAcao.findMany({
      where: { alarmeId: id },
      orderBy: { criadoEm: 'asc' },
      select: {
        tipo: true,
        destino: true,
        status: true,
        tentativas: true,
        erro: true,
        criadoEm: true,
        concluidoEm: true,
      },
    });
    return { ...resposta(a), execucoes };
  }

  async reconhecer(id: string, dto: TransicaoAlarmeDto) {
    const a = await this.carregar(id);
    if (a.status !== StatusAlarme.ATIVO) {
      throw new ConflictException(
        `Só um alarme ATIVO pode ser reconhecido (este está ${a.status}).`,
      );
    }
    return this.transicao(id, {
      status: StatusAlarme.RECONHECIDO,
      reconhecidoEm: new Date(),
      reconhecidoPor: dto.por ?? 'operador',
      ...(dto.comentario ? { comentario: dto.comentario } : {}),
    });
  }

  async resolver(id: string, dto: TransicaoAlarmeDto) {
    const a = await this.carregar(id);
    if (a.status === StatusAlarme.RESOLVIDO) {
      throw new ConflictException('O alarme já está resolvido.');
    }
    return this.transicao(id, {
      status: StatusAlarme.RESOLVIDO,
      resolvidoEm: new Date(),
      resolvidoPor: dto.por ?? 'operador',
      ...(dto.comentario ? { comentario: dto.comentario } : {}),
    });
  }

  private async transicao(id: string, data: Prisma.AlarmeUpdateInput) {
    const a = await this.prisma.alarme.update({
      where: { id },
      data,
      include: INCLUIR,
    });
    this.avisar(a);
    return resposta(a);
  }

  private async carregar(id: string): Promise<AlarmeCompleto> {
    const { id: inquilinoId } = await this.catalogo.inquilinoAtual();
    const a = await this.prisma.alarme.findFirst({
      where: { id, inquilinoId },
      include: INCLUIR,
    });
    if (!a) throw new NotFoundException(`Alarme ${id} não encontrado.`);
    return a;
  }

  private avisar(a: AlarmeCompleto): void {
    this.eventos.emit(EVENTO_ALARME_ALTERADO, resposta(a));
  }
}

export function resposta(a: AlarmeCompleto) {
  const { inquilinoId: _i, dispositivoId: _d, regraId: _r, ...resto } = a;
  return resto;
}
