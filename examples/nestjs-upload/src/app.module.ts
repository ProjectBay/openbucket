import { Module } from '@nestjs/common';
import { OpenBucketModule } from '@openbucket/nestjs';
import { BucketBootstrap } from './app.bootstrap';
import { FilesController } from './files.controller';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value === 'REPLACE_ME') {
    throw new Error(
      `Missing env var ${name}. Copy .env.example → .env and fill in the secrets ` +
        `(see the README).`,
    );
  }
  return value;
}

@Module({
  imports: [
    OpenBucketModule.forRoot({
      // SQLite metadata + blob payloads live here (gitignored).
      dataDir: './.openbucket-data',
      // The S3 endpoint + admin console mount under this prefix:
      //   S3 API       → http://localhost:3000/storage
      //   Admin console → http://localhost:3000/storage/admin
      mountPath: '/storage',
      rootCredentials: {
        accessKeyId: required('OB_ACCESS_KEY_ID'),
        secretAccessKey: required('OB_SECRET_ACCESS_KEY'),
      },
      admin: {
        username: 'admin',
        passwordHash: required('OB_ADMIN_HASH'),
        jwtSecret: required('OB_JWT_SECRET'),
        serveUi: true,
      },
    }),
  ],
  controllers: [FilesController],
  providers: [BucketBootstrap],
})
export class AppModule {}
