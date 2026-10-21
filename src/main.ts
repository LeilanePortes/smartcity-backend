import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PREFIXO_API } from './common/constants';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  // API REST versionada (RF-APP-01): tudo sob /api/v1. A raiz fica de fora
  // porque serve de ponteiro para a documentação e de verificação de saúde.
  app.setGlobalPrefix(PREFIXO_API, {
    exclude: [{ path: '/', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Iluminação Pública Inteligente — API')
    .setDescription(
      'Backend mock da rede de iluminação pública de Itaguari, GO. ' +
        'Exemplos de payload e o contrato do canal WebSocket em `docs/contrato-api.md`.',
    )
    .setVersion('1.0')
    .addTag('Postes', 'Mapa, detalhe, histórico e status dos postes')
    .addTag('KPIs', 'Indicadores agregados do dashboard')
    .addTag('Arquitetura', 'Estado das camadas edge · fog · nuvem')
    .addTag('OTA', 'Atualização remota de firmware com grupo canário')
    .addTag('Contratos', 'Contrato canônico publicado (JSON Schema e AsyncAPI)')
    .addTag('Catálogo', 'Domínios, perfis de dispositivo, locais e áreas')
    .addTag('Dispositivos', 'Cadastro, credenciais e conexão dos dispositivos')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'Token do dispositivo' },
      'dispositivo',
    )
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { defaultModelsExpandDepth: -1 },
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
