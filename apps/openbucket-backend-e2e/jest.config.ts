export default {
  displayName: 'openbucket-backend-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/**/*.e2e-spec.ts'],
  // Spawned-process e2e: generous timeout for boot + drain windows.
  testTimeout: 60_000,
  maxWorkers: 1, // tests bind real ports; run serially to avoid clashes
  coverageDirectory: '../../coverage/apps/openbucket-backend-e2e',
};
