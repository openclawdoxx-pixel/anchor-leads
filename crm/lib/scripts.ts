// crm/lib/scripts.ts
import fs from 'node:fs';
import path from 'node:path';
import type { BestPitch } from './types';

const SCRIPTS_DIR = path.join(process.cwd(), 'app', 'scripts');

export function loadScript(pitch: BestPitch): string {
  const filename = `${pitch}.md`;
  try {
    return fs.readFileSync(path.join(SCRIPTS_DIR, filename), 'utf-8');
  } catch {
    return `# Script not found\n\nNo script file found for pitch: ${pitch}`;
  }
}

export function loadAllScripts(): Record<BestPitch, string> {
  return {
    website: loadScript('website'),
    mcb: loadScript('mcb'),
    chat_ai: loadScript('chat_ai'),
    reputation: loadScript('reputation'),
    ghl_crm: loadScript('ghl_crm'),
  };
}
