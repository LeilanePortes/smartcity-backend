import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  info() {
    return {
      nome: 'Iluminação Pública Inteligente — API',
      cidade: 'Itaguari, GO',
      api: '/api/v1',
      docs: '/docs',
      openapi: '/docs-json',
      contratos: '/api/v1/contratos',
      tempoReal: '/tempo-real (Socket.IO)',
    };
  }
}
