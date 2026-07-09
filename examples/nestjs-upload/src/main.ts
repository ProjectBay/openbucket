import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  // The S3 endpoint, admin API, and admin console all live under `mountPath`
  // (see app.module.ts) — here that's `/storage`.
  // eslint-disable-next-line no-console
  console.log(`Upload API   →  POST http://localhost:${port}/files`);
  // eslint-disable-next-line no-console
  console.log(`Admin console →  http://localhost:${port}/storage/admin`);
}

void bootstrap();
