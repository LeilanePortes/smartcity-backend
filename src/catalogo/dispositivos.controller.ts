import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { tokenBearer } from './credenciais';
import { DispositivosService } from './dispositivos.service';
import {
  AtualizarDispositivoDto,
  CriarDispositivoDto,
  ListarDispositivosQuery,
} from './dto/dispositivo.dto';

const REF = { description: 'id (uuid) ou código', example: 'p-001' };

@ApiTags('Dispositivos')
@Controller('dispositivos')
export class DispositivosController {
  constructor(private readonly dispositivos: DispositivosService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista os dispositivos',
    description:
      'Filtros por domínio, perfil, local, área, conexão (online/offline pelo intervalo do perfil) e busca.',
  })
  listar(@Query() query: ListarDispositivosQuery) {
    return this.dispositivos.listar(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Cadastra um dispositivo e emite a credencial (RF-DIS-01, 02)',
  })
  @ApiCreatedResponse({
    description:
      '`{ dispositivo, credencial }`. O `credencial.token` aparece só nesta resposta.',
  })
  criar(@Body() dto: CriarDispositivoDto) {
    return this.dispositivos.criar(dto);
  }

  /// Declarada antes de `:ref` para não ser lida como um código.
  @Get('eu')
  @ApiBearerAuth('dispositivo')
  @ApiOperation({
    summary: 'O próprio dispositivo consulta o seu cadastro com o token',
    description:
      'Cabeçalho `Authorization: Bearer <token>`. Token revogado ou inválido → 401.',
  })
  @ApiUnauthorizedResponse({
    description: 'Token ausente, inválido ou revogado.',
  })
  async eu(@Headers('authorization') autorizacao?: string) {
    const token = tokenBearer(autorizacao);
    const d = token ? await this.dispositivos.autenticar(token) : null;
    if (!d) {
      throw new UnauthorizedException(
        'Credencial ausente, inválida ou revogada.',
      );
    }
    return this.dispositivos.respostaDe(d);
  }

  @Get(':ref')
  @ApiOperation({ summary: 'Detalhe de um dispositivo' })
  @ApiParam({ name: 'ref', ...REF })
  buscar(@Param('ref') ref: string) {
    return this.dispositivos.buscar(ref);
  }

  @Patch(':ref')
  @ApiOperation({ summary: 'Atualiza o cadastro (o código não muda)' })
  @ApiParam({ name: 'ref', ...REF })
  atualizar(@Param('ref') ref: string, @Body() dto: AtualizarDispositivoDto) {
    return this.dispositivos.atualizar(ref, dto);
  }

  @Post(':ref/credenciais')
  @ApiOperation({
    summary: 'Emite uma credencial nova (a anterior é revogada)',
  })
  @ApiParam({ name: 'ref', ...REF })
  emitirCredencial(@Param('ref') ref: string) {
    return this.dispositivos.emitirCredencial(ref);
  }

  @Delete(':ref/credenciais')
  @ApiOperation({
    summary: 'Revoga a credencial ativa: a próxima conexão é recusada',
  })
  @ApiParam({ name: 'ref', ...REF })
  revogarCredencial(@Param('ref') ref: string) {
    return this.dispositivos.revogarCredencial(ref);
  }
}
