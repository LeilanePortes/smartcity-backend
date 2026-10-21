import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CatalogoService } from './catalogo.service';
import {
  CriarDominioDto,
  CriarLocalDto,
  CriarPerfilDto,
  ListarCatalogoQuery,
} from './dto/catalogo.dto';

const REF = { description: 'id (uuid) ou slug', example: 'iluminacao' };

@ApiTags('Catálogo')
@Controller('catalogo')
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Get('dominios')
  @ApiOperation({ summary: 'Lista os domínios do catálogo do inquilino' })
  listarDominios(@Query() query: ListarCatalogoQuery) {
    return this.catalogo.listarDominios(query);
  }

  @Post('dominios')
  @ApiOperation({
    summary: 'Cria um domínio novo, sem alteração de código (RF-CEN-01)',
  })
  @ApiCreatedResponse({
    description: 'Domínio criado. 409 se o slug já existe.',
  })
  criarDominio(@Body() dto: CriarDominioDto) {
    return this.catalogo.criarDominio(dto);
  }

  @Get('dominios/:ref')
  @ApiOperation({ summary: 'Detalhe de um domínio' })
  @ApiParam({ name: 'ref', ...REF })
  buscarDominio(@Param('ref') ref: string) {
    return this.catalogo.buscarDominio(ref);
  }

  @Get('perfis')
  @ApiOperation({ summary: 'Lista os perfis de dispositivo' })
  listarPerfis(@Query() query: ListarCatalogoQuery) {
    return this.catalogo.listarPerfis(query);
  }

  @Post('perfis')
  @ApiOperation({
    summary:
      'Cria um perfil: grandezas, unidades, faixa válida e intervalo de envio (RF-CEN-02)',
  })
  @ApiCreatedResponse({
    description: 'Perfil criado. 409 se o slug já existe.',
  })
  criarPerfil(@Body() dto: CriarPerfilDto) {
    return this.catalogo.criarPerfil(dto);
  }

  @Get('perfis/:ref')
  @ApiOperation({ summary: 'Detalhe de um perfil' })
  @ApiParam({ name: 'ref', ...REF, example: 'luminaria-led' })
  buscarPerfil(@Param('ref') ref: string) {
    return this.catalogo.buscarPerfil(ref);
  }
}

@ApiTags('Catálogo')
@Controller('sites')
export class SitesController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista os locais (sites) do inquilino, com geometria GeoJSON',
  })
  listar(@Query() query: ListarCatalogoQuery) {
    return this.catalogo.listarSites(query);
  }

  @Post()
  @ApiOperation({ summary: 'Cria um local (bairro, fazenda...) (RF-CEN-03)' })
  criar(@Body() dto: CriarLocalDto) {
    return this.catalogo.criarSite(dto);
  }

  @Get(':ref')
  @ApiOperation({ summary: 'Detalhe de um local' })
  @ApiParam({ name: 'ref', ...REF, example: 'centro' })
  buscar(@Param('ref') ref: string) {
    return this.catalogo.buscarSite(ref);
  }

  @Get(':ref/areas')
  @ApiOperation({ summary: 'Lista as áreas de um local, com geometria' })
  @ApiParam({ name: 'ref', ...REF, example: 'centro' })
  listarAreas(@Param('ref') ref: string, @Query() query: ListarCatalogoQuery) {
    return this.catalogo.listarAreas(ref, query);
  }

  @Post(':ref/areas')
  @ApiOperation({ summary: 'Cria uma área (rua, praça, talhão...) no local' })
  @ApiParam({ name: 'ref', ...REF, example: 'centro' })
  criarArea(@Param('ref') ref: string, @Body() dto: CriarLocalDto) {
    return this.catalogo.criarArea(ref, dto);
  }
}
