'use strict';
/**
 * Jest globalSetup — provision test fixtures before the suite runs.
 *
 * Creates two vApps from the Ubuntu 22.04 template:
 *   mcp-test-off  → vmIdOff  (stays powered off)
 *   mcp-test-on   → vmIdOn   (powered on before tests)
 *
 * Fixture IDs are written to tests/fixtures-runtime.json.
 * config.js reads that file and merges the IDs over the hardcoded defaults,
 * so all test files pick them up transparently via cfg.fixtures.*.
 *
 * globalTeardown deletes the vApps and removes the file.
 */

const path = require('path');
const fs   = require('fs');

const McpClient = require('./McpClient');
const { waitForTask, waitForVmPower, toArray, sleep, get } = require('./helpers');
const { logFile } = require('./logger');

const RUNTIME_FIXTURES_FILE = path.resolve(__dirname, 'fixtures-runtime.json');

// Ubuntu Server 22.04 — status RESOLVED, Jakarta catalog (Ubuntu, id 5d5ca569-…)
const UBUNTU_22_TEMPLATE_HREF =
  'https://mycloud-jkt.zettagrid.id/api/vAppTemplate/vappTemplate-36bc8ad6-5e96-408f-a110-dc43f5660e28';
const VDC_ID  = '193b49aa-ab89-486b-a3ef-83e3953a106c';  // DC_1138718 / Jakarta
const ZONE_ID = 'jakarta';

const TASK_TIMEOUT  = 300_000;  // 5 min
const POWER_TIMEOUT = 180_000;  // 3 min

// ── ID normalisation helpers ──────────────────────────────────────────────────

function toVmUrn(raw) {
  if (!raw) return null;
  if (typeof raw === 'string' && raw.startsWith('urn:vcloud:vm:')) return raw;
  const m = String(raw).match(/vm-([0-9a-f-]{36})/);
  if (m) return `urn:vcloud:vm:${m[1]}`;
  if (/^[0-9a-f-]{36}$/.test(String(raw))) return `urn:vcloud:vm:${raw}`;
  return String(raw);
}

