#!/usr/bin/env npx tsx

/**
 * Test script for VDC resources functionality
 */

import { readFileSync } from 'fs';
import { ZettagridClient } from '../client/zettagrid-client.js';
import type { VdcResourceSummary } from '../types.js';

// Simple .env file loader
function loadEnvFile() {
  try {
    const envContent = readFileSync('.env', 'utf8');
    const lines = envContent.split('\n');
    
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          process.env[key.trim()] = value;
        }
      }
    });
  } catch (error) {
    console.warn('Warning: Could not load .env file:', error instanceof Error ? error.message : error);
  }
}

// Load environment variables
loadEnvFile();

const ZONE = 'perth';

// Format the resource data as a table
function formatTable(data: VdcResourceSummary): string {
  const headers = ['Resource', 'Units', 'Allocated', 'Used', 'Available', 'Utilization'];
  const rows = [
    ['RAM', data.resources.ram.units, data.resources.ram.allocated, data.resources.ram.used, data.resources.ram.available, data.resources.ram.utilization],
    ['vCPU', data.resources.vcpu.units, data.resources.vcpu.allocated, data.resources.vcpu.used, data.resources.vcpu.available, data.resources.vcpu.utilization],
    ['Storage', data.resources.storage.units, data.resources.storage.allocated, data.resources.storage.used, data.resources.storage.available, data.resources.storage.utilization]
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

async function testSingleVdc(client: ZettagridClient, vdcId: string, zoneId: string) {
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
  } else {
    console.log(`   💤 No RAM currently in use`);
  }
  
  if (cpuUtil > 80) {
    console.log(`   ⚠️  vCPU utilization is high (${data.resources.vcpu.utilization})`);
  } else if (cpuUtil > 0) {
    console.log(`   ✅ vCPU utilization is healthy (${data.resources.vcpu.utilization})`);
  } else {
    console.log(`   💤 No vCPU currently in use`);
  }
  
  if (storageUtil > 90) {
    console.log(`   ⚠️  Storage utilization is very high (${data.resources.storage.utilization})`);
  } else if (storageUtil > 0) {
    console.log(`   ✅ Storage utilization is normal (${data.resources.storage.utilization})`);
  } else {
    console.log(`   💤 No storage currently in use`);
  }
  
  // Raw data for debugging
  console.log(`\n🔍 Raw Response Data:`);
  console.log(JSON.stringify(data, null, 2));
}

async function testVdcResources(vdcId?: string, zoneId: string = ZONE) {
  console.log('📊 Testing VDC Resources Tool');
  console.log('=============================');
  console.log(`📍 Zone: ${zoneId.toUpperCase()}`);
  console.log(`⏱️  Start Time: ${new Date().toISOString()}\n`);
  
  const client = new ZettagridClient();
  
  try {
    console.log('✅ Client created successfully\n');
    
    // If no VDC ID provided, list VDCs first and test all
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
      
      // Test all VDCs
      console.log('\n🎯 Testing all VDCs:\n');
      
      for (let i = 0; i < vdcs.data.items.length; i++) {
        const vdc = vdcs.data.items[i];
        console.log(`📊 VDC ${i + 1}: ${vdc.name} (${vdc.id})`);
        console.log('=' + '='.repeat(60));
        
        await testSingleVdc(client, vdc.id, zoneId);
        console.log('\n');
      }
      return;
    }
    
    // Test single VDC if ID was provided
    console.log(`📊 Testing show_vdc_resources for VDC: ${vdcId}`);
    console.log('=' + '='.repeat(60));
    await testSingleVdc(client, vdcId, zoneId);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
  
  console.log(`\n✅ Test completed successfully at ${new Date().toISOString()}`);
}

// Run the test
await testVdcResources();