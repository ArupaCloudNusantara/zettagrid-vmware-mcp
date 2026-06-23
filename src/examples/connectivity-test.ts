/**
 * Simple test script to validate Zettagrid API connectivity
 * Tests basic authentication and API operations against Jakarta zone
 */

import { readFileSync } from 'fs';
import { ZettagridClient } from '../client/zettagrid-client.js';
import { ZoneManager } from '../managers/zone-manager.js';

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
    console.log('✅ Environment file loaded successfully');
  } catch (error) {
    console.log('⚠️  No .env file found, using system environment variables');
  }
}

async function testZettagridConnectivity(): Promise<void> {
  console.log('🚀 Starting Zettagrid API Connectivity Test');
  console.log('=' .repeat(50));

  // Load environment variables
  loadEnvFile();

  try {
    // Initialize zone manager
    console.log('📍 Initializing Zone Manager...');
    const zoneManager = new ZoneManager();
    const zoneStats = zoneManager.getZoneStats();
    
    console.log(`✅ Zone Manager initialized successfully`);
    console.log(`   Available zones: ${zoneStats.availableZones.join(', ')}`);
    console.log(`   Default zone: ${zoneStats.defaultZone}`);
    console.log(`   Total configured zones: ${zoneStats.configuredZones}/${zoneStats.totalZones}`);

    // Validate Jakarta zone configuration
    console.log('\n🔧 Validating Jakarta Zone Configuration...');
    const jakartaValidation = zoneManager.validateZoneConfig('jakarta');
    
    if (jakartaValidation.valid) {
      console.log('✅ Jakarta zone configuration is valid');
      const jakartaConfig = zoneManager.getZoneConfig('jakarta');
      console.log(`   Endpoint: ${jakartaConfig.apiEndpoint}`);
      console.log(`   Organization: ${jakartaConfig.organizationName}`);
      console.log(`   API Version: ${jakartaConfig.apiVersion}`);
      console.log(`   Token: ${jakartaConfig.apiToken.substring(0, 8)}...`);
    } else {
      console.log('❌ Jakarta zone configuration is invalid:');
      jakartaValidation.errors.forEach(error => console.log(`   - ${error}`));
      return;
    }

    // Test basic connectivity
    console.log('\n🌐 Testing Jakarta Zone Connectivity...');
    const connectivityResult = await zoneManager.testZoneConnectivity('jakarta');
    
    if (connectivityResult.success) {
      console.log(`✅ Jakarta zone connectivity test passed`);
      console.log(`   Response time: ${connectivityResult.responseTime}ms`);
    } else {
      console.log(`❌ Jakarta zone connectivity test failed: ${connectivityResult.error}`);
      console.log('   This might indicate network issues or incorrect endpoint configuration');
    }

    // Initialize Zettagrid client
    console.log('\n🔌 Initializing Zettagrid Client...');
    const client = new ZettagridClient();
    
    // Test zone information
    console.log('\n📊 Getting Zone Information...');
    const zoneInfoResult = await client.getZoneInfo('jakarta');
    
    if (zoneInfoResult.success) {
      console.log('✅ Zone information retrieved successfully:');
      console.log(`   Current zone: ${zoneInfoResult.data?.currentZone}`);
      console.log(`   Organization: ${zoneInfoResult.data?.organization}`);
      console.log(`   API Version: ${zoneInfoResult.data?.apiVersion}`);
      console.log(`   Endpoint: ${zoneInfoResult.data?.endpoint}`);
    } else {
      console.log(`❌ Failed to get zone information: ${zoneInfoResult.error?.message}`);
    }

    // Test authentication
    console.log('\n🔐 Testing Authentication...');
    const authTestResult = await client.testZone('jakarta');
    
    if (authTestResult.success) {
      console.log('✅ Authentication test passed');
      console.log('   API token is valid and authentication is working');
      
      if (authTestResult.data?.details) {
        console.log(`   Token expiry: ${authTestResult.data.details.tokenExpiry}`);
        console.log(`   Has refresh token: ${authTestResult.data.details.hasRefreshToken}`);
      }
    } else {
      console.log(`❌ Authentication test failed: ${authTestResult.error?.message}`);
      console.log('   This indicates issues with the API token or authentication process');
    }

    // Test basic API operations
    console.log('\n🏢 Testing Organization Operations...');
    const orgListResult = await client.listOrganizations('jakarta');
    
    if (orgListResult.success) {
      console.log('✅ Organization listing succeeded');
      console.log(`   Found ${orgListResult.data?.length || 0} organizations`);
    } else {
      console.log(`❌ Organization listing failed: ${orgListResult.error?.message}`);
      console.log('   This indicates API access issues or insufficient permissions');
    }

    // Test VDC operations
    console.log('\n🏗️  Testing VDC Operations...');
    const vdcListResult = await client.listVdcs('jakarta');
    
    if (vdcListResult.success) {
      console.log('✅ VDC listing succeeded');
      console.log(`   Found ${vdcListResult.data?.items?.length || 0} VDCs`);
      console.log(`   Total available: ${vdcListResult.data?.total || 0}`);
    } else {
      console.log(`❌ VDC listing failed: ${vdcListResult.error?.message}`);
    }

    // Test vApp operations
    console.log('\n📱 Testing vApp Operations...');
    const vappListResult = await client.listVApps(undefined, 'jakarta');
    
    if (vappListResult.success) {
      console.log('✅ vApp listing succeeded');
      console.log(`   Found ${vappListResult.data?.items?.length || 0} vApps`);
      console.log(`   Total available: ${vappListResult.data?.total || 0}`);
    } else {
      console.log(`❌ vApp listing failed: ${vappListResult.error?.message}`);
    }

    // Test VM operations
    console.log('\n💻 Testing VM Operations...');
    const vmListResult = await client.listVMs(undefined, 'jakarta');
    
    if (vmListResult.success) {
      console.log('✅ VM listing succeeded');
      console.log(`   Found ${vmListResult.data?.items?.length || 0} VMs`);
      console.log(`   Total available: ${vmListResult.data?.total || 0}`);
    } else {
      console.log(`❌ VM listing failed: ${vmListResult.error?.message}`);
    }

    // Health check
    console.log('\n🩺 Running Health Check...');
    const healthResult = await client.getHealthStatus();
    
    if (healthResult.success) {
      console.log('✅ Health check completed successfully');
      
      const health = healthResult.data;
      console.log(`   Configured zones: ${health.zones?.configuredZones}`);
      console.log(`   Active sessions: ${health.sessions?.activeSessions}`);
      console.log(`   Total sessions: ${health.sessions?.totalSessions}`);
      console.log(`   Validation status: ${health.validation?.valid ? 'Valid' : 'Invalid'}`);
    } else {
      console.log(`❌ Health check failed: ${healthResult.error?.message}`);
    }

    console.log('\n' + '=' .repeat(50));
    console.log('🎉 Zettagrid API Connectivity Test Completed!');
    console.log('Check the results above to verify API functionality.');

  } catch (error) {
    console.error('\n💥 Test failed with exception:');
    console.error(error instanceof Error ? error.message : String(error));
    console.error('\nStack trace:');
    console.error(error instanceof Error ? error.stack : 'No stack trace available');
  }
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testZettagridConnectivity().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { testZettagridConnectivity };