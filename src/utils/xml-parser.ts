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
  
  // Simple regex-based parsing for VDC records
  const vdcPattern = /<(\w+:)?(\w*[Vv]dc\w*)?Record[^>]*>/g;
  const matches = xmlString.match(vdcPattern);
  
  if (matches) {
    matches.forEach(match => {
      const href = extractAttribute(match, 'href');
      const name = extractAttribute(match, 'name');
      const id = extractAttribute(match, 'id') || extractIdFromHref(href);
      const type = extractAttribute(match, 'type') || 'application/vnd.vmware.vcloud.vdc+xml';
      const isEnabled = extractAttribute(match, 'isEnabled');
      const status = extractAttribute(match, 'status');
      
      if (href && name && id) {
        const vdc: ParsedVdc = {
          href,
          id,
          name,
          type,
          isEnabled: isEnabled === 'true'
        };
        if (status) {
          vdc.status = parseInt(status, 10);
        }
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
  
  const vappPattern = /<(\w+:)?(\w*[Vv][Aa]pp\w*)?Record[^>]*>/g;
  const matches = xmlString.match(vappPattern);
  
  if (matches) {
    matches.forEach(match => {
      const href = extractAttribute(match, 'href');
      const name = extractAttribute(match, 'name');
      const id = extractAttribute(match, 'id') || extractIdFromHref(href);
      const type = extractAttribute(match, 'type') || 'application/vnd.vmware.vcloud.vApp+xml';
      const status = extractAttribute(match, 'status');
      const deployed = extractAttribute(match, 'deployed');
      
      if (href && name && id) {
        const vapp: ParsedVApp = {
          href,
          id,
          name,
          type,
          deployed: deployed === 'true'
        };
        if (status) {
          vapp.status = parseInt(status, 10);
        }
        vapps.push(vapp);
      }
    });
  }
  
  return vapps;
}

/**
 * Parse VM records from vCloud Director query response
 */
export function parseVMRecords(xmlString: string): ParsedVM[] {
  const vms: ParsedVM[] = [];
  
  const vmPattern = /<(\w+:)?(\w*[Vv][Mm]\w*)?Record[^>]*>/g;
  const matches = xmlString.match(vmPattern);
  
  if (matches) {
    matches.forEach(match => {
      const href = extractAttribute(match, 'href');
      const name = extractAttribute(match, 'name');
      const id = extractAttribute(match, 'id') || extractIdFromHref(href);
      const type = extractAttribute(match, 'type') || 'application/vnd.vmware.vcloud.vm+xml';
      const status = extractAttribute(match, 'status');
      const deployed = extractAttribute(match, 'deployed');
      const vAppTemplate = extractAttribute(match, 'vAppTemplate');
      
      if (href && name && id) {
        const vm: ParsedVM = {
          href,
          id,
          name,
          type,
          deployed: deployed === 'true'
        };
        if (status) {
          vm.status = parseInt(status, 10);
        }
        if (vAppTemplate) {
          vm.vAppTemplate = vAppTemplate;
        }
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
  
  const orgPattern = /<(\w+:)?(\w*[Oo]rg\w*)?Record[^>]*>/g;
  const matches = xmlString.match(orgPattern);
  
  if (matches) {
    matches.forEach(match => {
      const href = extractAttribute(match, 'href');
      const name = extractAttribute(match, 'name');
      const id = extractAttribute(match, 'id') || extractIdFromHref(href);
      const type = extractAttribute(match, 'type') || 'application/vnd.vmware.vcloud.org+xml';
      const fullName = extractAttribute(match, 'fullName');
      
      if (href && name && id) {
        orgs.push({
          href,
          id,
          name,
          type,
          fullName
        });
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
  
  // Extract UUID or ID from URLs like:
  // https://vcd.example.com/api/vdc/12345678-1234-1234-1234-123456789abc
  const match = href.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
  if (match?.[1]) return match[1];
  
  // Extract from URLs ending with IDs
  const parts = href.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * Normalize input to extract ID from either href URL or direct ID
 */
export function normalizeIdFromHrefOrId(input: string): string {
  if (!input) return '';
  
  // If it looks like a URL/href, extract the ID
  if (input.includes('/') && (input.startsWith('http') || input.includes('api/'))) {
    return extractIdFromHref(input);
  }
  
  // Otherwise assume it's already an ID
  return input;
}

/**
 * Parse generic query results from vCloud Director query response
 */
export function parseQueryResults(xmlString: string): Record<string, any>[] {
  const results: Record<string, any>[] = [];
  
  // Find all record elements (e.g., AdminOrgVdcRecord, OrgVdcRecord, etc.)
  const recordPattern = /<(\w+:)?(\w*Record)[^>]*>/g;
  let match;
  
  while ((match = recordPattern.exec(xmlString)) !== null) {
    const fullMatch = match[0];
    const record: Record<string, any> = {};
    
    // Extract all attributes from the record element
    const attrPattern = /(\w+)=["']([^"']*)["']/g;
    let attrMatch;
    
    while ((attrMatch = attrPattern.exec(fullMatch)) !== null) {
      const [, attrName, attrValue] = attrMatch;
      
      if (!attrName || attrValue === undefined) continue;
      
      // Convert numeric values
      if (/^\d+(\.\d+)?$/.test(attrValue)) {
        record[attrName] = parseFloat(attrValue);
      } else if (attrValue === 'true' || attrValue === 'false') {
        record[attrName] = attrValue === 'true';
      } else {
        record[attrName] = attrValue;
      }
    }
    
    // Extract ID from href if present
    if (record.href && !record.id) {
      record.id = extractIdFromHref(record.href);
    }
    
    results.push(record);
  }
  
  return results;
}

/**
 * Get status description from vCloud Director status code
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