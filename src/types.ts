/**
 * Zettagrid VMware MCP Server - Type Definitions
 * Based on VMware vCloud Director API v1.5+ schema
 */

// Zone Configuration Types
export interface ZoneConfig {
  name: string;
  apiEndpoint: string;
  oauthEndpoint: string;
  apiToken: string;
  organizationName: string;
  apiVersion: string;
}

export interface ZettagridConfig {
  zones: Record<string, ZoneConfig>;
  defaultZone: string;
  timeout: number;
  retryAttempts: number;
  enableCaching: boolean;
  debugLevel: 'error' | 'warn' | 'info' | 'debug';
}

// Authentication Types
export interface AuthToken {
  token: string;
  expiresAt: Date;
  refreshToken?: string;
}

export interface AuthSession {
  zoneId: string;
  organizationId: string;
  userId: string;
  token: AuthToken;
}

// Base vCloud Director Types
export interface VCloudLink {
  href: string;
  rel: string;
  type?: string;
  name?: string;
}

export interface VCloudEntity {
  href?: string;
  id?: string;
  name: string;
  type?: string;
  description?: string;
  link?: VCloudLink[];
}

export interface VCloudReference extends VCloudEntity {
  href: string;
  id: string;
  type: string;
}

// Organization Types
export interface Organization extends VCloudEntity {
  fullName?: string;
  isEnabled?: boolean;
  canPublishCatalogs?: boolean;
  canPublishExternally?: boolean;
  canSubscribe?: boolean;
  deployedVMQuota?: number;
  storedVMQuota?: number;
  useServerBootSequence?: boolean;
  delayAfterPowerOnSeconds?: number;
  settings?: OrganizationSettings;
}

export interface OrganizationSettings {
  generalSettings?: OrganizationGeneralSettings;
  vAppLeaseSettings?: OrganizationVAppLeaseSettings;
  vAppTemplateLeaseSettings?: OrganizationVAppTemplateLeaseSettings;
  ldapSettings?: OrganizationLdapSettings;
  emailSettings?: OrganizationEmailSettings;
  passwordPolicySettings?: OrganizationPasswordPolicySettings;
  operationLimitsSettings?: OrganizationOperationLimitsSettings;
}

export interface OrganizationGeneralSettings {
  canPublishCatalogs?: boolean;
  deployedVMQuota?: number;
  storedVMQuota?: number;
  useServerBootSequence?: boolean;
  delayAfterPowerOnSeconds?: number;
}

export interface OrganizationVAppLeaseSettings {
  deploymentLeaseSeconds?: number;
  storageLeaseSeconds?: number;
  deleteOnStorageLeaseExpiration?: boolean;
}

export interface OrganizationVAppTemplateLeaseSettings {
  storageLeaseSeconds?: number;
  deleteOnStorageLeaseExpiration?: boolean;
}

export interface OrganizationLdapSettings {
  customUsersOu?: string;
  customOrgLdapSettings?: CustomOrgLdapSettings;
}

export interface CustomOrgLdapSettings {
  hostName?: string;
  port?: number;
  isSsl?: boolean;
  isSslAcceptAll?: boolean;
  realm?: string;
  searchBase?: string;
  userName?: string;
  password?: string;
  authenticationMechanism?: string;
  isGroupSearchBaseEnabled?: boolean;
  groupSearchBase?: string;
  connectorType?: 'ACTIVE_DIRECTORY' | 'OPEN_LDAP';
  userAttributes?: OrganizationLdapUserAttributes;
  groupAttributes?: OrganizationLdapGroupAttributes;
}

export interface OrganizationLdapUserAttributes {
  objectClass?: string;
  objectIdentifier?: string;
  userName?: string;
  email?: string;
  fullName?: string;
  givenName?: string;
  surname?: string;
  telephone?: string;
  groupMembership?: string;
  groupBackLinkIdentifier?: string;
}

export interface OrganizationLdapGroupAttributes {
  objectClass?: string;
  objectIdentifier?: string;
  groupName?: string;
  membership?: string;
  membershipIdentifier?: string;
  backLinkIdentifier?: string;
}

