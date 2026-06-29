'use strict';
/**
 * VM Lifecycle Test Suite
 * Covers: UC-VM-001 through UC-VM-015
 * - Power on/off, shutdown, reboot, hard reset
 * - CPU, RAM, disk resize
 * - CPU/memory hot-add (enable + use)
 * - Hot-add and resize guard rails (reduce, 3 GB boundary, disk shrink)
 */

const McpClient = require('../McpClient');
const cfg       = require('../config');
const { makeLogger } = require('../logger');
const { waitForTask, waitForVmPower, toArray, get } = require('../helpers');

const log = makeLogger('vm-lifecycle');
let client;

beforeAll(async () => {
  log.separator('VM Lifecycle Suite — Setup');
  client = new McpClient();
  await client.connect();
});

afterAll(async () => {
  if (client) client.disconnect();
  log.separator('VM Lifecycle Suite — Teardown complete');
});

// ─── UC-VM-001: Power On ───────────────────────────────────────────────────
describe('UC-VM-001 — Power On a Virtual Machine', () => {
  const UC = 'UC-VM-001';

  test('list_vms returns at least one VM', async () => {
    log.separator(UC + ': list_vms');
    const result = await client.call('list_vms', {});
    const vms = toArray(result);
    log.result(UC, 'list_vms returns VMs', vms.length > 0, `count=${vms.length}`);
    expect(vms.length).toBeGreaterThan(0);
  });

  test('power_on_vm succeeds for a powered-off VM', async () => {
    log.separator(UC + ': power_on_vm');
    const vmId = cfg.fixtures.vmIdOff;
    const result = await client.call('power_on_vm', { vmId }, cfg.timeouts.powerOp);
    log.debug(`power_on_vm response: ${JSON.stringify(result)}`);
    // Accept immediate success or a taskId to poll
    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) {
      await waitForTask(client, taskId, cfg.timeouts.powerOp);
    }
    log.result(UC, 'power_on_vm call completed', true);
    expect(result).toBeTruthy();
  });

  test('VM power state is poweredOn after operation', async () => {
    log.separator(UC + ': verify poweredOn');
    const vmId = cfg.fixtures.vmIdOff;
    const vm = await waitForVmPower(client, vmId, 'poweredOn');
    const state = (vm?.status || vm?.powerState || '').toLowerCase();
    log.result(UC, 'VM is poweredOn', state.includes('poweredon') || state.includes('powered_on'),
      `state="${state}"`);
    expect(state).toMatch(/poweredon|powered_on|on/i);
  });
});

