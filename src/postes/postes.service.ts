import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, StatusPoste } from '@prisma/client';
import { LUMINOSIDADE_PISO_PCT } from '../common/constants';
import { PrismaService } from '../prisma/prisma.service';
import { janelaPagina, lerOrdenacao, montarPagina } from '../common/paginacao';
import { ListarPostesQuery, ORDENACAO_POSTES } from './dto/listar-postes.query';
import { StatusManual } from './dto/atualizar-status.dto';
import {
  EVENTO_POSTE_STATUS_ALTERADO,
  PosteStatusAlteradoEvent,
} from './postes.events';

/// Campos enviados na listagem do mapa (PRD 5.1 · marcadores + bottom sheet).
const RESUMO_POSTE = {
  id: true,
  codigo: true,
  endereco: true,
  bairro: true,
  latitude: true,
  longitude: true,
  status: true,
  luminosidadeAtual: true,
  consumoInstantaneoKw: true,
  ultimaLeituraEm: true,
} satisfies Prisma.PosteSelect;

@Injectable()
export class PostesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Lista para o mapa, com filtro por status, busca por rua/bairro, paginação e ordenação. */
  async listar(query: ListarPostesQuery) {
    const where: Prisma.PosteWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.busca) {
      where.OR = [
        { endereco: { contains: query.busca, mode: 'insensitive' } },
        { bairro: { contains: query.busca, mode: 'insensitive' } },
      ];
    }

    const { campo, direcao } = lerOrdenacao(
      query.ordenar,
      ORDENACAO_POSTES,
      'codigo',
    );
    const [total, postes] = await this.prisma.$transaction([
      this.prisma.poste.count({ where }),
      this.prisma.poste.findMany({
        where,
        orderBy: { [campo]: direcao },
        ...janelaPagina(query),
        select: RESUMO_POSTE,
      }),
    ]);

    return montarPagina(postes, total, query);
  }

  /** Detalhe completo do poste. Lança 404 se não existir. */
  async buscarPorId(id: string) {
    const poste = await this.prisma.poste.findUnique({ where: { id } });
    if (!poste) throw new NotFoundException(`Poste ${id} não encontrado.`);
    return {
      ...poste,
      chamadoAberto: poste.status === StatusPoste.FALHA_OFFLINE,
    };
  }

  /** Valida a existência do poste sem carregar a linha inteira. */
  async garantirExiste(id: string): Promise<void> {
    const existe = await this.prisma.poste.count({ where: { id } });
    if (!existe) throw new NotFoundException(`Poste ${id} não encontrado.`);
  }

  /**
   * Atribuição manual de status pelo técnico: colocar em manutenção ou
   * devolver à operação normal (PRD 5.2 · "Agendar manutenção").
   */
  async atualizarStatus(id: string, status: StatusManual) {
    await this.garantirExiste(id);

    // Ajusta os campos "atuais" para um estado coerente já na resposta, sem
    // depender do próximo tick do simulador (que pode estar desligado).
    const data: Prisma.PosteUpdateInput = { status };
    if (status === StatusPoste.MANUTENCAO) {
      data.luminosidadeAtual = 0;
      data.consumoInstantaneoKw = 0;
    } else {
      data.luminosidadeAtual = LUMINOSIDADE_PISO_PCT;
    }

    const poste = await this.prisma.poste.update({ where: { id }, data });

    this.eventEmitter.emit(EVENTO_POSTE_STATUS_ALTERADO, {
      posteId: id,
      status,
    } satisfies PosteStatusAlteradoEvent);

    return poste;
  }
}
