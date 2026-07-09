/**
 * Unit-test config for the report emitter/renderer/recorder. These are pure,
 * Docker-free `*.spec.ts` tests — kept separate from `jest.config.ts` (the
 * testcontainers-backed `*.conformance.ts` suite) so `nx test conformance` can
 * run them in any environment.
 */
export default {
  displayName: 'conformance-unit',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  coverageDirectory: '../../coverage/apps/conformance-unit',
};
