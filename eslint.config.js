import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Packages the inner layers (domain, application) must not import. */
const FRAMEWORKS = [
  'fastify',
  '@fastify/*',
  'drizzle-orm',
  'drizzle-orm/*',
  'postgres',
  'zod',
  'resend',
  '@heloc/contracts',
  '@heloc/server-kit',
  '@heloc/config',
  '@heloc/logger',
];
const OUTER_LAYERS_FROM_APPLICATION = ['**/infrastructure/**', '**/interface/**', '**/app.ts'];
const OUTER_LAYERS_FROM_DOMAIN = ['**/application/**', ...OUTER_LAYERS_FROM_APPLICATION];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/.next/',
      '**/next-env.d.ts',
      '**/drizzle/',
      '.claude/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  // DDD layering (docs/DEV-PLAN.md §2.4): dependencies point inward only.
  {
    files: ['apps/*/src/domain/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: OUTER_LAYERS_FROM_DOMAIN, message: 'domain must not depend on outer layers.' },
            { group: FRAMEWORKS, message: 'domain must stay framework-free.' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/*/src/application/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: OUTER_LAYERS_FROM_APPLICATION,
              message: 'application may depend on domain only; adapters live in infrastructure.',
            },
            { group: FRAMEWORKS, message: 'application must stay framework-free.' },
          ],
        },
      ],
    },
  },
  {
    // Config is loaded and validated once in main.ts (see docs/CONFIGURATION.md §4.1);
    // everything else receives it via injection.
    files: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    ignores: ['**/main.ts', '**/*.test.ts', 'packages/config/**', 'apps/web/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read env via @heloc/config in main.ts and inject the config object.',
        },
      ],
    },
  },
);
