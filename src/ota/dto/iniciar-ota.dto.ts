import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class IniciarOtaDto {
  @ApiProperty({
    example: '2.5.0',
    description:
      'Versão de firmware a distribuir. Do catálogo: `2.5.0` (estável), `3.0.0` ' +
      '(defeito de energia, revertida pelo canário) e `3.0.1` (falha no autoteste, ' +
      'rollback A/B nos aparelhos).',
  })
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'versao deve ter o formato X.Y.Z' })
  versao!: string;
}
