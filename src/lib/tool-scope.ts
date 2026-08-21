/**
 * Read-only tool classification for the /mcp/readonly mount (A2.1). Prefix-matched rather
 * than a hand-maintained list, since new tools following the list_/get_/show_/test_ convention
 * should be read-only by default without a second place to update.
 */

const READ_ONLY_PREFIXES = ['list_', 'get_', 'show_', 'test_'];

// get_vm_console returns a WebMKS console ticket — a bearer credential granting live VM
// console access. It matches the read-only prefix but is not read-only in effect, so it's
// excluded from the read-only mount despite the name.
const READ_ONLY_EXCLUSIONS = new Set(['get_vm_console']);

export function isReadOnlyTool(toolName: string): boolean {
  if (READ_ONLY_EXCLUSIONS.has(toolName)) {
    return false;
  }
  return READ_ONLY_PREFIXES.some(prefix => toolName.startsWith(prefix));
}