// ─── UC-VM-002: Power Off ──────────────────────────────────────────────────
describe('UC-VM-002 — Power Off a Virtual Machine', () => {
  const UC = 'UC-VM-002';

  test('power_off_vm succeeds for a powered-on VM', async () => {
    log.separator(UC + ': power_off_vm');
    const vmId = cfg.fixtures.vmIdOn;
    const result = await client.call('power_off_vm', { vmId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'power_off_vm call completed', true);
    expect(result).toBeTruthy();
  });

  test('VM power state is poweredOff after operation', async () => {
    log.separator(UC + ': verify poweredOff');
    const vmId = cfg.fixtures.vmIdOn;
    const vm = await waitForVmPower(client, vmId, 'poweredOff');
    const state = (vm?.status || vm?.powerState || '').toLowerCase();
    log.result(UC, 'VM is poweredOff', state.includes('poweredoff') || state.includes('powered_off'),
      `state="${state}"`);
    expect(state).toMatch(/poweredoff|powered_off|off/i);
  });
});

// ─── UC-VM-003: Graceful Shutdown ─────────────────────────────────────────
describe('UC-VM-003 — Graceful VM Shutdown via Guest OS', () => {
  const UC = 'UC-VM-003';

  test('shutdown_vm call is accepted', async () => {
    log.separator(UC + ': shutdown_vm');
    const vmId = cfg.fixtures.vmIdTools;
    let result;
    try {
      result = await client.call('shutdown_vm', { vmId }, cfg.timeouts.powerOp);
      log.result(UC, 'shutdown_vm accepted', true);
      expect(result).toBeTruthy();
    } catch (e) {
      // Some VCD versions reject if VMware Tools not found — log as warning
      log.warn(`shutdown_vm returned error: ${e.message}`);
      expect(e.message).toMatch(/tools|guest/i);  // expected error type
    }
  });

  test('VM reaches poweredOff state within timeout', async () => {
    log.separator(UC + ': verify shutdown complete');
    const vmId = cfg.fixtures.vmIdTools;
    try {
      const vm = await waitForVmPower(client, vmId, 'poweredOff', cfg.timeouts.powerOp);
      const state = (vm?.status || vm?.powerState || '').toLowerCase();
      log.result(UC, 'VM reached poweredOff', true, `state="${state}"`);
      expect(state).toMatch(/poweredoff|powered_off|off/i);
    } catch (e) {
      log.warn(`VM may not have shut down cleanly: ${e.message}`);
      throw e;
    }
  });
});

// ─── UC-VM-004: Reboot ────────────────────────────────────────────────────
describe('UC-VM-004 — Reboot a Virtual Machine', () => {
  const UC = 'UC-VM-004';

  test('reboot_vm call is accepted', async () => {
    log.separator(UC + ': reboot_vm');
    // Ensure VM is on first
    await client.call('power_on_vm', { vmId: cfg.fixtures.vmIdTools }, cfg.timeouts.powerOp);
    await waitForVmPower(client, cfg.fixtures.vmIdTools, 'poweredOn');

    const result = await client.call('reboot_vm', { vmId: cfg.fixtures.vmIdTools }, cfg.timeouts.powerOp);
    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'reboot_vm accepted', true);
    expect(result).toBeTruthy();
  });

  test('VM returns to poweredOn after reboot', async () => {
    log.separator(UC + ': verify reboot complete');
    const vm = await waitForVmPower(client, cfg.fixtures.vmIdTools, 'poweredOn', cfg.timeouts.powerOp);
    const state = (vm?.status || vm?.powerState || '').toLowerCase();
    log.result(UC, 'VM is poweredOn post-reboot', state.includes('poweredon'), `state="${state}"`);
    expect(state).toMatch(/poweredon|on/i);
  });
});

// ─── UC-VM-005: Hard Reset ────────────────────────────────────────────────
describe('UC-VM-005 — Hard Reset a Virtual Machine', () => {
  const UC = 'UC-VM-005';

  test('reset_vm call completes without error', async () => {
    log.separator(UC + ': reset_vm');
    const vmId = cfg.fixtures.vmIdOn;
    await client.call('power_on_vm', { vmId }, cfg.timeouts.powerOp);
    await waitForVmPower(client, vmId, 'poweredOn');

    const result = await client.call('reset_vm', { vmId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'reset_vm completed', true);
    expect(result).toBeTruthy();
  });

  test('VM returns to poweredOn after hard reset', async () => {
    log.separator(UC + ': verify post-reset state');
    const vm = await waitForVmPower(client, cfg.fixtures.vmIdOn, 'poweredOn', cfg.timeouts.powerOp);
    const state = (vm?.status || vm?.powerState || '').toLowerCase();
    log.result(UC, 'VM poweredOn after hard reset', state.includes('poweredon'), `state="${state}"`);
    expect(state).toMatch(/poweredon|on/i);
  });
});

// ─── UC-VM-006: Resize CPU ────────────────────────────────────────────────
describe('UC-VM-006 — Resize VM CPU', () => {
  const UC = 'UC-VM-006';
  let originalCpu;

  test('get_vm returns current CPU count', async () => {
    log.separator(UC + ': get_vm');
    const vmId = cfg.fixtures.vmIdOff;
    // Ensure powered off
    await client.call('power_off_vm', { vmId }, cfg.timeouts.powerOp).catch(() => {});
    await waitForVmPower(client, vmId, 'poweredOff').catch(() => {});

    const vm = await client.call('get_vm', { vmId });
    originalCpu = get(vm, 'cpuCount') || get(vm, 'hardware', 'cpu', 'count') || 2;
    log.result(UC, `get_vm CPU count`, true, `cpuCount=${originalCpu}`);
    expect(originalCpu).toBeGreaterThan(0);
  });

  test('update_vm_cpu changes the CPU count', async () => {
    log.separator(UC + ': update_vm_cpu');
    const vmId = cfg.fixtures.vmIdOff;
    const newCpu = originalCpu + 2;
    const result = await client.call('update_vm_cpu', { vmId, cpuCount: newCpu });
    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId);
    log.result(UC, `update_vm_cpu to ${newCpu}`, true);
    expect(result).toBeTruthy();
  });

  test('get_vm reflects updated CPU count', async () => {
    log.separator(UC + ': verify CPU update');
    const vmId  = cfg.fixtures.vmIdOff;
    const newCpu = originalCpu + 2;
    const vm    = await client.call('get_vm', { vmId });
    const actual = get(vm, 'cpuCount') || get(vm, 'hardware', 'cpu', 'count');
    log.result(UC, 'CPU count updated in VCD', actual === newCpu, `expected=${newCpu} actual=${actual}`);
    expect(actual).toBe(newCpu);
  });
});

