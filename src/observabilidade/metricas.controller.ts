import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { metricasApi } from './metricas-plataforma';

/// `GET /metrics` (fora do /api/v1, como o Prometheus espera).
@ApiExcludeController()
@Controller('metrics')
export class MetricasController {
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metricas(): string {
    return metricasApi.texto();
  }
}
