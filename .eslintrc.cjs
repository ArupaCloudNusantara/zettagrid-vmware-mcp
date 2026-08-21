module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: [
    'build/', 'node_modules/', 'scripts/', 'tests/',
    // Not in tsconfig.json's include list and not imported anywhere in src/ — dead code,
    // same situation as the firewall managers deleted 2026-08-07 (commit 8b119b6). Flagged,
    // not deleted here; lint shouldn't fail on code that isn't even part of the build.
    'src/managers/vm-creator.ts',
  ],
  rules: {
    // TypeScript's own compiler (noUnusedLocals/noUnusedParameters, strict mode) already
    // enforces the correctness-critical subset of these; keep ESLint focused on catching
    // real bugs (recommended set) rather than re-litigating style already covered elsewhere.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-unused-vars': ['error', {
      // Matches the codebase's existing convention (e.g. _pagination, _network) for
      // deliberately-unused parameters, and the many intentional catch (error) { ... }
      // blocks that swallow an error without inspecting it.
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrors: 'none',
    }],
  },
};
