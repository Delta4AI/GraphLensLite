import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

// Flat config. Vendored/generated/build artifacts are not linted. Rules are
// tuned so the existing codebase passes clean; correctness-risk patterns are
// errors, stylistic noise is downgraded to warnings.
export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'src/lib/**', // vendored third-party bundles
      'src/gll.bundle.js', // generated esbuild bundle
      'src/gll.bundle.js.map',
      'src/**/*_prompt.js', // generated prompt strings
      'manuscript/**',
      'scripts/fixtures/**',
    ],
  },

  js.configs.recommended,

  // Browser-side application source (ES modules).
  {
    files: ['src/**/*.{js,mjs}'],
    ignores: ['src/package/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': 'off',
    },
  },

  // Node-side code: Electron main, build/packaging scripts, dev server, tooling.
  {
    files: [
      'src/package/**/*.{js,mjs}',
      'server/**/*.{js,mjs}',
      'scripts/**/*.{js,mjs}',
      '*.config.js',
      '*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      'no-console': 'off',
    },
  },

  // CommonJS files in src/package use require()/module.exports.
  {
    files: ['src/package/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // Vitest test suites (jsdom or node per-file).
  {
    files: ['tests/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
    },
  },

  // Turn off rules that conflict with Prettier formatting.
  prettier,
];
