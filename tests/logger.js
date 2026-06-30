'use strict';

const fs   = require('fs');
const path = require('path');
const cfg  = require('./config');

// ── Setup log directory & file ────────────────────────────────────────────────
const logDir = path.resolve(cfg.logDir);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logFile   = path.join(logDir, `vcd-mcp-test-${timestamp}.log`);
const stream    = fs.createWriteStream(logFile, { flags: 'a' });

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const configuredLevel = LEVELS[cfg.logLevel] ?? 1;

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function ts() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function write(level, tag, msg) {
  if (LEVELS[level] < configuredLevel) return;
  const line = `[${ts()}] [${level.toUpperCase().padEnd(5)}] [${tag}] ${msg}`;
  stream.write(line + '\n');
  // Console colouring
  const colours = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
  console.log(`${colours[level] || ''}${line}\x1b[0m`);
}

function makeLogger(tag) {
  return {
    debug: (m) => write('debug', tag, m),
    info:  (m) => write('info',  tag, m),
    warn:  (m) => write('warn',  tag, m),
    error: (m) => write('error', tag, m),
    separator: (label = '') => {
      const line = '─'.repeat(60);
      write('info', tag, label ? `┌─ ${label} ${'─'.repeat(Math.max(0, 56 - label.length))}` : line);
    },
    result: (ucId, title, passed, detail = '') => {
      const status = passed ? '✅ PASS' : '❌ FAIL';
      write(passed ? 'info' : 'error', tag,
        `${status}  ${ucId.padEnd(14)} ${title}${detail ? ' — ' + detail : ''}`);
    },
  };
}

module.exports = { makeLogger, logFile };
