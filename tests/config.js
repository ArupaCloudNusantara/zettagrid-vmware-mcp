/**
 * VCD MCP Test Suite — Configuration
 * ------------------------------------
 * Fill in the values below before running the tests.
 * All values can also be overridden via environment variables.
 *
 * Usage:
 *   export VCD_MCP_COMMAND="/path/to/vcd-mcp-server"
 *   npm test
 */

'use strict';

const path = require('path');

const config = {
  // ─── MCP Server ───────────────────────────────────────────────────────────
  // Command to launch the MCP server process (stdio transport)
  mcpCommand: process.env.VCD_MCP_COMMAND || 'node',
  mcpArgs:    (process.env.VCD_MCP_ARGS  || '/home/ubuntu/zettagrid-mcp/zettagrid-vmware-mcp/build/index.js').split(' '),
  // Working directory for the server process — must be the project root so
  // dotenv.config() finds .env and loads ZETTAGRID_API_TOKEN_* variables.
  mcpCwd:     process.env.VCD_MCP_CWD    || path.resolve(__dirname, '..'),

  // Additional environment variables passed to the MCP server process
  mcpEnv: {
    VCD_URL:      process.env.VCD_URL      || 'https://vcd.yourdomain.com',
    VCD_USERNAME: process.env.VCD_USERNAME || 'administrator@system',
    VCD_PASSWORD: process.env.VCD_PASSWORD || 'your-password',
    VCD_ORG:      process.env.VCD_ORG      || 'System',
    NODE_ENV:     'test',
  },

  // ─── Test Fixtures ────────────────────────────────────────────────────────
  // Pre-existing resources used as targets for read/power/resize operations.
  // These must exist in your VCD environment before running the tests.
  fixtures: {
    defaultZone:     process.env.TEST_DEFAULT_ZONE      || 'jakarta',
    vdcName:         process.env.TEST_VDC_NAME         || 'DC_1138718',
    orgName:         process.env.TEST_ORG_NAME         || 'Org_cloud60748',

    // A VM that is powered OFF (used for power-on, resize tests)
    vmIdOff:         process.env.TEST_VM_ID_OFF        || 'urn:vcloud:vm:0edeefb8-6a73-4807-bff1-7e0e3445daab',   // rhel-test
    // A VM that is powered ON  (used for power-off, reboot, metrics tests)
    vmIdOn:          process.env.TEST_VM_ID_ON         || 'urn:vcloud:vm:8e6d92c7-1854-4ccd-a5bd-a3b07a9f5919',   // claude-test
    // A VM with VMware Tools installed
    vmIdTools:       process.env.TEST_VM_ID_TOOLS      || 'urn:vcloud:vm:8e6d92c7-1854-4ccd-a5bd-a3b07a9f5919',   // claude-test

    // A vApp that is powered OFF (web vApp)
    vappIdOff:       process.env.TEST_VAPP_ID_OFF      || 'urn:vcloud:vapp:effbbb84-2208-4dea-95a7-b9f00d5aabc5', // web
    // A vApp that is powered ON (claude-test vApp)
    vappIdOn:        process.env.TEST_VAPP_ID_ON       || 'urn:vcloud:vapp:9e1851ef-986a-4547-a896-d17858ec5ac6', // claude-test

    // Catalog and template for vApp deployment tests
    catalogName:     process.env.TEST_CATALOG_NAME     || 'TestCatalog',
    templateName:    process.env.TEST_TEMPLATE_NAME    || 'Ubuntu-22.04-Template',

    // Edge gateway for networking tests
    edgeGatewayId:   process.env.TEST_EDGE_GW_ID       || 'urn:vcloud:gateway:xxxxxxxx',
    // Existing app port profile (e.g., HTTPS)
    appPortProfileId:process.env.TEST_APP_PORT_PROFILE || 'urn:vcloud:applicationPortProfile:HTTPS',
    // External IP on the edge gateway for NAT tests
    externalIp:      process.env.TEST_EXTERNAL_IP      || '203.0.113.10',
    // Internal VM IP for DNAT target
    internalIp:      process.env.TEST_INTERNAL_IP      || '192.168.1.100',
  },

  // ─── Timeouts ────────────────────────────────────────────────────────────
  timeouts: {
    mcpReady:    10_000,   // ms — wait for MCP server to initialise
    taskPoll:   300_000,   // ms — max wait for async VCD tasks
    taskInterval: 5_000,   // ms — poll interval for task status
    powerOp:    120_000,   // ms — max wait for VM power operations
  },

  // ─── Logging ─────────────────────────────────────────────────────────────
  logDir:   process.env.LOG_DIR || './logs',
  logLevel: process.env.LOG_LEVEL || 'info',   // 'debug' | 'info' | 'warn' | 'error'
};

module.exports = config;