export interface OrganizationEmailSettings {
  isDefaultSmtpServer?: boolean;
  isDefaultOrgEmail?: boolean;
  fromEmailAddress?: string;
  defaultSubjectPrefix?: string;
  isAlertEmailToAllAdmins?: boolean;
  smtpServerSettings?: SmtpServerSettings;
}

export interface SmtpServerSettings {
  isUseAuthentication?: boolean;
  host?: string;
  username?: string;
  password?: string;
  port?: number;
  isSecureModeEnabled?: boolean;
  isSSLTLS?: boolean;
}

export interface OrganizationPasswordPolicySettings {
  accountLockoutEnabled?: boolean;
  accountLockoutIntervalMinutes?: number;
  invalidLoginsBeforeLockout?: number;
  minLength?: number;
  minAlphabeticChars?: number;
  minNumericChars?: number;
  minSpecialChars?: number;
  maxLength?: number;
  minPasswordAge?: number;
  maxPasswordAge?: number;
  passwordHistoryLength?: number;
}

export interface OrganizationOperationLimitsSettings {
  consolesPerVmLimit?: number;
  operationsPerUser?: number;
  operationsPerOrg?: number;
  queuedOperationsPerUser?: number;
  queuedOperationsPerOrg?: number;
  runningOperationsPerUser?: number;
  runningOperationsPerOrg?: number;
}

// VDC (Virtual Data Center) Types
export interface Vdc extends VCloudEntity {
  status?: number;
  allocationModel?: 'AllocationVApp' | 'AllocationPool' | 'ReservationPool' | 'Flex';
  computeCapacity?: ComputeCapacity;
  storageCapacity?: CapacityWithUsage;
  availableNetworks?: AvailableNetworks;
  capabilities?: Capabilities;
  nicQuota?: number;
  networkQuota?: number;
  vmQuota?: number;
  isEnabled?: boolean;
  resourceEntities?: ResourceEntities;
  storageProfiles?: VdcStorageProfiles;
  defaultComputePolicy?: VCloudReference;
  supportedHardwareVersions?: SupportedHardwareVersions;
}

export interface ComputeCapacity {
  cpu?: CapacityWithUsage;
  memory?: CapacityWithUsage;
}

export interface CapacityWithUsage {
  units?: string;
  allocated?: number;
  limit?: number;
  reserved?: number;
  used?: number;
  overhead?: number;
}

export interface AvailableNetworks {
  network?: VCloudReference[];
}

export interface Capabilities {
  supportedHardwareVersions?: SupportedHardwareVersions;
}

export interface SupportedHardwareVersions {
  supportedHardwareVersion?: SupportedHardwareVersion[];
}

export interface SupportedHardwareVersion {
  value?: string;
}

export interface ResourceEntities {
  resourceEntity?: ResourceEntity[];
}

export interface ResourceEntity extends VCloudReference {
  status?: number;
}

export interface VdcStorageProfiles {
  vdcStorageProfile?: VdcStorageProfile[];
}

export interface VdcStorageProfile extends VCloudEntity {
  enabled?: boolean;
  units?: string;
  limit?: number;
  default?: boolean;
  iopsAllocated?: number;
  iopsLimit?: number;
}

// VDC Resource Display Types
export interface VdcResourceSummary {
  vdcId: string;
  vdcName: string;
  allocationModel?: 'AllocationVApp' | 'AllocationPool' | 'ReservationPool' | 'Flex';
  resources: VdcResourceTable;
}

export interface VdcResourceTable {
  ram: VdcResourceRow;
  vcpu: VdcResourceRow;
  storage: VdcResourceRow;
}

export interface VdcResourceRow {
  resource: string;
  units: string;
  allocated: number | string;
  used: number | string;
  available: number | string;
  utilization: string;
}

// Network Configuration Types
export interface EdgeNetworkConfig {
  edgeGatewayId: string;
  edgeGatewayName: string;
  externalIPs: ExternalIPInfo[];
  gatewayInterfaces: EdgeGatewayInterfaceInfo[];
  uplinks: UplinkInfo[];
  externalNetworks: ExternalNetworkInfo[];
  providerNetworks: ProviderNetworkInfo[];
}

export interface ExternalIPInfo {
  ipAddress: string;
  isAllocated: boolean;
  isPrimary?: boolean;
  interfaceName?: string;
  networkName?: string;
  usage?: string;
}

