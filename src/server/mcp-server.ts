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
import { McpToolResponse } from '../types.js';

export class ZettagridMcpServer {
  private server: Server;
  private client: ZettagridClient;

  constructor(server: Server) {
    this.server = server;
    this.client = new ZettagridClient();
  }

  /**
   * Initialize the MCP server with all tool handlers
   */
  async initialize(): Promise<void> {
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
              }
            },
            required: ['vdcId']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
              }
            },
            required: ['edgeGatewayId']
          }
        },
        {
          name: 'create_firewall_rule',
          description: 'Create a firewall rule',
          inputSchema: {
            type: 'object',
            properties: {
              edgeGatewayId: {
                type: 'string',
                description: 'Edge gateway ID'
              },
              description: {
                type: 'string',
                description: 'Firewall rule description'
              },
              policy: {
                type: 'string',
                description: 'Firewall policy',
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
              zoneId: {
                type: 'string',
                description: 'Zone ID (optional)',
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
              }
            },
            required: ['edgeGatewayId', 'description']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
              }
            },
            required: ['edgeGatewayId']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
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
                enum: ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin']
              }
            }
          }
        },
        {
          name: 'get_zone_info',
          description: 'Get information about available zones and current configuration',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    }));

    // Register call_tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result: McpToolResponse;

        switch (name) {
          case 'test_zone':
            result = await this.client.testZone(args?.zoneId as string);
            break;

          case 'list_organizations':
            result = await this.client.listOrganizations(args?.zoneId as string | undefined);
            break;

          case 'get_organization':
            result = await this.client.getOrganization(args?.organizationId as string, args?.zoneId as string | undefined);
            break;

          case 'list_vdcs':
            result = await this.client.listVdcs(args?.zoneId as string | undefined);
            break;

          case 'get_vdc':
            result = await this.client.getVdc(args?.vdcId as string, args?.zoneId as string | undefined);
            break;

          case 'show_vdc_resources':
            result = await this.client.showVdcResources(args?.vdcId as string, args?.zoneId as string | undefined);
            break;

          case 'list_vapps':
            result = await this.client.listVApps(args?.vdcId as string | undefined, args?.zoneId as string | undefined);
            break;

          case 'list_vms':
            result = await this.client.listVMs(args?.vappId as string | undefined, args?.zoneId as string | undefined);
            break;

          case 'power_on_vm':
            result = await this.client.powerOnVM(args?.vmId as string, args?.zoneId as string | undefined);
            break;

          case 'power_off_vm':
            result = await this.client.powerOffVM(args?.vmId as string, args?.zoneId as string | undefined);
            break;

          case 'get_vm_console':
            result = await this.client.getVMConsole(args?.vmId as string, args?.zoneId as string | undefined);
            break;

          case 'list_edge_gateways':
            result = await this.client.listEdgeGateways(args?.zoneId as string | undefined);
            break;

          case 'get_edge_gateway':
            result = await this.client.getEdgeGateway(args?.edgeGatewayId as string, args?.zoneId as string | undefined);
            break;

          case 'list_firewall_rules':
            result = await this.client.listFirewallRules(args?.edgeGatewayId as string, args?.zoneId as string | undefined);
            break;

          case 'create_firewall_rule':
            const firewallRule = {
              description: args?.description as string,
              policy: args?.policy as 'allow' | 'drop',
              sourceIp: args?.sourceIp as string,
              destinationIp: args?.destinationIp as string,
              sourcePortRange: args?.sourcePortRange as string,
              destinationPortRange: args?.destinationPortRange as string,
              isEnabled: args?.isEnabled as boolean,
              enableLogging: args?.enableLogging as boolean,
              protocols: {
                tcp: args?.protocol === 'tcp' || args?.protocol === 'any',
                udp: args?.protocol === 'udp' || args?.protocol === 'any',
                icmp: args?.protocol === 'icmp' || args?.protocol === 'any'
              }
            };
            result = await this.client.createFirewallRule(
              args?.edgeGatewayId as string, 
              firewallRule, 
              args?.zoneId as string | undefined
            );
            break;

          case 'show_edge_network_config':
            result = await this.client.showEdgeNetworkConfig(
              args?.edgeGatewayId as string, 
              args?.zoneId as string | undefined
            );
            break;

          case 'list_external_networks':
            result = await this.client.listExternalNetworks(args?.zoneId as string | undefined);
            break;

          case 'get_provider_network_info':
            result = await this.client.getProviderNetworkInfo(args?.zoneId as string | undefined);
            break;

          case 'get_zone_info':
            result = await this.client.getZoneInfo();
            break;

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${errorMessage}`
        );
      }
    });
  }
}