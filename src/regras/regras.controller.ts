import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AlarmesService } from './alarmes.service';
import { ListarAlarmesQuery, TransicaoAlarmeDto } from './dto/alarmes.dto';
import {
  AtualizarRegraDto,
  CriarRegraDto,
  ListarRegrasQuery,
} from './dto/regras.dto';
import { RegrasService } from './regras.service';

const ID = { name: 'id', format: 'uuid' };

@ApiTags('Regras')
@Controller('regras')
export class RegrasController {
  constructor(private readonly regras: RegrasService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as regras' })
  listar(@Query() query: ListarRegrasQuery) {
    return this.regras.listar(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Cria uma regra condição → ação (RF-PRO-02, RF-PRO-03)',
    description:
      'Condição de limite (com janela de tempo opcional) ou de ausência de dados; escopo por domínio, local, área, perfil ou dispositivo.',
  })
  criar(@Body() dto: CriarRegraDto) {
    return this.regras.criar(dto);
  }

  @Get(':id')
  @ApiParam(ID)
  @ApiOperation({ summary: 'Detalhe de uma regra' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.regras.buscar(id);
  }

  @Patch(':id')
  @ApiParam(ID)
  @ApiOperation({ summary: 'Atualiza uma regra (ex.: { "ativa": false })' })
  atualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarRegraDto,
  ) {
    return this.regras.atualizar(id, dto);
  }

  @Delete(':id')
  @ApiParam(ID)
  @ApiOperation({
    summary: 'Apaga a regra (os alarmes dela ficam no histórico)',
  })
  remover(@Param('id', ParseUUIDPipe) id: string) {
    return this.regras.remover(id);
  }

  @Get(':id/execucoes')
  @ApiParam(ID)
  @ApiOperation({
    summary: 'Ações executadas pela regra, com resultado e tentativas',
  })
  execucoes(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListarRegrasQuery,
  ) {
    return this.regras.execucoes(id, query);
  }
}

@ApiTags('Alarmes')
@Controller('alarmes')
export class AlarmesController {
  constructor(private readonly alarmes: AlarmesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista os alarmes (filtros por status, severidade, origem, dispositivo e regra)',
  })
  listar(@Query() query: ListarAlarmesQuery) {
    return this.alarmes.listar(query);
  }

  @Get(':id')
  @ApiParam(ID)
  @ApiOperation({ summary: 'Detalhe do alarme, com as ações executadas' })
  buscar(@Param('id', ParseUUIDPipe) id: string) {
    return this.alarmes.buscar(id);
  }

  @Post(':id/reconhecer')
  @ApiParam(ID)
  @ApiOperation({ summary: 'ATIVO → RECONHECIDO (RF-PRO-05)' })
  reconhecer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransicaoAlarmeDto,
  ) {
    return this.alarmes.reconhecer(id, dto);
  }

  @Post(':id/resolver')
  @ApiParam(ID)
  @ApiOperation({ summary: 'ATIVO ou RECONHECIDO → RESOLVIDO (RF-PRO-05)' })
  resolver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransicaoAlarmeDto,
  ) {
    return this.alarmes.resolver(id, dto);
  }
}
