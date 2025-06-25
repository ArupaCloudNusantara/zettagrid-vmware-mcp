#!/usr/bin/env tsx
/**
 * Debug list VDCs response
 * Usage: npx tsx src/examples/debug-list-vdcs.ts
 */

import { ZettagridClient } from '../client/zettagrid-client.js';
import { config } from 'dotenv';

// Load environment variables
config();

const ZONE = 'perth';

async function debugListVdcs() {
  console.log('🔍 Debugging List VDCs Response');
  console.log('===============================');
  
  const client = new ZettagridClient();
  
  try {
    console.log('📊 Getting list of VDCs...');
    
    const vdcsResult = await client.listVdcs(ZONE);
    
    if (vdcsResult.error) {
      console.error('❌ Error:', vdcsResult.error.message);
      if (vdcsResult.error.details) {
        console.log('Details:', JSON.stringify(vdcsResult.error.details, null, 2));
      }
      return;
    }
    
    console.log('\n📋 VDCs List Result:');
    console.log('Success:', vdcsResult.success);
    console.log('Metadata:', JSON.stringify(vdcsResult.metadata, null, 2));
    
    if (vdcsResult.data) {
      console.log('\n📊 VDCs Data:');
      console.log('Total:', vdcsResult.data.total);
      console.log('Items count:', vdcsResult.data.items?.length);
      
      if (vdcsResult.data.items) {
        console.log('\n📝 VDC Items:');
        vdcsResult.data.items.forEach((vdc, index) => {
          console.log(`\n  VDC ${index + 1}:`);
          console.log('    Name:', vdc.name);
          console.log('    ID:', vdc.id);
          console.log('    Href:', vdc.href);
          console.log('    Type:', vdc.type);
          console.log('    Status:', vdc.status);
          console.log('    Full object:', JSON.stringify(vdc, null, 4));
        });
      }
    }
    
    console.log('\n🔍 Full Response:');
    console.log(JSON.stringify(vdcsResult, null, 2));
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

debugListVdcs().catch(console.error);