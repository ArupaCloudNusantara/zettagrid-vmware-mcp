/**
 * Test create_vapp with debug parameters
 */

import { readFileSync } from 'fs';
import path from 'path';
import { ZettagridClient } from './src/client/zettagrid-client.js';

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

async function testCreateVApp(): Promise<void> {
  console.log('🚀 Test create_vapp with DEBUG_TEST_PARAMS.json');
  console.log('='.repeat(60));

  // Load environment variables
  loadEnvFile();

  const client = new ZettagridClient();
  const zone = 'cibitung';

  try {
    // Load test parameters from JSON file
    const paramsPath = '/tmp/claude-1000/-home-ubuntu-zettagrid-mcp-zettagrid-vmware-mcp/d45f6771-4142-45d9-8aff-f88c752ec056/scratchpad/DEBUG_TEST_PARAMS.json';
    const paramsContent = readFileSync(paramsPath, 'utf8');
    const params = JSON.parse(paramsContent);

    console.log('📋 Test Parameters loaded:');
    console.log(`  vappName: ${params.vappName}`);
    console.log(`  vdcId: ${params.vdcId}`);
    console.log(`  zoneId: ${params.zoneId}`);
    console.log(`  VM Count: ${params.instantiationParams.vmConfigs.length}`);
    console.log('');

    // Test authentication first
    console.log('🔐 Testing Authentication...');
    const authTest = await client.testZone(zone);
    if (!authTest.success) {
      console.log(`❌ Authentication failed: ${authTest.error?.message}`);
      return;
    }
    console.log('✅ Authentication successful\n');

    // Call create_vapp
    console.log('🏗️  Creating vApp with instantiationParams.vmConfigs...');
    const createResult = await client.createVApp(
      params.vdcId,
      params.templateId,
      params.vappName,
      params.zoneId,
      params.instantiationParams
    );

    console.log('✅ create_vapp call succeeded');
    console.log('\n📊 Response:');
    console.log(JSON.stringify(createResult, null, 2));

    if (createResult.data?.taskId) {
      console.log(`\n⏳ Task ID: ${createResult.data.taskId}`);
      console.log('Use get_task to check status or wait for completion');
    }

  } catch (error) {
    console.log('❌ Error:');
    if (error instanceof Error) {
      console.log(`  ${error.message}`);
      if (error.stack) {
        console.log('\nStack trace:');
        console.log(error.stack);
      }
    } else {
      console.log(JSON.stringify(error, null, 2));
    }
  }
}

testCreateVApp().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
