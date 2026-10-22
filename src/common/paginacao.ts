import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/// Paginação, filtros e ordenação padronizados (RF-APP-07): toda listagem da
/// API aceita os mesmos parâmetros e responde no mesmo envelope.

export const TAMANHO_PADRAO = 50;
export const TAMANHO_MAXIMO = 500;

export class PaginacaoQuery {
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    default: 1,
    description: 'Página (começa em 1).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina: number = 1;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: TAMANHO_MAXIMO,
    default: TAMANHO_PADRAO,
    description: `Itens por página (máximo ${TAMANHO_MAXIMO}).`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAMANHO_MAXIMO)
  tamanho: number = TAMANHO_PADRAO;

  @ApiPropertyOptional({
    description:
      'Campo de ordenação; prefixo "-" para decrescente (ex.: -timestamp). Os campos aceitos são listados em cada endpoint.',
    example: 'codigo',
  })
  @IsOptional()
  @Matches(/^-?[A-Za-z]+$/, {
    message: 'ordenar deve ser um nome de campo, com "-" opcional na frente',
  })
  ordenar?: string;
}

/// Resposta padrão de toda listagem.
export interface Pagina<T> {
  itens: T[];
  pagina: number;
  tamanho: number;
  total: number;
  totalPaginas: number;
}

export interface Ordenacao {
  campo: string;
  direcao: 'asc' | 'desc';
}

/**
 * Lê o parâmetro `ordenar` aceitando só os campos permitidos do endpoint
 * (400 com a lista dos aceitos caso contrário).
 */
export function lerOrdenacao(
  ordenar: string | undefined,
  permitidos: readonly string[],
  padrao: string,
): Ordenacao {
  const valor = ordenar ?? padrao;
  const desc = valor.startsWith('-');
  const campo = desc ? valor.slice(1) : valor;
  if (!permitidos.includes(campo)) {
    throw new BadRequestException(
      `ordenar: campo "${campo}" não é aceito aqui. Use um de: ${permitidos.join(', ')} (com "-" na frente para decrescente).`,
    );
  }
  return { campo, direcao: desc ? 'desc' : 'asc' };
}

/** `skip`/`take` do Prisma para a página pedida. */
export const janelaPagina = (q: PaginacaoQuery) => ({
  skip: (q.pagina - 1) * q.tamanho,
  take: q.tamanho,
});

export function montarPagina<T>(
  itens: T[],
  total: number,
  q: PaginacaoQuery,
): Pagina<T> {
  return {
    itens,
    pagina: q.pagina,
    tamanho: q.tamanho,
    total,
    totalPaginas: Math.ceil(total / q.tamanho),
  };
}
