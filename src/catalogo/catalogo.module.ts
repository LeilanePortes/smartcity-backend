import { Module } from '@nestjs/common';
import { CatalogoController, SitesController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';
import { DispositivosController } from './dispositivos.controller';
import { DispositivosService } from './dispositivos.service';
import { SincronizacaoPostesService } from './sincronizacao-postes.service';

/**
 * Catálogo da plataforma: inquilino → local → área → dispositivo, domínios e
 * perfis configuráveis, credenciais por dispositivo (RF-CEN-01 a 03,
 * RF-DIS-01, 02 e 06). Exporta os serviços para a ingestão autenticar e
 * enriquecer as mensagens.
 */
@Module({
  controllers: [CatalogoController, SitesController, DispositivosController],
  providers: [CatalogoService, DispositivosService, SincronizacaoPostesService],
  exports: [CatalogoService, DispositivosService],
})
export class CatalogoModule {}
