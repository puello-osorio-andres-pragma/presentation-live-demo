import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const READ_ONLY_COMMAND = /^(Get|List|Describe|FilterLogEvents|StartQuery|GetQueryResults|GetCallerIdentity)\w*Command$/;
const SDK_IMPORT = /import\s*\{([^}]+)\}\s*from\s*'@aws-sdk\/[^']+'/g;

async function sourceFiles() {
  const src = (await readdir(join(ROOT, 'src'))).filter((f) => f.endsWith('.mjs')).map((f) => join(ROOT, 'src', f));
  return [join(ROOT, 'server.mjs'), ...src];
}

test('serverOnlyImportsReadOnlyAwsCommands', async () => {
  const commands = [];
  for (const file of await sourceFiles()) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(SDK_IMPORT)) {
      commands.push(...match[1].split(',').map((name) => name.trim()).filter((name) => name.endsWith('Command')));
    }
  }

  assert.ok(commands.length > 0);
  assert.deepEqual(commands.filter((name) => !READ_ONLY_COMMAND.test(name)), []);
});
