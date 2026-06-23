/**
 * Simple XML parsing utilities for vCloud Director responses
 */

export interface ParsedVdc {
  href: string;
  id: string;
  name: string;
  type: string;
  isEnabled?: boolean;
  status?: number;
}

export interface ParsedVApp {
  href: string;
  id: string;
  name: string;
  type: string;
  status?: number;
  deployed?: boolean;
}

export interface ParsedVM {
  href: string;
  id: string;
  name: string;
  type: string;
  status?: number;
  deployed?: boolean;
  vAppTemplate?: string;
}

export interface ParsedOrganization {
  href: string;
  id: string;
  name: string;
  type: string;
  fullName?: string;
}

/**
 * Parse VDC records from vCloud Director query response
 */
export function parseVdcRecords(xmlString: string): ParsedVdc[] {
  const vdcs: ParsedVdc[] = [];
  
  const vdcPattern = /<(\w+:)?(\w*[Vv]dc\w*)?Record\b[^>]*>/g;
  const matches = xmlString.match(vdcPattern);
  
  if (matches) {
    matches.forEach(match => {
      const href = extractAttribute(match, 'href');
      const name = extractAttribute(match, 'name');
      const id = extractIdFromHref(href) || extractAttribute(match, 'id');
      const type = extractAttribute(match, 'type') || 'application/vnd.vmware.vcloud.vdc+xml';
      const isEnabled = extractAttribute(match, 'isEnabled');
      const status = extractAttribute(match, 'status');
      
      if (href && name && id) {
        const vdc: ParsedVdc = { href, id, name, type, isEnabled: isEnabled === 'true' };
        if (status) vdc.status = parseInt(status, 10);
        vdcs.push(vdc);
      }
    });
  }
  
  return vdcs;
}

/**
 * Parse vApp records from vCloud Director query response
 */
export function parseVAppRecords(xmlString: string): ParsedVApp[] {
  const vapps: ParsedVApp[] = [];
  
  const vappPattern = /<(\w+:)?(\w*[Vv][Aa]pp\w*)?Record\b[^>]*>/g;
  const matches = xmlString.match(vappPattern);
  
  if (matches) {
    matches.forEach(match => {
      const href = extractAttribute(match, 'href');
      const name = extractAttribute(match, 'name');
      const id = extractIdFromHref(href) || extractAttribute(match, 'id');
      const type = extractAttribute(match, 'type') || 'application/vnd.vmware.vcloud.vApp+xml';
      const status = extractAttribute(match, 'status');
      const deployed = extractAttribute(match, 'deployed');
      
      if (href && name && id) {
        const vapp: ParsedVApp = { href, id, name, type, deployed: deployed === 'true' };
        if (status) {
          const statusNum = parseInt(status, 10);
          vapp.status = isNaN(statusNum) ? (status as unknown as number) : statusNum;
        }
        vapps.push(vapp);
      }
    });
  }
  
  return vapps;
}

/**
 * Parse VM records from vCloud Director query response.
 * Matches VMRecord elements and filters out catalog template VMs via isVAppTemplate="true"
 * or href path containing /vAppTemplate/. Only deployed VM instances are returned.
 */