// ─── UC-VM-007: Resize RAM ────────────────────────────────────────────────
describe('UC-VM-007 — Resize VM Memory (RAM)', () => {
  const UC = 'UC-VM-007';
  const TARGET_RAM_MB = 4096;
  let originalRam;

  test('get_vm returns current memory in MB', async () => {
    log.separator(UC + ': get_vm');
    const vmId = cfg.fixtures.vmIdOff;
    const vm   = await client.call('get_vm', { vmId });
    originalRam = get(vm, 'memoryMB') || get(vm, 'hardware', 'memory', 'sizeMb') || 2048;
    log.result(UC, `get_vm RAM`, true, `currentRam=${originalRam}MB`);
    expect(originalRam).toBeGreaterThan(0);
  });

  test('update_vm_memory changes RAM allocation', async () => {
    log.separator(UC + ': update_vm_memory');
    const vmId  = cfg.fixtures.vmIdOff;
    const result = await client.call('update_vm_memory', { vmId, memoryMb: TARGET_RAM_MB });
    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId);
    log.result(UC, `update_vm_memory to ${TARGET_RAM_MB}MB`, true);
    expect(result).toBeTruthy();
  });

  test('get_vm reflects updated memory', async () => {
    log.separator(UC + ': verify RAM update');
    const vmId  = cfg.fixtures.vmIdOff;
    const vm    = await client.call('get_vm', { vmId });
    const actual = get(vm, 'memoryMB') || get(vm, 'hardware', 'memory', 'sizeMb');
    log.result(UC, 'RAM updated in VCD', actual === TARGET_RAM_MB,
      `expected=${TARGET_RAM_MB}MB actual=${actual}MB`);
    expect(actual).toBe(TARGET_RAM_MB);
  });
});

// ─── UC-VM-008: Resize Boot Disk ──────────────────────────────────────────
describe('UC-VM-008 — Resize VM Boot Disk', () => {
  const UC = 'UC-VM-008';
  let originalSizeGb;

  test('get_vm returns current disk size', async () => {
    log.separator(UC + ': get_vm disk');
    const vmId = cfg.fixtures.vmIdOff;
    const vm   = await client.call('get_vm', { vmId });
    originalSizeGb = get(vm, 'storageGb') || get(vm, 'disks', 0, 'sizeGb') || 40;
    log.result(UC, 'get_vm disk size', true, `currentDisk=${originalSizeGb}GB`);
    expect(originalSizeGb).toBeGreaterThan(0);
  });

  test('update_vm_disk increases disk size', async () => {
    log.separator(UC + ': update_vm_disk');
    const vmId       = cfg.fixtures.vmIdOff;
    const newSizeGb  = originalSizeGb + 20;
    const result = await client.call('update_vm_disk', { vmId, sizeGb: newSizeGb });
    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId);
    log.result(UC, `update_vm_disk to ${newSizeGb}GB`, true);
    expect(result).toBeTruthy();
  });

  test('get_vm reflects updated disk size', async () => {
    log.separator(UC + ': verify disk update');
    const vmId      = cfg.fixtures.vmIdOff;
    const newSizeGb = originalSizeGb + 20;
    const vm        = await client.call('get_vm', { vmId });
    const actual    = get(vm, 'storageGb') || get(vm, 'disks', 0, 'sizeGb');
    log.result(UC, 'Disk size updated in VCD', actual >= newSizeGb,
      `expected>=${newSizeGb}GB actual=${actual}GB`);
    expect(actual).toBeGreaterThanOrEqual(newSizeGb);
  });
});

