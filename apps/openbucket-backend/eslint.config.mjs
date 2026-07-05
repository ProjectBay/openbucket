import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    languageOptions: {
      parser: (await import('jsonc-eslint-parser')).default,
    },
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs}',
            // Build-only config; its `@nx/webpack` require is not a runtime dep
            // and must not be promoted into the generated prod package.json.
            '{projectRoot}/webpack.config.js',
          ],
          // Runtime deps of the bundled @openbucket/nestjs lib: the app's source
          // no longer imports these directly (the lib does), but webpack inlines
          // the lib into main.js so they must stay installed at runtime. Kept in
          // this package.json so the Docker prod install resolves them. (Phase 6
          // moves them to the lib's package.json + verifies the bundle scan
          // re-adds them to the generated prod package.json.)
          ignoredDependencies: [
            '@aws-sdk/client-s3',
            '@aws-sdk/lib-storage',
            '@aws-sdk/s3-request-presigner',
            '@mikro-orm/libsql',
            '@mikro-orm/migrations',
            '@mikro-orm/nestjs',
            '@nestjs/common',
            '@nestjs/config',
            '@nestjs/event-emitter',
            '@nestjs/jwt',
            '@nestjs/passport',
            '@nestjs/throttler',
            'argon2',
            'busboy',
            'fast-xml-parser',
            'image-size',
            'passport-jwt',
            'prom-client',
            'rxjs',
            'sharp',
            'uuid',
            'zod',
          ],
        },
      ],
    },
  },
];