export interface EdgeGatewayInterfaceInfo {
  name: string;
  displayName?: string;
  interfaceType: 'internal' | 'external' | 'trunk';
  networkName?: string;
  networkHref?: string;
  connectedNetwork?: string;
  ipAddresses: string[];
  subnetMask?: string;
  gateway?: string;
  isConnected: boolean;
  useForDefaultRoute?: boolean;
  rateLimit?: {
    inbound?: number;
    outbound?: number;
  };
}

export interface UplinkInfo {
  name: string;
  interfaceType: string;
  isConnected: boolean;
  subnets: UplinkSubnet[];
  externalNetwork?: string;
  bandwidth?: {
    inbound?: number;
    outbound?: number;
  };
}

export interface UplinkSubnet {
  gateway: string;
  netmask: string;
  ipRanges: IpRange[];
  primaryIp?: string;
  staticRoutes?: StaticRoute[];
}

export interface IpRange {
  startAddress: string;
  endAddress: string;
}

export interface StaticRoute {
  destination: string;
  nextHop: string;
  metric?: number;
}

export interface ExternalNetworkInfo {
  id: string;
  name: string;
  description?: string;
  gateway?: string;
  netmask?: string;
  dns1?: string;
  dns2?: string;
  dnsSuffix?: string;
  ipRanges: IpRange[];
  isShared?: boolean;
  networkType?: 'isolated' | 'bridged' | 'nat';
}

export interface ProviderNetworkInfo {
  id: string;
  name: string;
  description?: string;
  networkType: 'VLAN' | 'VXLAN' | 'PORTGROUP';
  vlanId?: number;
  vxlanId?: number;
  isAvailable: boolean;
  isShared: boolean;
  totalIpCount?: number;
  usedIpCount?: number;
  availableIpCount?: number;
}

// vApp Types
export interface VApp extends VCloudEntity {
  status?: number;
  deployed?: boolean;
  ovfDescriptorUploaded?: boolean;
  owner?: VCloudReference;
  inMaintenanceMode?: boolean;
  children?: VAppChildren;
  vAppParent?: VCloudReference;
  leaseSettingsSection?: LeaseSettingsSection;
  startupSection?: StartupSection;
  networkConfigSection?: NetworkConfigSection;
  customizationSection?: CustomizationSection;
  productSection?: ProductSection[];
  annotationSection?: AnnotationSection;
  runtimeInfoSection?: RuntimeInfoSection;
  snapshotSection?: SnapshotSection;
  dateCreated?: string;
  tasks?: TasksList;
}

export interface VAppChildren {
  vm?: Vm[];
  vApp?: VApp[];
}

export interface LeaseSettingsSection {
  deploymentLeaseInSeconds?: number;
  storageLeaseInSeconds?: number;
  deploymentLeaseExpiration?: string;
  storageLeaseExpiration?: string;
}

export interface StartupSection {
  item?: StartupSectionItem[];
}

export interface StartupSectionItem {
  id?: string;
  order?: number;
  startDelay?: number;
  startAction?: string;
  stopDelay?: number;
  stopAction?: string;
}

export interface NetworkConfigSection {
  networkConfig?: NetworkConfig[];
}

export interface NetworkConfig {
  networkName?: string;
  configuration?: NetworkConfiguration;
}

export interface NetworkConfiguration {
  ipScope?: IpScope;
  parentNetwork?: VCloudReference;
  fenceMode?: 'bridged' | 'isolated' | 'natRouted';
  retainNetInfoAcrossDeployments?: boolean;
  features?: NetworkFeatures;
  syslogServerSettings?: SyslogServerSettings;
}

export interface IpScope {
  isInherited?: boolean;
  gateway?: string;
  netmask?: string;
  dns1?: string;
  dns2?: string;
  dnsSuffix?: string;
  ipRanges?: IpRanges;
  allocatedIpAddresses?: AllocatedIpAddresses;
}

export interface IpRanges {
  ipRange?: IpRange[];
}

export interface AllocatedIpAddresses {
  ipAddress?: string[];
}

