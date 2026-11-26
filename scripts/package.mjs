import { cp, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const deckName = process.argv[2] ?? 'presentacion';

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(join(ROOT, 'deck', 'index.html'), join(DIST, `${deckName}.html`));
await cp(join(ROOT, 'demo.config.json'), join(DIST, 'demo.config.json'));
console.log(`Adjuntos listos en ${DIST}: ${deckName}.html y demo.config.json`);
