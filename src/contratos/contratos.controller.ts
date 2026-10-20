import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/// Pasta `contratos/` na raiz do projeto (vale em src/ e em dist/).
const PASTA = join(__dirname, '..', '..', 'contratos');

interface Versoes {
  atual: string;
  versoes: Array<{
    versao: string;
    data: string;
    arquivos: string[];
    alteracoes: string;
  }>;
}

const lerVersoes = (): Versoes =>
  JSON.parse(readFileSync(join(PASTA, 'versoes.json'), 'utf8')) as Versoes;

const TIPOS: Record<string, string> = {
  json: 'application/schema+json; charset=utf-8',
  yaml: 'application/yaml; charset=utf-8',
};

@ApiTags('Contratos')
@Controller('contratos')
export class ContratosController {
  @Get()
  @ApiOperation({
    summary: 'Versões publicadas do contrato canônico',
    description:
      'Histórico de versões, com os arquivos (JSON Schema e AsyncAPI) de cada uma.',
  })
  @ApiOkResponse({ description: '`{ atual, versoes[] }`' })
  @Header('Cache-Control', 'no-cache')
  versoes(): Versoes {
    return lerVersoes();
  }

  @Get(':versao/:arquivo')
  @ApiOperation({
    summary: 'Um arquivo do contrato (ex.: /contratos/v1/mensagem.schema.json)',
  })
  arquivo(
    @Param('versao') versao: string,
    @Param('arquivo') arquivo: string,
    @Res() res: Response,
  ): void {
    // Só serve o que está listado no histórico: nenhum outro caminho do disco.
    const entrada = lerVersoes().versoes.find(
      (v) => `v${v.versao.split('.')[0]}` === versao,
    );
    if (!entrada || !entrada.arquivos.includes(arquivo)) {
      throw new NotFoundException(
        `Contrato ${versao}/${arquivo} não publicado.`,
      );
    }
    const extensao = arquivo.split('.').pop() ?? '';
    res
      .type(TIPOS[extensao] ?? 'text/plain; charset=utf-8')
      .send(readFileSync(join(PASTA, versao, arquivo), 'utf8'));
  }
}