export interface NetworkFeatures {
  dhcpService?: DhcpService;
  firewallService?: FirewallService;
  natService?: NatService;
}

export interface DhcpService {
  isEnabled?: boolean;
  defaultLeaseTime?: number;
  maxLeaseTime?: number;
  ipRange?: IpRange;
}

export interface FirewallService {
  isEnabled?: boolean;
  defaultAction?: 'allow' | 'drop';
  logDefaultAction?: boolean;
  firewallRule?: FirewallRule[];
}

export interface FirewallRule {
  id?: string;
  isEnabled?: boolean;
  description?: string;
  policy?: 'allow' | 'drop';
  protocols?: FirewallRuleProtocols;
  destinationPortRange?: string;
  destinationIp?: string;
  sourcePortRange?: string;
  sourceIp?: string;
  enableLogging?: boolean;
}

export interface FirewallRuleProtocols {
  tcp?: boolean;
  udp?: boolean;
  icmp?: boolean;
  other?: string;
}

export interface NatService {
  isEnabled?: boolean;
  natType?: 'ipTranslation' | 'portForwarding';
  policy?: 'allowTraffic' | 'allowTrafficIn';
  natRule?: NatRule[];
}

export interface NatRule {
  id?: string;
  ruleType?: 'SNAT' | 'DNAT';
  isEnabled?: boolean;
  gatewayNatRule?: GatewayNatRule;
  oneToOneBasicRule?: NatOneToOneBasicRule;
  oneToOneVmRule?: NatOneToOneVmRule;
  portForwardingRule?: NatPortForwardingRule;
  vmRule?: NatVmRule;
}

export interface GatewayNatRule {
  interface?: VCloudReference;
  originalIp?: string;
  originalPort?: string;
  translatedIp?: string;
  translatedPort?: string;
  protocol?: 'TCP' | 'UDP' | 'TCP_UDP' | 'ICMP' | 'ANY';
}

export interface NatOneToOneBasicRule {
  mappingMode?: 'automatic' | 'manual';
  externalIpAddress?: string;
  internalIpAddress?: string;
}

export interface NatOneToOneVmRule {
  mappingMode?: 'automatic' | 'manual';
  externalIpAddress?: string;
  vAppScopedVmId?: string;
  vmNicId?: number;
}

export interface NatPortForwardingRule {
  externalIpAddress?: string;
  externalPort?: number;
  internalIpAddress?: string;
  internalPort?: number;
  protocol?: 'TCP' | 'UDP';
}

export interface NatVmRule {
  externalIpAddress?: string;
  externalPort?: number;
  vAppScopedVmId?: string;
  vmNicId?: number;
  internalPort?: number;
  protocol?: 'TCP' | 'UDP';
}

export interface SyslogServerSettings {
  syslogServerIp1?: string;
  syslogServerIp2?: string;
}

export interface CustomizationSection {
  customizeOnInstantiate?: boolean;
  changeComputerName?: boolean;
  joinDomainEnabled?: boolean;
  useOrgSettings?: boolean;
  domainName?: string;
  domainUserName?: string;
  domainUserPassword?: string;
  machineObjectOU?: string;
  adminPasswordEnabled?: boolean;
  adminPasswordAuto?: boolean;
  adminPassword?: string;
  adminAutoLogonEnabled?: boolean;
  adminAutoLogonCount?: number;
  resetPasswordRequired?: boolean;
  customizationScript?: string;
  computerName?: string;
}

export interface ProductSection {
  info?: string;
  product?: string;
  vendor?: string;
  version?: string;
  fullVersion?: string;
  productUrl?: string;
  vendorUrl?: string;
  appUrl?: string;
  property?: ProductSectionProperty[];
}

export interface ProductSectionProperty {
  key?: string;
  type?: string;
  userConfigurable?: boolean;
  defaultValue?: string;
  value?: string;
  label?: string;
  description?: string;
  qualifiers?: string;
}

export interface AnnotationSection {
  annotation?: string;
}

export interface RuntimeInfoSection {
  vmWareTools?: VmWareTools;
}

export interface VmWareTools {
  version?: string;
  runningStatus?: 'guestToolsNotRunning' | 'guestToolsRunning' | 'guestToolsExecutingScripts';
}

