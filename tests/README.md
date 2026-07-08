# VCD MCP Server — QA Regression Test Suite

**PT Arupa Cloud Nusantara | IT Infrastructure Division**

Jest-based regression tests for the VMware Cloud Director MCP Server.
Uses the **stdio MCP transport** — the test suite spawns the MCP server as
a child process, making it fully compatible with Claude Code on Linux.

---

## Project Structure

```
vcd-mcp-tests/
├── config.js                   # ← Edit this first
├── McpClient.js                # stdio MCP JSON-RPC client
├── helpers.js                  # Polling, list utils
├── logger.js                   # Console + file logger
├── jest.globalSetup.js
├── jest.globalTeardown.js
├── package.json
└── tests/
    ├── vm-lifecycle.test.js    # UC-VM-001 to UC-VM-008
    ├── vapp-catalog.test.js    # UC-VA-001  to UC-VA-005
    ├── networking.test.js      # UC-NET-001 to UC-NET-005
    ├── monitoring.test.js      # UC-MON-001 to UC-MON-004
    └── snapshot.test.js        # UC-SNAP-001 to UC-SNAP-003
```

---

## Prerequisites

| Requirement | Detail |
|---|---|
| Node.js | ≥ 18 (tested on v22) |
| VCD MCP Server | Built and available as an executable |
| VCD Environment | At least 1 Org, VDC, vApp, and VM |
| VMware Tools | Installed in test VMs (for UC-VM-003 / 004) |

Install dependencies:

```bash
npm install
```

---

## Configuration

### Option A — Edit `config.js`

Open `config.js` and fill in the sections:

```js
mcpCommand: 'node',
mcpArgs:    ['/opt/vcd-mcp/index.js'],   // path to your MCP server entry point

mcpEnv: {
  VCD_URL:      'https://vcd.yourdomain.com',
  VCD_USERNAME: 'administrator@system',
  VCD_PASSWORD: 'your-password',
  VCD_ORG:      'System',
},

fixtures: {
  vdcName:    'TestVDC',
  vmIdOff:    'urn:vcloud:vm:xxxxxxxx-off',   // powered-off VM
  vmIdOn:     'urn:vcloud:vm:xxxxxxxx-on',    // powered-on VM
  vmIdTools:  'urn:vcloud:vm:xxxxxxxx-tools', // VM with VMware Tools
  vappIdOff:  'urn:vcloud:vapp:xxxxxxxx-off',
  vappIdOn:   'urn:vcloud:vapp:xxxxxxxx-on',
  ...
}
```

### Option B — Environment Variables

```bash
export VCD_MCP_COMMAND=node
export VCD_MCP_ARGS="/opt/vcd-mcp/index.js"
export VCD_URL=https://vcd.yourdomain.com
export VCD_USERNAME=administrator@system
export VCD_PASSWORD=secret
export TEST_VM_ID_OFF=urn:vcloud:vm:xxxxxxxx
export TEST_VM_ID_ON=urn:vcloud:vm:yyyyyyyy
export TEST_EDGE_GW_ID=urn:vcloud:gateway:zzzzzzzz
```

---

## Running Tests

### Full suite

```bash
npm test
```

### Individual domain suites

```bash
npm run test:vm          # VM Lifecycle        (UC-VM-001 to 008)
npm run test:vapp        # vApp & Catalog      (UC-VA-001 to 005)
npm run test:network     # Firewall & NAT      (UC-NET-001 to 005)
npm run test:monitor     # Monitoring          (UC-MON-001 to 004)
npm run test:snapshot    # Snapshots           (UC-SNAP-001 to 003)
```

### Run a single test by name

```bash
npx jest --runInBand --testNamePattern="UC-VM-001"
```

### Enable debug logging

```bash
LOG_LEVEL=debug npm test
```

---

## Log Files

Logs are written to `./logs/vcd-mcp-test-<timestamp>.log`.

Each log line format:
```
[2026-06-29 10:15:32] [INFO ] [vm-lifecycle] ✅ PASS  UC-VM-001      Power On a VM — state="poweredOn"
[2026-06-29 10:15:33] [ERROR] [vm-lifecycle] ❌ FAIL  UC-VM-002      Power Off a VM — timed out
```

---

## Test Order & Dependencies

Tests within each suite run **sequentially** (`--runInBand`).
Some tests depend on the state left by a previous test in the same suite:

| Suite | Dependency |
|---|---|
| `vapp-catalog` | UC-VA-001 creates a vApp; UC-VA-002/005 reuse it |
| `networking` | UC-NET-001 creates firewall rule; UC-NET-002/003 update/delete it |
| `snapshot` | UC-SNAP-001 creates snapshot; UC-SNAP-002 reverts; UC-SNAP-003 removes |

Each suite has its own `afterAll` teardown that cleans up resources it created,
even if tests fail partway through.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `MCP init timeout` | Wrong `mcpCommand` / `mcpArgs` | Check path to MCP server binary |
| `MCP error -32601` | Tool name mismatch | Verify tool names against your MCP server version |
| `Task timed out` | VCD environment slow / overloaded | Increase `timeouts.taskPoll` in `config.js` |
| `VM did not reach poweredOn` | Fixture VM ID wrong | Update `fixtures.vmIdOff` / `vmIdOn` in `config.js` |
| All tests fail immediately | Auth failure | Check `VCD_USERNAME` / `VCD_PASSWORD` / `VCD_URL` |
| `shutdown_vm` fails with tools error | VMware Tools not installed | Use a different VM for `vmIdTools` |

---

## Adding New Test Cases

1. Add the use case to the appropriate `tests/*.test.js` file.
2. Follow the pattern: `log.separator()` → `client.call()` → `log.result()` → `expect()`.
3. Use `waitForTask()` for async VCD operations.
4. Register any created resources in `created` object for teardown.