function toVappUrn(raw) {
  if (!raw) return null;
  if (typeof raw === 'string' && raw.startsWith('urn:vcloud:vapp:')) return raw;
  const m = String(raw).match(/vapp-([0-9a-f-]{36})/);
  if (m) return `urn:vcloud:vapp:${m[1]}`;
  if (/^[0-9a-f-]{36}$/.test(String(raw))) return `urn:vcloud:vapp:${raw}`;
  return String(raw);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function deleteStaleVapp(client, vappName) {
  const vapps = toArray(await client.call('list_vapps', {}));
  const stale = vapps.find(v => v.name === vappName);
  if (!stale) return;
  const staleId = toVappUrn(stale.id || stale.vappId || stale.href);
  if (!staleId) return;
  console.log(`  ⚠️  Stale vApp "${vappName}" found (${staleId}) — deleting before recreating…`);
  const del = await client.call('delete_vapp', { vappId: staleId }, TASK_TIMEOUT);
  const delTask = get(del, 'data', 'taskId') || get(del, 'taskId');
  if (delTask) await waitForTask(client, delTask, TASK_TIMEOUT);
  await sleep(3_000);
  console.log(`  ✓ Stale "${vappName}" deleted`);
}

async function createVapp(client, vappName) {
  // Delete any stale vApp with the same name (leftover from a crashed/interrupted run)
  await deleteStaleVapp(client, vappName);

  console.log(`  → Creating vApp "${vappName}"…`);
  const result = await client.call('create_vapp', {
    vappName,
    templateId: UBUNTU_22_TEMPLATE_HREF,
    vdcId:      VDC_ID,
    zoneId:     ZONE_ID,
  }, TASK_TIMEOUT);

  if (result?.success === false) {
    throw new Error(
      `create_vapp "${vappName}" returned success=false: ${JSON.stringify(result?.error)}`
    );
  }

  const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
  if (taskId) {
    console.log(`     ⏳ Waiting for task ${taskId}…`);
    await waitForTask(client, taskId, TASK_TIMEOUT);
  }

  let vappId = toVappUrn(
    get(result, 'data', 'vappId') || get(result, 'data', 'id') ||
    get(result, 'vappId')         || get(result, 'id')
  );

  // Fallback: search by name (handles regex-miss in vappId extraction)
  if (!vappId) {
    console.log(`     🔍 vappId missing from response — searching by name…`);
    await sleep(5_000);
    const vapps = toArray(await client.call('list_vapps', {}));
    const found = vapps.find(v => v.name === vappName);
    if (found) vappId = toVappUrn(found.id || found.vappId || found.href);
  }

  if (!vappId) throw new Error(`Could not obtain vappId for "${vappName}" after creation`);
  console.log(`     ✓ vApp "${vappName}" = ${vappId}`);
  return vappId;
}

async function getVmFromVapp(client, vappId) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    await sleep(3_000);
    const vms = toArray(await client.call('list_vms', { vappId }));
    if (vms.length > 0) {
      const raw = vms[0].id || vms[0].vmId || vms[0].href;
      return toVmUrn(raw);
    }
    console.log(`     ⏳ Waiting for VM to appear in ${vappId} (attempt ${attempt}/6)…`);
  }
  throw new Error(`No VMs found in vApp ${vappId} after polling`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

module.exports = async function globalSetup() {
  console.log(`\n📋 Log file: ${logFile}\n`);
  console.log('🔧 Setting up test fixtures…\n');

  const client = new McpClient();
  const createdVapps = [];

  try {
    await client.connect();

    // 1. Powered-off fixture
    const vappIdOff = await createVapp(client, 'mcp-test-off');
    createdVapps.push(vappIdOff);
    const vmIdOff = await getVmFromVapp(client, vappIdOff);
    console.log(`  ✓ vmIdOff   = ${vmIdOff}`);

    // 2. Powered-on fixture
    const vappIdOn = await createVapp(client, 'mcp-test-on');
    createdVapps.push(vappIdOn);
    const vmIdOn = await getVmFromVapp(client, vappIdOn);
    console.log(`  ✓ vmIdOn    = ${vmIdOn}`);

    // 3. Power on the "on" vApp
    console.log(`\n  → Powering on ${vappIdOn}…`);
    const powerResult = await client.call('power_on_vapp', { vappId: vappIdOn }, POWER_TIMEOUT);
    const powerTaskId = get(powerResult, 'data', 'taskId') || get(powerResult, 'taskId');
    if (powerTaskId) await waitForTask(client, powerTaskId, POWER_TIMEOUT);
    await waitForVmPower(client, vmIdOn, 'poweredOn', POWER_TIMEOUT);
    console.log(`  ✓ vmIdOn is POWERED ON`);

    // 4. Persist fixture IDs
    const fixtures = {
      vmIdOff,
      vmIdOn,
      vappIdOn,
      vappIdOff,
      vmIdTools:     vmIdOn,       // vmIdTools reuses vmIdOn (same template)
      _createdVapps: createdVapps, // consumed by globalTeardown
    };
    fs.writeFileSync(RUNTIME_FIXTURES_FILE, JSON.stringify(fixtures, null, 2));

    console.log('\n✅ Fixtures ready:\n');
    console.log(`   vmIdOff   = ${vmIdOff}`);
    console.log(`   vmIdOn    = ${vmIdOn}`);
    console.log(`   vappIdOn  = ${vappIdOn}`);
    console.log(`   vappIdOff = ${vappIdOff}\n`);

  } catch (err) {
    // Write partial fixture so teardown can still clean up created vApps
    const partial = { _setupFailed: true, _error: err.message, _createdVapps: createdVapps };
    fs.writeFileSync(RUNTIME_FIXTURES_FILE, JSON.stringify(partial, null, 2));
    client.disconnect();
    throw new Error(
      `globalSetup failed — test VMs could not be provisioned.\n  Cause: ${err.message}`
    );
  }

  client.disconnect();
};
