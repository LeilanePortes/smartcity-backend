import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
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
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { defaultModelsExpandDepth: -1 },
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
