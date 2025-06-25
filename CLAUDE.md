# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a Zettagrid VMware MCP (Model Context Protocol) Server that provides comprehensive tenant organization management across Australian zones. It's a TypeScript-based Node.js application that interfaces with VMware vCloud Director APIs.

### Core Architecture
- **`src/index.ts`** - Main MCP server entry point
- **`src/server/mcp-server.ts`** - MCP protocol implementation and tool handlers
- **`src/client/zettagrid-client.ts`** - Main API client with comprehensive vCloud Director operations
- **`src/managers/`** - Business logic and resource management
  - **`zone-manager.ts`** - Multi-zone configuration and management across Australian regions
  - **`firewall-manager.ts`** - Firewall rule management and operations
  - **`vm-creator.ts`** - Virtual machine creation and lifecycle management
- **`src/auth/`** - Authentication system with OAuth token management
  - **`token-manager.ts`** - API token authentication and session management
  - **`zone-auth.ts`** - Zone-specific authentication handlers
- **`src/types.ts`** - Complete TypeScript interfaces for vCloud Director API schema
- **`src/utils/xml-parser.ts`** - XML response parsing utilities for vCloud Director API
- **`src/examples/`** - Example scripts and usage demonstrations
- **`src/lib/`** - Library exports for external usage

### Multi-Zone Support
The application supports all Australian Zettagrid zones:
- Sydney, Melbourne, Perth, Brisbane, Adelaide, Darwin
- Each zone has independent authentication and API endpoints
- Zone-aware session management and API routing

## Build Commands

```bash
# Development
npm run dev              # Run in development mode with tsx
npm run build            # Compile TypeScript to build/
npm start                # Run compiled server

# Testing
npm test                 # Run Jest unit tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage

# Code Quality
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint issues

# Utilities
npm run clean            # Clean build directory
```

### Test Infrastructure
- **Unit tests**: Located in `tests/unit/`
- **Integration tests**: Located in `tests/integration/`
- **Live testing**: `npx tsx src/examples/connectivity-test.ts` - Tests against real Zettagrid infrastructure
- **Test fixtures**: Located in `tests/fixtures/`

## Environment Configuration

The application requires `.env` file with zone-specific credentials:

```bash
# Zone Configuration
ZETTAGRID_DEFAULT_ZONE=perth
ZETTAGRID_API_VERSION=39.1
ZETTAGRID_ORGANIZATION=your-organization-name

# Zone API Tokens (per zone)
ZETTAGRID_API_TOKEN_PERTH=your-token
ZETTAGRID_API_TOKEN_SYDNEY=your-token
# ... other zones

# Zone API Endpoints
ZETTAGRID_API_ENDPOINT_PERTH=https://mycloud.per.zettagrid.com/api
ZETTAGRID_API_ENDPOINT_SYDNEY=https://mycloud.syd.zettagrid.com/api
# ... other zones

# Zone OAuth Endpoints
ZETTAGRID_OAUTH_ENDPOINT_PERTH=https://mycloud.per.zettagrid.com/oauth/tenant/your-organization/token
# ... other zones

# Performance Settings
ZETTAGRID_TIMEOUT=30000
ZETTAGRID_RETRY_ATTEMPTS=3
ZETTAGRID_ENABLE_CACHING=true
DEBUG_LEVEL=info
```

## Key Technologies

- **TypeScript 5.3+** - Strict typing with comprehensive vCloud Director schema compliance
- **Node.js 18+** - ES modules (`"type": "module"`)
- **MCP Protocol** - Model Context Protocol for AI assistant integration
- **axios** - HTTP client for vCloud Director API communication
- **zod** - Runtime schema validation
- **Jest** - Testing framework with TypeScript support
- **tsx** - TypeScript execution for development

## Authentication Architecture

### OAuth Flow Implementation
1. **API Token**: Initial Zettagrid API token per zone
2. **Token Exchange**: Automatic exchange for OAuth access tokens
3. **Session Management**: Cached sessions with automatic refresh
4. **Multi-Zone**: Independent authentication state per zone

### Authentication Classes
- `TokenManager` - Handles token lifecycle and session caching
- `ZoneAuth` - Zone-specific authentication operations
- `ZoneManager` - Configuration and zone discovery

## API Capabilities

The MCP server provides comprehensive vCloud Director operations:

### Organization Management
- List and manage organizations
- Organization settings and configuration
- User and group management

### Virtual Data Center (VDC) Operations
- VDC lifecycle management
- Compute policies and resource allocation
- Storage profile management

### vApp and VM Management
- vApp deployment and lifecycle
- VM power operations and configuration
- Storage and network configuration

### Network and Security
- Organization network management
- Firewall rule configuration
- NAT rule management
- Load balancer operations

## Development Patterns

### Error Handling
- Comprehensive error types with zone context
- Automatic retry logic with exponential backoff
- Session re-authentication on token expiration
- Detailed error metadata for debugging

### XML Response Parsing
- Custom XML parsers in `utils/xml-parser.ts`
- Type-safe parsing with schema validation
- Support for vCloud Director query result formats

### Zone-Aware Operations
- All operations support optional zone parameter
- Automatic fallback to default zone
- Zone configuration validation and health checks

### Testing Approach
- Unit tests for core functionality
- Integration tests with mock responses
- Live testing against real Zettagrid infrastructure
- Test fixtures for consistent test data

## Security Considerations

- All API credentials stored in environment variables only
- OAuth token refresh flow with secure session management
- SSL/TLS enforcement for all API communications
- Zone-isolated authentication to prevent cross-zone access
- No credentials stored in code or committed to repository