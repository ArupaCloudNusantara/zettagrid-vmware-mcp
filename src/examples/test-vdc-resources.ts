#!/usr/bin/env tsx
/**
 * Test VDC resources tool
 * Usage: npx tsx src/examples/test-vdc-resources.ts [vdcId] [zoneId]
 */

import { ZettagridClient } from '../client/zettagrid-client.js';
import { config } from 'dotenv';

// Load environment variables
config();

const ZONE = 'perth'; // Default testing zone

function formatTable(data: any): string {
  if (!data.resources) return 'No resource data available';

  const { ram, vcpu, storage } = data.resources;
  
  // Create table headers
  const headers = ['Resource', 'Units', 'Allocated', 'Used', 'Available', 'Utilization'];
  const rows = [
    [ram.resource, ram.units, ram.allocated, ram.used, ram.available, ram.utilization],
    [vcpu.resource, vcpu.units, vcpu.allocated, vcpu.used, vcpu.available, vcpu.utilization],
    [storage.resource, storage.units, storage.allocated, storage.used, storage.available, storage.utilization]
  ];

  // Calculate column widths
  const colWidths = headers.map((header, i) => 
    Math.max(header.length, ...rows.map(row => String(row[i]).length))
  );

  // Format table
  const formatRow = (row: string[]) => 
    '| ' + row.map((cell, i) => String(cell).padEnd(colWidths[i])).join(' | ') + ' |';
  
  const separator = '|' + colWidths.map(width => '-'.repeat(width + 2)).join('|') + '|';

  return [
    formatRow(headers),
    separator,
    ...rows.map(formatRow)
  ].join('\n');
}

async function testVdcResources(vdcId?: string, zoneId: string = ZONE) {
  console.log('📊 Testing VDC Resources Tool');
  console.log('=============================');
  console.log(`📍 Zone: ${zoneId.toUpperCase()}`);
  console.log(`⏱️  Start Time: ${new Date().toISOString()}\n`);
  
  const client = new ZettagridClient();
  
  try {
    console.log('✅ Client created successfully\n');
    
    // If no VDC ID provided, list VDCs first
    if (!vdcId) {
      console.log('🔍 No VDC ID provided, listing available VDCs...');
      const vdcs = await client.listVdcs(zoneId);
      
      if (vdcs.error) {
        console.error('❌ Failed to list VDCs:', vdcs.error.message);
        return;
      }
      
      if (!vdcs.data?.items || vdcs.data.items.length === 0) {
        console.log('❌ No VDCs found in this zone');
        return;
      }
      
      console.log(`✅ Found ${vdcs.data.items.length} VDCs:`);
      vdcs.data.items.forEach((vdc, index) => {
        console.log(`   ${index + 1}. ${vdc.name} (${vdc.id})`);
      });
      
      // Use the first VDC
      vdcId = vdcs.data.items[0].id;
      console.log(`\n🎯 Using first VDC: ${vdcs.data.items[0].name} (${vdcId})\n`);
    }
    
    // Test the show_vdc_resources tool
    console.log(`📊 Testing show_vdc_resources for VDC: ${vdcId}`);
    console.log('=' .repeat(60));
    
    const resourcesResult = await client.showVdcResources(vdcId, zoneId);
    
    if (resourcesResult.error) {
      console.error('❌ Failed to get VDC resources:', resourcesResult.error.message);
      if (resourcesResult.error.details) {
        console.log('   Details:', JSON.stringify(resourcesResult.error.details, null, 2));
      }
      return;
    }
    
    if (!resourcesResult.data) {
      console.log('❌ No resource data returned');
      return;
    }
    
    const data = resourcesResult.data;
    
    // Display VDC information
    console.log(`\n🏢 VDC Information:`);
    console.log(`   Name: ${data.vdcName}`);
    console.log(`   ID: ${data.vdcId}`);
    if (data.allocationModel) {
      console.log(`   Allocation Model: ${data.allocationModel}`);
    }
    console.log(`   Zone: ${resourcesResult.metadata?.zone || zoneId}`);
    
    // Display resource table
    console.log(`\n📋 Resource Allocation & Usage:`);
    console.log(formatTable(data));
    
    // Display additional insights
    console.log(`\n💡 Resource Insights:`);
    
    const ramUtil = parseFloat(data.resources.ram.utilization);
    const cpuUtil = parseFloat(data.resources.vcpu.utilization);
    const storageUtil = parseFloat(data.resources.storage.utilization);
    
    if (ramUtil > 80) {
      console.log(`   ⚠️  RAM utilization is high (${data.resources.ram.utilization})`);
    } else if (ramUtil > 0) {
      console.log(`   ✅ RAM utilization is healthy (${data.resources.ram.utilization})`);
    }
    
    if (cpuUtil > 80) {
      console.log(`   ⚠️  vCPU utilization is high (${data.resources.vcpu.utilization})`);
    } else if (cpuUtil > 0) {
      console.log(`   ✅ vCPU utilization is healthy (${data.resources.vcpu.utilization})`);
    }
    
    if (storageUtil > 80) {
      console.log(`   ⚠️  Storage utilization is high (${data.resources.storage.utilization})`);
    } else if (storageUtil > 0) {
      console.log(`   ✅ Storage utilization is healthy (${data.resources.storage.utilization})`);
    }
    
    // Show raw data for debugging
    console.log(`\n🔍 Raw Response Data:`);
    console.log(JSON.stringify(data, null, 2));
    
    console.log(`\n✅ Test completed successfully at ${new Date().toISOString()}`);
    
  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const [vdcId, zoneId] = args;

if (args.includes('--help') || args.includes('-h')) {
  console.log('VDC Resources Tool Test');
  console.log('=======================');
  console.log('Usage: npx tsx src/examples/test-vdc-resources.ts [vdcId] [zoneId]');
  console.log('');
  console.log('Parameters:');
  console.log('  vdcId   - VDC ID (optional, will list available VDCs if not provided)');
  console.log('  zoneId  - Zone ID (optional, defaults to "perth")');
  console.log('');
  console.log('Examples:');
  console.log('  npx tsx src/examples/test-vdc-resources.ts');
  console.log('  npx tsx src/examples/test-vdc-resources.ts d8407649-b53a-4e47-befd-2e7110db33e0');
  console.log('  npx tsx src/examples/test-vdc-resources.ts d8407649-b53a-4e47-befd-2e7110db33e0 perth');
  process.exit(0);
}

// Run the test
console.log('Starting VDC resources test...\n');
testVdcResources(vdcId, zoneId || ZONE).catch(console.error);