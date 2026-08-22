/**
 * Single source of truth for the server's reported version — read once from package.json
 * instead of a hardcoded string. The hardcoded version drifted out of sync with a real
 * release within one release cycle (1.3.0 -> manually bumped to 1.4.0 -> stale again at
 * 1.5.0) because nothing forced it to be updated; reading it removes that failure mode.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file lives at src/lib/ (and build/lib/ once compiled) — package.json is two levels up
// in both cases, since build/ mirrors src/'s depth under the repo root.
const packageJsonPath = join(__dirname, '..', '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };

export const SERVER_VERSION: string = packageJson.version;
