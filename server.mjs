import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SSMClient } from '@aws-sdk/client-ssm';
import { STSClient } from '@aws-sdk/client-sts';
import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { CloudWatchLogsClient, FilterLogEventsCommand, StartQueryCommand, GetQueryResultsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { PORT, INSIGHTS_QUERIES } from './src/config.mjs';
import { parseDemoConfig } from './src/demo-config.mjs';
import { createMasker } from './src/masker.mjs';
import { createGatewayClient } from './src/gateway-client.mjs';
import { createSimulation } from './src/simulation.mjs';
import { createLogsService } from './src/logs-service.mjs';
import { createRequestHandler } from './src/http-server.mjs';
import { loadDemoSecrets } from './src/aws-secrets.mjs';
import { isValidDpi, promptHidden } from './src/prompt-dpi.mjs';
import { listProfiles, resolveProfile, assertExpectedAccount } from './src/aws-profile.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const deckDir = join(root, 'deck');
const configPath = process.env.DEMO_CONFIG ?? join(root, 'demo.config.json');
let profile = process.env.AWS_PROFILE ?? '<perfil>';

async function readConfig() {
  try {
    return parseDemoConfig(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`No existe ${configPath}. Copia ahí el demo.config.json que recibiste por correo`);
    throw error;
  }
}

async function requireDeck() {
  try {
    await access(join(deckDir, 'index.html'));
  } catch {
    throw new Error(`No existe deck/index.html. Copia ahí el HTML de la presentación que recibiste por correo`);
  }
}

async function configuredProfiles() {
  const path = process.env.AWS_CONFIG_FILE ?? join(homedir(), '.aws', 'config');
  try {
    return listProfiles(await readFile(path, 'utf8'));
  } catch {
    return [];
  }
}

async function askLine(question) {
  if (!process.stdin.isTTY) throw new Error('No hay terminal interactiva: define AWS_PROFILE para arrancar.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function readDpi(environment) {
  const dpi = process.env.DEMO_DPI ?? await promptHidden(`DPI de prueba de ${environment} (13 dígitos, no se guarda): `);
  if (!isValidDpi(dpi)) throw new Error('El DPI debe tener exactamente 13 dígitos.');
  return dpi;
}

async function main() {
  const config = await readConfig();
  await requireDeck();
  const { environment } = config;
  profile = await resolveProfile({ envProfile: process.env.AWS_PROFILE, profiles: await configuredProfiles(), ask: askLine, fallback: config.aws.defaultProfile, environment });
  const clientConfig = { region: config.aws.region, profile };
  await assertExpectedAccount({ sts: new STSClient(clientConfig), expectedAccount: config.aws.accountId, profile, environment });
  console.log(`Perfil ${profile} verificado contra la cuenta de ${environment}. Solo se leen datos de AWS.`);
  const dpi = await readDpi(environment);
  console.log(`Leyendo secretos de ${environment}…`);
  const secrets = await loadDemoSecrets({
    ssm: new SSMClient(clientConfig),
    apiGateway: new APIGatewayClient(clientConfig),
    names: config.ssm,
    apiKeyId: config.gateway.apiKeyId,
  });
  const masker = createMasker({ secrets: [dpi, secrets.apiKey, secrets.signingSecret, config.operationId, config.aws.accountId] });
  const gateway = createGatewayClient({
    baseUrl: config.gateway.baseUrl,
    apiKey: secrets.apiKey,
    origin: config.gateway.origin,
    merchantKey: config.transaction.merchantKey,
    externalCustomerId: config.transaction.externalCustomerId,
  });
  const simulation = createSimulation({ gateway, masker, secrets, dpi, operationId: config.operationId, transaction: config.transaction });
  const logs = createLogsService({
    client: new CloudWatchLogsClient(clientConfig),
    commands: { FilterLogEventsCommand, StartQueryCommand, GetQueryResultsCommand },
    masker,
    groups: config.logGroups,
    queries: INSIGHTS_QUERIES,
  });
  const health = async () => ({ ok: true, environment, profile, gateway: config.gateway.host, dpi: masker.text(dpi) });
  const server = createServer(createRequestHandler({ simulation, logs, health, publicDir: deckDir }));
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Presentación en vivo: http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  const hint = /token|sso|credential|expired/i.test(error.message) ? ` Renueva la sesión: aws sso login --profile ${profile}` : '';
  console.error(`No se pudo iniciar: ${error.name}: ${error.message.replace(/\.$/, '')}.${hint}`);
  process.exitCode = 1;
});
