#!/usr/bin/env tsx
/**
 * Test all currently available MCP tools in Perth zone
 * Usage: npx tsx src/examples/test-available-tools.ts
 */

import { ZettagridClient } from '../client/zettagrid-client.js';
import { config } from 'dotenv';

// Load environment variables
config();

const ZONE = 'perth'; // Testing in Perth zone
const DELAY_MS = 1000; // Delay between tests to avoid rate limiting

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testAvailableTools() {
  console.log('🚀 Zettagrid MCP Available Tools Test');
  console.log('=====================================');
  console.log(`📍 Testing Zone: ${ZONE.toUpperCase()}`);
  console.log(`⏱️  Start Time: ${new Date().toISOString()}\n`);
  
  const client = new ZettagridClient();
  const testResults: { tool: string; status: string; details?: string }[] = [];
  
  try {
    console.log('✅ Client created successfully\n');
    
    // Store IDs for cross-tool testing
    let orgId: string | undefined;
    let vdcId: string | undefined;
    let vappId: string | undefined;
    let vmId: string | undefined;
    
    // Test 1: Zone Info
    console.log('1️⃣  Testing get_zone_info...');
    try {
      const zoneInfo = await client.getZoneInfo();
      if (zoneInfo.error) {
        testResults.push({ tool: 'get_zone_info', status: '❌ Failed', details: zoneInfo.error.message });
        console.error('❌ Failed:', zoneInfo.error.message);
      } else {
        testResults.push({ tool: 'get_zone_info', status: '✅ Success' });
        console.log('✅ Success! Zone info retrieved');
      }
    } catch (e) {
      testResults.push({ tool: 'get_zone_info', status: '❌ Error', details: String(e) });
      console.error('❌ Error:', e);
    }
    await delay(DELAY_MS);
    
    // Test 2: List Organizations
    console.log('\n2️⃣  Testing list_organizations...');
    try {
      const orgs = await client.listOrganizations(ZONE);
      if (orgs.error) {
        testResults.push({ tool: 'list_organizations', status: '❌ Failed', details: orgs.error.message });
        console.error('❌ Failed:', orgs.error.message);
      } else if (orgs.data && Array.isArray(orgs.data)) {
        testResults.push({ tool: 'list_organizations', status: '✅ Success', details: `Found ${orgs.data.length} organizations` });
        console.log(`✅ Success! Found ${orgs.data.length} organizations`);
        if (orgs.data.length > 0) {
          orgId = orgs.data[0].id;
          console.log(`   First org: ${orgs.data[0].name} (${orgId})`);
        }
      }
    } catch (e) {
      testResults.push({ tool: 'list_organizations', status: '❌ Error', details: String(e) });
      console.error('❌ Error:', e);
    }
    await delay(DELAY_MS);
    
    // Test 3: Get Organization (if we have an ID)
    if (orgId) {
      console.log('\n3️⃣  Testing get_organization...');
      try {
        const org = await client.getOrganization(orgId, ZONE);
        if (org.error) {
          testResults.push({ tool: 'get_organization', status: '❌ Failed', details: org.error.message });
          console.error('❌ Failed:', org.error.message);
        } else if (org.data) {
          testResults.push({ tool: 'get_organization', status: '✅ Success', details: org.data.name });
          console.log(`✅ Success! Org: ${org.data.name}`);
        }
      } catch (e) {
        testResults.push({ tool: 'get_organization', status: '❌ Error', details: String(e) });
        console.error('❌ Error:', e);
      }
      await delay(DELAY_MS);
    }
    
    // Test 4: List VDCs
    console.log('\n4️⃣  Testing list_vdcs...');
    try {
      const vdcs = await client.listVdcs(ZONE);
      if (vdcs.error) {
        testResults.push({ tool: 'list_vdcs', status: '❌ Failed', details: vdcs.error.message });
        console.error('❌ Failed:', vdcs.error.message);
      } else if (vdcs.data && vdcs.data.items) {
        testResults.push({ tool: 'list_vdcs', status: '✅ Success', details: `Found ${vdcs.data.items.length} VDCs` });
        console.log(`✅ Success! Found ${vdcs.data.items.length} VDCs`);
        if (vdcs.data.items.length > 0) {
          vdcId = vdcs.data.items[0].id;
          console.log(`   First VDC: ${vdcs.data.items[0].name} (${vdcId})`);
        }
      }
    } catch (e) {
      testResults.push({ tool: 'list_vdcs', status: '❌ Error', details: String(e) });
      console.error('❌ Error:', e);
    }
    await delay(DELAY_MS);
    
    // Test 5: Get VDC (if we have an ID)
    if (vdcId) {
      console.log('\n5️⃣  Testing get_vdc...');
      try {
        const vdc = await client.getVdc(vdcId, ZONE);
        if (vdc.error) {
          testResults.push({ tool: 'get_vdc', status: '❌ Failed', details: vdc.error.message });
          console.error('❌ Failed:', vdc.error.message);
        } else if (vdc.data) {
          testResults.push({ tool: 'get_vdc', status: '✅ Success', details: vdc.data.name });
          console.log(`✅ Success! VDC: ${vdc.data.name}`);
        }
      } catch (e) {
        testResults.push({ tool: 'get_vdc', status: '❌ Error', details: String(e) });
        console.error('❌ Error:', e);
      }
      await delay(DELAY_MS);
    }
    
    // Test 6: List vApps
    console.log('\n6️⃣  Testing list_vapps...');
    try {
      const vapps = await client.listVApps(vdcId, ZONE);
      if (vapps.error) {
        testResults.push({ tool: 'list_vapps', status: '❌ Failed', details: vapps.error.message });
        console.error('❌ Failed:', vapps.error.message);
      } else if (vapps.data && vapps.data.items) {
        testResults.push({ tool: 'list_vapps', status: '✅ Success', details: `Found ${vapps.data.items.length} vApps` });
        console.log(`✅ Success! Found ${vapps.data.items.length} vApps`);
        if (vapps.data.items.length > 0) {
          vappId = vapps.data.items[0].id;
          console.log(`   First vApp: ${vapps.data.items[0].name} (${vappId})`);
        }
      }
    } catch (e) {
      testResults.push({ tool: 'list_vapps', status: '❌ Error', details: String(e) });
      console.error('❌ Error:', e);
    }
    await delay(DELAY_MS);
    
    // Test 7: List VMs
    console.log('\n7️⃣  Testing list_vms...');
    try {
      const vms = await client.listVMs(vappId, ZONE);
      if (vms.error) {
        testResults.push({ tool: 'list_vms', status: '❌ Failed', details: vms.error.message });
        console.error('❌ Failed:', vms.error.message);
      } else if (vms.data && vms.data.items) {
        testResults.push({ tool: 'list_vms', status: '✅ Success', details: `Found ${vms.data.items.length} VMs` });
        console.log(`✅ Success! Found ${vms.data.items.length} VMs`);
        if (vms.data.items.length > 0) {
          vmId = vms.data.items[0].id;
          console.log(`   First VM: ${vms.data.items[0].name} (${vmId})`);
        }
      }
    } catch (e) {
      testResults.push({ tool: 'list_vms', status: '❌ Error', details: String(e) });
      console.error('❌ Error:', e);
    }
    await delay(DELAY_MS);
    
    // Test 8: VM Operations (if we have a VM ID)
    if (vmId) {
      // Test get_vm_console
      console.log('\n8️⃣  Testing get_vm_console...');
      try {
        const consoleResult = await client.getVMConsole(vmId, ZONE);
        if (consoleResult.error) {
          testResults.push({ tool: 'get_vm_console', status: '❌ Failed', details: consoleResult.error.message });
          console.error('❌ Failed:', consoleResult.error.message);
          if (consoleResult.error.details) {
            console.log('   Details:', JSON.stringify(consoleResult.error.details, null, 2));
          }
        } else {
          testResults.push({ tool: 'get_vm_console', status: '✅ Success' });
          console.log('✅ Success! Console ticket acquired');
          if (consoleResult.data && consoleResult.data.ticket) {
            console.log(`   Ticket: ${consoleResult.data.ticket.substring(0, 20)}...`);
          }
        }
      } catch (e) {
        testResults.push({ tool: 'get_vm_console', status: '❌ Error', details: String(e) });
        console.error('❌ Error:', e);
      }
      await delay(DELAY_MS);
      
      // Note: Skipping power_on_vm and power_off_vm to avoid disrupting running VMs
      console.log('\n⚠️  Skipping power_on_vm and power_off_vm tests to avoid disrupting running VMs');
      testResults.push({ tool: 'power_on_vm', status: '⏭️  Skipped', details: 'Avoided to prevent VM disruption' });
      testResults.push({ tool: 'power_off_vm', status: '⏭️  Skipped', details: 'Avoided to prevent VM disruption' });
    }
    
    // Test 9: Test Zone
    console.log('\n9️⃣  Testing test_zone...');
    try {
      const testZone = await client.testZone(ZONE);
      if (testZone.error) {
        testResults.push({ tool: 'test_zone', status: '❌ Failed', details: testZone.error.message });
        console.error('❌ Failed:', testZone.error.message);
      } else {
        testResults.push({ tool: 'test_zone', status: '✅ Success' });
        console.log('✅ Success! Zone test completed');
      }
    } catch (e) {
      testResults.push({ tool: 'test_zone', status: '❌ Error', details: String(e) });
      console.error('❌ Error:', e);
    }
    
    // Summary
    console.log('\n📊 Test Summary');
    console.log('===============');
    console.log(`✅ Test completed at: ${new Date().toISOString()}`);
    console.log(`📍 Zone tested: ${ZONE}\n`);
    
    console.log('Results by tool:');
    console.log('----------------');
    testResults.forEach(result => {
      console.log(`${result.status} ${result.tool}${result.details ? ` - ${result.details}` : ''}`);
    });
    
    const successCount = testResults.filter(r => r.status.includes('Success')).length;
    const failCount = testResults.filter(r => r.status.includes('Failed') || r.status.includes('Error')).length;
    const skipCount = testResults.filter(r => r.status.includes('Skipped')).length;
    
    console.log(`\n📈 Statistics:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   ⏭️  Skipped: ${skipCount}`);
    console.log(`   📊 Total: ${testResults.length}`);
    
  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
  }
}

// Run the test
console.log('Starting available MCP tools test...\n');
testAvailableTools().catch(console.error);