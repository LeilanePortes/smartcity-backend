import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { SeveridadeAlarme } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginacaoQuery } from '../../common/paginacao';

export const ORDENACAO_REGRAS = ['nome', 'criadoEm', 'severidade'] as const;

const REF = 'id (uuid) ou slug/código; null tira o filtro';
const aparar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/// Escopo: id ou slug; `null` (numa atualização) remove o filtro.
const ref = () => [
  IsOptional(),
  ValidateIf((_: unknown, v: unknown) => v !== null),
  IsString(),
];
function Ref(): PropertyDecorator {
  return (alvo, chave) => ref().forEach((d) => d(alvo, chave));
}

export class ListarRegrasQuery extends PaginacaoQuery {
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  ativa?: boolean;
}

export class CriarRegraDto {
  @ApiProperty({ example: 'Tensão alta no quadro' })
  @Transform(aparar)
  @IsString()
  @MaxLength(120)
  nome!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  ativa?: boolean;

  @ApiPropertyOptional({
    example: 'energia',
    description: `Domínio: ${REF}.`,
    nullable: true,
  })
  @Ref()
  dominio?: string | null;

  @ApiPropertyOptional({
    example: 'centro',
    description: `Local: ${REF}.`,
    nullable: true,
  })
  @Ref()
  site?: string | null;

  @ApiPropertyOptional({
    example: 'avenida-goias',
    description: `Área geográfica: ${REF}. Se o slug existir em mais de um local, informe o site.`,
    nullable: true,
  })
  @Ref()
  area?: string | null;

  @ApiPropertyOptional({
    example: 'medidor-quadro',
    description: `Perfil: ${REF}.`,
    nullable: true,
  })
  @Ref()
  perfil?: string | null;

  @ApiPropertyOptional({
    example: 'medidor-centro',
    description: `Dispositivo: ${REF}.`,
    nullable: true,
  })
  @Ref()
  dispositivo?: string | null;

  @ApiProperty({
    description:
      '`{ tipo: "limite", grandeza, operador (> >= < <= == !=), valor, duracaoS? }` ou `{ tipo: "ausencia", duracaoS }`.',
    example: {
      tipo: 'limite',
      grandeza: 'tensao',
      operador: '>',
      valor: 240,
      duracaoS: 60,
    },
  })
  @IsObject()
  condicao!: Record<string, unknown>;

  @ApiPropertyOptional({
    enum: SeveridadeAlarme,
    default: SeveridadeAlarme.AVISO,
  })
  @IsOptional()
  @IsEnum(SeveridadeAlarme)
  severidade?: SeveridadeAlarme;

  @ApiProperty({
    description:
      'Lista de ações: `alarme` · `notificar { email }` · `comando { nome, parametros? }` · `webhook { url, tentativas? }` · `publicar { topico }`.',
    example: [
      { tipo: 'alarme' },
      { tipo: 'notificar', email: 'operador@itaguari.local' },
      { tipo: 'webhook', url: 'http://exemplo.local/alarmes' },
    ],
  })
  @IsArray()
  acoes!: Record<string, unknown>[];
}

export class AtualizarRegraDto extends PartialType(CriarRegraDto) {}
