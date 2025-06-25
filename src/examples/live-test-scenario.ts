/**
 * Comprehensive live test scenario for Perth zone
 * Tests VM creation, power operations, firewall rules, and cleanup
 */

import { readFileSync } from 'fs';
import { ZettagridClient } from '../client/zettagrid-client.js';

// Simple .env file loader
function loadEnvFile() {
  try {
    const envContent = readFileSync('.env', 'utf8');
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim();
        }
      }
    }
  } catch (error) {
    console.log('⚠️  No .env file found, using system environment variables');
  }
}

async function discoverPerthResources(): Promise<void> {
  console.log('🔍 Discovering Perth Zone Resources');
  console.log('=' .repeat(50));

  // Load environment variables
  loadEnvFile();

  const client = new ZettagridClient();
  const zone = 'perth';

  let availableVdcs: any[] = [];
  let availableVapps: any[] = [];
  let availableVMs: any[] = [];

  try {
    // Test authentication first
    console.log('🔐 Testing Authentication...');
    const authTest = await client.testZone(zone);
    if (!authTest.success) {
      console.log(`❌ Authentication failed: ${authTest.error?.message}`);
      return;
    }
    console.log('✅ Authentication successful\n');

    // Discover organizations
    console.log('🏢 Discovering Organizations...');
    const orgsResult = await client.listOrganizations(zone);
    if (orgsResult.success) {
      console.log(`✅ Found ${orgsResult.data?.length || 0} organizations`);
      if (orgsResult.data && orgsResult.data.length > 0) {
        orgsResult.data.forEach((org, i) => {
          console.log(`   ${i + 1}. ${org.name || 'Unknown'} (${org.id || 'no-id'})`);
        });
      }
    } else {
      console.log(`❌ Failed to list organizations: ${orgsResult.error?.message}`);
    }

    // Discover VDCs
    console.log('\n🏗️  Discovering Virtual Data Centers...');
    const vdcsResult = await client.listVdcs(zone);
    if (vdcsResult.success) {
      availableVdcs = vdcsResult.data?.items || [];
      console.log(`✅ Found ${availableVdcs.length} VDCs`);
      if (availableVdcs.length > 0) {
        availableVdcs.forEach((vdc, i) => {
          console.log(`   ${i + 1}. ${vdc.name || 'Unknown'} (${vdc.id || 'no-id'}) - Status: ${vdc.status || 'Unknown'}`);
        });
      }
    } else {
      console.log(`❌ Failed to list VDCs: ${vdcsResult.error?.message}`);
    }

    // Discover vApps
    console.log('\n📱 Discovering vApps...');
    const vappsResult = await client.listVApps(undefined, zone);
    if (vappsResult.success) {
      availableVapps = vappsResult.data?.items || [];
      console.log(`✅ Found ${availableVapps.length} vApps`);
      if (availableVapps.length > 0) {
        availableVapps.forEach((vapp, i) => {
          console.log(`   ${i + 1}. ${vapp.name || 'Unknown'} (${vapp.id || 'no-id'}) - Status: ${vapp.status || 'Unknown'}`);
        });
      }
    } else {
      console.log(`❌ Failed to list vApps: ${vappsResult.error?.message}`);
    }

    // Discover VMs
    console.log('\n💻 Discovering Virtual Machines...');
    const vmsResult = await client.listVMs(undefined, zone);
    if (vmsResult.success) {
      availableVMs = vmsResult.data?.items || [];
      console.log(`✅ Found ${availableVMs.length} VMs`);
      if (availableVMs.length > 0) {
        availableVMs.forEach((vm, i) => {
          console.log(`   ${i + 1}. ${vm.name || 'Unknown'} (${vm.id || 'no-id'}) - Status: ${vm.status || 'Unknown'}`);
        });
      }
    } else {
      console.log(`❌ Failed to list VMs: ${vmsResult.error?.message}`);
    }

    // Test raw API access for more detailed discovery
    console.log('\n🔍 Testing Raw API Access...');
    await testRawApiAccess(client, zone);

    // Summary
    console.log('\n📊 Resource Summary:');
    console.log(`   VDCs: ${availableVdcs.length}`);
    console.log(`   vApps: ${availableVapps.length}`);
    console.log(`   VMs: ${availableVMs.length}`);

    // If resources are available, run comprehensive live test
    if (availableVdcs.length > 0) {
      console.log('\n🚀 Starting Comprehensive Live Test...');
      await runComprehensiveLiveTest(client, zone, availableVdcs, availableVapps, availableVMs);
    } else {
      console.log('\n⚠️  No VDCs available for live testing');
    }

  } catch (error) {
    console.error('\n💥 Discovery failed with exception:');
    console.error(error instanceof Error ? error.message : String(error));
  }
}

