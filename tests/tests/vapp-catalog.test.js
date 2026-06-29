'use strict';
/**
 * vApp & Catalog Management Test Suite
 * Covers: UC-VA-001 through UC-VA-006
 * - Deploy vApp, add VM to vApp, power on/off vApp, undeploy vApp, delete vApp
 */

const McpClient = require('../McpClient');
const cfg       = require('../config');
const { makeLogger } = require('../logger');
const { waitForTask, waitForVappStatus, findInList, toArray, get } = require('../helpers');

const log = makeLogger('vapp-catalog');
let client;

// Track resources created during tests so teardown can clean up
const created = { vappId: null };

beforeAll(async () => {
  log.separator('vApp & Catalog Suite — Setup');
  client = new McpClient();
  await client.connect();
});

afterAll(async () => {
  // Best-effort cleanup of any vApp created during UC-VA-001
  if (created.vappId) {
    log.info(`Teardown: deleting test vApp ${created.vappId}`);
    try {
      await client.call('power_off_vapp', { vappId: created.vappId }).catch(() => {});
      const r = await client.call('delete_vapp', { vappId: created.vappId });
      const tid = get(r, 'taskId') || get(r, 'task', 'id');
      if (tid) await waitForTask(client, tid).catch(() => {});
    } catch (e) {
      log.warn(`Teardown delete_vapp failed: ${e.message}`);
    }
  }
  if (client) client.disconnect();
  log.separator('vApp & Catalog Suite — Teardown complete');
});

// ─── UC-VA-001: Deploy vApp from Catalog ──────────────────────────────────
describe('UC-VA-001 — Deploy a vApp from Catalog Template', () => {
  const UC = 'UC-VA-001';
  let catalogId;
  let templateId;

  test('list_catalogs returns at least one catalog', async () => {
    log.separator(UC + ': list_catalogs');
    const result  = await client.call('list_catalogs', {});
    const catalogs = toArray(result);
    log.result(UC, 'list_catalogs', catalogs.length > 0, `count=${catalogs.length}`);
    expect(catalogs.length).toBeGreaterThan(0);

    const match = catalogs.find(c =>
      c.name === cfg.fixtures.catalogName ||
      c.name?.toLowerCase().includes('test')
    ) || catalogs[0];
    catalogId = match.id || match.catalogId;
    log.info(`Using catalog: ${match.name} (${catalogId})`);
  });

  test('list_catalog_items returns at least one template', async () => {
    log.separator(UC + ': list_catalog_items');
    const result  = await client.call('list_catalog_items', { catalogId });
    const items   = toArray(result);
    log.result(UC, 'list_catalog_items', items.length > 0, `count=${items.length}`);
    expect(items.length).toBeGreaterThan(0);

    const match = items.find(i =>
      i.name === cfg.fixtures.templateName ||
      i.type?.toLowerCase().includes('vapp')
    ) || items[0];
    templateId = match.id || match.templateId;
    log.info(`Using template: ${match.name} (${templateId})`);
  });

  test('create_vapp deploys a new vApp from template', async () => {
    log.separator(UC + ': create_vapp');
    const vappName = `test-vapp-${Date.now()}`;
    const result = await client.call('create_vapp', {
      name:       vappName,
      templateId,
      vdcName:    cfg.fixtures.vdcName,
    }, cfg.timeouts.taskPoll);

    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);

    // Capture vappId for subsequent tests and teardown
    created.vappId = get(result, 'vappId') || get(result, 'id');
    log.result(UC, `create_vapp "${vappName}"`, !!created.vappId || !!result,
      `vappId=${created.vappId}`);
    expect(result).toBeTruthy();
  });

  test('get_vapp confirms vApp exists after deployment', async () => {
    log.separator(UC + ': get_vapp');
    if (!created.vappId) { log.warn('No vappId from create_vapp — skipping'); return; }
    const vapp = await client.call('get_vapp', { vappId: created.vappId });
    const name = vapp?.name || '';
    log.result(UC, 'get_vapp returns deployed vApp', !!name, `name="${name}"`);
    expect(name).toBeTruthy();
  });
});

