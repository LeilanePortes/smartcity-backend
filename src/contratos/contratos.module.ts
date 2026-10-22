import { Module } from '@nestjs/common';
import { ContratosController } from './contratos.controller';

/** Publica o contrato canônico (JSON Schema e AsyncAPI) por URL, com histórico de versões. */
@Module({ controllers: [ContratosController] })
export class ContratosModule {}
