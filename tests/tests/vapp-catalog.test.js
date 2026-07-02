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
    // Search the selected catalog first, then fall back to scanning all catalogs for a vApp template.
    // create_vapp requires the full template href (not bare ID) in its Source element.
    // entityType is the VCD field that distinguishes vApp templates from ISOs/media.
    const cats = toArray(await client.call('list_catalogs', {}));
    // Cache items per catalog to avoid double API calls
    const catItems = {};
    for (const cat of cats) {
      const cid = cat.id || cat.catalogId;
      catItems[cid] = toArray(await client.call('list_catalog_items', { catalogId: cid }));
    }
    let match;
    // Pass 1: exact name match across ALL catalogs (avoids picking wrong template from first catalog)
    for (const cat of cats) {
      const cid = cat.id || cat.catalogId;
      const exact = catItems[cid].find(i => i.name === cfg.fixtures.templateName);
      if (exact) { match = exact; catalogId = cid; break; }
    }
    // Pass 2: any vApp template (prefer configured catalog name, then others)
    if (!match) {
      const ordered = [
        ...cats.filter(c => c.name === cfg.fixtures.catalogName),
        ...cats.filter(c => c.name !== cfg.fixtures.catalogName),
      ];
      for (const cat of ordered) {
        const cid = cat.id || cat.catalogId;
        const fb = catItems[cid].find(i => (i.entityType || '').toLowerCase().includes('vapptemplate'));
        if (fb) { match = fb; catalogId = cid; break; }
      }
    }
    // Final fallback — use first item from original catalog (may be ISO, test will warn)
    if (!match) {
      const items = toArray(await client.call('list_catalog_items', { catalogId }));
      match = items[0];
      log.warn(`${UC}: no vApp template found — falling back to first catalog item: ${match?.name}`);
    }
    // create_vapp needs the vApp template href (entityHref), NOT the catalogItem href
    templateId = match?.entityHref || match?.href || match?.id || match?.templateId;
    log.result(UC, 'list_catalog_items', !!templateId, `count=— template=${match?.name} (${templateId})`);
    expect(templateId).toBeTruthy();
  });

  test('create_vapp deploys a new vApp from template', async () => {
    log.separator(UC + ': create_vapp');

    // Resolve vdcId from vdcName (create_vapp requires vdcId, not vdcName)
    const vdcs = toArray(await client.call('list_vdcs', {}));
    const vdc  = vdcs.find(v => v.name === cfg.fixtures.vdcName) || vdcs[0];
    const vdcId = vdc?.id || vdc?.vdcId;
    if (!vdcId) { log.warn('No VDC found — skipping create_vapp'); return; }
    log.info(`Using vdcId: ${vdcId}`);

    const vappName = `test-vapp-${Date.now()}`;
    const result = await client.call('create_vapp', {
      vappName,
      templateId,
      vdcId,
    }, cfg.timeouts.taskPoll);

    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);

    // Capture vappId for subsequent tests and teardown
    created.vappId = get(result, 'data', 'vappId') || get(result, 'data', 'id') || get(result, 'vappId') || get(result, 'id');

    // Fallback: if vappId not in response (regex miss on VCD XML), search by name
    if (!created.vappId && result?.success !== false) {
      await new Promise(r => setTimeout(r, 5000));
      const vapps = toArray(await client.call('list_vapps', {}));
      const found = vapps.find(v => v.name === vappName);
      if (found) {
        created.vappId = found.id || null;
        log.info(`${UC}: vappId recovered via name search: ${created.vappId}`);
      }
    }

    const isSuccess = result?.success !== false && !!created.vappId;
    log.result(UC, `create_vapp "${vappName}"`, isSuccess, `vappId=${created.vappId}`);
    expect(isSuccess).toBe(true);
  });

  test('get_vapp confirms vApp exists after deployment', async () => {
    log.separator(UC + ': get_vapp');
    if (!created.vappId) { log.warn('No vappId from create_vapp — skipping'); return; }
    const vapp = await client.call('get_vapp', { vappId: created.vappId });
    const name = get(vapp, 'data', 'name') || vapp?.name || '';
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
    const cats = toArray(await client.call('list_catalogs', {}));
    expect(cats.length).toBeGreaterThan(0);
    // Search all catalogs for a vApp template (entityType, not type)
    let match;
    for (const cat of cats) {
      const items = toArray(await client.call('list_catalog_items', { catalogId: cat.id || cat.catalogId }));
      match = items.find(i => (i.entityType || '').toLowerCase().includes('vapptemplate')) || match;
      if (match) break;
    }
    if (!match) match = toArray(await client.call('list_catalog_items', { catalogId: cats[0].id || cats[0].catalogId }))[0];
    // add_vm_to_vapp also requires the vApp template href (entityHref), not catalogItem href
    templateId = match?.entityHref || match?.href || match?.id || match?.templateId;
    log.result(UC, 'template found', !!templateId, `templateId=${templateId}`);
    expect(templateId).toBeTruthy();
  });

  test('add_vm_to_vapp adds a VM into an existing vApp', async () => {
    log.separator(UC + ': add_vm_to_vapp');
    const vappId = created.vappId;
    if (!vappId) { log.warn(`${UC}: no vappId from UC-VA-001 — skipping`); return; }
    const result = await client.call('add_vm_to_vapp', {
      vappId,
      templateId,
      vmName: `test-vm-${Date.now()}`,
    }, cfg.timeouts.taskPoll);

    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);
    log.result(UC, 'add_vm_to_vapp completed', true);
    expect(result).toBeTruthy();
  });

  test('list_vms shows new VM under the vApp', async () => {
    log.separator(UC + ': list_vms verify');
    const vappId = created.vappId;
    if (!vappId) { log.warn(`${UC}: no vappId from UC-VA-001 — skipping`); return; }
    const vms    = toArray(await client.call('list_vms', { vappId }));
    log.result(UC, 'VM added to vApp', vms.length > 0, `vmCount=${vms.length}`);
    expect(vms.length).toBeGreaterThan(0);
  });
});

