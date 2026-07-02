'use strict';
/**
 * Jest reporter that writes a structured summary to logs/jest-results.log.
 * Records every test() block result (passed/failed/skipped) plus failure details.
 * Runs alongside the default reporter — does not replace console output.
 */
const fs   = require('fs');
const path = require('path');

const LOG_DIR   = path.resolve(__dirname, '../logs');
const timestamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
const RESULT_FILE = path.join(LOG_DIR, `jest-results-${timestamp}.log`);

class ResultsReporter {
  onRunComplete(_contexts, results) {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    const lines = [];
    const now   = new Date().toISOString().replace('T', ' ').slice(0, 19);

    lines.push(`Jest run: ${now}`);
    lines.push('='.repeat(70));

    results.testResults.forEach(suite => {
      const file = path.relative(process.cwd(), suite.testFilePath);
      const suiteStatus = suite.numFailingTests === 0 ? 'PASS' : 'FAIL';
      lines.push(`\n[${suiteStatus}] ${file}`);

      suite.testResults.forEach(t => {
        const icon = t.status === 'passed'  ? '  ✓'
                   : t.status === 'failed'  ? '  ✕'
                   : '  ○';   // pending/skipped
        lines.push(`${icon} ${t.fullName} (${t.duration ?? 0}ms)`);
        if (t.status === 'failed') {
          t.failureMessages.forEach(msg => {
            // Include first 3 lines of the failure (error message + call site)
            msg.split('\n').slice(0, 3).forEach(l => lines.push(`      ${l.trim()}`));
          });
        }
      });
    });

    lines.push('\n' + '='.repeat(70));
    lines.push(`Test Suites: ${results.numPassedTestSuites} passed, ${results.numFailedTestSuites} failed, ${results.numTotalTestSuites} total`);
    lines.push(`Tests:       ${results.numPassedTests} passed, ${results.numFailedTests} failed, ${results.numPendingTests} skipped, ${results.numTotalTests} total`);
    lines.push(`Time:        ${((results.testResults.reduce((s, r) => s + (r.perfStats?.end - r.perfStats?.start), 0)) / 1000).toFixed(1)}s`);
    lines.push(`Result:      ${results.numFailedTests === 0 ? 'ALL PASSED' : results.numFailedTests + ' FAILED'}`);

    fs.writeFileSync(RESULT_FILE, lines.join('\n') + '\n');
  }
}

module.exports = ResultsReporter;
