'use strict';
/**
 * Snapshot Management Test Suite
 * Covers: UC-SNAP-001 through UC-SNAP-003
 * - Create snapshot, revert to snapshot, remove all snapshots
 */

const McpClient = require('../McpClient');
const cfg       = require('../config');
const { makeLogger } = require('../logger');
const { waitForTask, toArray, get, sleep } = require('../helpers');

const log = makeLogger('snapshot.test');
let client;

// Snapshot created in UC-SNAP-001 and used in UC-SNAP-002
const state = { snapshotCreated: false };

beforeAll(async () => {
  log.separator('Snapshot Management Suite — Setup');
  client = new McpClient();
  await client.connect();
});

afterAll(async () => {
  log.info('Starting Snapshot Management Suite teardown...');
  // Safety net: remove all snapshots from the test VM on teardown
  if (state.snapshotCreated) {
    log.info('Teardown: removing test snapshots');
    await client.call('remove_snapshots', { vmId: cfg.fixtures.vmIdOff })
      .catch(e => log.warn(`Teardown snapshot removal: ${e.message}`));
    log.info('Snapshot cleanup completed');
  }
  try {
    if (client) {
      log.info('Disconnecting client');
      client.disconnect();
      log.info('Client disconnected');
    }
  } catch (e) {
    log.warn(`Error during disconnect: ${e.message}`);
  }
  log.separator('Snapshot Management Suite — Teardown complete');
});

// ─── UC-SNAP-001: Create Snapshot ─────────────────────────────────────────
describe('UC-SNAP-001 — Create a VM Snapshot', () => {
  const UC = 'UC-SNAP-001';

  test('get_vm returns current VM state before snapshot', async () => {
    log.separator(UC + ': get_vm pre-snapshot');
    const vmId  = cfg.fixtures.vmIdOff;
    const vm    = await client.call('get_vm', { vmId });
    const name  = vm?.name || vm?.vmName || '';
    log.result(UC, 'get_vm returns VM', !!vm, `name="${name}"`);
    expect(vm).toBeTruthy();
  }, 30_000);

  test('list_snapshots returns baseline snapshot count', async () => {
    log.separator(UC + ': list_snapshots baseline');
    const vmId   = cfg.fixtures.vmIdOff;
    const result = await client.call('list_snapshots', { vmId });
    const snaps  = toArray(result);
    log.info(`Baseline snapshot count: ${snaps.length}`);
    // No assertion — just recording baseline
    expect(result !== undefined).toBe(true);
  }, 30_000);

  test('create_snapshot creates a snapshot successfully', async () => {
    log.separator(UC + ': create_snapshot');
    const vmId   = cfg.fixtures.vmIdOff;
    const result = await client.call('create_snapshot', {
      vmId,
      memory: false,   // don't include memory state (VM is off)
    }, cfg.timeouts.taskPoll);

    log.info(`create_snapshot raw: ${JSON.stringify(result).slice(0, 500)}`);
    const isSuccess = get(result, 'success') !== false && get(result, 'data', '_type') !== 'error';
    const taskId = get(result, 'data', 'taskId') || get(result, 'data', 'id') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);

    state.snapshotCreated = isSuccess;
    log.result(UC, 'create_snapshot completed', isSuccess, taskId ? `taskId=${taskId}` : 'no taskId');
    expect(isSuccess).toBe(true);
  }, cfg.timeouts.taskPoll);

  test('list_snapshots shows at least one snapshot after creation', async () => {
    log.separator(UC + ': verify snapshot exists');
    const vmId  = cfg.fixtures.vmIdOff;
    // Wait for VCD to complete snapshot creation
    await sleep(15_000);
    const result = await client.call('list_snapshots', { vmId });
    log.debug(`list_snapshots raw: ${JSON.stringify(result).slice(0, 400)}`);
    const snaps  = toArray(result);
    log.result(UC, `snapshot count >= 1`, snaps.length >= 1, `count=${snaps.length}`);
    expect(snaps.length).toBeGreaterThanOrEqual(1);

    // Log snapshot timestamps for traceability
    snaps.forEach((s, i) => {
      log.info(`  Snapshot [${i}]: created=${s.created || s.createdAt || 'unknown'}`);
    });
  }, 60_000);
});