// ─── UC-VM-009: CPU Hot-Add — Enable and Use ──────────────────────────────
describe('UC-VM-009 — CPU Hot-Add: Enable and Use', () => {
  const UC    = 'UC-VM-009';
  const vmId  = cfg.fixtures.vmIdOff;
  let baseCpu;

  test('power off VM and enable CPU hot-add', async () => {
    log.separator(UC + ': enable cpuHotAdd');
    await client.call('power_off_vm', { vmId }, cfg.timeouts.powerOp).catch(() => {});
    await waitForVmPower(client, vmId, 'poweredOff').catch(() => {});

    const vm = await client.call('get_vm', { vmId });
    baseCpu  = get(vm, 'data', 'cpuCount') || get(vm, 'cpuCount') || 2;

    const result = await client.call('update_vm_cpu', { vmId, cpuCount: baseCpu, cpuHotAdd: true });
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId);
    log.result(UC, 'CPU hot-add enabled', get(result, 'success') !== false);
    expect(get(result, 'success')).not.toBe(false);
  });

  test('power on VM', async () => {
    log.separator(UC + ': power on');
    const result = await client.call('power_on_vm', { vmId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    await waitForVmPower(client, vmId, 'poweredOn');
    log.result(UC, 'VM powered on', true);
    expect(result).toBeTruthy();
  });

  test('hot-add vCPUs while powered on', async () => {
    log.separator(UC + ': hot-add vCPUs');
    const newCpu = baseCpu + 2;
    // Do NOT pass coresPerSocket — tool preserves existing topology automatically
    const result = await client.call('update_vm_cpu', { vmId, cpuCount: newCpu });
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId);
    log.result(UC, `hot-add vCPUs to ${newCpu}`, get(result, 'success') !== false);
    expect(get(result, 'success')).not.toBe(false);
  });

  test('get_vm reflects updated CPU count', async () => {
    log.separator(UC + ': verify CPU count');
    const newCpu = baseCpu + 2;
    const vm     = await client.call('get_vm', { vmId });
    const actual = get(vm, 'data', 'cpuCount') || get(vm, 'cpuCount');
    log.result(UC, 'CPU count updated', actual === newCpu, `expected=${newCpu} actual=${actual}`);
    expect(actual).toBe(newCpu);
  });
});

// ─── UC-VM-010: CPU Reduce Guard ──────────────────────────────────────────
describe('UC-VM-010 — CPU Reduce Guard: Block on Powered-On VM', () => {
  const UC   = 'UC-VM-010';
  const vmId = cfg.fixtures.vmIdOn;

  test('ensure VM is powered on', async () => {
    log.separator(UC + ': ensure poweredOn');
    await client.call('power_on_vm', { vmId }, cfg.timeouts.powerOp).catch(() => {});
    const vm    = await waitForVmPower(client, vmId, 'poweredOn');
    const state = (get(vm, 'data', 'statusDescription') || get(vm, 'statusDescription') || '').toLowerCase();
    log.result(UC, 'VM is powered on', true, `state="${state}"`);
    expect(state).toMatch(/powered_on|poweredon|on/i);
  });

  test('reducing vCPUs on a powered-on VM is blocked', async () => {
    log.separator(UC + ': attempt CPU reduce');
    const vm         = await client.call('get_vm', { vmId });
    const currentCpu = get(vm, 'data', 'cpuCount') || get(vm, 'cpuCount') || 4;
    const result     = await client.call('update_vm_cpu', { vmId, cpuCount: Math.max(1, currentCpu - 2) });
    const code       = get(result, 'error', 'code');
    log.result(UC, 'CPU_REDUCE_REQUIRES_POWER_OFF returned', code === 'CPU_REDUCE_REQUIRES_POWER_OFF', `code="${code}"`);
    expect(code).toBe('CPU_REDUCE_REQUIRES_POWER_OFF');
  });

  test('error details include current and requested CPU counts', async () => {
    log.separator(UC + ': verify error details');
    const vm         = await client.call('get_vm', { vmId });
    const currentCpu = get(vm, 'data', 'cpuCount') || get(vm, 'cpuCount') || 4;
    const result     = await client.call('update_vm_cpu', { vmId, cpuCount: Math.max(1, currentCpu - 2) });
    const details    = get(result, 'error', 'details');
    log.result(UC, 'error details present', !!details, JSON.stringify(details));
    expect(details).toHaveProperty('currentCpuCount');
    expect(details).toHaveProperty('requestedCpuCount');
  });
});

