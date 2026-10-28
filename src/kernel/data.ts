// Validates every module's data sections before any module inits. Fails loudly.
import * as v from 'valibot';
import type { DataFile, ModuleDef } from '../contracts/kernel';

export type DataBundle = Partial<Record<DataFile, Record<string, unknown>>>;

export class DataError extends Error {
  constructor(public problems: string[]) {
    super(`Game data is invalid:\n- ${problems.join('\n- ')}`);
    this.name = 'DataError';
  }
}

export interface DataResult {
  sections: Map<string, Partial<Record<DataFile, unknown>>>;
  /** sections in the data files that no registered module owns */
  orphans: string[];
}

export function loadData(bundle: DataBundle, modules: ModuleDef[]): DataResult {
  const problems: string[] = [];
  const sections = new Map<string, Partial<Record<DataFile, unknown>>>();
  const names = new Set(modules.map((m) => m.manifest.name));

  for (const mod of modules) {
    const { name, data } = mod.manifest;
    const own: Partial<Record<DataFile, unknown>> = {};
    for (const [file, schema] of Object.entries(data ?? {}) as [DataFile, v.GenericSchema][]) {
      const raw = bundle[file]?.[name];
      if (raw === undefined) {
        problems.push(`${file}.json has no "${name}" section`);
        continue;
      }
      const result = v.safeParse(schema, raw);
      if (result.success) own[file] = result.output;
      else {
        for (const issue of result.issues) {
          const path = issue.path?.map((p) => String(p.key)).join('.') ?? '';
          problems.push(`${file}.json → ${name}${path ? '.' + path : ''}: ${issue.message}`);
        }
      }
    }
    sections.set(name, own);
  }

  const orphans: string[] = [];
  for (const [file, content] of Object.entries(bundle)) {
    for (const key of Object.keys(content ?? {})) {
      if (key.startsWith('$')) continue; // $comment etc.
      if (!names.has(key)) orphans.push(`${file}.${key}`);
    }
  }

  if (problems.length) throw new DataError(problems);
  return { sections, orphans };
}