export function parseVMRecords(xmlString: string): ParsedVM[] {
  const vms: ParsedVM[] = [];

  // VCD returns VMRecord (uppercase M) for all VMs including catalog templates
  const vmPattern = /<(\w+:)?VMRecord\b[^>]*>/g;
  const matches = xmlString.match(vmPattern);

  if (matches) {
    matches.forEach(match => {
      // Skip catalog template VMs — they carry isVAppTemplate="true"
      // or their href points to /vAppTemplate/ instead of /vApp/
      const isTemplate = /isVAppTemplate="true"/i.test(match) ||
                         /href="[^"]*\/vAppTemplate\/vm-/i.test(match);
      if (isTemplate) return;

      const href = extractAttribute(match, 'href');
      const name = extractAttribute(match, 'name');
      const id = extractIdFromHref(href) || extractAttribute(match, 'id');
      const type = extractAttribute(match, 'type') || 'application/vnd.vmware.vcloud.vm+xml';
      const status = extractAttribute(match, 'status');
      const deployed = extractAttribute(match, 'deployed');
      const vAppTemplate = extractAttribute(match, 'vAppTemplate');

      if (href && name && id) {
        const vm: ParsedVM = { href, id, name, type, deployed: deployed === 'true' };
        // status in query records may be numeric or string depending on VCD version
        if (status) {
          const statusNum = parseInt(status, 10);
          vm.status = isNaN(statusNum) ? (status as unknown as number) : statusNum;
        }
        if (vAppTemplate) vm.vAppTemplate = vAppTemplate;
        vms.push(vm);
      }
    });
  }

  return vms;
}

/**
 * Parse organization records from vCloud Director response
 */
export function parseOrganizationRecords(xmlString: string): ParsedOrganization[] {
  const orgs: ParsedOrganization[] = [];
  
  const orgPattern = /<(\w+:)?(\w*[Oo]rg\w*)?Record\b[^>]*>/g;
  const matches = xmlString.match(orgPattern);
  
  if (matches) {
    matches.forEach(match => {
      const href = extractAttribute(match, 'href');
      const name = extractAttribute(match, 'name');
      const id = extractIdFromHref(href) || extractAttribute(match, 'id');
      const type = extractAttribute(match, 'type') || 'application/vnd.vmware.vcloud.org+xml';
      const fullName = extractAttribute(match, 'fullName');
      
      if (href && name && id) {
        orgs.push({ href, id, name, type, fullName });
      }
    });
  }
  
  return orgs;
}

/**
 * Extract attribute value from XML element string
 */
function extractAttribute(xmlElement: string, attributeName: string): string {
  const pattern = new RegExp(`${attributeName}=["']([^"']*?)["']`, 'i');
  const match = xmlElement.match(pattern);
  return match?.[1] || '';
}

/**
 * Extract ID from href URL
 */
