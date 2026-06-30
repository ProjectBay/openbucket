const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

// Externalize every declared third-party dependency EXCEPT the workspace library
// `@openbucket/nestjs`, which must be INLINED into the bundle (resolved from source
// via the tsconfig path). Once libs/nestjs became an npm workspace package it landed
// in node_modules, so Nx's default `externalDependencies: 'all'` emitted a runtime
// `require('@openbucket/nestjs')` that resolves to the package's uncompiled
// `src/index.js` (only `src/index.ts` exists in the source tree) and crashed the
// standalone app at startup. Bundling it keeps `main.js` self-contained; native deps
// (better-sqlite3, argon2, …) stay external because they remain in this list.
const externalDependencies = Object.keys(require('./package.json').dependencies).filter(
  (dep) => dep !== '@openbucket/nestjs',
);

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/openbucket-backend'),
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      externalDependencies,
      sourceMaps: true,
    }),
  ],
};
