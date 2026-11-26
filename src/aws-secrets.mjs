import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { GetApiKeyCommand } from '@aws-sdk/client-api-gateway';

async function parameter(ssm, name, decrypt = false) {
  const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: decrypt }));
  return out.Parameter.Value;
}

export async function loadDemoSecrets({ ssm, apiGateway, names, apiKeyId }) {
  const [signingSecret, jwePublicKey, jweKid, apiKey] = await Promise.all([
    parameter(ssm, names.signingSecret, true),
    parameter(ssm, names.jwePublicKey),
    parameter(ssm, names.jweKid),
    apiGateway.send(new GetApiKeyCommand({ apiKey: apiKeyId, includeValue: true })).then((out) => out.value),
  ]);
  return { signingSecret, jwePublicKey, jweKid, apiKey };
}
