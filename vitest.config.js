import { defineConfig } from 'vitest/config';

// Tests pick their own environment via per-file `// @vitest-environment jsdom`
// directives, so no global `environment` is set here — only coverage config.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      reportsDirectory: './coverage',
      // Measure first-party application source only.
      include: ['src/**/*.{js,mjs}'],
      exclude: [
        'src/lib/**', // vendored third-party bundles
        'src/gll.bundle.js', // generated esbuild bundle
        'src/package/**', // build/packaging scripts, not app logic
        'src/**/*_prompt.js', // generated prompt strings
      ],
      // No hard thresholds yet: large rendering/UI modules are still untested.
      // Treat the reported number as a baseline to raise over time.
    },
  },
});
