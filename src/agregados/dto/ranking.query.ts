import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginacaoQuery, TAMANHO_MAXIMO } from '../../common/paginacao';
import { PERIODOS_KPI } from '../../common/periodo';
import type { PeriodoKpi } from '../../common/periodo';

export class RankingQuery extends PaginacaoQuery {
  @ApiPropertyOptional({ enum: PERIODOS_KPI, default: 'mes' })
  @IsOptional()
  @IsIn(PERIODOS_KPI)
  periodo: PeriodoKpi = 'mes';

  /// Quantos postes por página do ranking (PRD 5.3 · top 5 por padrão).
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: TAMANHO_MAXIMO,
    default: 5,
    description: 'Itens por página do ranking (padrão: top 5).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAMANHO_MAXIMO)
  override tamanho: number = 5;
}
