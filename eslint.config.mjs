import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/node_modules',
      '**/.angular',
      '**/coverage',
      // Third-party Spartan UI sub-libraries vendored under libs/ui/.
      // Each ships its own legacy `.eslintrc.json`; not in OpenBucket's
      // lint scope. EPIC-06 may revisit during the M6 CI hardening pass.
      'libs/ui/**',
      // Generated OpenAPI client (api-client:generate → openapi-generator-cli).
      // Machine-authored TS; hand-edits would be overwritten on regeneration,
      // and the api-client:check target gates its freshness instead. Excluded
      // from lint during the M6 CI hardening pass (STORY-0500/0502).
      'libs/api-client/src/lib/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?js$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
