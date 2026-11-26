import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listProfiles, resolveProfile, assertExpectedAccount, AccountGuardError } from '../src/aws-profile.mjs';

const CONFIG = [
  '[default]',
  'region = us-east-1',
  '[sso-session corp]',
  'sso_start_url = https://example.awsapps.com/start',
  '[profile demo-dev]',
  'sso_session = corp',
  '[profile  mi-perfil-dev ]',
  'sso_session = corp',
].join('\n');

const asker = (answer) => {
  const questions = [];
  const ask = async (question) => {
    questions.push(question);
    return answer;
  };
  return { ask, questions };
};

test('listProfilesReadsDefaultAndNamedProfilesIgnoringSsoSessions', () => {
  assert.deepEqual(listProfiles(CONFIG), ['default', 'demo-dev', 'mi-perfil-dev']);
  assert.deepEqual(listProfiles(''), []);
});

test('resolveProfileUsesEnvironmentWithoutAsking', async () => {
  const { ask, questions } = asker('otro');

  const profile = await resolveProfile({ envProfile: 'desde-env', profiles: [], ask, fallback: 'demo-dev', environment: 'dev' });

  assert.equal(profile, 'desde-env');
  assert.equal(questions.length, 0);
});

test('resolveProfileAsksShowingConfiguredProfilesAndAcceptsTypedName', async () => {
  const { ask, questions } = asker(' mi-perfil-dev ');

  const profile = await resolveProfile({ profiles: ['demo-dev', 'mi-perfil-dev'], ask, fallback: 'demo-dev', environment: 'dev' });

  assert.equal(profile, 'mi-perfil-dev');
  assert.match(questions[0], /demo-dev, mi-perfil-dev/);
  assert.match(questions[0], /\[demo-dev\]/);
  assert.match(questions[0], /para dev\./);
});

test('resolveProfileFallsBackOnEmptyAnswerOnlyWhenFallbackExists', async () => {
  assert.equal(await resolveProfile({ profiles: ['demo-dev'], ask: asker('').ask, fallback: 'demo-dev', environment: 'dev' }), 'demo-dev');
  await assert.rejects(resolveProfile({ profiles: ['otro'], ask: asker('').ask, fallback: 'demo-dev', environment: 'dev' }), /nombre del perfil/);
});

test('resolveProfileRejectsNamesNotConfiguredWhenConfigIsKnown', async () => {
  await assert.rejects(resolveProfile({ profiles: ['demo-dev'], ask: asker('inventado').ask, fallback: 'demo-dev', environment: 'dev' }), /inventado.*~\/\.aws\/config/);
});

test('resolveProfileAcceptsAnyNameWhenConfigIsUnavailable', async () => {
  const { ask, questions } = asker('perfil-sin-config');

  const profile = await resolveProfile({ profiles: [], ask, fallback: 'demo-dev', environment: 'dev' });

  assert.equal(profile, 'perfil-sin-config');
  assert.doesNotMatch(questions[0], /configurados/);
});

test('assertExpectedAccountPassesOnlyForTheExpectedAccount', async () => {
  const sts = (account) => ({ send: async () => ({ Account: account }) });

  assert.equal(await assertExpectedAccount({ sts: sts('111122223333'), expectedAccount: '111122223333', profile: 'p', environment: 'dev' }), '111122223333');
  await assert.rejects(
    assertExpectedAccount({ sts: sts('444455556666'), expectedAccount: '111122223333', profile: 'prod', environment: 'dev' }),
    (error) => error instanceof AccountGuardError && /prod/.test(error.message) && /111122223333/.test(error.message) && /dev/.test(error.message) && !/444455556666/.test(error.message),
  );
});
