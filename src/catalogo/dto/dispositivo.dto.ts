import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginacaoQuery } from '../../common/paginacao';

/// Código do dispositivo: vira o segmento {dispositivo} do tópico MQTT.
export const FORMATO_CODIGO = /^[a-z0-9][a-z0-9_.-]{0,62}$/;

/// Campos aceitos em `ordenar` na listagem de dispositivos.
export const ORDENACAO_DISPOSITIVOS = [
  'codigo',
  'nome',
  'firmware',
  'criadoEm',
  'ultimaMensagemEm',
] as const;

const aparar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const REF = 'id (uuid) ou slug';

export class ListarDispositivosQuery extends PaginacaoQuery {
  @ApiPropertyOptional({
    example: 'iluminacao',
    description: `Domínio: ${REF}.`,
  })
  @IsOptional()
  @IsString()
  dominio?: string;

  @ApiPropertyOptional({
    example: 'luminaria-led',
    description: `Perfil: ${REF}.`,
  })
  @IsOptional()
  @IsString()
  perfil?: string;

  @ApiPropertyOptional({ example: 'centro', description: `Local: ${REF}.` })
  @IsOptional()
  @IsString()
  site?: string;

  @ApiPropertyOptional({
    example: 'avenida-goias',
    description: `Área: ${REF}.`,
  })
  @IsOptional()
  @IsString()
  area?: string;

  @ApiPropertyOptional({ enum: ['online', 'offline'] })
  @IsOptional()
  @IsIn(['online', 'offline'])
  conexao?: 'online' | 'offline';

  @ApiPropertyOptional({ description: 'Busca por código ou nome.' })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(120)
  busca?: string;
}

export class CriarDispositivoDto {
  @ApiProperty({
    example: 'medidor-centro',
    description:
      'Código único no inquilino; vira o {dispositivo} do tópico MQTT.',
  })
  @Matches(FORMATO_CODIGO, {
    message: 'codigo: só letras minúsculas, números, ".", "-" e "_"',
  })
  codigo!: string;

  @ApiProperty({ example: 'Medidor do quadro de comando — Centro' })
  @Transform(aparar)
  @IsString()
  @MaxLength(120)
  nome!: string;

  @ApiProperty({ example: 'energia', description: `Domínio: ${REF}.` })
  @IsString()
  dominio!: string;

  @ApiProperty({ example: 'medidor-quadro', description: `Perfil: ${REF}.` })
  @IsString()
  perfil!: string;

  @ApiProperty({ example: 'centro', description: `Local (site): ${REF}.` })
  @IsString()
  site!: string;

  @ApiPropertyOptional({
    example: 'avenida-goias',
    description: `Área dentro do local: ${REF}. null remove a área.`,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  area?: string | null;

  @ApiProperty({ example: 'Medidores Genéricos Ltda.' })
  @Transform(aparar)
  @IsString()
  @MaxLength(120)
  fabricante!: string;

  @ApiPropertyOptional({ example: 'MQ-3F' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  modelo?: string;

  @ApiProperty({ example: '1.0.0' })
  @IsString()
  @MaxLength(40)
  firmware!: string;

  @ApiPropertyOptional({ example: -15.920801 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: -49.606172 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

/// Tudo pode mudar, menos o código (ele está nos tópicos do aparelho).
export class AtualizarDispositivoDto extends PartialType(
  OmitType(CriarDispositivoDto, ['codigo'] as const),
) {}
