import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const INTERVALOS = [
  'auto',
  'bruto',
  '1m',
  '5m',
  '15m',
  '1h',
  '1d',
] as const;
export type Intervalo = (typeof INTERVALOS)[number];

const REF = 'id (uuid) ou slug/código';

export class JanelaSerieQuery {
  @ApiPropertyOptional({
    description: 'Início (ISO 8601). Padrão: 24 h antes do fim.',
    example: '2026-10-20T20:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  inicio?: string;

  @ApiPropertyOptional({ description: 'Fim (ISO 8601). Padrão: agora.' })
  @IsOptional()
  @IsISO8601()
  fim?: string;

  @ApiPropertyOptional({
    enum: INTERVALOS,
    default: 'auto',
    description:
      'Agregação: `bruto` (cada medição) ou janelas de 1 min a 1 dia. `auto` escolhe pelo tamanho do período.',
  })
  @IsOptional()
  @IsIn(INTERVALOS)
  intervalo: Intervalo = 'auto';
}

export class SerieDispositivoQuery extends JanelaSerieQuery {
  @ApiPropertyOptional({
    example: 'potencia',
    description: 'Grandeza. Omitida = todas as do perfil.',
  })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]*$/)
  grandeza?: string;
}

export class SerieQuery extends JanelaSerieQuery {
  @ApiPropertyOptional({
    example: 'potencia',
    description: 'Grandeza (obrigatória).',
  })
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'grandeza é obrigatória (ex.: potencia)',
  })
  grandeza!: string;

  @ApiPropertyOptional({
    example: 'p-001',
    description: `Dispositivo: ${REF}.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  dispositivo?: string;

  @ApiPropertyOptional({
    example: 'avenida-goias',
    description: `Área: ${REF}.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  area?: string;

  @ApiPropertyOptional({ example: 'centro', description: `Local: ${REF}.` })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  site?: string;

  @ApiPropertyOptional({
    example: 'iluminacao',
    description: `Domínio: ${REF}.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  dominio?: string;
}
