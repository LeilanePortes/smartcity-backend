import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginacaoQuery } from '../../common/paginacao';

/// Identificador legível usado nos tópicos MQTT e nas URLs (sem acento nem espaço).
export const FORMATO_SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const MSG_SLUG =
  'use só letras minúsculas, números, "-" e "_" (ex.: recursos_hidricos)';

const aparar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/// Campos aceitos em `ordenar` nas listagens do catálogo.
export const ORDENACAO_CATALOGO = ['slug', 'nome', 'criadoEm'] as const;

export class ListarCatalogoQuery extends PaginacaoQuery {
  @ApiPropertyOptional({ description: 'Busca por slug ou nome.' })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(120)
  busca?: string;
}

class BaseCatalogoDto {
  @ApiProperty({
    example: 'pecuaria',
    description: `Identificador: ${MSG_SLUG}.`,
  })
  @Matches(FORMATO_SLUG, { message: `slug: ${MSG_SLUG}` })
  slug!: string;

  @ApiProperty({ example: 'Pecuária' })
  @Transform(aparar)
  @IsString()
  @MaxLength(120)
  nome!: string;
}

export class CriarDominioDto extends BaseCatalogoDto {
  @ApiPropertyOptional({ example: 'Brincos e colares com GPS, bebedouros.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string;
}

export class GrandezaDto {
  @ApiProperty({
    example: 'nivel',
    description: 'Nome da grandeza (minúsculo, "_").',
  })
  @Matches(/^[a-z][a-z0-9_]{0,62}$/, {
    message: 'grandeza: comece com letra; só minúsculas, números e "_"',
  })
  grandeza!: string;

  @ApiProperty({
    example: 'm',
    description: 'Unidade UCUM (ex.: kW, %, Cel, m, V).',
  })
  @IsString()
  @MaxLength(20)
  unidade!: string;

  @ApiPropertyOptional({ example: 0, description: 'Mínimo da faixa válida.' })
  @IsOptional()
  @IsNumber()
  minimo?: number;

  @ApiPropertyOptional({ example: 10, description: 'Máximo da faixa válida.' })
  @IsOptional()
  @IsNumber()
  maximo?: number;
}

export class CriarPerfilDto extends BaseCatalogoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string;

  @ApiProperty({ type: [GrandezaDto] })
  @ValidateNested({ each: true })
  @Type(() => GrandezaDto)
  @ArrayMinSize(1)
  grandezas!: GrandezaDto[];

  @ApiProperty({
    example: 1800,
    description:
      'Intervalo esperado entre mensagens, em segundos (até 7 dias).',
  })
  @IsInt()
  @Min(1)
  @Max(604_800)
  intervaloEnvioS!: number;
}

export class CriarLocalDto extends BaseCatalogoDto {
  @ApiPropertyOptional({
    example: 'bairro',
    description: 'Livre: bairro, fazenda, praça, talhão, rua...',
  })
  @IsOptional()
  @Matches(FORMATO_SLUG, { message: `tipo: ${MSG_SLUG}` })
  tipo?: string;

  @ApiPropertyOptional({
    description:
      'Geometria GeoJSON (Point, LineString, Polygon...), coordenadas [lon, lat].',
    example: { type: 'Point', coordinates: [-49.606172, -15.920801] },
  })
  @IsOptional()
  @IsObject()
  geometria?: Record<string, unknown>;
}
