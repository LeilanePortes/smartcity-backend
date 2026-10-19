import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EstadoCamadasService } from './estado-camadas.service';
import { IngestaoService } from './ingestao.service';

@ApiTags('Arquitetura')
@Controller('arquitetura')
export class ArquiteturaController {
  constructor(
    private readonly ingestao: IngestaoService,
    private readonly estado: EstadoCamadasService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Estado das camadas edge · fog · nuvem',
    description:
      'Modo de operação, presença do campo (edge) e dos gateways (fog), ' +
      'último relatório de banda (campo → fog × fog → nuvem) e alertas recentes do fog. ' +
      'Com `modo: "interno"` (simulador embutido) os campos das camadas vêm nulos.',
  })
  @ApiOkResponse({
    description:
      '`{ modo, nuvem, edge, fog, trafego, alertas[], geradoEm }` — ver docs/contrato-api.md.',
  })
  estadoAtual() {
    const { fog, trafego } = this.estado;
    return {
      modo: this.ingestao.modo,
      nuvem: { brokerConectado: this.estado.brokerConectado },
      edge: trafego ? { online: trafego.edgeOnline } : null,
      fog: fog
        ? {
            online: fog.online,
            gateways: trafego?.gateways ?? [],
            buffer: trafego?.buffer ?? fog.buffer,
            atualizadoEm: trafego?.em ?? fog.em,
          }
        : null,
      trafego: trafego
        ? {
            janelaS: trafego.janelaS,
            entrada: trafego.entrada,
            saida: trafego.saida,
            reducaoMsgsPct: trafego.reducaoMsgsPct,
            reducaoBytesPct: trafego.reducaoBytesPct,
            postes: trafego.postes,
            em: trafego.em,
          }
        : null,
      alertas: this.estado.alertasRecentes,
      geradoEm: new Date(),
    };
  }
}
