'use strict';

/**
 * McpClient — lightweight stdio MCP client for Jest tests.
 *
 * Protocol: JSON-RPC 2.0 over stdin/stdout (MCP stdio transport).
 * Each request is a newline-delimited JSON object; each response
 * is a newline-delimited JSON object returned on stdout.
 *
 * Usage:
 *   const client = new McpClient();
 *   await client.connect();
 *   const result = await client.call('list_vms', { vdcId: '...' });
 *   await client.disconnect();
 */

const { spawn }   = require('child_process');
const EventEmitter = require('events');
const cfg          = require('./config');
const { makeLogger } = require('./logger');

const log = makeLogger('McpClient');

class McpClient extends EventEmitter {
  constructor() {
    super();
    this._proc    = null;
    this._pending = new Map();   // id → { resolve, reject, timer }
    this._idSeq   = 1;
    this._buf     = '';
    this._ready   = false;
  }

  // ── Connect ─────────────────────────────────────────────────────────────
  connect() {
    return new Promise((resolve, reject) => {
      log.info(`Spawning MCP server: ${cfg.mcpCommand} ${cfg.mcpArgs.join(' ')}`);

      this._proc = spawn(cfg.mcpCommand, cfg.mcpArgs, {
        env:   { ...process.env, ...cfg.mcpEnv },
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd:   cfg.mcpCwd,
      });

      this._proc.stderr.on('data', (d) => {
        log.debug(`[stderr] ${d.toString().trim()}`);
      });

      this._proc.stdout.on('data', (chunk) => {
        this._buf += chunk.toString();
        let nl;
        while ((nl = this._buf.indexOf('\n')) !== -1) {
          const line = this._buf.slice(0, nl).trim();
          this._buf  = this._buf.slice(nl + 1);
          if (!line) continue;
          try {
            this._handleMessage(JSON.parse(line));
          } catch (e) {
            log.warn(`Unparse-able stdout line: ${line}`);
          }
        }
      });

      this._proc.on('error', (err) => {
        log.error(`Process error: ${err.message}`);
        reject(err);
      });

      this._proc.on('exit', (code, sig) => {
        log.info(`MCP server exited (code=${code}, signal=${sig})`);
        for (const [, p] of this._pending) {
          clearTimeout(p.timer);
          p.reject(new Error(`MCP server exited with code ${code}`));
        }
        this._pending.clear();
      });

      // Send MCP initialise handshake
      const initTimeout = setTimeout(() => reject(new Error('MCP init timeout')), cfg.timeouts.mcpReady);

      this._sendRaw({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'vcd-mcp-jest', version: '1.0.0' },
        },
      });

      this.once('_init_ok', () => {
        clearTimeout(initTimeout);
        // Send initialized notification
        this._sendRaw({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
        this._ready = true;
        log.info('MCP handshake complete — server ready');
        resolve();
      });

      this.once('_init_err', (err) => {
        clearTimeout(initTimeout);
        reject(err);
      });
    });
  }

  // ── Disconnect ───────────────────────────────────────────────────────────
  disconnect() {
    if (this._proc && !this._proc.killed) {
      this._proc.stdin.end();
      this._proc.kill('SIGTERM');
    }
    this._ready = false;
    log.info('MCP client disconnected');
  }

  // ── Call a tool ──────────────────────────────────────────────────────────
  /**
   * @param {string} toolName  — MCP tool name (e.g. 'list_vms')
   * @param {object} args      — tool arguments
   * @param {number} [timeout] — override timeout in ms
   * @returns {Promise<object>} parsed tool result content
   */
  call(toolName, args = {}, timeout = 60_000) {
    if (!this._ready) throw new Error('McpClient not connected');
    return new Promise((resolve, reject) => {
      const id = this._idSeq++;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Tool call "${toolName}" timed out after ${timeout}ms`));
      }, timeout);

      this._pending.set(id, { resolve, reject, timer, toolName });
      log.debug(`→ call #${id} tools/call ${toolName} ${JSON.stringify(args)}`);

      this._sendRaw({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      });
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  _sendRaw(obj) {
    if (!this._proc || this._proc.killed) throw new Error('MCP process not running');
    this._proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  _handleMessage(msg) {
    // Init response
    if (msg.id === 0) {
      if (msg.error) this.emit('_init_err', new Error(msg.error.message));
      else           this.emit('_init_ok');
      return;
    }

    const pending = this._pending.get(msg.id);
    if (!pending) { log.debug(`Unmatched response id=${msg.id}`); return; }

    clearTimeout(pending.timer);
    this._pending.delete(msg.id);

    if (msg.error) {
      log.error(`← error #${msg.id} [${pending.toolName}]: ${JSON.stringify(msg.error)}`);
      pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
      return;
    }

    // Parse content array → first text block
    const content = msg.result?.content ?? msg.result ?? {};
    let parsed = content;
    if (Array.isArray(content)) {
      const text = content.find(b => b.type === 'text');
      if (text) {
        try { parsed = JSON.parse(text.text); }
        catch { parsed = text.text; }
      }
    }
    log.debug(`← reply #${msg.id} [${pending.toolName}]: ${JSON.stringify(parsed).slice(0, 200)}`);
    pending.resolve(parsed);
  }
}

module.exports = McpClient;
