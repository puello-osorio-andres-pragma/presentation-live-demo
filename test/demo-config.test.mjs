import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDemoConfig, DemoConfigError } from '../src/demo-config.mjs';

const VALID = {
  environment: 'dev',
  aws: { region: 'us-east-1', accountId: '111122223333', defaultProfile: 'demo-dev', ssoStartUrl: 'https://example.awsapps.com/start', ssoRegion: 'us-east-1', roleName: 'ReadOnly' },
  gateway: { baseUrl: 'https://abc.execute-api.us-east-1.amazonaws.com/dev', apiKeyId: 'key123', origin: 'https://front.example.com' },
  merchant: { key: 'mk_demo', name: 'Comercio de pruebas', productId: 'PIS-DEMO', amount: '150.00', currency: 'GTQ', redirectUrl: 'https://tpp.example.com/retorno', externalCustomerId: 'CUST-DEMO-001' },
  ssm: { signingSecret: '/demo/signing-secret', jwePublicKey: '/demo/jwe-public-key', jweKid: '/demo/jwe-kid' },
  biometrics: { operationId: 'op-fixed' },
  logGroups: [{ key: 'journey', label: 'Journey', name: '/aws/ecs/journey' }],
};

const withChange = (mutate) => {
  const copy = structuredClone(VALID);
  mutate(copy);
  return JSON.stringify(copy);
};

test('parseDemoConfigReturnsFlatConfigForTheServer', () => {
  const config = parseDemoConfig(JSON.stringify(VALID));

  assert.equal(config.environment, 'dev');
  assert.equal(config.aws.accountId, '111122223333');
  assert.equal(config.gateway.host, 'abc.execute-api.us-east-1.amazonaws.com');
  assert.deepEqual(config.transaction, {
    productId: 'PIS-DEMO', amount: '150.00', currency: 'GTQ', merchantKey: 'mk_demo', merchantName: 'Comercio de pruebas',
    tppRedirectUrl: 'https://tpp.example.com/retorno', externalCustomerId: 'CUST-DEMO-001',
  });
  assert.ok(Object.isFrozen(config));
});

test('parseDemoConfigRejectsInvalidJson', () => {
  assert.throws(() => parseDemoConfig('{'), (error) => error instanceof DemoConfigError && /JSON/.test(error.message));
});

test('parseDemoConfigRejectsMissingFieldsNamingThePath', () => {
  assert.throws(() => parseDemoConfig(withChange((c) => { delete c.gateway.apiKeyId; })), /gateway\.apiKeyId/);
  assert.throws(() => parseDemoConfig(withChange((c) => { c.logGroups = []; })), /logGroups/);
});

test('parseDemoConfigRejectsUnreplacedPlaceholders', () => {
  assert.throws(() => parseDemoConfig(withChange((c) => { c.aws.accountId = '<ACCOUNT_ID>'; })), /aws\.accountId/);
});

test('parseDemoConfigRejectsNonHttpsGatewayAndMalformedAccount', () => {
  assert.throws(() => parseDemoConfig(withChange((c) => { c.gateway.baseUrl = 'http://abc/dev'; })), /gateway\.baseUrl/);
  assert.throws(() => parseDemoConfig(withChange((c) => { c.aws.accountId = '123'; })), /aws\.accountId/);
});
