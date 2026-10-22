import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  PayloadTooLargeException,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { tokenBearer } from '../catalogo/credenciais';
import { DispositivosService } from '../catalogo/dispositivos.service';
import { ListarInvalidasQuery } from './dto/listar-invalidas.query';
import { InvalidasService } from './invalidas.service';
import { Origem, PipelineService } from './pipeline.service';

/// Tamanho máximo de um lote (RF-ING-03 pede 5.000 numa requisição).
export const TAMANHO_MAXIMO_LOTE = 5_000;

const EXEMPLO = {
  versao: '1.0',
  id_mensagem: '0b5c3a2e-6f0d-4a8e-9a57-2d1f1b6c9e41',
  dispositivo: 'medidor-centro',
  tipo: 'telemetria',
  timestamp: '2026-10-21T20:00:00Z',
  medidas: [
    { grandeza: 'potencia', valor: 12.4, unidade: 'kW' },
    { grandeza: 'tensao', valor: 221, unidade: 'V' },
  ],
};

@ApiTags('Ingestão')
@Controller('ingestao')
export class IngestaoHttpController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly dispositivos: DispositivosService,
    private readonly invalidas: InvalidasService,
  ) {}

  /** Autenticar: o token do cabeçalho identifica o dispositivo (RF-DIS-02). */
  private async origem(
    autorizacao: string | undefined,
    canal: 'http' | 'lote',
  ): Promise<Origem> {
    const token = tokenBearer(autorizacao);
    const d = token ? await this.dispositivos.autenticar(token) : null;
    if (!d) {
      throw new UnauthorizedException(
        'Credencial ausente, inválida ou revogada.',
      );
    }
    return {
      canal,
      inquilino: d.inquilino.slug,
      dispositivoAutenticado: d.codigo,
    };
  }

  @Post()
  @HttpCode(202)
  @ApiBearerAuth('dispositivo')
  @ApiOperation({
    summary: 'Recebe uma mensagem canônica por HTTP (RF-ING-02)',
    description:
      'Cabeçalho `Authorization: Bearer <token do dispositivo>`. A mensagem segue o JSON Schema da sua versão (`/api/v1/contratos`).',
  })
  @ApiBody({ schema: { type: 'object', example: EXEMPLO } })
  @ApiResponse({
    status: 202,
    description: '`{ status: "aceita" | "duplicada", id_mensagem, atrasada }`',
  })
  @ApiResponse({
    status: 400,
    description:
      'Fora do esquema: `{ message, etapa, erros[] }` (vai para a fila de inválidas).',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou revogado.',
  })
  @ApiResponse({ status: 403, description: 'Mensagem de outro dispositivo.' })
  async receber(
    @Body() corpo: unknown,
    @Headers('authorization') autorizacao?: string,
  ) {
    const origem = await this.origem(autorizacao, 'http');
    const [r] = await this.pipeline.processar([corpo], origem);
    if (r.status === 'recusada') {
      const erro = {
        message: r.motivo,
        etapa: r.etapa,
        erros: r.erros,
      };
      throw r.etapa === 'autenticar'
        ? new ForbiddenException({
            ...erro,
            error: 'Forbidden',
            statusCode: 403,
          })
        : new BadRequestException({
            ...erro,
            error: 'Bad Request',
            statusCode: 400,
          });
    }
    return {
      status: r.status,
      id_mensagem: r.id_mensagem,
      atrasada: r.atrasada ?? false,
    };
  }

  @Post('lote')
  @HttpCode(200)
  @ApiBearerAuth('dispositivo')
  @ApiOperation({
    summary:
      'Recebe um lote de mensagens, com resultado por mensagem (RF-ING-03)',
    description: `Corpo: array de mensagens canônicas ou \`{ "mensagens": [...] }\`, até ${TAMANHO_MAXIMO_LOTE}. As válidas são gravadas mesmo que outras sejam recusadas.`,
  })
  @ApiBody({ schema: { type: 'object', example: { mensagens: [EXEMPLO] } } })
  @ApiResponse({
    status: 200,
    description:
      '`{ total, aceitas, duplicadas, recusadas, resultados[] }` — um resultado por mensagem, na ordem enviada.',
  })
  async receberLote(
    @Body() corpo: unknown,
    @Headers('authorization') autorizacao?: string,
  ) {
    const origem = await this.origem(autorizacao, 'lote');
    const mensagens = Array.isArray(corpo)
      ? corpo
      : (corpo as { mensagens?: unknown })?.mensagens;
    if (!Array.isArray(mensagens) || !mensagens.length) {
      throw new BadRequestException(
        'Envie um array de mensagens ou { "mensagens": [...] } com pelo menos uma.',
      );
    }
    if (mensagens.length > TAMANHO_MAXIMO_LOTE) {
      throw new PayloadTooLargeException(
        `Lote com ${mensagens.length} mensagens; o máximo é ${TAMANHO_MAXIMO_LOTE}.`,
      );
    }
    const resultados = await this.pipeline.processar(mensagens, origem);
    const contar = (s: string) =>
      resultados.filter((r) => r.status === s).length;
    return {
      total: resultados.length,
      aceitas: contar('aceita'),
      duplicadas: contar('duplicada'),
      recusadas: contar('recusada'),
      resultados,
    };
  }

  @Get('invalidas')
  @ApiOperation({
    summary:
      'Fila de mensagens inválidas (DLQ), com a etapa e o motivo (RF-ING-06)',
  })
  listarInvalidas(@Query() query: ListarInvalidasQuery) {
    return this.invalidas.listar(query);
  }
}