export interface SnapshotSection {
  snapshot?: Snapshot[];
}

export interface Snapshot extends VCloudEntity {
  size?: number;
  poweredOn?: boolean;
  creationDate?: string;
}

// VM (Virtual Machine) Types
export interface Vm extends VCloudEntity {
  status?: number;
  deployed?: boolean;
  needsCustomization?: boolean;
  nestedHypervisorEnabled?: boolean;
  vAppScopedLocalId?: string;
  environment?: VmEnvironment;
  vmCapabilities?: VmCapabilities;
  storageProfile?: VCloudReference;
  operatingSystemSection?: OperatingSystemSection;
  virtualHardwareSection?: VirtualHardwareSection;
  guestCustomizationSection?: GuestCustomizationSection;
  runtimeInfoSection?: RuntimeInfoSection;
  snapshotSection?: SnapshotSection;
  dateCreated?: string;
  tasks?: TasksList;
}

// Console Types
export interface ConsoleTicket {
  ticket?: string;
  vmx?: string;
  host?: string;
  port?: number;
  sslThumbprint?: string;
}

export interface VmConsoleTicket extends VCloudEntity {
  ticket?: string;
  vmName?: string;
  consoleType?: 'VMRC' | 'WebMKS' | 'VNC';
  vmId?: string;
}

export interface VmEnvironment {
  property?: VmEnvironmentProperty[];
}

export interface VmEnvironmentProperty {
  key?: string;
  value?: string;
  type?: string;
  userConfigurable?: boolean;
  defaultValue?: string;
  label?: string;
  description?: string;
  qualifiers?: string;
}

export interface VmCapabilities {
  memoryHotAddEnabled?: boolean;
  cpuHotAddEnabled?: boolean;
}

export interface OperatingSystemSection {
  id?: number;
  version?: string;
  description?: string;
  osType?: string;
}

export interface VirtualHardwareSection {
  info?: string;
  system?: VirtualSystem;
  item?: VirtualHardwareItem[];
}

export interface VirtualSystem {
  elementName?: string;
  instanceID?: string;
  virtualSystemIdentifier?: string;
  virtualSystemType?: string;
}

export interface VirtualHardwareItem {
  instanceID?: string;
  resourceType?: number;
  resourceSubType?: string;
  elementName?: string;
  description?: string;
  address?: string;
  addressOnParent?: string;
  allocationUnits?: string;
  automaticAllocation?: boolean;
  automaticDeallocation?: boolean;
  connected?: boolean;
  hostResource?: string;
  virtualQuantity?: number;
  virtualQuantityUnits?: string;
  weight?: number;
  connection?: VirtualHardwareConnection[];
  hostResourceAllocationInfo?: HostResourceAllocationInfo;
  busNumber?: number;
  unitNumber?: number;
}

export interface VirtualHardwareConnection {
  value?: string;
  primaryNetworkConnection?: boolean;
  ipAddress?: string;
  externalIpAddress?: string;
  isConnected?: boolean;
  macAddress?: string;
  ipAddressingMode?: 'NONE' | 'DHCP' | 'POOL' | 'MANUAL';
  networkConnectionIndex?: number;
}

export interface HostResourceAllocationInfo {
  reservation?: number;
  limit?: number;
  shares?: ResourceSharesInfo;
}

export interface ResourceSharesInfo {
  shares?: number;
  level?: 'low' | 'normal' | 'high' | 'custom';
}

export interface GuestCustomizationSection {
  enabled?: boolean;
  changeSid?: boolean;
  virtualMachineId?: string;
  joinDomainEnabled?: boolean;
  useOrgSettings?: boolean;
  domainName?: string;
  domainUserName?: string;
  domainUserPassword?: string;
  machineObjectOU?: string;
  adminPasswordEnabled?: boolean;
  adminPasswordAuto?: boolean;
  adminPassword?: string;
  adminAutoLogonEnabled?: boolean;
  adminAutoLogonCount?: number;
  resetPasswordRequired?: boolean;
  customizationScript?: string;
  computerName?: string;
}

