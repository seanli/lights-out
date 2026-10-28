// Module discovery and live data. No side effects, so tests can import it.
import type { ModuleDef } from '../contracts/kernel';
import type { DataBundle } from '../kernel';
import rules from '../../data/rules.json';
import copy from '../../data/copy.json';
import flags from '../../data/flags.json';

/** Every folder in src/modules with an index.ts is a module. Delete the folder and it's gone. */
export function discoverModules(): ModuleDef[] {
  const found = import.meta.glob<{ default: ModuleDef }>('../modules/*/index.ts', { eager: true });
  return Object.values(found).map((m) => m.default).filter(Boolean);
}

export const liveData: DataBundle = { rules, copy, flags } as DataBundle;
