'use strict';
const { logFile } = require('./logger');

module.exports = async function globalSetup() {
  console.log(`\n📋 Log file: ${logFile}\n`);
};
