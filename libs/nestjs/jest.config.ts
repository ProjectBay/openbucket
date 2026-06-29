export default {
  displayName: 'nestjs',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // `uuid` (v14) ships ESM-only — un-ignore so ts-jest transpiles it for Jest.
  transformIgnorePatterns: ['/node_modules/(?!uuid/)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Jest doesn't honor tsconfig paths — map the workspace alias to source.
  moduleNameMapper: {
    '^@openbucket/nestjs$': '<rootDir>/src/index.ts',
  },
  coverageDirectory: '../../coverage/libs/nestjs',
};