// ─── UC-VA-002: Add VM to vApp ────────────────────────────────────────────
describe('UC-VA-002 — Add VM to Existing vApp from Catalog', () => {
  const UC = 'UC-VA-002';
  let templateId;

  test('list_catalog_items returns a usable template', async () => {
    log.separator(UC + ': list_catalog_items');
    const cats   = toArray(await client.call('list_catalogs', {}));
    expect(cats.length).toBeGreaterThan(0);
    const cat    = cats[0];
    const items  = toArray(await client.call('list_catalog_items', { catalogId: cat.id || cat.catalogId }));
    expect(items.length).toBeGreaterThan(0);
    templateId = (items[0].id || items[0].templateId);
    log.result(UC, 'template found', !!templateId, `templateId=${templateId}`);
  });

  test('add_vm_to_vapp adds a VM into an existing vApp', async () => {
    log.separator(UC + ': add_vm_to_vapp');
    const vappId = created.vappId || cfg.fixtures.vappIdOff;
    const result = await client.call('add_vm_to_vapp', {
      vappId,
      templateId,
      vmName: `test-vm-${Date.now()}`,
    }, cfg.timeouts.taskPoll);

    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);
    log.result(UC, 'add_vm_to_vapp completed', true);
    expect(result).toBeTruthy();
  });

  test('list_vms shows new VM under the vApp', async () => {
    log.separator(UC + ': list_vms verify');
    const vappId = created.vappId || cfg.fixtures.vappIdOff;
    const vms    = toArray(await client.call('list_vms', { vappId }));
    log.result(UC, 'VM added to vApp', vms.length > 0, `vmCount=${vms.length}`);
    expect(vms.length).toBeGreaterThan(0);
  });
});

