'use strict';
/**
 * Jest globalTeardown — delete all test fixtures created by globalSetup.
 *
 * Reads tests/fixtures-runtime.json to find the vApp IDs that were
 * provisioned by globalSetup, undeploys and deletes each one, then
 * removes the file so a fresh run starts clean.
 *
 * Failures are logged but do NOT throw — teardown is best-effort so that
 * a broken VCD state doesn't swallow the real test result.
 */

const path = require('path');
const fs   = require('fs');

const McpClient = require('./McpClient');
const { waitForTask, sleep, get } = require('./helpers');

const RUNTIME_FIXTURES_FILE = path.resolve(__dirname, 'fixtures-runtime.json');
const TASK_TIMEOUT = 300_000;

async function deleteVapp(client, vappId) {
  console.log(`  → Deleting vApp ${vappId}…`);
  try {
    // Undeploy (power off + undeploy) — ignore errors if already undeployed
    const undeployResult = await client.call('undeploy_vapp', { vappId }, TASK_TIMEOUT).catch(() => null);
    if (undeployResult) {
      const tid = get(undeployResult, 'data', 'taskId') || get(undeployResult, 'taskId');
      if (tid) await waitForTask(client, tid, TASK_TIMEOUT).catch(() => {});
    }
    await sleep(2_000);

    const deleteResult = await client.call('delete_vapp', { vappId }, TASK_TIMEOUT);
    const taskId = get(deleteResult, 'data', 'taskId') || get(deleteResult, 'taskId');
    if (taskId) await waitForTask(client, taskId, TASK_TIMEOUT);
    console.log(`  ✓ Deleted ${vappId}`);
  } catch (err) {
    console.warn(`  ⚠  Failed to delete vApp ${vappId}: ${err.message}`);
  }
}

module.exports = async function globalTeardown() {
  console.log('\n🧹 Tearing down test fixtures…\n');

  let fixtures;
  try {
    fixtures = JSON.parse(fs.readFileSync(RUNTIME_FIXTURES_FILE, 'utf8'));
  } catch {
    console.log('  No fixtures-runtime.json found — nothing to clean up.');
    console.log('\n✅ Test run complete.\n');
    return;
  }

  const vappIds = (fixtures._createdVapps || []).filter(Boolean);
  if (!vappIds.length) {
    console.log('  No created vApps to clean up.');
    try { fs.unlinkSync(RUNTIME_FIXTURES_FILE); } catch {}
    console.log('\n✅ Test run complete.\n');
    return;
  }

  const client = new McpClient();
  try {
    await client.connect();
    for (const vappId of vappIds) {
      await deleteVapp(client, vappId);
    }
    console.log(`\n  Deleted ${vappIds.length} vApp(s).`);
  } catch (err) {
    console.warn(`  ⚠  Teardown error: ${err.message}`);
  } finally {
    client.disconnect();
    try { fs.unlinkSync(RUNTIME_FIXTURES_FILE); } catch {}
  }

  console.log('\n✅ Test run complete.\n');
};
