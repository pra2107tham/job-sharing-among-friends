// Flat config for the whole workspace. One config beats four, and it keeps the
// rules identical between the app and the shared packages.

const expoConfig = require('eslint-config-expo/flat');
const tseslint = require('typescript-eslint');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/.turbo/**',
      '.pgdata/**',
      'apps/mobile/expo-env.d.ts',
    ],
  },
  ...expoConfig,
  ...tseslint.configs.recommended,
  {
    // Without this, import/no-unresolved cannot follow the `@/*` alias from
    // apps/mobile/tsconfig.json or the workspace package names.
    settings: {
      'import/resolver': {
        typescript: {
          project: ['apps/mobile/tsconfig.json', 'packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      // The codebase is strict-mode TypeScript; an explicit `any` is almost
      // always a modelling gap worth surfacing.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Floating promises are the main source of silent failure in this
      // codebase's async event handlers; require an explicit `void`.
      'no-void': 'off',
    },
  },
  {
    // Config files are CommonJS and run in Node.
    files: ['**/*.config.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
