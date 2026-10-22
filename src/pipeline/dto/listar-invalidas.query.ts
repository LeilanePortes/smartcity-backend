import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginacaoQuery } from '../../common/paginacao';

/// Campos aceitos em `ordenar` na fila de inválidas (padrão: mais recentes primeiro).
export const ORDENACAO_INVALIDAS = ['recebidoEm', 'canal', 'etapa'] as const;

export class ListarInvalidasQuery extends PaginacaoQuery {
  @ApiPropertyOptional({ enum: ['http', 'lote', 'mqtt'] })
  @IsOptional()
  @IsIn(['http', 'lote', 'mqtt'])
  canal?: string;

  @ApiPropertyOptional({ enum: ['autenticar', 'validar', 'enriquecer'] })
  @IsOptional()
  @IsIn(['autenticar', 'validar', 'enriquecer'])
  etapa?: string;

  @ApiPropertyOptional({
    description: 'Código do dispositivo informado na mensagem.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  dispositivo?: string;
}
