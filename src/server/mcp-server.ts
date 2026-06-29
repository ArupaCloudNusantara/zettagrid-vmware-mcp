/**
 * Zettagrid VMware MCP Server Implementation
 * Handles all MCP protocol operations for Zettagrid cloud infrastructure
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { ZettagridClient } from '../client/zettagrid-client.js';
import { McpToolResponse, VdcResourceSummary } from '../types.js';

export class ZettagridMcpServer {
  private server: Server;
  private client?: ZettagridClient;

  constructor(server: Server) {
    this.server = server;
  }

  /**
   * Format VDC resources as a markdown table
   */
  private formatVdcResourcesTable(summary: VdcResourceSummary): string {
    const { vdcName, resources } = summary;
    
    // Create the table header
    const header = `# VDC: ${vdcName}\n\n`;
    
    // Build markdown table
    let table = header;
    
    // Header row
    table += '| Resource | Allocated | Used | Available | Utilization |\n';
    table += '|----------|-----------|------|-----------|-------------|\n';
    
    // Data rows
    const rows = [resources.ram, resources.vcpu, resources.storage];
    for (const row of rows) {
      const resourceWithUnit = `${row.resource} (${row.units})`;
      table += `| ${resourceWithUnit} | ${row.allocated} | ${row.used} | ${row.available} | ${row.utilization} |\n`;
    }
    
    return table;
  }

  /**
   * Handle showing all VDC resources in a consolidated table
   */
  private async handleShowAllVdcResources(zoneId?: string): Promise<McpToolResponse<string>> {
    try {
      if (!this.client) {
        this.client = new ZettagridClient();
      }

      // First get list of all VDCs
      const vdcsResponse = await this.client.listVdcs(zoneId);
      
      if (!vdcsResponse.success || !vdcsResponse.data?.items?.length) {
        return {
          success: false,
          error: {
            code: 'NO_VDCS_FOUND',
            message: 'No VDCs found or failed to list VDCs'
          }
        };
      }

      // Get resources for each VDC
      const vdcResourcePromises = vdcsResponse.data.items.map(async (vdc) => {
        // Use the real VDC ID from href
        const realVdcId = vdc.href?.split('/').pop();
        if (realVdcId) {
          const resourceResponse = await this.client!.showVdcResources(realVdcId, zoneId);
          return resourceResponse.success ? resourceResponse.data : null;
        }
        return null;
      });

      const vdcResources = await Promise.all(vdcResourcePromises);
      const validResources = vdcResources.filter(Boolean) as VdcResourceSummary[];

      if (validResources.length === 0) {
        return {
          success: false,
          error: {
            code: 'NO_RESOURCE_DATA',
            message: 'Failed to retrieve resource data for any VDCs'
          }
        };
      }

      // Create consolidated markdown table
      const header = `# VDC Resource Summary - ${zoneId || 'Default Zone'}\n\n`;
      let table = header;
      
      // Table headers
      table += '| VDC Name | RAM Allocated | RAM Used | RAM Util | CPU Allocated | CPU Used | CPU Util | Storage Allocated | Storage Used | Storage Util |\n';
      table += '|----------|---------------|----------|----------|---------------|----------|----------|-------------------|--------------|---------------|\n';
      
      // Add rows for each VDC
      for (const vdcResource of validResources) {
        const { vdcName, resources } = vdcResource;
        const ram = resources.ram;
        const cpu = resources.vcpu;
        const storage = resources.storage;
        
        table += `| ${vdcName} | ${ram.allocated} ${ram.units} | ${ram.used} ${ram.units} | ${ram.utilization} | ${cpu.allocated} ${cpu.units} | ${cpu.used} ${cpu.units} | ${cpu.utilization} | ${storage.allocated} ${storage.units} | ${storage.used} ${storage.units} | ${storage.utilization} |\n`;
      }

      return {
        success: true,
        data: table,
        metadata: {
          zone: zoneId || 'default',
          organization: 'unknown', // Will be filled by client
          timestamp: new Date().toISOString()
        }
      };

    } catch (error) {
      return {
        success: false,
        error: {
          code: 'SHOW_ALL_VDC_RESOURCES_ERROR',
          message: error instanceof Error ? error.message : 'Failed to show all VDC resources'
        }
      };
    }
  }

  /**
   * Initialize the MCP server with all tool handlers
   */
  async initialize(): Promise<void> {
    try {
      // Initialize the client here, after environment is loaded
      this.client = new ZettagridClient();
    } catch (error) {
      console.error('Failed to initialize Zettagrid client:', error);
      throw error;
    }
    // Register list_tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'test_zone',
          description: 'Test connectivity and authentication for a specific zone',
          inputSchema: {
            type: 'object',
            properties: {
              zoneId: {
                type: 'string',
                description: 'Zone ID to test (e.g., perth, sydney)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            }
          }
        },
        {
          name: 'list_organizations',
          description: 'List all accessible organizations in a zone',
          inputSchema: {
            type: 'object',
            properties: {
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional, uses default if not specified)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            }
          }
        },
        {
          name: 'get_organization',
          description: 'Get detailed information about a specific organization',
          inputSchema: {
            type: 'object',
            properties: {
              organizationId: {
                type: 'string',
                description: 'Organization ID or name'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['organizationId']
          }
        },
        {
          name: 'list_vdcs',
          description: 'List virtual data centers in an organization',
          inputSchema: {
            type: 'object',
            properties: {
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            }
          }
        },
        {
          name: 'get_vdc',
          description: 'Get detailed VDC information',
          inputSchema: {
            type: 'object',
            properties: {
              vdcId: {
                type: 'string',
                description: 'VDC ID or name'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['vdcId']
          }
        },
        {
          name: 'show_vdc_resources',
          description: 'Show VDC resource allocation and usage in table format (RAM, vCPU, Storage)',
          inputSchema: {
            type: 'object',
            properties: {
              vdcId: {
                type: 'string',
                description: 'VDC ID'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['vdcId']
          }
        },
        {
          name: 'show_all_vdc_resources',
          description: 'Show all VDC resource allocation and usage in a consolidated markdown table',
          inputSchema: {
            type: 'object',
            properties: {
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            }
          }
        },
        {
          name: 'list_vapps',
          description: 'List virtual applications in a VDC',
          inputSchema: {
            type: 'object',
            properties: {
              vdcId: {
                type: 'string',
                description: 'VDC ID (optional, lists from all VDCs if not specified)'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            }
          }
        },
        {
          name: 'list_vms',
          description: 'List virtual machines',
          inputSchema: {
            type: 'object',
            properties: {
              vappId: {
                type: 'string',
                description: 'vApp ID (optional, lists from all vApps if not specified)'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            }
          }
        },
        {
          name: 'power_on_vm',
          description: 'Power on a virtual machine',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: {
                type: 'string',
                description: 'Virtual machine ID'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['vmId']
          }
        },
        {
          name: 'power_off_vm',
          description: 'Power off a virtual machine',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: {
                type: 'string',
                description: 'Virtual machine ID'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['vmId']
          }
        },
        {
          name: 'get_vm_console',
          description: 'Get VM console access ticket',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: {
                type: 'string',
                description: 'Virtual machine ID'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['vmId']
          }
        },
        {
          name: 'list_edge_gateways',
          description: 'List edge gateways',
          inputSchema: {
            type: 'object',
            properties: {
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            }
          }
        },
        {
          name: 'get_edge_gateway',
          description: 'Get edge gateway details',
          inputSchema: {
            type: 'object',
            properties: {
              edgeGatewayId: {
                type: 'string',
                description: 'Edge gateway ID'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['edgeGatewayId']
          }
        },
        {
          name: 'list_firewall_rules',
          description: 'List firewall rules for an edge gateway',
          inputSchema: {
            type: 'object',
            properties: {
              edgeGatewayId: {
                type: 'string',
                description: 'Edge gateway ID'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['edgeGatewayId']
          }
        },
        {
          name: 'create_firewall_rule',
          description: 'Create an NSX-T firewall rule on an edge gateway. Required fields: edgeGatewayId, name, policy ("allow" or "drop" — NOT "action"). For port-based matching pass portProfiles (array of URNs) — NOT portProfileIds. Typical DNAT companion: direction=IN, policy=allow, portProfiles=[external-port-profile-URN]. Use list_application_port_profiles to find URNs.',
          inputSchema: {
            type: 'object',
            properties: {
              edgeGatewayId: {
                type: 'string',
                description: 'Edge gateway ID'
              },
              name: {
                type: 'string',
                description: 'Firewall rule name (shown in UI)'
              },
              description: {
                type: 'string',
                description: 'Firewall rule description (optional)'
              },
              policy: {
                type: 'string',
                description: 'REQUIRED. Traffic action — use "allow" or "drop" (NOT "action", NOT "ALLOW").',
                enum: ['allow', 'drop']
              },
              sourceIp: {
                type: 'string',
                description: 'Source IP address or range (default: Any)'
              },
              destinationIp: {
                type: 'string',
                description: 'Destination IP address or range (default: Any)'
              },
              sourcePortRange: {
                type: 'string',
                description: 'Source port range (default: Any)'
              },
              destinationPortRange: {
                type: 'string',
                description: 'Destination port range (default: Any)'
              },
              protocol: {
                type: 'string',
                description: 'Protocol type',
                enum: ['tcp', 'udp', 'icmp', 'any']
              },
              isEnabled: {
                type: 'boolean',
                description: 'Enable the rule (default: true)'
              },
              enableLogging: {
                type: 'boolean',
                description: 'Enable logging for this rule (default: false)'
              },
              portProfiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Application port profile URNs to match — use THIS (NOT portProfileIds). E.g. ["urn:vcloud:applicationPortProfile:xxx"]. Omit to match any port.'
              },
              portProfileId: {
                type: 'string',
                description: 'Single application port profile URN (alternative to portProfiles array for a single profile)'
              },
              sourceFirewallGroups: {
                type: 'array',
                items: { type: 'string' },
                description: 'Source firewall group URNs (IP sets, security groups). Omit for Any.'
              },
              destinationFirewallGroups: {
                type: 'array',
                items: { type: 'string' },
                description: 'Destination firewall group URNs (IP sets, security groups). Omit for Any.'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['edgeGatewayId', 'name', 'policy']
          }
        },
        {
          name: 'show_edge_network_config',
          description: 'Show comprehensive edge gateway network configuration (external IPs, uplinks, provider networks)',
          inputSchema: {
            type: 'object',
            properties: {
              edgeGatewayId: {
                type: 'string',
                description: 'Edge gateway ID'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['edgeGatewayId']
          }
        },
        {
          name: 'list_nat_rules',
          description: 'List NAT rules (DNAT/SNAT) for an edge gateway via CloudAPI (NSX-T)',
          inputSchema: {
            type: 'object',
            properties: {
              edgeGatewayId: {
                type: 'string',
                description: 'Edge gateway ID (UUID)'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['edgeGatewayId']
          }
        },
        {
          name: 'get_vm_metrics',
          description: 'Get current VM performance metrics via CloudAPI: CPU%, RAM%, disk IOPS, network throughput (requires VCD 36+)',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: {
                type: 'string',
                description: 'VM UUID (from list_vms or get_vm)'
              },
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            },
            required: ['vmId']
          }
        },
        {
          name: 'update_firewall_rule',
          description: 'Update an existing firewall rule by ID on an NSX-T edge gateway',
          inputSchema: {
            type: 'object',
            properties: {
              edgeGatewayId: { type: 'string', description: 'Edge gateway UUID' },
              ruleId: { type: 'string', description: 'Firewall rule UUID (from list_firewall_rules)' },
              name: { type: 'string', description: 'Rule name' },
              description: { type: 'string', description: 'Rule description' },
              policy: { type: 'string', enum: ['allow', 'drop', 'reject'], description: 'allow | drop | reject' },
              isEnabled: { type: 'boolean', description: 'Enable or disable the rule' },
              sourceIp: { type: 'string', description: 'Source IP or CIDR (omit or "Any" for any)' },
              destinationIp: { type: 'string', description: 'Destination IP or CIDR (omit or "Any" for any)' },
              portProfiles: { type: 'array', items: { type: 'string' }, description: 'Application port profile URNs' },
              portProfileId: { type: 'string', description: 'Single application port profile URN (alternative to portProfiles array)' },
              sourceFirewallGroups: { type: 'array', items: { type: 'string' }, description: 'Source firewall group URNs (IP sets, security groups). Omit for Any.' },
              destinationFirewallGroups: { type: 'array', items: { type: 'string' }, description: 'Destination firewall group URNs (IP sets, security groups). Omit for Any.' },
              enableLogging: { type: 'boolean', description: 'Enable traffic logging' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['edgeGatewayId', 'ruleId', 'name', 'policy']
          }
        },
        {
          name: 'delete_firewall_rule',
          description: 'Delete a firewall rule by ID from an NSX-T edge gateway',
          inputSchema: {
            type: 'object',
            properties: {
              edgeGatewayId: { type: 'string', description: 'Edge gateway UUID' },
              ruleId: { type: 'string', description: 'Firewall rule UUID (from list_firewall_rules)' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['edgeGatewayId', 'ruleId']
          }
        },
        {
          name: 'create_nat_rule',
          description: 'Create a DNAT or SNAT rule on an edge gateway. DNAT maps a public IP:port to a private IP:port (port forwarding). SNAT maps a source subnet to an outbound IP. For DNAT: set firewallMatch to MATCH_EXTERNAL_ADDRESS (recommended — matches traffic on the external/public port before NAT; the default MATCH_INTERNAL_ADDRESS matches after NAT and typically mismatches firewall rules keyed on the external port). The applicationPortProfileId defines the internal destination protocol/port; dnatExternalPort overrides the incoming external port.',
          inputSchema: {
            type: 'object',
            properties: {
              edgeGatewayId: { type: 'string', description: 'Edge gateway UUID' },
              name: { type: 'string', description: 'Rule name' },
              type: { type: 'string', enum: ['DNAT', 'SNAT', 'REFLEXIVE'], description: 'NAT type: DNAT (inbound port forward), SNAT (outbound masquerade), REFLEXIVE (bidirectional)' },
              externalAddresses: { type: 'string', description: 'Public/external IP address (e.g. 203.0.113.1)' },
              internalAddresses: { type: 'string', description: 'Private/internal IP address or subnet (e.g. 192.168.1.10)' },
              externalPort: { type: 'string', description: 'External port number or range (e.g. "80" or "8080-8090"), omit for any' },
              internalPort: { type: 'string', description: 'Internal port number (e.g. "80"), omit to match external' },
              description: { type: 'string', description: 'Optional description' },
              enabled: { type: 'boolean', description: 'Enable rule immediately (default true)' },
              applicationPortProfileId: { type: 'string', description: 'Application port profile URN for protocol matching (optional)' },
              applicationPortProfileName: { type: 'string', description: 'Display name for the port profile (optional)' },
              firewallMatch: { type: 'string', enum: ['MATCH_INTERNAL_ADDRESS', 'MATCH_EXTERNAL_ADDRESS', 'BYPASS'], description: 'Firewall match mode (default: MATCH_INTERNAL_ADDRESS)' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['edgeGatewayId', 'name', 'type', 'externalAddresses', 'internalAddresses']
          }
        },
        {
          name: 'delete_nat_rule',
          description: 'Delete a NAT rule by ID from an edge gateway',
          inputSchema: {
            type: 'object',
            properties: {
              edgeGatewayId: { type: 'string', description: 'Edge gateway UUID' },
              ruleId: { type: 'string', description: 'NAT rule UUID (from list_nat_rules)' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['edgeGatewayId', 'ruleId']
          }
        },
        {
          name: 'reset_vm',
          description: 'Hard reset a VM (equivalent to pressing reset button). No guest OS involvement — use when shutdown/reboot fail on an unresponsive VM.',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'VM UUID' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId']
          }
        },
        {
          name: 'update_vm_cpu',
          description: 'Update the vCPU count of a VM and/or manage CPU hot-add. Two modes: (1) Powered-off VM — change cpuCount freely and optionally set cpuHotAdd to enable/disable hot-add. (2) Powered-on VM with hot-add enabled — change cpuCount WITHOUT providing coresPerSocket; the tool automatically preserves the existing socket topology so vCD does not reject the change. SEQUENTIAL ONLY: vCD rejects concurrent updates — wait for the returned task to succeed (get_task) before calling update_vm_memory or update_vm_disk.',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'VM UUID' },
              cpuCount: { type: 'number', description: 'Number of vCPUs (e.g. 2, 4, 8)' },
              coresPerSocket: { type: 'number', description: 'Cores per socket. If omitted, the current value is read from the VM and preserved (important for hot-add on powered-on VMs). For new/powered-off VMs with no prior value, defaults to min(cpuCount, 16) to minimise socket count. Only set explicitly for specific NUMA or licensing requirements.' },
              cpuHotAdd: { type: 'boolean', description: 'Enable CPU hot-add (true) or disable it (false). Allows adding vCPUs to a running VM in future. Must be set while VM is powered off; do not pass this when hot-adding vCPUs to a running VM.' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId', 'cpuCount']
          }
        },
        {
          name: 'update_vm_memory',
          description: 'Update the RAM of a VM and/or manage memory hot-add. Two modes: (1) Powered-off VM — change memoryMB freely and optionally set memoryHotAdd to enable/disable hot-add. (2) Powered-on VM with hot-add enabled — increase memoryMB only (cannot decrease while running). Parameter is "memoryMB" (NOT memorySizeMB). SEQUENTIAL ONLY: vCD rejects concurrent updates — wait for any in-flight update_vm_cpu or update_vm_disk task to complete first. ENFORCED SAFETY: hot-adding memory past the 3GB boundary (≤3072 MB → >3072 MB) on a powered-on VM is blocked — Linux guests freeze when this boundary is crossed (VMware KB 343190). Safe path to reach >3GB: (1) power off the VM, (2) call this tool with the target memoryMB and memoryHotAdd=true, (3) power on. Once the VM starts above 3GB, hot-add can expand up to 16× the initial powered-on size.',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'VM UUID' },
              memoryMB: { type: 'number', description: 'Memory in MB (e.g. 1024=1GB, 2048=2GB, 4096=4GB, 8192=8GB)' },
              memoryHotAdd: { type: 'boolean', description: 'Enable memory hot-add (true) or disable it (false). Allows increasing RAM on a running VM in future. Must be set while VM is powered off; do not pass this when hot-adding memory to a running VM.' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId', 'memoryMB']
          }
        },
        {
          name: 'update_vm_disk',
          description: 'Resize the boot disk of a VM. VM must be powered off. Size can only be increased, not decreased. Parameter is "diskSizeMB" (NOT diskSizeGB — multiply GB × 1024, e.g. 20 GB = 20480). SEQUENTIAL ONLY: vCD rejects concurrent updates — wait for any in-flight update_vm_cpu or update_vm_memory task to complete first.',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'VM UUID' },
              diskSizeMB: { type: 'number', description: 'New disk size in MB — use diskSizeMB NOT diskSizeGB (20 GB = 20480, 50 GB = 51200)' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId', 'diskSizeMB']
          }
        },
        {
          name: 'update_vm_computer_name',
          description: 'Update the computer name (hostname) of a VM in VCD. Must be called while the VM is powered off and BEFORE power-on. VCD injects this value as vCloud_computerName into the VM\'s OVF environment; open-vm-tools reads it on first boot and sets the OS hostname. For Ubuntu cloud-init VMs use this after instantiation and before power-on to ensure the correct hostname is set.',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'VM UUID' },
              computerName: { type: 'string', description: 'Desired computer name / hostname (e.g. "my-vm-01")' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId', 'computerName']
          }
        },
        {
          name: 'delete_vapp',
          description: 'Delete a vApp and all VMs inside it. Automatically undeployes the vApp first if still deployed (handles suspended or mixed-state vApps). WARNING: irreversible — all VM disks and data are permanently deleted.',
          inputSchema: {
            type: 'object',
            properties: {
              vappId: { type: 'string', description: 'vApp UUID (from list_vapps or create_vapp)' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vappId']
          }
        },
        {
          name: 'undeploy_vapp',
          description: 'Undeploy a vApp — removes VMs from ESXi hosts without deleting data. Forcibly powers off any running or suspended VMs. Use when you want to free ESXi host resources without deleting the vApp, or to prepare a vApp for deletion manually.',
          inputSchema: {
            type: 'object',
            properties: {
              vappId: { type: 'string', description: 'vApp UUID (from list_vapps)' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vappId']
          }
        },
        {
          name: 'get_task',
          description: 'Get the current status of an async VCD task by its task ID. Use to poll for completion after power ops, create_vapp, snapshots, etc.',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string', description: 'Task UUID (from taskId field returned by async operations)' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['taskId']
          }
        },
        {
          name: 'list_external_networks',
          description: 'List external networks available in the zone',
          inputSchema: {
            type: 'object',
            properties: {
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            }
          }
        },
        {
          name: 'get_provider_network_info',
          description: 'Get provider network information and availability',
          inputSchema: {
            type: 'object',
            properties: {
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung']
              }
            }
          }
        },
        {
          name: 'get_vm',
          description: 'Get detailed virtual machine information',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'Virtual machine ID' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId']
          }
        },
        {
          name: 'shutdown_vm',
          description: 'Gracefully shutdown a virtual machine via guest OS (preferred over power_off_vm)',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'Virtual machine ID' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId']
          }
        },
        {
          name: 'reboot_vm',
          description: 'Gracefully reboot a virtual machine via guest OS',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'Virtual machine ID' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId']
          }
        },
        {
          name: 'suspend_vm',
          description: 'Suspend a virtual machine',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'Virtual machine ID' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId']
          }
        },
        {
          name: 'get_vapp',
          description: 'Get detailed vApp information',
          inputSchema: {
            type: 'object',
            properties: {
              vappId: { type: 'string', description: 'vApp ID' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vappId']
          }
        },
        {
          name: 'power_on_vapp',
          description: 'Power on a vApp and all its VMs',
          inputSchema: {
            type: 'object',
            properties: {
              vappId: { type: 'string', description: 'vApp ID' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vappId']
          }
        },
        {
          name: 'power_off_vapp',
          description: 'Power off a vApp. WARNING: hard power-off.',
          inputSchema: {
            type: 'object',
            properties: {
              vappId: { type: 'string', description: 'vApp ID' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vappId']
          }
        },
        {
          name: 'create_vapp',
          description: 'Deploy a new vApp from a catalog template. IMPORTANT: All VM configuration (name, network, OVF properties) must go inside instantiationParams.vmConfigs — top-level vmConfigs/ovfProperties are silently ignored. CPU/memory/disk are NOT applied during instantiation (vCD limitation) — use update_vm_cpu/update_vm_memory/update_vm_disk afterward (sequentially, waiting for each task). Typical workflow: create_vapp → get_task until success → update_vm_disk → get_task → update_vm_memory → get_task → power_on_vapp. Network auto-discovery: if vmConfigs omit networkConnections and only one routed network exists it is used automatically (POOL mode); if multiple networks exist returns CLARIFICATION_REQUIRED — call list_org_networks first.',
          inputSchema: {
            type: 'object',
            properties: {
              vdcId: { type: 'string', description: 'Target VDC ID (UUID from list_vdcs)' },
              templateId: { type: 'string', description: 'Full catalog template href (e.g. "https://mycloud-jkt.zettagrid.id/api/vAppTemplate/vappTemplate-{uuid}") from list_catalog_items' },
              vappName: { type: 'string', description: 'Name for the new vApp' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] },
              instantiationParams: {
                type: 'object',
                description: 'VM and network configuration. ALL per-VM config must go here — do NOT pass vmConfigs or ovfProperties at the top level.',
                properties: {
                  networkConfig: {
                    type: 'array',
                    description: 'vApp-level network fence configuration (usually auto-populated from vmConfigs.networkConnections — only specify manually for advanced topologies)',
                    items: {
                      type: 'object',
                      properties: {
                        networkName: { type: 'string', description: 'Name of the network' },
                        parentNetworkHref: { type: 'string', description: 'Href of the parent org network to connect to' },
                        fenceMode: { type: 'string', enum: ['bridged', 'isolated', 'natRouted'], description: 'Network fence mode' }
                      },
                      required: ['networkName', 'fenceMode']
                    }
                  },
                  vmConfigs: {
                    type: 'array',
                    description: 'Per-VM configuration (one entry per VM in the template). NOTE: cpuCount/memoryMB/diskSizeMB are recorded but NOT applied by vCD during instantiation — the VM gets template defaults. Resize with update_vm_cpu/update_vm_memory/update_vm_disk after creation (run sequentially, not in parallel).',
                    items: {
                      type: 'object',
                      properties: {
                        vmName: { type: 'string', description: 'VM display name — use "vmName" NOT "name" (common mistake). Overrides template default.' },
                        description: { type: 'string', description: 'VM description' },
                        cpuCount: { type: 'number', description: 'vCPU count — use "cpuCount" NOT "cpus". Applied post-instantiation via update_vm_cpu.' },
                        coresPerSocket: { type: 'number', description: 'CPU cores per socket' },
                        memoryMB: { type: 'number', description: 'RAM in MB — use "memoryMB" NOT "memorySizeMB". Applied post-instantiation via update_vm_memory.' },
                        diskSizeMB: { type: 'number', description: 'Boot disk size in MB — applied post-instantiation via update_vm_disk.' },
                        storageProfileHref: { type: 'string', description: 'Storage policy href' },
                        storageProfileName: { type: 'string', description: 'Storage policy name' },
                        networkConnections: {
                          type: 'array',
                          description: 'VM NIC connections to org VDC networks',
                          items: {
                            type: 'object',
                            properties: {
                              networkName: { type: 'string', description: 'Org VDC network name to connect to' },
                              ipMode: { type: 'string', enum: ['DHCP', 'POOL', 'MANUAL', 'NONE'], description: 'IP allocation mode. Omit to auto-select: defaults to POOL when pool IPs are available, otherwise clarification is requested.' },
                              ipAddress: { type: 'string', description: 'Static IP (required when ipMode=MANUAL)' },
                              isPrimary: { type: 'boolean', description: 'Set as primary NIC (default: first NIC)' },
                              index: { type: 'number', description: 'NIC index (default: array position)' }
                            },
                            required: ['networkName']
                          }
                        },
                        ovfProperties: {
                          type: 'array',
                          description: 'OVF ProductSection properties for cloud-init (Ubuntu). Keys: hostname, instance-id (required), password, public-keys, user-data (base64), seedfrom',
                          items: {
                            type: 'object',
                            properties: {
                              key: { type: 'string' },
                              value: { type: 'string' }
                            },
                            required: ['key', 'value']
                          }
                        },
                        guestCustomization: {
                          type: 'object',
                          description: 'Guest OS customization (Windows VMs / VCD guest tools)',
                          properties: {
                            enabled: { type: 'boolean' },
                            computerName: { type: 'string' },
                            adminPasswordEnabled: { type: 'boolean' },
                            adminPasswordAuto: { type: 'boolean' },
                            adminPassword: { type: 'string' },
                            resetPasswordRequired: { type: 'boolean' },
                            customizationScript: { type: 'string' },
                            changeSid: { type: 'boolean' }
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            required: ['vdcId', 'templateId', 'vappName']
          }
        },
        {
          name: 'list_disks',
          description: 'List named independent disks',
          inputSchema: {
            type: 'object',
            properties: {
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            }
          }
        },
        {
          name: 'list_tasks',
          description: 'List recent asynchronous tasks (useful for checking status after power/resize operations)',
          inputSchema: {
            type: 'object',
            properties: {
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            }
          }
        },
        {
          name: 'list_org_networks',
          description: 'List organization VDC networks',
          inputSchema: {
            type: 'object',
            properties: {
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            }
          }
        },
        {
          name: 'list_catalogs',
          description: 'List catalogs available in the organization',
          inputSchema: {
            type: 'object',
            properties: {
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            }
          }
        },
        {
          name: 'list_catalog_items',
          description: 'List catalog items (vApp templates) — use this to find templateId for create_vapp',
          inputSchema: {
            type: 'object',
            properties: {
              catalogId: { type: 'string', description: 'Catalog ID to filter by (optional, lists from all catalogs if omitted)' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            }
          }
        },
        {
          name: 'list_snapshots',
          description: 'List snapshots for a VM',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'Virtual machine ID' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId']
          }
        },
        {
          name: 'create_snapshot',
          description: 'Create a snapshot of a VM\'s current state',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'Virtual machine ID' },
              snapshotName: { type: 'string', description: 'Snapshot name (optional)' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId']
          }
        },
        {
          name: 'revert_snapshot',
          description: 'Revert a VM to its current (most recent) snapshot',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'Virtual machine ID' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId']
          }
        },
        {
          name: 'remove_snapshots',
          description: 'Remove all snapshots for a VM',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'Virtual machine ID' },
              zoneId: { type: 'string', description: 'Zone ID (optional)', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId']
          }
        },
        {
          name: 'get_zone_health',
          description: 'Get health status across all configured zones (session stats, validation results)',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
                {
          name: 'get_zone_info',
          description: 'Get information about available zones and current configuration',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'add_vm_to_vapp',
          description: 'Add a VM from a catalog template into an existing vApp. The vApp must already exist (use create_vapp or list_vapps to find it). Network ipMode defaults to POOL when pool IPs are available; if pool is exhausted and vdcId is provided, clarification is requested. Compute overrides (CPU, memory, disk) are not applied during instantiation — use update_vm_cpu / update_vm_memory / update_vm_disk on the new VM afterward.',
          inputSchema: {
            type: 'object',
            properties: {
              vappId: { type: 'string', description: 'Existing vApp UUID (from list_vapps or create_vapp)' },
              templateId: { type: 'string', description: 'Catalog template href (from list_catalog_items)' },
              vmName: { type: 'string', description: 'Name for the new VM' },
              vdcId: { type: 'string', description: 'VDC UUID (optional but recommended — enables static IP pool availability checking)' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] },
              networkConnections: {
                type: 'array',
                description: 'NIC connections to org VDC networks. Omit ipMode to auto-select POOL when IPs are available.',
                items: {
                  type: 'object',
                  properties: {
                    networkName: { type: 'string', description: 'Org VDC network name' },
                    ipMode: { type: 'string', enum: ['DHCP', 'POOL', 'MANUAL', 'NONE'], description: 'IP allocation mode (omit to auto-select)' },
                    ipAddress: { type: 'string', description: 'Static IP (required when ipMode=MANUAL)' },
                    isPrimary: { type: 'boolean', description: 'Set as primary NIC' },
                    index: { type: 'number', description: 'NIC index (default: array position)' }
                  },
                  required: ['networkName']
                }
              },
              ovfProperties: {
                type: 'array',
                description: 'OVF ProductSection properties for cloud-init (Ubuntu). Keys: hostname, instance-id, password, public-keys, user-data (base64)',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    value: { type: 'string' }
                  },
                  required: ['key', 'value']
                }
              },
              guestCustomization: {
                type: 'object',
                description: 'Guest OS customization (Windows VMs / VCD guest tools)',
                properties: {
                  enabled: { type: 'boolean' },
                  computerName: { type: 'string' },
                  adminPasswordEnabled: { type: 'boolean' },
                  adminPasswordAuto: { type: 'boolean' },
                  adminPassword: { type: 'string' },
                  resetPasswordRequired: { type: 'boolean' },
                  customizationScript: { type: 'string' },
                  changeSid: { type: 'boolean' }
                }
              }
            },
            required: ['vappId', 'templateId', 'vmName']
          }
        },
        {
          name: 'update_vm_network',
          description: 'Update a VM NIC\'s network/IP properties. Takes flat parameters (nicIndex, networkName, ipMode, ipAddress, isPrimary) — NOT a networkConnections array. The networkName must match the name of a network the vApp already has configured (as shown in get_vm networkConnections[].network). VM can be running or powered off.',
          inputSchema: {
            type: 'object',
            properties: {
              vmId: { type: 'string', description: 'VM UUID' },
              nicIndex: { type: 'number', description: 'NIC index to update (default: 0 — first NIC)' },
              networkName: { type: 'string', description: 'New org VDC network name to connect this NIC to' },
              ipMode: { type: 'string', enum: ['DHCP', 'POOL', 'MANUAL', 'NONE'], description: 'IP allocation mode' },
              ipAddress: { type: 'string', description: 'Static IP address (required when ipMode=MANUAL)' },
              isPrimary: { type: 'boolean', description: 'Set this NIC as the primary NIC' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['vmId']
          }
        },
        {
          name: 'list_application_port_profiles',
          description: 'List application port profiles (system-defined and tenant-defined). Use this to find the URN needed for create_firewall_rule portProfileId, create_nat_rule applicationPortProfileId, etc.',
          inputSchema: {
            type: 'object',
            properties: {
              filter: {
                type: 'string',
                enum: ['ALL', 'SYSTEM', 'TENANT'],
                description: 'Scope filter: ALL (default), SYSTEM (built-in), or TENANT (custom)'
              },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            }
          }
        },
        {
          name: 'create_application_port_profile',
          description: 'Create a custom application port profile (tenant-scoped). NOTE: the response data is empty — the URN is NOT returned. After creation call list_application_port_profiles(filter: TENANT) to retrieve the new profile\'s URN. Use list_application_port_profiles first to avoid creating duplicates.',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Profile name (e.g. "Custom-SSH-13022")' },
              contextEntityId: { type: 'string', description: 'VDC URN to scope the profile — MUST be "urn:vcloud:vdc:{uuid}" (NOT a gateway URN). Get the VDC UUID from list_vdcs.' },
              ports: {
                type: 'array',
                description: 'One or more port/protocol definitions',
                items: {
                  type: 'object',
                  properties: {
                    protocol: { type: 'string', enum: ['TCP', 'UDP', 'ICMPv4', 'ICMPv6'], description: 'Protocol' },
                    destinationPorts: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Destination port numbers or ranges (e.g. ["80", "8080-8090"])'
                    }
                  },
                  required: ['protocol', 'destinationPorts']
                }
              },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['name', 'contextEntityId', 'ports']
          }
        },
        {
          name: 'delete_application_port_profile',
          description: 'Delete a tenant-scoped application port profile by its URN or UUID. Only tenant-created profiles can be deleted; system-defined profiles will return an error. Delete any NAT/firewall rules that reference the profile before deleting it.',
          inputSchema: {
            type: 'object',
            properties: {
              profileId: { type: 'string', description: 'Application port profile URN (e.g. "urn:vcloud:applicationPortProfile:uuid") or bare UUID' },
              zoneId: { type: 'string', enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'] }
            },
            required: ['profileId']
          }
        }
      ]
    }));

    // Register call_tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!this.client) {
        throw new McpError(
          ErrorCode.InternalError,
          'Server not properly initialized'
        );
      }

      try {
        let result: McpToolResponse;
        let responseText: string | undefined;

        const req = (param: string): string => {
          const val = args?.[param];
          if (val === undefined || val === null || val === '') {
            throw new McpError(ErrorCode.InvalidParams, `'${param}' is required for tool '${name}'`);
          }
          return val as string;
        };
        const reqNum = (param: string): number => {
          const val = args?.[param];
          if (val === undefined || val === null) {
            throw new McpError(ErrorCode.InvalidParams, `'${param}' is required for tool '${name}'`);
          }
          return val as number;
        };

        switch (name) {
          case 'test_zone':
            result = await this.client.testZone(req('zoneId'));
            break;

          case 'list_organizations':
            result = await this.client.listOrganizations(args?.zoneId as string | undefined);
            break;

          case 'get_organization':
            result = await this.client.getOrganization(req('organizationId'), args?.zoneId as string | undefined);
            break;

          case 'list_vdcs':
            result = await this.client.listVdcs(args?.zoneId as string | undefined);
            break;

          case 'get_vdc':
            result = await this.client.getVdc(req('vdcId'), args?.zoneId as string | undefined);
            break;

          case 'show_vdc_resources':
            result = await this.client.showVdcResources(req('vdcId'), args?.zoneId as string | undefined);
            if (result.success && result.data) {
              responseText = this.formatVdcResourcesTable(result.data as VdcResourceSummary);
            }
            break;

          case 'show_all_vdc_resources':
            result = await this.handleShowAllVdcResources(args?.zoneId as string | undefined);
            if (result.success && result.data) {
              responseText = result.data as string;
            }
            break;

          case 'list_vapps':
            result = await this.client.listVApps(args?.vdcId as string | undefined, args?.zoneId as string | undefined);
            break;

          case 'list_vms':
            result = await this.client.listVMs(args?.vappId as string | undefined, args?.zoneId as string | undefined);
            break;

          case 'power_on_vm':
            result = await this.client.powerOnVM(req('vmId'), args?.zoneId as string | undefined);
            break;

          case 'power_off_vm':
            result = await this.client.powerOffVM(req('vmId'), args?.zoneId as string | undefined);
            break;

          case 'get_vm_console':
            result = await this.client.getVMConsole(req('vmId'), args?.zoneId as string | undefined);
            break;

          case 'list_edge_gateways':
            result = await this.client.listEdgeGateways(args?.zoneId as string | undefined);
            break;

          case 'get_edge_gateway':
            result = await this.client.getEdgeGateway(req('edgeGatewayId'), args?.zoneId as string | undefined);
            break;

          case 'list_firewall_rules':
            result = await this.client.listFirewallRules(req('edgeGatewayId'), args?.zoneId as string | undefined);
            break;

          case 'create_firewall_rule': {
            const firewallRule = {
              name: (args?.name || args?.description) as string,
              description: (args?.description || args?.name) as string,
              policy: req('policy') as 'allow' | 'drop',
              sourceIp: args?.sourceIp as string,
              destinationIp: args?.destinationIp as string,
              sourcePortRange: args?.sourcePortRange as string,
              destinationPortRange: args?.destinationPortRange as string,
              isEnabled: args?.isEnabled as boolean,
              enableLogging: args?.enableLogging as boolean,
              portProfiles: args?.portProfiles as string[] | undefined,
              portProfileId: args?.portProfileId as string | undefined,
              sourceFirewallGroups: args?.sourceFirewallGroups as string[] | undefined,
              destinationFirewallGroups: args?.destinationFirewallGroups as string[] | undefined,
              protocols: {
                tcp: args?.protocol === 'tcp' || args?.protocol === 'any',
                udp: args?.protocol === 'udp' || args?.protocol === 'any',
                icmp: args?.protocol === 'icmp' || args?.protocol === 'any'
              }
            };
            result = await this.client.createFirewallRule(
              req('edgeGatewayId'),
              firewallRule,
              args?.zoneId as string | undefined
            );
            break;
          }

          case 'show_edge_network_config':
            result = await this.client.showEdgeNetworkConfig(
              req('edgeGatewayId'),
              args?.zoneId as string | undefined
            );
            break;

          case 'list_nat_rules':
            result = await this.client.listNatRules(
              req('edgeGatewayId'),
              args?.zoneId as string | undefined
            );
            break;

          case 'get_vm_metrics':
            result = await this.client.getVmMetrics(
              req('vmId'),
              args?.zoneId as string | undefined
            );
            break;

          case 'update_firewall_rule':
            result = await this.client.updateFirewallRule(
              req('edgeGatewayId'),
              req('ruleId'),
              {
                name: req('name'),
                description: args?.description as string | undefined,
                policy: args?.policy as string | undefined,
                isEnabled: args?.isEnabled as boolean | undefined,
                sourceIp: args?.sourceIp as string | undefined,
                destinationIp: args?.destinationIp as string | undefined,
                portProfiles: args?.portProfiles as string[] | undefined,
                portProfileId: args?.portProfileId as string | undefined,
                sourceFirewallGroups: args?.sourceFirewallGroups as string[] | undefined,
                destinationFirewallGroups: args?.destinationFirewallGroups as string[] | undefined,
                enableLogging: args?.enableLogging as boolean | undefined,
              } as any,
              args?.zoneId as string | undefined
            );
            break;

          case 'delete_firewall_rule':
            result = await this.client.deleteFirewallRule(
              req('edgeGatewayId'),
              req('ruleId'),
              args?.zoneId as string | undefined
            );
            break;

          case 'create_nat_rule':
            result = await this.client.createNatRule(
              req('edgeGatewayId'),
              {
                name: req('name'),
                type: req('type') as 'DNAT' | 'SNAT' | 'REFLEXIVE',
                externalAddresses: req('externalAddresses'),
                internalAddresses: req('internalAddresses'),
                ...(args?.externalPort !== undefined && { externalPort: args.externalPort as string }),
                ...(args?.internalPort !== undefined && { internalPort: args.internalPort as string }),
                ...(args?.description !== undefined && { description: args.description as string }),
                ...(args?.enabled !== undefined && { enabled: args.enabled as boolean }),
                ...(args?.applicationPortProfileId !== undefined && { applicationPortProfileId: args.applicationPortProfileId as string }),
                ...(args?.applicationPortProfileName !== undefined && { applicationPortProfileName: args.applicationPortProfileName as string }),
                ...(args?.firewallMatch !== undefined && { firewallMatch: args.firewallMatch as string }),
              },
              args?.zoneId as string | undefined
            );
            break;

          case 'delete_nat_rule':
            result = await this.client.deleteNatRule(
              req('edgeGatewayId'),
              req('ruleId'),
              args?.zoneId as string | undefined
            );
            break;

          case 'reset_vm':
            result = await this.client.resetVM(
              req('vmId'),
              args?.zoneId as string | undefined
            );
            break;

          case 'update_vm_cpu':
            result = await this.client.updateVMCpu(
              req('vmId'),
              reqNum('cpuCount'),
              args?.coresPerSocket as number | undefined,
              args?.zoneId as string | undefined,
              args?.cpuHotAdd as boolean | undefined
            );
            break;

          case 'update_vm_disk':
            result = await this.client.updateVMDisk(
              req('vmId'),
              reqNum('diskSizeMB'),
              args?.zoneId as string | undefined
            );
            break;

          case 'update_vm_memory':
            result = await this.client.updateVMMemory(
              req('vmId'),
              reqNum('memoryMB'),
              args?.zoneId as string | undefined,
              args?.memoryHotAdd as boolean | undefined
            );
            break;

          case 'update_vm_computer_name':
            result = await this.client.updateVMComputerName(
              req('vmId'),
              req('computerName'),
              args?.zoneId as string | undefined
            );
            break;

          case 'delete_vapp':
            result = await this.client.deleteVApp(
              req('vappId'),
              args?.zoneId as string | undefined
            );
            break;

          case 'undeploy_vapp':
            result = await this.client.undeployVApp(
              req('vappId'),
              args?.zoneId as string | undefined
            );
            break;

          case 'get_task':
            result = await this.client.getTask(
              req('taskId'),
              args?.zoneId as string | undefined
            );
            break;

          case 'list_external_networks':
            result = await this.client.listExternalNetworks(args?.zoneId as string | undefined);
            break;

          case 'get_provider_network_info':
            result = await this.client.getProviderNetworkInfo(args?.zoneId as string | undefined);
            break;

          case 'get_vm':
            result = await this.client.getVM(req('vmId'), args?.zoneId as string | undefined);
            break;

          case 'shutdown_vm':
            result = await this.client.shutdownVM(req('vmId'), args?.zoneId as string | undefined);
            break;

          case 'reboot_vm':
            result = await this.client.rebootVM(req('vmId'), args?.zoneId as string | undefined);
            break;

          case 'suspend_vm':
            result = await this.client.suspendVM(req('vmId'), args?.zoneId as string | undefined);
            break;

          case 'get_vapp':
            result = await this.client.getVApp(req('vappId'), args?.zoneId as string | undefined);
            break;

          case 'power_on_vapp':
            result = await this.client.powerOnVApp(req('vappId'), args?.zoneId as string | undefined);
            break;

          case 'power_off_vapp':
            result = await this.client.powerOffVApp(req('vappId'), args?.zoneId as string | undefined);
            break;

          case 'create_vapp': {
            // Input validation: catch common parameter mistakes before sending to vCD
            const configErrors: string[] = [];
            if (args?.vmConfigs !== undefined) {
              configErrors.push('"vmConfigs" was passed at the top level — it must be inside instantiationParams.vmConfigs (e.g. instantiationParams: { vmConfigs: [...] })');
            }
            if (args?.ovfProperties !== undefined) {
              configErrors.push('"ovfProperties" was passed at the top level — it must be inside instantiationParams.vmConfigs[].ovfProperties');
            }
            if (args?.networkConnections !== undefined) {
              configErrors.push('"networkConnections" was passed at the top level — it must be inside instantiationParams.vmConfigs[].networkConnections');
            }
            const vmCfgs = (args?.instantiationParams as any)?.vmConfigs;
            if (Array.isArray(vmCfgs)) {
              vmCfgs.forEach((cfg: any, i: number) => {
                if (cfg?.name !== undefined && cfg?.vmName === undefined) {
                  configErrors.push(`instantiationParams.vmConfigs[${i}]: use "vmName" not "name" to set the VM display name`);
                }
                if (cfg?.cpus !== undefined && cfg?.cpuCount === undefined) {
                  configErrors.push(`instantiationParams.vmConfigs[${i}]: use "cpuCount" not "cpus"`);
                }
                if (cfg?.memorySizeMB !== undefined && cfg?.memoryMB === undefined) {
                  configErrors.push(`instantiationParams.vmConfigs[${i}]: use "memoryMB" not "memorySizeMB"`);
                }
                if (cfg?.memory !== undefined && cfg?.memoryMB === undefined) {
                  configErrors.push(`instantiationParams.vmConfigs[${i}]: use "memoryMB" not "memory"`);
                }
              });
            }
            if (configErrors.length > 0) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `create_vapp parameter errors:\n${configErrors.map(e => `  • ${e}`).join('\n')}`
              );
            }
            result = await this.client.createVApp(
              req('vdcId'),
              req('templateId'),
              req('vappName'),
              args?.zoneId as string | undefined,
              args?.instantiationParams as import('../types.js').VAppInstantiationParams | undefined
            );
            break;
          }

          case 'list_disks':
            result = await this.client.listDisks(args?.zoneId as string | undefined);
            break;

          case 'list_tasks':
            result = await this.client.listTasks(args?.zoneId as string | undefined);
            break;

          case 'list_org_networks':
            result = await this.client.listOrgNetworks(args?.zoneId as string | undefined);
            break;

          case 'list_catalogs':
            result = await this.client.listCatalogs(args?.zoneId as string | undefined);
            break;

          case 'list_catalog_items':
            result = await this.client.listCatalogItems(args?.catalogId as string | undefined, args?.zoneId as string | undefined);
            break;

          case 'list_snapshots':
            result = await this.client.listSnapshots(req('vmId'), args?.zoneId as string | undefined);
            break;

          case 'create_snapshot':
            result = await this.client.createSnapshot(
              req('vmId'),
              args?.snapshotName as string | undefined,
              args?.zoneId as string | undefined
            );
            break;

          case 'revert_snapshot':
            result = await this.client.revertSnapshot(req('vmId'), args?.zoneId as string | undefined);
            break;

          case 'remove_snapshots':
            result = await this.client.removeAllSnapshots(req('vmId'), args?.zoneId as string | undefined);
            break;

          case 'get_zone_health':
            result = await this.client.getZoneHealth();
            break;

          case 'get_zone_info':
            result = await this.client.getZoneInfo();
            break;

          case 'add_vm_to_vapp':
            result = await this.client.addVMToVApp(
              req('vappId'),
              req('templateId'),
              req('vmName'),
              {
                networkConnections: args?.networkConnections as import('../types.js').VAppNetworkConnection[] | undefined,
                ovfProperties: args?.ovfProperties as import('../types.js').VAppOvfProperty[] | undefined,
                guestCustomization: args?.guestCustomization as import('../types.js').VAppGuestCustomization | undefined,
              },
              args?.vdcId as string | undefined,
              args?.zoneId as string | undefined
            );
            break;

          case 'update_vm_network':
            result = await this.client.updateVMNetwork(
              req('vmId'),
              {
                nicIndex: args?.nicIndex as number | undefined,
                networkName: args?.networkName as string | undefined,
                ipMode: args?.ipMode as 'DHCP' | 'POOL' | 'MANUAL' | 'NONE' | undefined,
                ipAddress: args?.ipAddress as string | undefined,
                isPrimary: args?.isPrimary as boolean | undefined,
              },
              args?.zoneId as string | undefined
            );
            break;

          case 'list_application_port_profiles':
            result = await this.client.listApplicationPortProfiles(
              args?.filter as string | undefined,
              args?.zoneId as string | undefined
            );
            break;

          case 'create_application_port_profile':
            result = await this.client.createApplicationPortProfile(
              req('name'),
              req('contextEntityId'),
              args?.ports as Array<{ protocol: string; destinationPorts: string[] }>,
              args?.zoneId as string | undefined
            );
            break;

          case 'delete_application_port_profile':
            result = await this.client.deleteApplicationPortProfile(
              req('profileId'),
              args?.zoneId as string | undefined
            );
            break;

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }

        // Use formatted text if available, otherwise return JSON
        return {
          content: [
            {
              type: 'text',
              text: responseText || JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Detect vCD concurrent-update conflict (HTTP 400 VAPP_UPDATE_VM with a blocking task ID)
        const concurrentMatch = errorMessage.match(/VAPP_UPDATE_VM\(com\.vmware\.vcloud\.entity\.task:([a-f0-9-]+)\)/);
        if (concurrentMatch) {
          const blockingTaskId = concurrentMatch[1];
          throw new McpError(
            ErrorCode.InternalError,
            `VM update conflict: another update is still running (task ${blockingTaskId}). ` +
            `Wait for it to complete with get_task(taskId: "${blockingTaskId}") before retrying. ` +
            `vCD only allows one concurrent hardware update per VM.`
          );
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${errorMessage}`
        );
      }
    });
  }
}