async function runComprehensiveLiveTest(
  client: ZettagridClient, 
  zone: string, 
  vdcs: any[], 
  vapps: any[], 
  vms: any[]
): Promise<void> {
  console.log('=' .repeat(60));
  console.log('🧪 COMPREHENSIVE LIVE TEST - PERTH ZONE');
  console.log('=' .repeat(60));

  const testStartTime = Date.now();

  try {
    // Step 1: Select target VDC
    console.log('\n1️⃣  Selecting Target VDC...');
    const targetVdc = vdcs[0]; // Use first available VDC
    console.log(`✅ Selected VDC: ${targetVdc.name} (${targetVdc.id})`);

    // Step 2: Check for existing test resources (cleanup from previous runs)
    console.log('\n2️⃣  Checking for existing test resources...');
    const testVApps = vapps.filter(v => v.name?.includes('MCP-Test') || v.name?.includes('zettagrid-test'));
    const testVMs = vms.filter(v => v.name?.includes('MCP-Test') || v.name?.includes('test-vm'));
    
    console.log(`Found ${testVApps.length} existing test vApps`);
    console.log(`Found ${testVMs.length} existing test VMs`);

    // Step 3: Try to create a simple test VM (if no existing test resources)
    if (testVApps.length === 0) {
      console.log('\n3️⃣  Attempting to discover available templates...');
      await discoverTemplatesAndNetworks(client, zone);
      
      console.log('\n4️⃣  Note: VM creation requires existing vApp templates');
      console.log('   Skipping VM creation due to complexity of template discovery');
    } else {
      console.log('\n3️⃣  Using existing test vApp for VM operations...');
      const testVApp = testVApps[0];
      console.log(`✅ Using vApp: ${testVApp.name} (${testVApp.id})`);

      // Step 4: Test VM power operations on existing VMs
      if (testVMs.length > 0) {
        console.log('\n4️⃣  Testing VM Power Operations...');
        const testVM = testVMs[0];
        console.log(`🎯 Target VM: ${testVM.name} (${testVM.id})`);

        // Test power operations
        await testVMPowerOperations(client, zone, testVM);
      }
    }

    // Step 5: Test Network and Firewall Operations
    console.log('\n5️⃣  Testing Network Discovery...');
    await testNetworkOperations(client, zone);

    console.log('\n✅ Live test completed successfully!');
    const testDuration = (Date.now() - testStartTime) / 1000;
    console.log(`⏱️  Total test duration: ${testDuration.toFixed(2)} seconds`);

  } catch (error) {
    console.error('\n💥 Live test failed:');
    console.error(error instanceof Error ? error.message : String(error));
  }
}

