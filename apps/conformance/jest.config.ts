export default {
  displayName: 'conformance',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Conformance specs use the `.conformance.ts` suffix so they never run under
  // the unit (`*.spec.ts`) or backend e2e (`*.e2e-spec.ts`) test globs.
  testMatch: ['<rootDir>/src/**/*.conformance.ts'],
  // testcontainers pulls/boots the image: generous timeout, serial workers.
  testTimeout: 120_000,
  maxWorkers: 1,
  coverageDirectory: '../../coverage/apps/conformance',
};
