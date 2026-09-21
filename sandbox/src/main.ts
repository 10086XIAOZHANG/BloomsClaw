import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SandboxModule } from './sandbox.module';

async function bootstrap() {
  const app = await NestFactory.create(SandboxModule, {
    logger: ['log', 'error', 'warn'],
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
}

void bootstrap();
