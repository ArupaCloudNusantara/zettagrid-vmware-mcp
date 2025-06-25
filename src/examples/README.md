# Zettagrid VMware MCP Examples

This directory contains example scripts demonstrating various features of the Zettagrid VMware MCP client.

## Available Examples

### Core Functionality Tests
- **`connectivity-test.ts`** - Test zone connectivity and basic authentication
- **`complete-vm-test.ts`** - Full VM lifecycle test (create vApp, VM, power operations)
- **`comprehensive-test.ts`** - Comprehensive API testing across multiple zones
- **`live-test.ts`** - Live testing against real Zettagrid infrastructure
- **`vm-power-test.ts`** - VM power management examples

### Network and Security
- **`firewall-test.ts`** - Firewall rule creation and management
- **`firewall-investigation.ts`** - Firewall configuration analysis
- **`nsxt-firewall-investigation.ts`** - NSX-T specific firewall analysis

### Analysis and Investigation
- **`gateway-config-analyzer.ts`** - Gateway configuration analysis
- **`live-test-scenario.ts`** - Live testing scenarios

## Running Examples

### Prerequisites
1. Configure your `.env` file with valid Zettagrid credentials
2. Build the project: `npm run build`
3. Ensure you have access to the required zones

### Basic Usage
```bash
# Run connectivity test
npx tsx src/examples/connectivity-test.ts

# Run complete VM test
npx tsx src/examples/complete-vm-test.ts

# Run firewall tests
npx tsx src/examples/firewall-test.ts
```

### Environment Setup
Create a `.env` file in the project root:
```bash
ZETTAGRID_DEFAULT_ZONE=perth
ZETTAGRID_API_VERSION=39.1
ZETTAGRID_ORGANIZATION=your-organization-name
ZETTAGRID_API_TOKEN_PERTH=your-perth-token
ZETTAGRID_API_ENDPOINT_PERTH=https://mycloud.per.zettagrid.com/api
ZETTAGRID_OAUTH_ENDPOINT_PERTH=https://mycloud.per.zettagrid.com/oauth/tenant/your-organization/token
```

## Example Categories

### 1. Connectivity and Authentication
- Basic zone connectivity testing
- OAuth token refresh validation
- Multi-zone authentication

### 2. Resource Management
- Organization and VDC operations
- vApp and VM lifecycle management
- Storage and network operations

### 3. Security and Networking
- Firewall rule management
- NAT rule configuration
- Gateway configuration analysis

### 4. Analysis and Debugging
- Configuration investigation tools
- Live environment testing
- Performance analysis

## Notes
- All examples include error handling and detailed logging
- Examples are designed to be run independently
- Some examples may create/modify resources - use with caution in production
- Check individual files for specific requirements and configurations