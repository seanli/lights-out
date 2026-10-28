// Regenerates ARCHITECTURE.md from the module manifests. Run: npm run arch
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { discoverModules } = await server.ssrLoadModule('/src/shell/registry.ts');
  const mods = discoverModules().map((m) => m.manifest).sort((a, b) => a.name.localeCompare(b.name));
  const list = (xs) => (xs && xs.length ? xs.map((x) => '`' + x + '`').join(', ') : '—');
  const lines = [
    '# Architecture',
    '',
    '_Generated from the module manifests by `npm run arch`. Do not edit by hand._',
    '',
    'Kernel: registry · run-to-completion event bus · plain-data store with snapshots · dependency-ordered boot · logger · data loader.',
    'Shell: `src/shell` (entry, view service, design system in `src/shell/styles`). Contracts: `src/contracts`.',
    '',
    '| Module | Owns | Provides | Uses | Emits | Listens | Data |',
    '|---|---|---|---|---|---|---|',
    ...mods.map((m) => `| **${m.name}** | ${list(m.owns)} | ${list(m.provides)} | ${list([...(m.uses ?? []), ...(m.optional ?? []).map((s) => s + '?')])} | ${list(m.emits)} | ${list(m.listens)} | ${list(Object.keys(m.data ?? {}))} |`),
    '',
    '## Who reacts to what',
    '',
  ];
  const types = [...new Set(mods.flatMap((m) => m.emits))].sort();
  for (const t of types) {
    const from = mods.filter((m) => m.emits.includes(t)).map((m) => m.name);
    const to = mods.filter((m) => m.listens.includes(t)).map((m) => m.name);
    lines.push(`- \`${t}\`: ${from.join(', ')} → ${to.length ? to.join(', ') : '(nobody yet)'}`);
  }
  writeFileSync('ARCHITECTURE.md', lines.join('\n') + '\n');
  console.log(`ARCHITECTURE.md: ${mods.length} modules`);
} finally {
  await server.close();
}