// ─── UC-VM-011: Memory Hot-Add — Enable and Use ───────────────────────────
describe('UC-VM-011 — Memory Hot-Add: Enable and Use', () => {
  const UC   = 'UC-VM-011';
  const vmId = cfg.fixtures.vmIdOff;
  // Stay well below 3 GB boundary to avoid the Linux freeze guard
  const BASE_MEMORY_MB   = 2048;
  const HOT_ADD_MEMORY_MB = 2560;

  test('power off VM and enable memory hot-add', async () => {
    log.separator(UC + ': enable memoryHotAdd');
    await client.call('power_off_vm', { vmId }, cfg.timeouts.powerOp).catch(() => {});
    await waitForVmPower(client, vmId, 'poweredOff').catch(() => {});

    const result = await client.call('update_vm_memory', { vmId, memoryMB: BASE_MEMORY_MB, memoryHotAdd: true });
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId);
    log.result(UC, 'memory hot-add enabled', get(result, 'success') !== false);
    expect(get(result, 'success')).not.toBe(false);
  });

  test('power on VM', async () => {
    log.separator(UC + ': power on');
    const result = await client.call('power_on_vm', { vmId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    await waitForVmPower(client, vmId, 'poweredOn');
    log.result(UC, 'VM powered on', true);
    expect(result).toBeTruthy();
  });

  test('hot-add memory while powered on (staying below 3 GB)', async () => {
    log.separator(UC + ': hot-add memory');
    const result = await client.call('update_vm_memory', { vmId, memoryMB: HOT_ADD_MEMORY_MB });
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId);
    log.result(UC, `hot-add memory to ${HOT_ADD_MEMORY_MB} MB`, get(result, 'success') !== false);
    expect(get(result, 'success')).not.toBe(false);
  });

  test('get_vm reflects updated memory', async () => {
    log.separator(UC + ': verify memory');
    const vm     = await client.call('get_vm', { vmId });
    const actual = get(vm, 'data', 'memoryMB') || get(vm, 'memoryMB');
    log.result(UC, 'memory updated', actual === HOT_ADD_MEMORY_MB, `expected=${HOT_ADD_MEMORY_MB} actual=${actual}`);
    expect(actual).toBe(HOT_ADD_MEMORY_MB);
  });
});

// ─── UC-VM-012: Memory Reduce Guard ──────────────────────────────────────
describe('UC-VM-012 — Memory Reduce Guard: Block on Powered-On VM', () => {
  const UC   = 'UC-VM-012';
  const vmId = cfg.fixtures.vmIdOn;

  test('ensure VM is powered on', async () => {
    log.separator(UC + ': ensure poweredOn');
    await client.call('power_on_vm', { vmId }, cfg.timeouts.powerOp).catch(() => {});
    await waitForVmPower(client, vmId, 'poweredOn');
    log.result(UC, 'VM is powered on', true);
    expect(true).toBe(true);
  });

  test('reducing memory on a powered-on VM is blocked', async () => {
    log.separator(UC + ': attempt memory reduce');
    const vm      = await client.call('get_vm', { vmId });
    const current = get(vm, 'data', 'memoryMB') || get(vm, 'memoryMB') || 2048;
    const result  = await client.call('update_vm_memory', { vmId, memoryMB: Math.max(512, current - 512) });
    const code    = get(result, 'error', 'code');
    log.result(UC, 'MEMORY_REDUCE_REQUIRES_POWER_OFF returned', code === 'MEMORY_REDUCE_REQUIRES_POWER_OFF', `code="${code}"`);
    expect(code).toBe('MEMORY_REDUCE_REQUIRES_POWER_OFF');
  });

  test('error details include current and requested memory', async () => {
    log.separator(UC + ': verify error details');
    const vm      = await client.call('get_vm', { vmId });
    const current = get(vm, 'data', 'memoryMB') || get(vm, 'memoryMB') || 2048;
    const result  = await client.call('update_vm_memory', { vmId, memoryMB: Math.max(512, current - 512) });
    const details = get(result, 'error', 'details');
    log.result(UC, 'error details present', !!details, JSON.stringify(details));
    expect(details).toHaveProperty('currentMemMB');
    expect(details).toHaveProperty('requestedMemMB');
  });
});