export function extractIdFromHref(href: string): string {
  if (!href) return '';
  const match = href.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
  if (match?.[1]) return match[1];
  const parts = href.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * Normalize input to extract ID from either href URL or direct ID
 */
export function normalizeIdFromHrefOrId(input: string): string {
  if (!input) return '';
  if (input.includes('/') && (input.startsWith('http') || input.includes('api/'))) {
    return extractIdFromHref(input);
  }
  return input;
}

/**
 * Parse generic query results from vCloud Director query response
 */
export function parseQueryResults(xmlString: string): Record<string, any>[] {
  const results: Record<string, any>[] = [];
  const recordPattern = /<(\w+:)?(\w*Record)\b[^>]*>/g;
  let match;
  
  while ((match = recordPattern.exec(xmlString)) !== null) {
    const fullMatch = match[0];
    const record: Record<string, any> = {};
    const attrPattern = /(\w+)=["']([^"']*)["']/g;
    let attrMatch;
    
    while ((attrMatch = attrPattern.exec(fullMatch)) !== null) {
      const [, attrName, attrValue] = attrMatch;
      if (!attrName || attrValue === undefined) continue;
      if (/^\d+(\.\d+)?$/.test(attrValue)) {
        record[attrName] = parseFloat(attrValue);
      } else if (attrValue === 'true' || attrValue === 'false') {
        record[attrName] = attrValue === 'true';
      } else {
        record[attrName] = attrValue;
      }
    }
    
    if (record.href && !record.id) {
      record.id = extractIdFromHref(record.href);
    }
    
    results.push(record);
  }
  
  return results;
}

/**
 * Known XML namespace prefixes to strip from parsed attribute output.
 * These appear as attributes on VCD XML root elements (e.g. xmlns:ovf="...")
 * but are namespace declarations, not entity data.
 */
const XMLNS_PREFIXES = new Set([
  'xmlns', 'vmext', 'ovf', 'vssd', 'common', 'rasd', 'vmw', 'ovfenv', 'ns9',
  'xsi', 'xsd', 'env', 'vcloud', 'fun', 'hw'
]);

/**
 * Parse attributes from a single entity XML element (Vdc, VApp, Vm, ScreenTicket, etc.)
 * Matches the first occurrence of rootTagPattern in xmlString and extracts all attributes.
 * Strips XML namespace declarations (xmlns:*) from the output.
 */
export function parseEntityAttributes(xmlString: string, rootTagPattern: RegExp): Record<string, any> {
  const result: Record<string, any> = {};
  const tagMatches = xmlString.match(rootTagPattern);
  if (!tagMatches || !tagMatches[0]) return result;

  const fullMatch = tagMatches[0];
  const attrPattern = /(\w+)=["']([^"']*)["']/g;
  let attrMatch;

  while ((attrMatch = attrPattern.exec(fullMatch)) !== null) {
    const [, attrName, attrValue] = attrMatch;
    if (!attrName || attrValue === undefined) continue;

    // Skip XML namespace declarations: xmlns, xmlns:ovf, ovf:version, etc.
    const prefix = attrName.includes(':') ? (attrName.split(':')[0] ?? attrName) : attrName;
    if (XMLNS_PREFIXES.has(prefix) || attrName === 'xmlns') continue;

    if (/^\d+(\.\d+)?$/.test(attrValue)) {
      result[attrName] = parseFloat(attrValue);
    } else if (attrValue === 'true' || attrValue === 'false') {
      result[attrName] = attrValue === 'true';
    } else {
      result[attrName] = attrValue;
    }
  }

  if (result.href && !result.id) {
    result.id = extractIdFromHref(result.href);
  }

  return result;
}

/**
 * Parse detailed VM information from full VM entity XML.
 * Extracts CPU, RAM, network connections, and guest OS info from child elements.
 */
export function parseVmDetails(xmlString: string): Record<string, any> {
  const details: Record<string, any> = {};

  // Root attributes (name, status, deployed, etc.)
  const rootAttrs = parseEntityAttributes(xmlString, /<(\w+:)?Vm\b[^>]*>/);
  Object.assign(details, rootAttrs);

  // Fix entity-level status codes (different from query record status):
  // 4=POWERED_ON, 8=POWERED_OFF, 3=SUSPENDED in entity XML
  if (details.status !== undefined) {
    details.statusDescription = getVmEntityStatusDescription(details.status);
  }

  // CPU — ResourceType 3 in VirtualHardwareSection
  const cpuMatch = xmlString.match(/<rasd:ResourceType>3<\/rasd:ResourceType>[\s\S]*?<rasd:VirtualQuantity>(\d+)<\/rasd:VirtualQuantity>/);
  if (cpuMatch?.[1]) details.cpuCount = parseInt(cpuMatch[1], 10);

  // RAM in MB — ResourceType 4
  const ramMatch = xmlString.match(/<rasd:ResourceType>4<\/rasd:ResourceType>[\s\S]*?<rasd:VirtualQuantity>(\d+)<\/rasd:VirtualQuantity>/);
  if (ramMatch?.[1]) {
    details.memoryMB = parseInt(ramMatch[1], 10);
    details.memoryGB = Math.round(details.memoryMB / 1024 * 100) / 100;
  }

  // Network connections
  const networkSection = xmlString.match(/<NetworkConnectionSection[\s\S]*?<\/NetworkConnectionSection>/);
  if (networkSection) {
    const connections: Record<string, any>[] = [];
    const connPattern = /<NetworkConnection\b([^>]*)>([\s\S]*?)<\/NetworkConnection>/g;
    let connMatch;
    while ((connMatch = connPattern.exec(networkSection[0])) !== null) {
      const connAttrs = connMatch[1] ?? '';
      const connBody = connMatch[2] ?? '';
      const networkName = connAttrs.match(/network=["']([^"']*)["']/)?.[1] ?? '';
      const ipAddr = connBody.match(/<IpAddress>(.*?)<\/IpAddress>/)?.[1] ?? '';
      const mac = connBody.match(/<MACAddress>(.*?)<\/MACAddress>/)?.[1] ?? '';
      const connected = (connBody.match(/<IsConnected>(.*?)<\/IsConnected>/)?.[1] ?? '') === 'true';
      const allocMode = connBody.match(/<IpAddressAllocationMode>(.*?)<\/IpAddressAllocationMode>/)?.[1] ?? '';
      connections.push({ network: networkName, ipAddress: ipAddr, macAddress: mac, isConnected: connected, allocationMode: allocMode });
    }
    if (connections.length > 0) details.networkConnections = connections;
  }

  // Disks — ResourceType 17 items in VirtualHardwareSection
  const disks: Record<string, any>[] = [];
  const diskItemPattern = /<ovf:Item>([\s\S]*?)<\/ovf:Item>/g;
  let diskItemMatch;
  while ((diskItemMatch = diskItemPattern.exec(xmlString)) !== null) {
    const itemContent = diskItemMatch[1] ?? '';
    if (!/<rasd:ResourceType>17<\/rasd:ResourceType>/.test(itemContent)) continue;
    const diskName = itemContent.match(/<rasd:ElementName>(.*?)<\/rasd:ElementName>/)?.[1] ?? 'Hard disk';
    const capacityMBStr = itemContent.match(/capacity="(\d+)"/)?.[1];
    const vqStr = itemContent.match(/<rasd:VirtualQuantity>(\d+)<\/rasd:VirtualQuantity>/)?.[1];
    const vqUnits = itemContent.match(/<rasd:VirtualQuantityUnits>(.*?)<\/rasd:VirtualQuantityUnits>/)?.[1];
    const disk: Record<string, any> = { name: diskName };
    if (capacityMBStr) {
      disk.capacityMB = parseInt(capacityMBStr, 10);
      disk.capacityGB = Math.round(parseInt(capacityMBStr, 10) / 1024 * 10) / 10;
    }
    if (vqStr && vqUnits === 'byte') {
      disk.sizeBytes = parseInt(vqStr, 10);
      disk.sizeGB = Math.round(parseInt(vqStr, 10) / (1024 * 1024 * 1024) * 10) / 10;
    }
    disks.push(disk);
  }
  if (disks.length > 0) details.disks = disks;

  // Guest customization — computer name
  const computerName = xmlString.match(/<ComputerName>(.*?)<\/ComputerName>/)?.[1] ?? '';
  if (computerName) details.computerName = computerName;

  // OS type from GuestCustomizationSection or OperatingSystemSection
  const osType = xmlString.match(/<ovf:Description>(.*?)<\/ovf:Description>/)?.[1]
    ?? xmlString.match(/<Description>(.*?)<\/Description>/)?.[1];
  if (osType && !details.osType) details.osType = osType;

  return details;
}

/**
 * Parse detailed vApp information from full vApp entity XML.
 * Extracts root attributes and child VM summaries from the <Children> section.
 */
export function parseVAppDetails(xmlString: string): Record<string, any> {
  const details: Record<string, any> = {};

  const rootAttrs = parseEntityAttributes(xmlString, /<(\w+:)?VApp\b[^>]*>/);
  Object.assign(details, rootAttrs);

  const childrenMatch = xmlString.match(/<Children>([\s\S]*?)<\/Children>/);
  if (childrenMatch?.[0]) {
    const children: Record<string, any>[] = [];
    const vmTagPattern = /<(\w+:)?Vm\b[^>]*>/g;
    let vmMatch;
    while ((vmMatch = vmTagPattern.exec(childrenMatch[0])) !== null) {
      const tagStr = vmMatch[0];
      const attrs = parseEntityAttributes(tagStr, /<[^>]+>/);
      if (attrs.name && attrs.href) {
        const idRaw = typeof attrs.id === 'string' ? attrs.id : String(attrs.id ?? '');
        children.push({
          id: idRaw.replace(/^urn:vcloud:vm:/, '') || extractIdFromHref(String(attrs.href)),
          urn: attrs.id,
          name: attrs.name,
          href: attrs.href,
          status: attrs.status,
          deployed: attrs.deployed,
        });
      }
    }
    if (children.length > 0) details.children = children;
  }

  return details;
}

/**
 * Parse a VCD Task or Error XML response into a structured object.
 * VCD power/snapshot operations return <Task> on success (202) or <Error> on failure.
 */
export function parseTaskResponse(xmlString: string): Record<string, any> {
  if (!xmlString || typeof xmlString !== 'string') return { raw: xmlString };

  // Detect Error XML (VCD returns these for logical failures even with 2xx status)
  const errorMatch = xmlString.match(/<(\w+:)?Error\b[^>]*>/);
  if (errorMatch) {
    const errTag = errorMatch[0];
    return {
      _type: 'error',
      minorErrorCode: extractAttribute(errTag, 'minorErrorCode'),
      message: extractAttribute(errTag, 'message'),
      majorErrorCode: extractAttribute(errTag, 'majorErrorCode'),
    };
  }

  // Detect Task XML
  const taskMatch = xmlString.match(/<(\w+:)?Task\b[^>]*>/);
  if (taskMatch) {
    const taskTag = taskMatch[0];
    const href     = extractAttribute(taskTag, 'href') || '';
    const taskId   = href.split('/task/')[1] || '';
    return {
      _type: 'task',
      taskId,
      taskHref: href,
      taskStatus: extractAttribute(taskTag, 'status'),
      operation: extractAttribute(taskTag, 'operationName') || extractAttribute(taskTag, 'name'),
      operationDescription: extractAttribute(taskTag, 'operation'),
      startTime: extractAttribute(taskTag, 'startTime'),
      expiryTime: extractAttribute(taskTag, 'expiryTime'),
    };
  }

  // Unknown XML — return preview
  return { _type: 'unknown', preview: xmlString.slice(0, 200) };
}

/**
 * Entity-level VM/vApp status codes (from GET /api/vApp/vm-{id}).
 * Different from query record status codes.
 */
function getVmEntityStatusDescription(status: number): string {
  const statusMap: Record<number, string> = {
    0: 'UNRESOLVED',
    1: 'RESOLVED',
    2: 'DEPLOYED',
    3: 'SUSPENDED',
    4: 'POWERED_ON',
    5: 'WAITING_FOR_INPUT',
    6: 'UNKNOWN',
    7: 'UNRECOGNIZED',
    8: 'POWERED_OFF',
    9: 'INCONSISTENT_STATE',
    10: 'CHILDREN_DO_NOT_EXIST',
    11: 'UPLOAD_INITIATED',
    12: 'UPLOAD_COMPLETE',
  };
  return statusMap[status] || `UNKNOWN_${status}`;
}

/**
 * Get status description from vCloud Director status code (query record codes)
 */
export function getStatusDescription(status: number): string {
  const statusMap: Record<number, string> = {
    0: 'FAILED_CREATION',
    1: 'UNRESOLVED',
    2: 'RESOLVED',
    3: 'DEPLOYED',
    4: 'SUSPENDED',
    5: 'POWERED_ON',
    6: 'WAITING_FOR_INPUT',
    7: 'UNKNOWN',
    8: 'UNRECOGNIZED',
    9: 'POWERED_OFF',
    10: 'INCONSISTENT_STATE',
    11: 'MIXED',
    12: 'DESCRIPTOR_PENDING',
    13: 'COPYING_CONTENTS',
    14: 'DISK_CONTENTS_PENDING',
    15: 'QUARANTINED',
    16: 'QUARANTINE_EXPIRED',
    17: 'REJECTED',
    18: 'TRANSFER_TIMEOUT'
  };
  
  return statusMap[status] || `UNKNOWN_STATUS_${status}`;
}
