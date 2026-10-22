import { ApiPropertyOptional } from '@nestjs/swagger';
import { SeveridadeAlarme, StatusAlarme } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginacaoQuery } from '../../common/paginacao';

/// Campos aceitos em `ordenar` nos alarmes (padrão: mais recentes primeiro).
export const ORDENACAO_ALARMES = [
  'ocorridoEm',
  'criadoEm',
  'severidade',
  'status',
] as const;

export class ListarAlarmesQuery extends PaginacaoQuery {
  @ApiPropertyOptional({ enum: StatusAlarme })
  @IsOptional()
  @IsEnum(StatusAlarme)
  status?: StatusAlarme;

  @ApiPropertyOptional({ enum: SeveridadeAlarme })
  @IsOptional()
  @IsEnum(SeveridadeAlarme)
  severidade?: SeveridadeAlarme;

  @ApiPropertyOptional({ enum: ['regra', 'borda'] })
  @IsOptional()
  @IsIn(['regra', 'borda'])
  origem?: string;

  @ApiPropertyOptional({ description: 'Dispositivo: id ou código.' })
  @IsOptional()
  @IsString()
  dispositivo?: string;

  @ApiPropertyOptional({ description: 'Id da regra.' })
  @IsOptional()
  @IsString()
  regra?: string;
}

export class TransicaoAlarmeDto {
  @ApiPropertyOptional({
    example: 'operador',
    description: 'Quem fez (até o login existir, vem no corpo).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  por?: string;

  @ApiPropertyOptional({ example: 'Equipe a caminho.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentario?: string;
}