// ─── UC-VM-013: Memory 3 GB Boundary Guard ────────────────────────────────
describe('UC-VM-013 — Memory Hot-Add 3 GB Boundary Guard', () => {
  const UC   = 'UC-VM-013';
  // Requires a powered-on VM with ≤3072 MB RAM.
  // Uses vmIdOn — if that VM has >3 GB this test is skipped automatically.
  const vmId = cfg.fixtures.vmIdOn;

  test('attempt to cross 3 GB boundary on powered-on VM is blocked', async () => {
    log.separator(UC + ': boundary guard');
    const vm      = await client.call('get_vm', { vmId });
    const current = get(vm, 'data', 'memoryMB') || get(vm, 'memoryMB') || 2048;

    if (current > 3072) {
      log.warn(`UC-VM-013: VM already has ${current} MB (>3 GB) — boundary guard not applicable, skipping`);
      return;
    }

    const result = await client.call('update_vm_memory', { vmId, memoryMB: 4096 });
    const code   = get(result, 'error', 'code');
    log.result(UC, 'MEMORY_HOT_ADD_BOUNDARY_VIOLATION returned', code === 'MEMORY_HOT_ADD_BOUNDARY_VIOLATION', `code="${code}"`);
    expect(code).toBe('MEMORY_HOT_ADD_BOUNDARY_VIOLATION');
  });

  test('error details include boundary, current, and requested memory', async () => {
    log.separator(UC + ': verify error details');
    const vm      = await client.call('get_vm', { vmId });
    const current = get(vm, 'data', 'memoryMB') || get(vm, 'memoryMB') || 2048;

    if (current > 3072) {
      log.warn(`UC-VM-013: VM already has ${current} MB — skipping details check`);
      return;
    }

    const result  = await client.call('update_vm_memory', { vmId, memoryMB: 4096 });
    const details = get(result, 'error', 'details');
    log.result(UC, 'error details present', !!details, JSON.stringify(details));
    expect(details).toHaveProperty('currentMemMB');
    expect(details).toHaveProperty('requestedMemMB');
    expect(details).toHaveProperty('boundaryMB');
    expect(get(details, 'boundaryMB')).toBe(3072);
  });
});

// ─── UC-VM-014: Disk Extend While Powered On ─────────────────────────────
describe('UC-VM-014 — Disk Extend While VM is Powered On', () => {
  const UC   = 'UC-VM-014';
  const vmId = cfg.fixtures.vmIdOn;
  let currentDiskMB;

  test('ensure VM is powered on', async () => {
    log.separator(UC + ': ensure poweredOn');
    await client.call('power_on_vm', { vmId }, cfg.timeouts.powerOp).catch(() => {});
    await waitForVmPower(client, vmId, 'poweredOn');
    log.result(UC, 'VM is powered on', true);
    expect(true).toBe(true);
  });

  test('extend disk while VM is powered on', async () => {
    log.separator(UC + ': extend disk on running VM');
    const vm      = await client.call('get_vm', { vmId });
    const diskGb  = get(vm, 'data', 'disks', 0, 'capacityGB') || get(vm, 'disks', 0, 'sizeGb') || 20;
    currentDiskMB = diskGb * 1024;
    const newDiskMB = currentDiskMB + 5120; // +5 GB

    const result = await client.call('update_vm_disk', { vmId, diskSizeMB: newDiskMB });
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId);
    log.result(UC, `disk extended to ${newDiskMB} MB while powered on`, get(result, 'success') !== false);
    expect(get(result, 'success')).not.toBe(false);
  });

  test('get_vm reflects updated disk size', async () => {
    log.separator(UC + ': verify disk size');
    const newDiskMB = currentDiskMB + 5120;
    const vm        = await client.call('get_vm', { vmId });
    const actualMB  = get(vm, 'data', 'disks', 0, 'capacityMB') || (get(vm, 'disks', 0, 'sizeGb') * 1024);
    log.result(UC, 'disk size updated', actualMB >= newDiskMB, `expected>=${newDiskMB} actual=${actualMB}`);
    expect(actualMB).toBeGreaterThanOrEqual(newDiskMB);
  });
});

