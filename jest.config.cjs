'use strict';
module.exports = {
  testTimeout:     300_000,
  testEnvironment: 'node',
  testMatch:       ['**/tests/**/*.test.js'],
  globalSetup:     './tests/jest.globalSetup.js',
  globalTeardown:  './tests/jest.globalTeardown.js',
  verbose:         true,
  // Test files MUST run serially — they share VCD fixtures (vmIdOff, vappIdOn) and
  // concurrent VCD operations conflict (task lock errors, snapshot conflicts, etc.).
  // --runInBand guarantees serial in-process execution; maxWorkers alone is insufficient.
  runInBand:       true,
  // Write structured pass/fail summary to logs/jest-results.log after every run.
  // Runs alongside the default reporter — does not suppress console output.
  reporters: ['default', './tests/jest-results-reporter.cjs'],
};
