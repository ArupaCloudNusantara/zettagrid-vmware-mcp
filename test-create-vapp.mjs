import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';

const BASE_URL = 'http://127.0.0.1:3001/mcp';

// Desired VM hardware (applied post-instantiation)
const DESIRED = { cpuCount: 2, coresPerSocket: 1, memoryMB: 2048, diskSizeMB: 20480 };

// SSH public key injected via cloud-init OVF property
const SSH_PUBLIC_KEY = readFileSync(`${homedir()}/.ssh/id_ed25519.pub`, 'utf8').trim();

async function callTool(client, name, args) {
  console.log(`\n→ ${name}`, JSON.stringify(args ?? {}));
  const result = await client.callTool({ name, arguments: args ?? {} });
  const text = result.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text; }
}

async function waitForTask(client, taskHref, label = 'task', timeoutMs = 180000) {
  const taskId = taskHref.split('/task/')[1];
  if (!taskId) throw new Error(`Cannot parse taskId from href: ${taskHref}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const r = await callTool(client, 'get_task', { taskId });
    const status = r?.data?.taskStatus;
    console.log(`  ${label}: ${status}`);
    if (status === 'success') return;
    if (status === 'error' || status === 'aborted') throw new Error(`Task ${label} failed: ${status}`);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForVappGone(client, vappName, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const vapps = await callTool(client, 'list_vapps', {});
    const list = vapps?.data?.items ?? [];
    if (!list.find(v => v.name === vappName)) { console.log(`  "${vappName}" gone.`); return; }
    console.log(`  Still waiting for "${vappName}" to be deleted...`);
  }
  throw new Error(`Timed out waiting for vApp "${vappName}" to be deleted`);
}

async function waitForNatRule(client, egwId, ruleName, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const nats = await callTool(client, 'list_nat_rules', { edgeGatewayId: egwId });
    if ((nats?.data?.items ?? []).find(r => r.name === ruleName)) {
      console.log(`  NAT rule "${ruleName}" confirmed.`);
      return;
    }
    console.log(`  Waiting for NAT rule "${ruleName}"...`);
  }
  throw new Error(`Timed out waiting for NAT rule "${ruleName}"`);
}

async function cleanupNatAndFw(client, egwId, ruleName) {
  // Remove NAT rules
  const nats = await callTool(client, 'list_nat_rules', { edgeGatewayId: egwId });
  const oldNats = (nats?.data?.items ?? []).filter(r => r.name === ruleName);
  for (const r of oldNats) {
    console.log(`  Removing NAT rule: ${r.name} (${r.id})`);
    await callTool(client, 'delete_nat_rule', { edgeGatewayId: egwId, ruleId: r.id });
  }
  if (!oldNats.length) console.log(`  No NAT rules named "${ruleName}".`);

  // Remove firewall rules
  const fws = await callTool(client, 'list_firewall_rules', { edgeGatewayId: egwId });
  const oldFws = (fws?.data?.items ?? []).filter(r => r.name === ruleName);
  for (const r of oldFws) {
    console.log(`  Removing firewall rule: ${r.name} (${r.id})`);
    await callTool(client, 'delete_firewall_rule', { edgeGatewayId: egwId, ruleId: r.id });
  }
  if (!oldFws.length) console.log(`  No firewall rules named "${ruleName}".`);
}

async function cleanup(client, vappName, egwId) {
  console.log(`\n── Cleanup: vApp "${vappName}"`);
  const vapps = await callTool(client, 'list_vapps', {});
  const leftovers = (vapps?.data?.items ?? []).filter(v => v.name === vappName);
  if (leftovers.length) {
    for (const vapp of leftovers) {
      console.log(`  Found ${vapp.id} (${vapp.status})`);
      if (!['POWERED_OFF', 'RESOLVED', 'UNRESOLVED'].includes(vapp.status ?? '')) {
        const r = await callTool(client, 'power_off_vapp', { vappId: vapp.id });
        if (r?.data?.taskHref) await waitForTask(client, r.data.taskHref, 'power-off');
        else await new Promise(r => setTimeout(r, 8000));
      }
      await callTool(client, 'delete_vapp', { vappId: vapp.id });
    }
    await waitForVappGone(client, vappName);
  } else {
    console.log('  No vApp found.');
  }

  if (egwId) {
    console.log(`\n── Cleanup: NAT/FW rules "${vappName}-ssh"`);
    await cleanupNatAndFw(client, egwId, `${vappName}-ssh`);
  }
}

async function main() {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(BASE_URL)));
  console.log('Connected\n');

  // ── 1. VDC ──────────────────────────────────────────────────────────────────
  const vdcs = await callTool(client, 'list_vdcs', {});
  const vdc = (vdcs?.data?.items ?? vdcs?.data ?? [])[0];
  if (!vdc) { console.error('No VDCs'); process.exit(1); }
  console.log(`\n✓ VDC: ${vdc.name} (${vdc.id})`);

  // ── 2. Edge gateway for this VDC ────────────────────────────────────────────
  const egws = await callTool(client, 'list_edge_gateways', {});
  const egw = (egws?.data?.items ?? []).find(g => g.ownerVdc === vdc.name);
  if (!egw) { console.error('No edge gateway for VDC', vdc.name); process.exit(1); }
  console.log(`\n✓ Edge gateway: ${egw.name} (${egw.id})`);

  // Extract primary public IP from edge gateway uplinks
  const egwDetail = await callTool(client, 'get_edge_gateway', { edgeGatewayId: egw.id });
  const uplinks = egwDetail?.data?._raw?.edgeGatewayUplinks ?? [];
  let publicIp = null;
  for (const uplink of uplinks) {
    for (const subnet of uplink.subnets?.values ?? []) {
      if (subnet.primaryIp) { publicIp = subnet.primaryIp; break; }
    }
    if (publicIp) break;
  }
  if (!publicIp) { console.error('No primary public IP found on edge gateway'); process.exit(1); }
  console.log(`✓ Public IP: ${publicIp}`);

  // ── 3. Template ─────────────────────────────────────────────────────────────
  const items = await callTool(client, 'list_catalog_items', {});
  const allItems = items?.data?.items ?? [];
  const template = allItems.find(i =>
    i.entityType === 'vapptemplate' &&
    i.name?.toLowerCase().includes('ubuntu') &&
    (i.name?.includes('24') || i.name?.toLowerCase().includes('24.04'))
  );
  if (!template) {
    console.log('Templates:', allItems.filter(i => i.entityType === 'vapptemplate').map(i => i.name));
    console.error('No Ubuntu 24.04 template'); process.exit(1);
  }
  const templateHref = template.entity ?? template.href ?? template.id;
  console.log(`\n✓ Template: ${template.name}`);

  // ── 4. Network ──────────────────────────────────────────────────────────────
  const networks = await callTool(client, 'list_org_networks', {});
  const netList = networks?.data?.items ?? [];
  const routedNets = netList.filter(n =>
    n.linkType === 1 &&
    n.vdc?.includes(vdc.id) &&
    (n.totalIpCount - (n.usedIpCount ?? 0)) > 0
  );
  if (!routedNets.length) { console.error('No routed networks with free IPs found'); process.exit(1); }
  const net = routedNets.find(n => n.name?.startsWith('DC_')) ?? routedNets[0];
  console.log(`\n✓ Network: ${net.name} (gateway: ${net.defaultGateway}, free IPs: ${net.totalIpCount - (net.usedIpCount ?? 0)})`);

  // ── 0. Cleanup (after discovering egw so we can also clean up NAT/FW rules) ─
  await cleanup(client, 'claude-test', egw.id);

  // ── Phase 1: Instantiate vApp ────────────────────────────────────────────────
  console.log('\n── Phase 1: instantiate from template');
  const createResult = await callTool(client, 'create_vapp', {
    vdcId: vdc.id,
    templateId: templateHref,
    vappName: 'claude-test',
    instantiationParams: {
      networkConfig: [{
        networkName: net.name,
        parentNetworkHref: net.href,
        fenceMode: 'bridged'
      }],
      vmConfigs: [{
        vmName: 'claude-test',
        networkConnections: [{
          networkName: net.name,
          ipMode: 'POOL'
        }],
        ovfProperties: [
          { key: 'instance-id',  value: 'claude-test-001' },
          { key: 'hostname',     value: 'claude-test' },
          { key: 'password',     value: 'Rahasia123' },
          { key: 'public-keys',  value: SSH_PUBLIC_KEY },
          // Prevent password expiry; also lock in hostname so it survives VCD customisation
          { key: 'user-data',    value: Buffer.from(
              '#cloud-config\npreserve_hostname: false\nhostname: claude-test\nfqdn: claude-test\nchpasswd:\n  expire: False\n'
            ).toString('base64') }
        ]
      }]
    }
  });
  if (!createResult?.success) {
    console.error('create_vapp failed:', createResult?.error?.message);
    process.exit(1);
  }
  const { vmId, vappId, task } = createResult.data;
  console.log(`  vApp: ${vappId}  VM: ${vmId}  task: ${task?.status}`);

  // ── Phase 2: Wait for instantiation ─────────────────────────────────────────
  console.log('\n── Phase 2: wait for instantiation');
  await waitForTask(client, task.href, 'instantiate');

  // Get VM's assigned IP (POOL assigns IP at instantiation time)
  const vmInfo = await callTool(client, 'get_vm', { vmId });
  const vmIp = vmInfo?.data?.networkConnections?.[0]?.ipAddress;
  if (!vmIp) { console.error('VM has no IP address after instantiation'); process.exit(1); }
  console.log(`  VM IP: ${vmIp}`);

  // ── Phase 2.5: Set computer name (VCD injects this as vCloud_computerName on boot) ──
  console.log('\n── Phase 2.5: set computer name');
  let r = await callTool(client, 'update_vm_computer_name', { vmId, computerName: 'claude-test' });
  console.log('  computer name:', r?.success ? 'ok' : r?.error?.message);
  if (r?.data?.taskHref) await waitForTask(client, r.data.taskHref, 'computer-name');

  // ── Phase 3: Resize hardware ─────────────────────────────────────────────────
  console.log('\n── Phase 3: resize hardware');

  r = await callTool(client, 'update_vm_cpu', { vmId, cpuCount: DESIRED.cpuCount, coresPerSocket: DESIRED.coresPerSocket });
  console.log('  cpu:', r?.success ? 'ok' : r?.error?.message);
  if (r?.data?.taskHref) await waitForTask(client, r.data.taskHref, 'cpu-resize');

  r = await callTool(client, 'update_vm_memory', { vmId, memoryMB: DESIRED.memoryMB });
  console.log('  memory:', r?.success ? 'ok' : r?.error?.message);
  if (r?.data?.taskHref) await waitForTask(client, r.data.taskHref, 'memory-resize');

  r = await callTool(client, 'update_vm_disk', { vmId, diskSizeMB: DESIRED.diskSizeMB });
  console.log('  disk:', r?.success ? 'ok' : r?.error?.message);
  if (r?.data?.taskHref) await waitForTask(client, r.data.taskHref, 'disk-resize');

  // ── Phase 4: Power on ────────────────────────────────────────────────────────
  console.log('\n── Phase 4: power on');
  r = await callTool(client, 'power_on_vapp', { vappId });
  console.log('  power-on task:', r?.data?.taskStatus ?? r?.error?.message);
  if (r?.data?.taskHref) await waitForTask(client, r.data.taskHref, 'power-on');

  // ── Phase 5: Publish SSH to public IP ────────────────────────────────────────
  console.log('\n── Phase 5: publish SSH port');

  // DNAT: publicIP:22 → vmIP:22
  r = await callTool(client, 'create_nat_rule', {
    edgeGatewayId: egw.id,
    name: 'claude-test-ssh',
    type: 'DNAT',
    externalAddresses: publicIp,
    externalPort: '22',
    internalAddresses: vmIp,
    internalPort: '22',
    description: `SSH access to claude-test (${vmIp})`,
    firewallMatch: 'MATCH_EXTERNAL_ADDRESS'
  });
  console.log('  DNAT rule:', r?.success ? `${publicIp}:22 → ${vmIp}:22 (queued)` : r?.error?.message);
  await waitForNatRule(client, egw.id, 'claude-test-ssh');

  // Firewall: allow inbound TCP to publicIP (port 22 is enforced by DNAT)
  r = await callTool(client, 'create_firewall_rule', {
    edgeGatewayId: egw.id,
    name: 'claude-test-ssh',
    description: `Allow SSH to claude-test (${vmIp})`,
    policy: 'allow',
    destinationIp: publicIp
  });
  console.log('  Firewall rule:', r?.success ? 'created' : r?.error?.message);

  // ── Phase 6: verify SSH ───────────────────────────────────────────────────────
  console.log('\n── Phase 6: verify SSH (waiting up to 300s for cloud-init)');
  let sshOk = false;
  const sshDeadline = Date.now() + 300000;
  while (Date.now() < sshDeadline) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const { execSync } = await import('child_process');
      const out = execSync(
        `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -i ~/.ssh/id_ed25519 ubuntu@${publicIp} 'hostname && df -h / | tail -1'`,
        { timeout: 10000 }
      ).toString().trim();
      console.log(`  SSH ok:\n${out.split('\n').map(l => '    ' + l).join('\n')}`);
      sshOk = true;
      break;
    } catch {
      console.log('  Waiting for cloud-init to finish...');
    }
  }
  if (!sshOk) console.log('  SSH not ready within 120s (cloud-init may still be running)');

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n══ Done ══');
  console.log(`  vApp ID  : ${vappId}`);
  console.log(`  VM ID    : ${vmId}`);
  console.log(`  VM IP    : ${vmIp}`);
  console.log(`  SSH      : ssh -i ~/.ssh/id_ed25519 ubuntu@${publicIp}`);

  await client.close();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
