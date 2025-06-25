#!/usr/bin/env tsx
/**
 * Debug VDC data structure
 * Usage: npx tsx src/examples/debug-vdc-data.ts [vdcId]
 */

import { ZettagridClient } from '../client/zettagrid-client.js';
import { config } from 'dotenv';

// Load environment variables
config();

const ZONE = 'perth';

async function debugVdcData(vdcId?: string) {
  console.log('🔍 Debugging VDC Data Structure');
  console.log('===============================');
  
  const client = new ZettagridClient();
  
  try {
    // If no VDC ID provided, get the first one
    if (!vdcId) {
      const vdcs = await client.listVdcs(ZONE);
      if (vdcs.data?.items && vdcs.data.items.length > 0) {
        vdcId = vdcs.data.items[0].id;
        console.log(`Using VDC: ${vdcs.data.items[0].name} (${vdcId})`);
      } else {
        console.log('No VDCs found');
        return;
      }
    }
    
    console.log(`\n📊 Getting VDC details for: ${vdcId}`);
    
    const vdcResult = await client.getVdc(vdcId, ZONE);
    
    if (vdcResult.error) {
      console.error('❌ Error:', vdcResult.error.message);
      return;
    }
    
    const vdc = vdcResult.data;
    
    console.log('\n🏢 Basic VDC Info:');
    console.log('  Name:', vdc.name);
    console.log('  ID:', vdc.id);
    console.log('  Status:', vdc.status);
    console.log('  Allocation Model:', vdc.allocationModel);
    console.log('  Enabled:', vdc.isEnabled);
    
    console.log('\n💾 Compute Capacity:');
    if (vdc.computeCapacity) {
      console.log('  Compute Capacity exists:', !!vdc.computeCapacity);
      
      if (vdc.computeCapacity.memory) {
        console.log('  Memory:');
        console.log('    Units:', vdc.computeCapacity.memory.units);
        console.log('    Allocated:', vdc.computeCapacity.memory.allocated);
        console.log('    Used:', vdc.computeCapacity.memory.used);
        console.log('    Limit:', vdc.computeCapacity.memory.limit);
        console.log('    Reserved:', vdc.computeCapacity.memory.reserved);
        console.log('    Overhead:', vdc.computeCapacity.memory.overhead);
      } else {
        console.log('  Memory: Not available');
      }
      
      if (vdc.computeCapacity.cpu) {
        console.log('  CPU:');
        console.log('    Units:', vdc.computeCapacity.cpu.units);
        console.log('    Allocated:', vdc.computeCapacity.cpu.allocated);
        console.log('    Used:', vdc.computeCapacity.cpu.used);
        console.log('    Limit:', vdc.computeCapacity.cpu.limit);
        console.log('    Reserved:', vdc.computeCapacity.cpu.reserved);
        console.log('    Overhead:', vdc.computeCapacity.cpu.overhead);
      } else {
        console.log('  CPU: Not available');
      }
    } else {
      console.log('  Compute Capacity: Not available');
    }
    
    console.log('\n💽 Storage Capacity:');
    if (vdc.storageCapacity) {
      console.log('  Storage Capacity exists:', !!vdc.storageCapacity);
      console.log('  Units:', vdc.storageCapacity.units);
      console.log('  Allocated:', vdc.storageCapacity.allocated);
      console.log('  Used:', vdc.storageCapacity.used);
      console.log('  Limit:', vdc.storageCapacity.limit);
      console.log('  Reserved:', vdc.storageCapacity.reserved);
      console.log('  Overhead:', vdc.storageCapacity.overhead);
    } else {
      console.log('  Storage Capacity: Not available');
    }
    
    console.log('\n📋 Quotas:');
    console.log('  VM Quota:', vdc.vmQuota);
    console.log('  Network Quota:', vdc.networkQuota);
    console.log('  NIC Quota:', vdc.nicQuota);
    
    console.log('\n🔍 Full VDC Response:');
    console.log(JSON.stringify(vdc, null, 2));
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const [vdcId] = args;

debugVdcData(vdcId).catch(console.error);