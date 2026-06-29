export default {
  displayName: 'openbucket-backend',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // `uuid` (v14) ships ESM-only. Un-ignore it so ts-jest transpiles its
  // `export` syntax to CommonJS for the Jest runner (webpack handles the
  // app build natively). tsconfig.spec.json sets allowJs for this.
  transformIgnorePatterns: ['/node_modules/(?!uuid/)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/openbucket-backend',
};
