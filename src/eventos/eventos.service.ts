import { Injectable } from '@nestjs/common';
import {
  janelaPagina,
  lerOrdenacao,
  montarPagina,
  PaginacaoQuery,
} from '../common/paginacao';
import { ORDENACAO_EVENTOS } from '../postes/dto/listar-eventos.query';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EventosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Log do sensor 360° de um poste, paginado; padrão: mais recentes primeiro (PRD 5.2). */
  async listarPorPoste(posteId: string, query: PaginacaoQuery) {
    const { campo, direcao } = lerOrdenacao(
      query.ordenar,
      ORDENACAO_EVENTOS,
      '-timestamp',
    );
    const where = { posteId };
    const [total, eventos] = await this.prisma.$transaction([
      this.prisma.eventoSensor.count({ where }),
      this.prisma.eventoSensor.findMany({
        where,
        orderBy: { [campo]: direcao },
        ...janelaPagina(query),
        select: {
          id: true,
          tipo: true,
          sentido: true,
          luminosidadeResultante: true,
          timestamp: true,
        },
      }),
    ]);
    return montarPagina(eventos, total, query);
  }
}
