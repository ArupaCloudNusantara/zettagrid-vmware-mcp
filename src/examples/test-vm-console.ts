#!/usr/bin/env tsx
/**
 * Test VM Console functionality
 * Usage: npx tsx src/examples/test-vm-console.ts <vmId> [zoneId]
 */

import { ZettagridClient } from '../client/zettagrid-client.js';
import { config } from 'dotenv';

// Load environment variables
config();

async function testVMConsole(vmId: string, zoneId?: string) {
  console.log('🚀 Testing VM Console Access');
  console.log('============================');
  
  const client = new ZettagridClient();
  
  try {
    // Initialize client
    await client.initialize();
    console.log('✅ Client initialized successfully\n');
    
    // Get VM details first
    console.log(`📋 Getting VM details for: ${vmId}`);
    const vmResult = await client.getVM(vmId, zoneId);
    
    if (vmResult.error) {
      console.error('❌ Failed to get VM details:', vmResult.error.message);
      return;
    }
    
    console.log(`✅ VM Name: ${vmResult.data.name}`);
    console.log(`   Status: ${vmResult.data.status}`);
    console.log(`   Zone: ${vmResult.metadata?.zone || 'default'}\n`);
    
    // Get console ticket
    console.log('🎫 Acquiring console ticket...');
    const consoleResult = await client.getVMConsole(vmId, zoneId);
    
    if (consoleResult.error) {
      console.error('❌ Failed to get console ticket:', consoleResult.error.message);
      console.error('   Details:', JSON.stringify(consoleResult.error.details, null, 2));
      return;
    }
    
    console.log('✅ Console ticket acquired successfully!');
    console.log('\n📊 Console Access Details:');
    console.log('==========================');
    console.log(JSON.stringify(consoleResult.data, null, 2));
    
    if (consoleResult.data.ticket) {
      console.log('\n🔗 Console Connection Info:');
      console.log(`   Ticket: ${consoleResult.data.ticket}`);
      console.log(`   Type: ${consoleResult.data.consoleType || 'VMRC'}`);
      console.log(`   VM: ${consoleResult.data.vmName || vmResult.data.name}`);
      
      console.log('\n💡 To connect to the console:');
      console.log('   1. Use VMware Remote Console (VMRC) or Web Console');
      console.log('   2. Provide the ticket when prompted');
      console.log('   3. Ticket is valid for a limited time');
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('❌ Usage: npx tsx src/examples/test-vm-console.ts <vmId> [zoneId]');
  console.error('   Example: npx tsx src/examples/test-vm-console.ts vm-12345');
  console.error('   Example: npx tsx src/examples/test-vm-console.ts vm-12345 sydney');
  process.exit(1);
}

const [vmId, zoneId] = args;

// Run the test
testVMConsole(vmId, zoneId).catch(console.error);