// ─── UC-VM-015: Disk Shrink Guard ─────────────────────────────────────────
describe('UC-VM-015 — Disk Shrink Guard', () => {
  const UC   = 'UC-VM-015';
  const vmId = cfg.fixtures.vmIdOn;

  test('shrink disk is blocked regardless of power state', async () => {
    log.separator(UC + ': attempt disk shrink');
    const vm       = await client.call('get_vm', { vmId });
    const diskGb   = get(vm, 'data', 'disks', 0, 'capacityGB') || get(vm, 'disks', 0, 'sizeGb') || 20;
    const smallerMB = Math.max(1024, (diskGb - 5) * 1024);

    const result = await client.call('update_vm_disk', { vmId, diskSizeMB: smallerMB });
    const code   = get(result, 'error', 'code');
    log.result(UC, 'DISK_SHRINK_NOT_SUPPORTED returned', code === 'DISK_SHRINK_NOT_SUPPORTED', `code="${code}"`);
    expect(code).toBe('DISK_SHRINK_NOT_SUPPORTED');
  });

  test('error details include current and requested disk sizes', async () => {
    log.separator(UC + ': verify error details');
    const vm       = await client.call('get_vm', { vmId });
    const diskGb   = get(vm, 'data', 'disks', 0, 'capacityGB') || get(vm, 'disks', 0, 'sizeGb') || 20;
    const smallerMB = Math.max(1024, (diskGb - 5) * 1024);

    const result  = await client.call('update_vm_disk', { vmId, diskSizeMB: smallerMB });
    const details = get(result, 'error', 'details');
    log.result(UC, 'error details present', !!details, JSON.stringify(details));
    expect(details).toHaveProperty('currentDiskMB');
    expect(details).toHaveProperty('requestedDiskMB');
    expect(get(details, 'currentDiskMB')).toBeGreaterThan(get(details, 'requestedDiskMB'));
  });
});