// Storage Types
export interface Disk extends VCloudEntity {
  status?: number;
  size?: number;
  busType?: number;
  busSubType?: string;
  storageProfile?: VCloudReference;
  owner?: VCloudReference;
  tasks?: TasksList;
  sharingType?: 'None' | 'DiskSharing' | 'ControllerSharing';
  encrypted?: boolean;
  uuid?: string;
  iops?: number;
}

// Network Types
export interface OrgNetwork extends VCloudEntity {
  configuration?: NetworkConfiguration;
  isShared?: boolean;
  networkPool?: VCloudReference;
  allowedExternalIpAddresses?: IpAddresses;
  tasks?: TasksList;
}

export interface IpAddresses {
  ipAddress?: string[];
}

export interface EdgeGateway extends VCloudEntity {
  status?: number;
  configuration?: GatewayConfiguration;
  tasks?: TasksList;
}

export interface GatewayConfiguration {
  gatewayBackingConfig?: string;
  gatewayInterfaces?: GatewayInterfaces;
  edgeGatewayServiceConfiguration?: EdgeGatewayServiceConfiguration;
  haEnabled?: boolean;
  useDefaultRouteForDnsRelay?: boolean;
  defaultRoute?: string;
}

export interface GatewayInterfaces {
  gatewayInterface?: GatewayInterface[];
}

export interface GatewayInterface {
  name?: string;
  displayName?: string;
  network?: VCloudReference;
  interfaceType?: 'internal' | 'external' | 'trunk';
  subnetParticipation?: SubnetParticipation[];
  applyRateLimit?: boolean;
  inRateLimit?: number;
  outRateLimit?: number;
  useForDefaultRoute?: boolean;
}

export interface SubnetParticipation {
  gateway?: string;
  netmask?: string;
  ipAddress?: string;
  ipRanges?: IpRanges;
}

export interface EdgeGatewayServiceConfiguration {
  firewallService?: FirewallService;
  natService?: NatService;
  dhcpService?: DhcpService;
  routingService?: StaticRoutingService;
  loadBalancerService?: LoadBalancerService;
  ipsecVpnService?: IpsecVpnService;
}

export interface StaticRoutingService {
  isEnabled?: boolean;
  staticRoute?: StaticRoute[];
}

export interface StaticRoute {
  name?: string;
  network?: string;
  nextHopIp?: string;
  interface?: string;
  gatewayInterface?: VCloudReference;
  metric?: number;
  mtu?: number;
}

export interface LoadBalancerService {
  isEnabled?: boolean;
  pool?: LoadBalancerPool[];
  virtualServer?: LoadBalancerVirtualServer[];
}

export interface LoadBalancerPool extends VCloudEntity {
  algorithm?: 'round-robin' | 'least-conn' | 'source' | 'uri' | 'leastconn';
  member?: LoadBalancerPoolMember[];
  healthCheck?: LoadBalancerHealthCheck[];
  transparent?: boolean;
}

export interface LoadBalancerPoolMember {
  ipAddress?: string;
  weight?: number;
  servicePort?: LoadBalancerServicePort[];
  healthCheck?: LoadBalancerHealthCheck[];
  condition?: 'enabled' | 'disabled' | 'drain';
  detailCondition?: string;
}

export interface LoadBalancerServicePort {
  algorithm?: 'round-robin' | 'least-conn' | 'source' | 'uri' | 'leastconn';
  protocol?: 'HTTP' | 'HTTPS' | 'TCP' | 'UDP';
  port?: string;
  healthCheckPort?: string;
}

export interface LoadBalancerHealthCheck {
  mode?: 'http' | 'https' | 'tcp' | 'ssl';
  uri?: string;
  healthThreshold?: string;
  unhealthThreshold?: string;
  interval?: string;
  timeout?: string;
}

export interface LoadBalancerVirtualServer extends VCloudEntity {
  interface?: VCloudReference;
  ipAddress?: string;
  serviceProfile?: LoadBalancerServiceProfile[];
  logging?: boolean;
  pool?: string;
}

export interface LoadBalancerServiceProfile {
  protocol?: 'HTTP' | 'HTTPS' | 'TCP' | 'UDP';
  port?: string;
  persistence?: LoadBalancerPersistence;
}