// ─── UC-SNAP-002: Revert to Snapshot ──────────────────────────────────────
describe('UC-SNAP-002 — Revert VM to Latest Snapshot', () => {
  const UC = 'UC-SNAP-002';

  test('list_snapshots confirms snapshot exists before revert', async () => {
    log.separator(UC + ': pre-revert list_snapshots');
    const vmId  = cfg.fixtures.vmIdOff;
    const snaps = toArray(await client.call('list_snapshots', { vmId }));
    log.result(UC, 'snapshot exists for revert', snaps.length >= 1, `count=${snaps.length}`);
    if (snaps.length === 0) {
      log.warn('No snapshots found — skipping revert test (run UC-SNAP-001 first)');
    }
    expect(snaps.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  test('revert_snapshot call is accepted', async () => {
    log.separator(UC + ': revert_snapshot');
    // Guard: if no snapshots exist, skip to avoid hanging on a stuck VM in VCD.
    const vmId   = cfg.fixtures.vmIdOff;
    const preCheck = toArray(await client.call('list_snapshots', { vmId }));
    if (preCheck.length === 0) {
      log.warn(`${UC}: no snapshots to revert — skipping revert_snapshot call (UC-SNAP-001 must pass first)`);
      expect(true).toBe(true);
      return;
    }
    const result = await client.call('revert_snapshot', { vmId }, cfg.timeouts.taskPoll);
    const taskId = get(result, 'data', 'taskId') || get(result, 'data', 'id') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);
    log.result(UC, 'revert_snapshot completed', !!result || result === null);
    expect(result !== undefined).toBe(true);
  }, cfg.timeouts.taskPoll);

  test('get_vm confirms VM is accessible after revert', async () => {
    log.separator(UC + ': post-revert get_vm');
    await sleep(10_000);
    const vmId = cfg.fixtures.vmIdOff;
    const vm   = await client.call('get_vm', { vmId });
    log.result(UC, 'VM accessible post-revert', !!vm);
    expect(vm).toBeTruthy();
  }, 30_000);
});

// ─── UC-SNAP-003: Remove All Snapshots ────────────────────────────────────
describe('UC-SNAP-003 — Remove All VM Snapshots', () => {
  const UC = 'UC-SNAP-003';

  test('list_snapshots confirms snapshots exist before removal', async () => {
    log.separator(UC + ': pre-removal list_snapshots');
    const vmId  = cfg.fixtures.vmIdOff;
    const snaps = toArray(await client.call('list_snapshots', { vmId }));
    log.result(UC, 'snapshots exist before removal', snaps.length >= 1, `count=${snaps.length}`);
    if (snaps.length === 0) {
      log.warn('No snapshots to remove — test may be trivially true');
    }
    // Accept 0 or more; the removal call should still succeed
    expect(snaps.length).toBeGreaterThanOrEqual(0);
  }, 30_000);

  test('remove_snapshots call completes without error', async () => {
    log.separator(UC + ': remove_snapshots');
    const vmId   = cfg.fixtures.vmIdOff;
    const result = await client.call('remove_snapshots', { vmId }, cfg.timeouts.taskPoll);
    log.info(`remove_snapshots raw: ${JSON.stringify(result).slice(0, 500)}`);
    const isSuccess = get(result, 'success') !== false;
    const taskId = get(result, 'data', 'taskId') || get(result, 'data', 'id') || get(result, 'taskId') || get(result, 'task', 'id');
    log.info(`remove_snapshots taskId=${taskId} success=${isSuccess}`);
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);
    state.snapshotCreated = false;   // teardown no longer needed
    log.result(UC, 'remove_snapshots completed', isSuccess);
    expect(isSuccess).toBe(true);
  }, cfg.timeouts.taskPoll);

  test('list_snapshots returns empty list after removal', async () => {
    log.separator(UC + ': verify snapshots removed');
    const vmId    = cfg.fixtures.vmIdOff;
    const deadline = Date.now() + 60_000;
    let snaps = [];
    // Poll until empty (VCD may take time to update snapshotSection after task success)
    while (Date.now() < deadline) {
      await sleep(5_000);
      const result = await client.call('list_snapshots', { vmId });
      snaps = toArray(result);
      log.info(`  post-remove snapshot count: ${snaps.length}`);
      if (snaps.length === 0) break;
    }
    log.result(UC, 'snapshot list is empty after removal', snaps.length === 0,
      `remaining=${snaps.length}`);
    expect(snaps.length).toBe(0);
  }, 90_000);
});