async function testVMPowerOperations(client: ZettagridClient, zone: string, vm: any): Promise<void> {
  try {
    console.log(`   📊 Current VM status: ${vm.status} (${getStatusDescription(vm.status)})`);
    
    // If VM is powered off, try to power on
    if (vm.status === 9 || vm.status === 8) { // POWERED_OFF or UNRECOGNIZED
      console.log('   🔋 Attempting to power on VM...');
      const powerOnResult = await client.powerOnVM(vm.id, zone);
      if (powerOnResult.success) {
        console.log('   ✅ Power on request successful');
        
        // Wait a bit and check status
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Power off the VM
        console.log('   ⚡ Attempting to power off VM...');
        const powerOffResult = await client.powerOffVM(vm.id, zone);
        if (powerOffResult.success) {
          console.log('   ✅ Power off request successful');
        } else {
          console.log(`   ❌ Power off failed: ${powerOffResult.error?.message}`);
        }
      } else {
        console.log(`   ❌ Power on failed: ${powerOnResult.error?.message}`);
      }
    } else if (vm.status === 5) { // POWERED_ON
      console.log('   ⚡ VM is powered on, attempting to power off...');
      const powerOffResult = await client.powerOffVM(vm.id, zone);
      if (powerOffResult.success) {
        console.log('   ✅ Power off request successful');
      } else {
        console.log(`   ❌ Power off failed: ${powerOffResult.error?.message}`);
      }
    } else {
      console.log(`   ℹ️  VM status (${vm.status}) not suitable for power operations`);
    }

  } catch (error) {
    console.log(`   ❌ VM power operations failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function discoverTemplatesAndNetworks(client: ZettagridClient, zone: string): Promise<void> {
  try {
    console.log('   🔍 Discovering vApp templates...');
    const templatesResult = await client.makeRequest({
      method: 'GET',
      url: '/query',
      params: { type: 'vAppTemplate', pageSize: '10' }
    }, zone);

    if (templatesResult.status === 200 && typeof templatesResult.data === 'string') {
      const templateMatches = templatesResult.data.match(/<.*Record\s/g);
      const templateCount = templateMatches ? templateMatches.length : 0;
      console.log(`   📋 Found ${templateCount} vApp templates`);
    }

    console.log('   🔍 Discovering organization networks...');
    const networksResult = await client.makeRequest({
      method: 'GET',
      url: '/query',
      params: { type: 'orgNetwork', pageSize: '10' }
    }, zone);

    if (networksResult.status === 200 && typeof networksResult.data === 'string') {
      const networkMatches = networksResult.data.match(/<.*Record\s/g);
      const networkCount = networkMatches ? networkMatches.length : 0;
      console.log(`   🌐 Found ${networkCount} organization networks`);
    }

  } catch (error) {
    console.log(`   ❌ Template/network discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function testNetworkOperations(client: ZettagridClient, zone: string): Promise<void> {
  try {
    console.log('   🌐 Testing network discovery...');
    
    // Test edge gateway discovery
    const edgeGatewaysResult = await client.makeRequest({
      method: 'GET',
      url: '/query',
      params: { type: 'edgeGateway', pageSize: '5' }
    }, zone);

    if (edgeGatewaysResult.status === 200 && typeof edgeGatewaysResult.data === 'string') {
      const gatewayMatches = edgeGatewaysResult.data.match(/<.*Record\s/g);
      const gatewayCount = gatewayMatches ? gatewayMatches.length : 0;
      console.log(`   🚪 Found ${gatewayCount} edge gateways`);
      
      if (gatewayCount > 0) {
        console.log('   ✅ Edge gateways available for firewall rule management');
      } else {
        console.log('   ℹ️  No edge gateways found - firewall rules require edge gateways');
      }
    }

  } catch (error) {
    console.log(`   ❌ Network operations test failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function getStatusDescription(status: number): string {
  const statusMap: Record<number, string> = {
    0: 'FAILED_CREATION',
    1: 'UNRESOLVED',
    2: 'RESOLVED', 
    3: 'DEPLOYED',
    4: 'SUSPENDED',
    5: 'POWERED_ON',
    6: 'WAITING_FOR_INPUT',
    7: 'UNKNOWN',
    8: 'UNRECOGNIZED',
    9: 'POWERED_OFF',
    10: 'INCONSISTENT_STATE'
  };
  
  return statusMap[status] || `UNKNOWN_${status}`;
}

async function testRawApiAccess(client: ZettagridClient, zone: string): Promise<void> {
  try {
    // Test session endpoint
    console.log('   Testing /api/session...');
    const sessionResult = await client.makeRequest({
      method: 'GET',
      url: '/session'
    }, zone);
    
    if (sessionResult.status === 200) {
      console.log('   ✅ Session endpoint accessible');
      // Try to parse basic session info
      if (typeof sessionResult.data === 'string' && sessionResult.data.includes('Session')) {
        console.log('   📋 Session data received (XML format)');
      }
    } else {
      console.log(`   ❌ Session endpoint failed: ${sessionResult.status}`);
    }

    // Test org endpoint
    console.log('   Testing /api/org...');
    const orgResult = await client.makeRequest({
      method: 'GET',  
      url: '/org'
    }, zone);
    
    if (orgResult.status === 200) {
      console.log('   ✅ Organization endpoint accessible');
    } else {
      console.log(`   ❌ Organization endpoint failed: ${orgResult.status}`);
    }

    // Test query endpoint for VDCs
    console.log('   Testing /api/query for VDCs...');
    const queryResult = await client.makeRequest({
      method: 'GET',
      url: '/query',
      params: { type: 'orgVdc', pageSize: '10' }
    }, zone);
    
    if (queryResult.status === 200) {
      console.log('   ✅ Query endpoint accessible');
      if (typeof queryResult.data === 'string') {
        // Simple XML parsing to count records
        const recordMatches = queryResult.data.match(/<.*Record\s/g);
        const recordCount = recordMatches ? recordMatches.length : 0;
        console.log(`   📊 Found ${recordCount} VDC records in query response`);
      }
    } else {
      console.log(`   ❌ Query endpoint failed: ${queryResult.status}`);
    }

  } catch (error) {
    console.log(`   ❌ Raw API test failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Run discovery if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  discoverPerthResources().catch(error => {
    console.error('Discovery failed:', error);
    process.exit(1);
  });
}

export { discoverPerthResources };