// ─── UC-VM-016: Suspend VM ────────────────────────────────────────────────
describe('UC-VM-016 — Suspend a Virtual Machine', () => {
  const UC   = 'UC-VM-016';
  const vmId = cfg.fixtures.vmIdOn;

  test('ensure VM is powered on before suspend', async () => {
    log.separator(UC + ': ensure poweredOn');
    await client.call('power_on_vm', { vmId }, cfg.timeouts.powerOp).catch(() => {});
    await waitForVmPower(client, vmId, 'poweredOn');
    log.result(UC, 'VM powered on', true);
    expect(true).toBe(true);
  });

  test('suspend_vm is accepted', async () => {
    log.separator(UC + ': suspend_vm');
    const result = await client.call('suspend_vm', { vmId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'suspend_vm accepted', get(result, 'success') !== false);
    expect(get(result, 'success')).not.toBe(false);
  });

  test('VM reaches suspended state', async () => {
    log.separator(UC + ': verify suspended');
    const vm    = await waitForVmPower(client, vmId, 'suspended');
    const state = (get(vm, 'data', 'statusDescription') || get(vm, 'statusDescription') || '').toLowerCase();
    log.result(UC, 'VM is suspended', true, `state="${state}"`);
    expect(state).toMatch(/suspend/i);
  });

  test('power on VM to restore after suspend test', async () => {
    log.separator(UC + ': restore power');
    const result = await client.call('power_on_vm', { vmId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    await waitForVmPower(client, vmId, 'poweredOn');
    log.result(UC, 'VM restored to poweredOn', true);
    expect(result).toBeTruthy();
  });
});

// ─── UC-VM-017: VM Console URL ────────────────────────────────────────────
describe('UC-VM-017 — Get VM Console URL', () => {
  const UC   = 'UC-VM-017';
  const vmId = cfg.fixtures.vmIdOn;

  test('ensure VM is powered on', async () => {
    log.separator(UC + ': ensure poweredOn');
    await client.call('power_on_vm', { vmId }, cfg.timeouts.powerOp).catch(() => {});
    await waitForVmPower(client, vmId, 'poweredOn');
    log.result(UC, 'VM powered on', true);
    expect(true).toBe(true);
  });

  test('get_vm_console returns a console ticket or URL', async () => {
    log.separator(UC + ': get_vm_console');
    const result = await client.call('get_vm_console', { vmId });
    log.debug(`get_vm_console: ${JSON.stringify(result).slice(0, 300)}`);
    log.result(UC, 'get_vm_console returns data', !!result);
    expect(result).toBeTruthy();
  });

  test('console response contains a URL, ticket, or host field', async () => {
    log.separator(UC + ': verify console fields');
    const result = await client.call('get_vm_console', { vmId });
    const text   = JSON.stringify(result).toLowerCase();
    const hasUrl    = text.includes('url')    || text.includes('http') || text.includes('vmrc');
    const hasTicket = text.includes('ticket') || text.includes('token') || text.includes('host');
    log.result(UC, 'console URL or ticket present', hasUrl || hasTicket);
    expect(hasUrl || hasTicket).toBe(true);
  });
});

// ─── UC-VM-018: Update VM Computer Name ──────────────────────────────────
describe('UC-VM-018 — Update VM Computer Name', () => {
  const UC   = 'UC-VM-018';
  const vmId = cfg.fixtures.vmIdOff;
  const NEW_NAME = 'qa-renamed-vm';

  test('power off VM before renaming', async () => {
    log.separator(UC + ': ensure poweredOff');
    await client.call('power_off_vm', { vmId }, cfg.timeouts.powerOp).catch(() => {});
    await waitForVmPower(client, vmId, 'poweredOff').catch(() => {});
    log.result(UC, 'VM powered off', true);
    expect(true).toBe(true);
  });

  test('update_vm_computer_name changes the guest hostname', async () => {
    log.separator(UC + ': update_vm_computer_name');
    const result = await client.call('update_vm_computer_name', { vmId, computerName: NEW_NAME });
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId);
    log.result(UC, `update_vm_computer_name to "${NEW_NAME}"`, get(result, 'success') !== false);
    expect(get(result, 'success')).not.toBe(false);
  });

  test('get_vm reflects updated computer name', async () => {
    log.separator(UC + ': verify computer name');
    const vm     = await client.call('get_vm', { vmId });
    const actual = get(vm, 'data', 'computerName') || get(vm, 'computerName') || '';
    log.result(UC, 'computer name updated', actual === NEW_NAME, `expected="${NEW_NAME}" actual="${actual}"`);
    expect(actual).toBe(NEW_NAME);
  });
});

// ─── UC-VM-019: Update VM Network ─────────────────────────────────────────
describe('UC-VM-019 — Update VM Network Connection', () => {
  const UC   = 'UC-VM-019';
  const vmId = cfg.fixtures.vmIdOff;

  test('power off VM before changing network config', async () => {
    log.separator(UC + ': ensure poweredOff');
    await client.call('power_off_vm', { vmId }, cfg.timeouts.powerOp).catch(() => {});
    await waitForVmPower(client, vmId, 'poweredOff').catch(() => {});
    log.result(UC, 'VM powered off', true);
    expect(true).toBe(true);
  });

  test('get_vm returns current NIC configuration', async () => {
    log.separator(UC + ': get current NIC');
    const vm   = await client.call('get_vm', { vmId });
    const nics = get(vm, 'data', 'networkConnections') || get(vm, 'networkConnections') || [];
    log.result(UC, 'NIC list returned', nics.length > 0, `nicCount=${nics.length}`);
    expect(nics.length).toBeGreaterThan(0);
  });

  test('update_vm_network updates NIC 0 to POOL mode', async () => {
    log.separator(UC + ': update_vm_network');
    const vm      = await client.call('get_vm', { vmId });
    const nics    = get(vm, 'data', 'networkConnections') || get(vm, 'networkConnections') || [];
    const network = get(nics, 0, 'network') || get(nics, 0, 'networkName') || cfg.fixtures.vdcName;

    const result = await client.call('update_vm_network', {
      vmId,
      nicIndex:    0,
      networkName: network,
      ipMode:      'POOL',
      connected:   true,
    });
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId);
    log.result(UC, 'update_vm_network accepted', get(result, 'success') !== false, `network="${network}"`);
    expect(get(result, 'success')).not.toBe(false);
  });
});
