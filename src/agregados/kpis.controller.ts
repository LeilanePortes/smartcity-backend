import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgregadosService } from './agregados.service';
import { KpisQuery } from './dto/kpis.query';
import { RankingQuery } from './dto/ranking.query';

@ApiTags('KPIs')
@Controller('kpis')
export class KpisController {
  constructor(private readonly agregados: AgregadosService) {}

  @Get()
  @ApiOperation({
    summary: 'Consumo, custo e variação da rede no período',
    description:
      'Janela atual vs. período anterior equivalente, `parcialHoje` (dia corrente) ' +
      'e série comparativa para o gráfico.',
  })
  @ApiOkResponse({
    description:
      '`{ periodo, tarifa, atual, anterior, variacao, parcialHoje, serie }`.',
  })
  resumo(@Query() query: KpisQuery) {
    return this.agregados.resumo(query.periodo);
  }

  @Get('maior-consumo')
  @ApiOperation({ summary: 'Ranking dos postes de maior consumo no período' })
  @ApiOkResponse({ description: '`{ periodo, inicio, fim, ranking[] }`.' })
  maiorConsumo(@Query() query: RankingQuery) {
    return this.agregados.maiorConsumo(query);
  }

  @Get('postes-por-status')
  @ApiOperation({ summary: 'Contagem de postes por status' })
  @ApiOkResponse({ description: '`{ total, porStatus[] }` — as 4 categorias.' })
  postesPorStatus() {
    return this.agregados.postesPorStatus();
  }
}
