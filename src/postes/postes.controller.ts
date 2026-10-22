import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { EventosService } from '../eventos/eventos.service';
import { TelemetriaService } from '../telemetria/telemetria.service';
import { AtualizarStatusDto } from './dto/atualizar-status.dto';
import { HistoricoTelemetriaQuery } from './dto/historico-telemetria.query';
import { ListarEventosQuery } from './dto/listar-eventos.query';
import { ListarPostesQuery } from './dto/listar-postes.query';
import { PostesService } from './postes.service';

@ApiTags('Postes')
@Controller('postes')
export class PostesController {
  constructor(
    private readonly postes: PostesService,
    private readonly telemetria: TelemetriaService,
    private readonly eventos: EventosService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lista os postes para o mapa',
    description:
      'Filtro por status e busca por rua/bairro. Retorna todos os postes que casam.',
  })
  @ApiOkResponse({
    description: '`{ total, postes[] }` com os campos do marcador.',
  })
  listar(@Query() query: ListarPostesQuery) {
    return this.postes.listar(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um poste' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description:
      'Poste completo + `chamadoAberto` (true quando `FALHA_OFFLINE`).',
  })
  detalhe(@Param('id', ParseUUIDPipe) id: string) {
    return this.postes.buscarPorId(id);
  }

  @Get(':id/telemetria')
  @ApiOperation({
    summary: 'Histórico de consumo do poste',
    description:
      'Série agregada para o gráfico de barras + resumo (média, pico, economia %). ' +
      'Bucket por hora em `hoje`, por dia em `semana`/`mes`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  async historicoTelemetria(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: HistoricoTelemetriaQuery,
  ) {
    await this.postes.garantirExiste(id);
    return this.telemetria.historicoPorPoste(id, query.periodo);
  }

  @Get(':id/eventos')
  @ApiOperation({ summary: 'Log do sensor 360° do poste' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async logEventos(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListarEventosQuery,
  ) {
    await this.postes.garantirExiste(id);
    return this.eventos.listarPorPoste(id, query);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Atribui status manualmente (agendar/encerrar manutenção)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Poste atualizado.' })
  atualizarStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarStatusDto,
  ) {
    return this.postes.atualizarStatus(id, dto.status);
  }
}
