import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';

const SECTION = /^\s*\[\s*(default|profile\s+([^\]]+?))\s*\]\s*$/;

export class AccountGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AccountGuardError';
  }
}

export function listProfiles(configText) {
  return configText
    .split(/\r?\n/)
    .map((line) => SECTION.exec(line))
    .filter(Boolean)
    .map((match) => (match[1] === 'default' ? 'default' : match[2].trim()));
}

function questionFor(profiles, suggested, environment) {
  const known = profiles.length ? ` Perfiles configurados: ${profiles.join(', ')}.` : '';
  const hint = suggested ? ` [${suggested}]` : '';
  return `Nombre del perfil AWS configurado para ${environment}.${known}${hint}: `;
}

export async function resolveProfile({ envProfile, profiles, ask, fallback, environment }) {
  if (envProfile) return envProfile;
  const suggested = profiles.length === 0 || profiles.includes(fallback) ? fallback : null;
  const answer = ((await ask(questionFor(profiles, suggested, environment))) ?? '').trim();
  const profile = answer || suggested;
  if (!profile) throw new Error('Escribe el nombre del perfil que configuraste con aws configure sso.');
  if (profiles.length && !profiles.includes(profile)) {
    throw new Error(`El perfil ${profile} no existe en ~/.aws/config. Revisa INSTALACION.md.`);
  }
  return profile;
}

export async function assertExpectedAccount({ sts, expectedAccount, profile, environment }) {
  const { Account } = await sts.send(new GetCallerIdentityCommand({}));
  if (Account !== expectedAccount) {
    throw new AccountGuardError(`El perfil ${profile} no apunta a la cuenta de ${environment} (${expectedAccount}). La presentación solo corre contra ${environment}.`);
  }
  return Account;
}
