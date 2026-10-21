import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { janelaPagina, lerOrdenacao, montarPagina } from '../common/paginacao';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListarInvalidasQuery,
  ORDENACAO_INVALIDAS,
} from './dto/listar-invalidas.query';

/** Consulta da fila de mensagens inválidas (DLQ). */
@Injectable()
export class InvalidasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(query: ListarInvalidasQuery) {
    const where: Prisma.MensagemInvalidaWhereInput = {};
    if (query.canal) where.canal = query.canal;
    if (query.etapa) where.etapa = query.etapa;
    if (query.dispositivo) where.dispositivo = query.dispositivo;
    const { campo, direcao } = lerOrdenacao(
      query.ordenar,
      ORDENACAO_INVALIDAS,
      '-recebidoEm',
    );
    const [total, itens] = await this.prisma.$transaction([
      this.prisma.mensagemInvalida.count({ where }),
      this.prisma.mensagemInvalida.findMany({
        where,
        orderBy: { [campo]: direcao },
        ...janelaPagina(query),
      }),
    ]);
    return montarPagina(itens, total, query);
  }
}
