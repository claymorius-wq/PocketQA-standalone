import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-web/**',
      '**/dist-preview/**',
      'preview-data/**',
      '.preview/**',
      '**/expo-env.d.ts',
      '**/.expo/**',
      '**/web-build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      '**/.data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly', Buffer: 'readonly', __dirname: 'readonly', fetch: 'readonly', TextEncoder: 'readonly', URLSearchParams: 'readonly', setInterval: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', clearInterval: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    // Expo config plugins are CommonJS modules loaded by the Expo CLI in Node.
    files: ['apps/mobile/plugins/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', module: 'writable' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
