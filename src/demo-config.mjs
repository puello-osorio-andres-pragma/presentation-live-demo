const REQUIRED_PATHS = [
  'environment',
  'aws.region', 'aws.accountId', 'aws.defaultProfile',
  'gateway.baseUrl', 'gateway.apiKeyId', 'gateway.origin',
  'merchant.key', 'merchant.name', 'merchant.productId', 'merchant.amount', 'merchant.currency', 'merchant.redirectUrl', 'merchant.externalCustomerId',
  'ssm.signingSecret', 'ssm.jwePublicKey', 'ssm.jweKid',
  'biometrics.operationId',
];
const PLACEHOLDER = /^<[^>]+>$/;
const ACCOUNT_ID = /^\d{12}$/;

export class DemoConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DemoConfigError';
  }
}

const valueAt = (source, path) => path.split('.').reduce((node, key) => node?.[key], source);

function requireValue(source, path) {
  const value = valueAt(source, path);
  if (typeof value !== 'string' || value.trim() === '' || PLACEHOLDER.test(value)) {
    throw new DemoConfigError(`demo.config.json: falta un valor real en ${path}`);
  }
  return value;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new DemoConfigError('demo.config.json no es un JSON válido');
  }
}

function validateLogGroups(raw) {
  if (!Array.isArray(raw.logGroups) || raw.logGroups.length === 0) throw new DemoConfigError('demo.config.json: logGroups debe tener al menos un log group');
  return raw.logGroups.map((_, index) => {
    const [key, label, name] = ['key', 'label', 'name'].map((field) => requireValue(raw, `logGroups.${index}.${field}`));
    return { key, label, name };
  });
}

export function parseDemoConfig(text) {
  const raw = parseJson(text);
  REQUIRED_PATHS.forEach((path) => requireValue(raw, path));
  if (!ACCOUNT_ID.test(raw.aws.accountId)) throw new DemoConfigError('demo.config.json: aws.accountId debe tener 12 dígitos');
  if (!raw.gateway.baseUrl.startsWith('https://')) throw new DemoConfigError('demo.config.json: gateway.baseUrl debe usar https');
  const { merchant } = raw;
  return Object.freeze({
    environment: raw.environment,
    aws: { ...raw.aws },
    gateway: { ...raw.gateway, baseUrl: raw.gateway.baseUrl.replace(/\/$/, ''), host: new URL(raw.gateway.baseUrl).host },
    ssm: { ...raw.ssm },
    operationId: raw.biometrics.operationId,
    transaction: {
      productId: merchant.productId,
      amount: merchant.amount,
      currency: merchant.currency,
      merchantKey: merchant.key,
      merchantName: merchant.name,
      tppRedirectUrl: merchant.redirectUrl,
      externalCustomerId: merchant.externalCustomerId,
    },
    logGroups: validateLogGroups(raw),
  });
}
