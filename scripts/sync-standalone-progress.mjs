// Reuse the Vue frontend's tested domain logic without a browser build/runtime dependency.
import { readFile, writeFile } from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const source = await readFile(new URL('../frontend/src/modules/serviceguide/services/serviceProgress.ts', import.meta.url), 'utf8');
const plain = source.replace(/^import[^\r\n]*\r?\n/gm, '').replace(/^export /gm, '');
const { outputText } = ts.transpileModule(plain, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } });
const header = '// Generated from frontend/src/modules/serviceguide/services/serviceProgress.ts.\n// Update with: node scripts/sync-standalone-progress.mjs\n';
const target = new URL('../frontend-standalone/service-progress.js', import.meta.url);
const generated = header + '(() => {\n' + outputText + '\nwindow.CampusServiceProgress = { ServiceProgressStore, orderSteps, FLOW_UPDATED_NOTICE };\n})();\n';
if (process.argv.includes('--check')) {
  const actual = await readFile(target, 'utf8');
  if (actual.replace(/\r\n/g, '\n') !== generated.replace(/\r\n/g, '\n')) throw new Error('Standalone progress is stale. Run node scripts/sync-standalone-progress.mjs');
  console.log('Standalone progress matches the tested Vue domain.');
} else await writeFile(target, generated);
