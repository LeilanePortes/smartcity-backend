import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IniciarOtaDto } from './dto/iniciar-ota.dto';
import { OtaService } from './ota.service';

@ApiTags('OTA')
@Controller('ota')
export class OtaController {
  constructor(private readonly ota: OtaService) {}

  @Get()
  @ApiOperation({
    summary: 'Estado do OTA: catálogo, versões em campo e implantação atual',
    description:
      'Implantação em ondas com grupo canário × controle e o histórico de ' +
      'decisões de cada portão (avançar, estender, concluir ou reverter).',
  })
  @ApiOkResponse({
    description:
      '`{ modo, catalogo[], versoesEmCampo, criterios, implantacao }` — ver docs/contrato-api.md.',
  })
  estado() {
    return this.ota.estado();
  }

  @Post('implantacoes')
  @ApiOperation({
    summary: 'Inicia a distribuição de uma versão pela frota',
    description:
      'Começa pelo grupo canário (primeira onda) e avança sozinho conforme os critérios.',
  })
  @ApiCreatedResponse({
    description: 'Estado do OTA com a implantação iniciada.',
  })
  @ApiConflictResponse({
    description: 'Implantação já em andamento ou API fora do modo camadas.',
  })
  iniciar(@Body() dto: IniciarOtaDto) {
    return this.ota.iniciar(dto.versao);
  }

  @Post('reverter')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reverte a implantação em andamento (decisão manual da equipe)',
  })
  @ApiOkResponse({ description: 'Estado do OTA com a implantação revertida.' })
  @ApiConflictResponse({ description: 'Não há implantação em andamento.' })
  reverter() {
    return this.ota.reverterManual();
  }
}