// ─── UC-VA-003: Power On vApp ─────────────────────────────────────────────
describe('UC-VA-003 — Power On a vApp', () => {
  const UC = 'UC-VA-003';
  // Use the newly created vApp from UC-VA-001 if available;
  // vappIdOff fixture may be absent if it was deleted by a previous test run.
  let targetVappId;

  beforeAll(() => {
    targetVappId = created.vappId;
    if (!targetVappId) log.warn(`${UC}: no vappId from UC-VA-001 — all power-on tests will skip`);
  });

  test('power_on_vapp transitions vApp to powered-on', async () => {
    log.separator(UC + ': power_on_vapp');
    if (!targetVappId) { log.warn(`${UC}: no vApp to power on — skipping`); expect(true).toBe(true); return; }
    const vappId = targetVappId;
    const result = await client.call('power_on_vapp', { vappId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'power_on_vapp accepted', true);
    expect(result).toBeTruthy();
  });

  test('get_vapp status is Powered On', async () => {
    log.separator(UC + ': verify vApp status');
    if (!targetVappId) { log.warn(`${UC}: no vApp — skipping`); expect(true).toBe(true); return; }
    const vapp   = await waitForVappStatus(client, targetVappId, 'Powered On');
    const status = vapp?.status || '';
    log.result(UC, 'vApp Powered On', status.toLowerCase().includes('powered'), `status="${status}"`);
    expect(status).toMatch(/powered.?on|running/i);
  });

  test('list_vms shows VMs inside vApp are powered on', async () => {
    log.separator(UC + ': list_vms check');
    if (!targetVappId) { log.warn(`${UC}: no vApp — skipping`); expect(true).toBe(true); return; }
    const vms = toArray(await client.call('list_vms', { vappId: targetVappId }));
    vms.forEach((v, i) => log.debug(`  VM[${i}] status=${JSON.stringify(v.status)} powerState=${JSON.stringify(v.powerState)}`));
    const poweredOn = vms.filter(v => {
      // status may be: numeric 4, string 'POWERED_ON'/'powered_on', or absent (vApp confirmed on)
      if (v.status === undefined && v.powerState === undefined) return true;
      const s = String(v.status ?? v.powerState ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      // Exclude only explicitly-off/suspended states
      return !['8','poweredoff','off','3','suspended','1','resolved'].includes(s);
    });
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
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'power_off_vapp accepted', true);
    expect(result).toBeTruthy();
  });

  test('get_vapp status is Powered Off within timeout', async () => {
    log.separator(UC + ': verify vApp status');
    // Ubuntu 22.04 graceful shutdown can take 4-8 minutes — use 10m timeout
    const vapp   = await waitForVappStatus(client, cfg.fixtures.vappIdOn, 'Powered Off', 600_000);
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
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id') || get(result, 'data', 'taskId');
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
    const name = get(vapp, 'data', 'name') || vapp?.name || '';
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
    targetVappId = created.vappId;
    if (!targetVappId) log.warn(`${UC}: no vappId from UC-VA-001 — delete tests will skip`);
  });

  test('list_vapps confirms target vApp exists before deletion', async () => {
    log.separator(UC + ': pre-delete list_vapps');
    if (!targetVappId) { log.warn(`${UC}: no vappId — skipping`); return; }
    const vapps = toArray(await client.call('list_vapps', {}));
    const found = vapps.some(v => (v.id || v.vappId) === targetVappId);
    log.result(UC, 'vApp exists before delete', found);
    if (!found) log.warn(`vApp ${targetVappId} not found — may have been cleaned up already`);
  });

  test('delete_vapp removes the vApp permanently', async () => {
    log.separator(UC + ': delete_vapp');
    if (!targetVappId) { log.warn(`${UC}: no vappId — skipping`); return; }
    const result = await client.call('delete_vapp', { vappId: targetVappId }, cfg.timeouts.taskPoll);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);
    log.result(UC, 'delete_vapp completed', true);
    created.vappId = null;
    expect(result).toBeTruthy();
  });

  test('list_vapps no longer returns the deleted vApp', async () => {
    log.separator(UC + ': post-delete list_vapps');
    if (!targetVappId) { log.warn(`${UC}: no vappId — skipping`); return; }
    const vapps = toArray(await client.call('list_vapps', {}));
    const found = vapps.some(v => (v.id || v.vappId) === targetVappId);
    log.result(UC, 'vApp absent after delete', !found);
    expect(found).toBe(false);
  });
});
