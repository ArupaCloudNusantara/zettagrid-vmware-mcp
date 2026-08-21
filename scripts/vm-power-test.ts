/**
 * VM Power Operations Test
 * Tests VM power on/off operations with existing VMs in Perth zone
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

async function testVMPowerOperations(): Promise<void> {
  console.log('🔋 VM Power Operations Test - Perth Zone');
  console.log('=' .repeat(50));

  // Load environment variables
  loadEnvFile();

  const client = new ZettagridClient();
  const zone = 'perth';

  try {
    // Test authentication first
    console.log('🔐 Testing Authentication...');
    const authTest = await client.testZone(zone);
    if (!authTest.success) {
      console.log(`❌ Authentication failed: ${authTest.error?.message}`);
      return;
    }
    console.log('✅ Authentication successful\n');

    // Discover VMs
    console.log('💻 Discovering Virtual Machines...');
    const vmsResult = await client.listVMs(undefined, zone);
    if (!vmsResult.success) {
      console.log(`❌ Failed to list VMs: ${vmsResult.error?.message}`);
      return;
    }

    const availableVMs = vmsResult.data?.items || [];
    console.log(`✅ Found ${availableVMs.length} VMs`);

    if (availableVMs.length === 0) {
      console.log('❌ No VMs available for testing');
      return;
    }

    // Show available VMs
    availableVMs.forEach((vm, i) => {
      console.log(`   ${i + 1}. ${vm.name || 'Unknown'} (${vm.id || 'no-id'}) - Status: ${getStatusDescription(vm.status || 0)}`);
    });

    // Select a VM for testing (prefer one that might be powered off)
    let targetVM = availableVMs.find(vm => vm.status === 9) || // POWERED_OFF
                   availableVMs.find(vm => vm.status === 8) || // UNRECOGNIZED  
                   availableVMs[0]; // fallback to first VM

    console.log(`\n🎯 Selected VM for testing: ${targetVM.name} (${targetVM.id})`);
    console.log(`   Current Status: ${getStatusDescription(targetVM.status || 0)} (${targetVM.status})`);

    // Test power operations
    console.log('\n🔋 Testing Power Operations...');
    
    if (targetVM.status === 9 || targetVM.status === 8) { // POWERED_OFF or UNRECOGNIZED
      console.log('   ▶️  Attempting to power on VM...');
      const powerOnResult = await client.powerOnVM(targetVM.id, zone);
      if (powerOnResult.success) {
        console.log('   ✅ Power on request successful!');
        console.log(`   📋 Response: ${JSON.stringify(powerOnResult.data, null, 2)}`);
        
        // Wait a bit for state change
        console.log('   ⏱️  Waiting 10 seconds for VM to start...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Check status
        console.log('   📊 Checking VM status after power on...');
        const vmStatusResult = await client.getVM(targetVM.id, zone);
        if (vmStatusResult.success) {
          const updatedStatus = vmStatusResult.data?.status || 0;
          console.log(`   📈 Updated Status: ${getStatusDescription(updatedStatus)} (${updatedStatus})`);
        }
        
        // Now power off
        console.log('   ⏹️  Attempting to power off VM...');
        const powerOffResult = await client.powerOffVM(targetVM.id, zone);
        if (powerOffResult.success) {
          console.log('   ✅ Power off request successful!');
          console.log(`   📋 Response: ${JSON.stringify(powerOffResult.data, null, 2)}`);
        } else {
          console.log(`   ❌ Power off failed: ${powerOffResult.error?.message}`);
        }
      } else {
        console.log(`   ❌ Power on failed: ${powerOnResult.error?.message}`);
      }
    } else if (targetVM.status === 5) { // POWERED_ON
      console.log('   ⏹️  VM is powered on, testing power off...');
      const powerOffResult = await client.powerOffVM(targetVM.id, zone);
      if (powerOffResult.success) {
        console.log('   ✅ Power off request successful!');
        console.log(`   📋 Response: ${JSON.stringify(powerOffResult.data, null, 2)}`);
        
        // Wait and check status
        console.log('   ⏱️  Waiting 10 seconds for VM to stop...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        console.log('   📊 Checking VM status after power off...');
        const vmStatusResult = await client.getVM(targetVM.id, zone);
        if (vmStatusResult.success) {
          const updatedStatus = vmStatusResult.data?.status || 0;
          console.log(`   📈 Updated Status: ${getStatusDescription(updatedStatus)} (${updatedStatus})`);
        }
      } else {
        console.log(`   ❌ Power off failed: ${powerOffResult.error?.message}`);
      }
    } else {
      console.log(`   ℹ️  VM status (${targetVM.status}) not suitable for standard power operations`);
      console.log('   🔄 Attempting power operations anyway...');
      
      // Try power on first
      console.log('   ▶️  Attempting power on...');
      const powerOnResult = await client.powerOnVM(targetVM.id, zone);
      if (powerOnResult.success) {
        console.log('   ✅ Power on request successful!');
      } else {
        console.log(`   ❌ Power on failed: ${powerOnResult.error?.message}`);
      }
    }

    console.log('\n✅ VM Power Operations Test completed!');

  } catch (error) {
    console.error('\n💥 Test failed with exception:');
    console.error(error instanceof Error ? error.message : String(error));
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

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testVMPowerOperations().catch(error => {
    console.error('VM Power Test failed:', error);
    process.exit(1);
  });
}

export { testVMPowerOperations };