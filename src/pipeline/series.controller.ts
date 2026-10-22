import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { SerieDispositivoQuery, SerieQuery } from './dto/serie.query';
import { SeriesService } from './series.service';

const REF = { description: 'id (uuid) ou código', example: 'p-001' };

@ApiTags('Séries')
@Controller()
export class SeriesController {
  constructor(private readonly series: SeriesService) {}

  @Get('series')
  @ApiOperation({
    summary:
      'Série temporal por grandeza, dispositivo, área, local, domínio e intervalo (RF-DAD-01)',
    description:
      'Junta as medições do pipeline e o histórico dos postes. Medições atrasadas aparecem na hora em que foram medidas.',
  })
  consultar(@Query() query: SerieQuery) {
    return this.series.consultar(query);
  }

  @Get('dispositivos/:ref/telemetria')
  @ApiOperation({
    summary: 'Histórico de um dispositivo, por grandeza e intervalo',
  })
  @ApiParam({ name: 'ref', ...REF })
  porDispositivo(
    @Param('ref') ref: string,
    @Query() query: SerieDispositivoQuery,
  ) {
    return this.series.porDispositivo(ref, query);
  }

  @Get('dispositivos/:ref/ultimos-valores')
  @ApiOperation({
    summary:
      'Último valor de cada grandeza do dispositivo, sem consultar o histórico (RF-DAD-02)',
  })
  @ApiParam({ name: 'ref', ...REF })
  ultimosValores(@Param('ref') ref: string) {
    return this.series.ultimosValores(ref);
  }
}