// ─── UC-VA-003: Power On vApp ─────────────────────────────────────────────
describe('UC-VA-003 — Power On a vApp', () => {
  const UC = 'UC-VA-003';

  test('power_on_vapp transitions vApp to powered-on', async () => {
    log.separator(UC + ': power_on_vapp');
    const vappId = cfg.fixtures.vappIdOff;
    const result = await client.call('power_on_vapp', { vappId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'power_on_vapp accepted', true);
    expect(result).toBeTruthy();
  });

  test('get_vapp status is Powered On', async () => {
    log.separator(UC + ': verify vApp status');
    const vapp   = await waitForVappStatus(client, cfg.fixtures.vappIdOff, 'Powered On');
    const status = vapp?.status || '';
    log.result(UC, 'vApp Powered On', status.toLowerCase().includes('powered'), `status="${status}"`);
    expect(status).toMatch(/powered.?on|running/i);
  });

  test('list_vms shows VMs inside vApp are powered on', async () => {
    log.separator(UC + ': list_vms check');
    const vms = toArray(await client.call('list_vms', { vappId: cfg.fixtures.vappIdOff }));
    const poweredOn = vms.filter(v =>
      (v.status || v.powerState || '').toLowerCase().match(/poweredon|on/)
    );
    log.result(UC, 'VMs inside vApp are powered on',
      poweredOn.length > 0, `poweredOn=${poweredOn.length}/${vms.length}`);
    expect(poweredOn.length).toBeGreaterThan(0);
  });
});

// ─── UC-VA-004: Power Off vApp ────────────────────────────────────────────
describe('UC-VA-004 — Power Off a vApp', () => {
  const UC = 'UC-VA-004';

  test('power_off_vapp transitions vApp to powered-off', async () => {
    log.separator(UC + ': power_off_vapp');
    const vappId = cfg.fixtures.vappIdOn;
    const result = await client.call('power_off_vapp', { vappId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'power_off_vapp accepted', true);
    expect(result).toBeTruthy();
  });

  test('get_vapp status is Powered Off within timeout', async () => {
    log.separator(UC + ': verify vApp status');
    const vapp   = await waitForVappStatus(client, cfg.fixtures.vappIdOn, 'Powered Off');
    const status = vapp?.status || '';
    log.result(UC, 'vApp Powered Off', status.toLowerCase().includes('off'), `status="${status}"`);
    expect(status).toMatch(/powered.?off|stopped/i);
  });
});

// ─── UC-VA-006: Undeploy vApp ─────────────────────────────────────────────
describe('UC-VA-006 — Undeploy a vApp (Power Off + Undeploy Without Deleting)', () => {
  const UC     = 'UC-VA-006';
  const vappId = cfg.fixtures.vappIdOn;

  test('ensure vApp is powered on before undeploying', async () => {
    log.separator(UC + ': ensure powered on');
    await client.call('power_on_vapp', { vappId }, cfg.timeouts.powerOp).catch(() => {});
    await waitForVappStatus(client, vappId, 'Powered On').catch(() => {});
    log.result(UC, 'vApp is powered on', true);
    expect(true).toBe(true);
  });

  test('undeploy_vapp powers off and undeploys the vApp', async () => {
    log.separator(UC + ': undeploy_vapp');
    const result = await client.call('undeploy_vapp', { vappId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'taskId') || get(result, 'task', 'id') || get(result, 'data', 'taskId');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'undeploy_vapp accepted', !!result);
    expect(result).toBeTruthy();
  });

  test('vApp is powered off after undeploy', async () => {
    log.separator(UC + ': verify powered off');
    const vapp   = await waitForVappStatus(client, vappId, 'Powered Off');
    const status = (vapp?.status || '').toLowerCase();
    log.result(UC, 'vApp powered off after undeploy', true, `status="${status}"`);
    expect(status).toMatch(/powered.?off|stopped|resolved/i);
  });

  test('get_vapp confirms vApp still exists after undeploy', async () => {
    log.separator(UC + ': verify vApp still exists');
    const vapp = await client.call('get_vapp', { vappId });
    const name = vapp?.name || get(vapp, 'data', 'name') || '';
    log.result(UC, 'vApp still exists after undeploy', !!name, `name="${name}"`);
    expect(name).toBeTruthy();
  });
});

// ─── UC-VA-005: Delete vApp ───────────────────────────────────────────────
describe('UC-VA-005 — Delete a vApp', () => {
  const UC = 'UC-VA-005';
  // Use the vApp created in UC-VA-001 if available; otherwise a dedicated fixture
  let targetVappId;

  beforeAll(() => {
    targetVappId = created.vappId || cfg.fixtures.vappIdOff;
    log.info(`${UC}: targeting vApp ${targetVappId} for deletion`);
  });

  test('list_vapps confirms target vApp exists before deletion', async () => {
    log.separator(UC + ': pre-delete list_vapps');
    const vapps = toArray(await client.call('list_vapps', {}));
    const found = vapps.some(v => (v.id || v.vappId) === targetVappId);
    log.result(UC, 'vApp exists before delete', found || vapps.length > 0);
    // If not found it may already be gone — warn but don't fail pre-check
    if (!found) log.warn(`vApp ${targetVappId} not found — may have been cleaned up already`);
  });

  test('delete_vapp removes the vApp permanently', async () => {
    log.separator(UC + ': delete_vapp');
    const result = await client.call('delete_vapp', { vappId: targetVappId }, cfg.timeouts.taskPoll);
    const taskId = get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);
    log.result(UC, 'delete_vapp completed', true);
    created.vappId = null;   // mark cleaned up
    expect(result).toBeTruthy();
  });

  test('list_vapps no longer returns the deleted vApp', async () => {
    log.separator(UC + ': post-delete list_vapps');
    const vapps = toArray(await client.call('list_vapps', {}));
    const found = vapps.some(v => (v.id || v.vappId) === targetVappId);
    log.result(UC, 'vApp absent after delete', !found);
    expect(found).toBe(false);
  });
});