export interface LoadBalancerPersistence {
  method?: 'cookie' | 'ssl-sessionid' | 'sourceip';
  cookieName?: string;
  cookieMode?: 'insert' | 'prefix' | 'app-session';
  expire?: string;
}

export interface IpsecVpnService {
  isEnabled?: boolean;
  endpoint?: IpsecVpnEndpoint[];
  tunnel?: IpsecVpnTunnel[];
}

export interface IpsecVpnEndpoint extends VCloudEntity {
  network?: VCloudReference;
  publicIp?: string;
}

export interface IpsecVpnTunnel extends VCloudEntity {
  localEndpoint?: VCloudReference;
  peerEndpoint?: VCloudReference;
  peerIpAddress?: string;
  peerId?: string;
  localId?: string;
  localIpAddress?: string;
  localSubnet?: IpsecVpnSubnet[];
  peerSubnet?: IpsecVpnSubnet[];
  sharedSecret?: string;
  sharedSecretEncrypted?: boolean;
  encryptionProtocol?: string;
  mtu?: number;
  isEnabled?: boolean;
  isOperational?: boolean;
  errorDetails?: string;
}

export interface IpsecVpnSubnet {
  name?: string;
  gateway?: string;
  netmask?: string;
}

// Catalog Types
export interface Catalog extends VCloudEntity {
  owner?: VCloudReference;
  isShared?: boolean;
  isPublished?: boolean;
  catalogItems?: CatalogItems;
  dateCreated?: string;
  versionNumber?: number;
  tasks?: TasksList;
}

export interface CatalogItems {
  catalogItem?: CatalogItem[];
}

export interface CatalogItem extends VCloudEntity {
  entity?: VCloudReference;
  dateCreated?: string;
  versionNumber?: number;
  tasks?: TasksList;
}

export interface VAppTemplate extends VCloudEntity {
  status?: number;
  owner?: VCloudReference;
  children?: VAppTemplateChildren;
  vAppScopedLocalId?: string;
  ovfDescriptorUploaded?: boolean;
  goldMaster?: boolean;
  catalogName?: string;
  tasks?: TasksList;
}

export interface VAppTemplateChildren {
  vm?: Vm[];
}

export interface Media extends VCloudEntity {
  status?: number;
  imageType?: 'iso' | 'floppy';
  size?: number;
  owner?: VCloudReference;
  storageProfile?: VCloudReference;
  tasks?: TasksList;
}

// Task Types
export interface TasksList {
  task?: Task[];
}

export interface Task extends VCloudEntity {
  status?: 'queued' | 'preRunning' | 'running' | 'success' | 'error' | 'canceled' | 'aborted';
  operation?: string;
  operationName?: string;
  startTime?: string;
  endTime?: string;
  expiryTime?: string;
  user?: VCloudReference;
  organization?: VCloudReference;
  progress?: number;
  params?: any;
  owner?: VCloudReference;
  error?: VCloudError;
  result?: VCloudReference;
  vcTaskList?: VcTaskList;
  tasks?: TasksList;
}

export interface VcTaskList {
  vcTask?: VcTask[];
}

export interface VcTask {
  moRef?: string;
  vcName?: string;
  result?: string;
}

// Error Types
export interface VCloudError {
  majorErrorCode?: number;
  minorErrorCode?: string;
  message?: string;
  vendorSpecificErrorCode?: string;
  stackTrace?: string;
}

// Query Types
export interface QueryResultRecords {
  total?: number;
  pageSize?: number;
  page?: number;
  record?: QueryResultRecord[];
  link?: VCloudLink[];
}

export interface QueryResultRecord {
  href?: string;
  id?: string;
  type?: string;
  name?: string;
  [key: string]: any; // Allow additional dynamic properties
}

// MCP Tool Response Types
export interface McpToolResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    zone: string;
    organization: string;
    requestId?: string;
    timestamp: string;
  };
}

// API Client Types
export interface ApiRequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  data?: any;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface ApiResponse<T = any> {
  status: number;
  statusText: string;
  data: T;
  headers: Record<string, string>;
}

// Utility Types
export type ZoneId = 'sydney' | 'melbourne' | 'perth' | 'brisbane' | 'adelaide' | 'darwin';

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortAsc?: boolean;
  sortBy?: string;
  filter?: string;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}