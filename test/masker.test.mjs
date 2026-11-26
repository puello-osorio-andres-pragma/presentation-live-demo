import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMasker } from '../src/masker.mjs';

const DPI = '2547896510101';
const API_KEY = 'apikey-demo-value-123456';
const masker = createMasker({ secrets: [DPI, API_KEY] });

test('maskDpiKeepsTwoDigitsOnEachSide', () => {
  assert.equal(masker.text(`dpi ${DPI}`), 'dpi 25*********01');
});

test('maskUnknownThirteenDigitNumberAsDpi', () => {
  assert.equal(masker.text('otro 1234567890123'), 'otro 12*********23');
});

test('maskAccountNumbersKeepLastFour', () => {
  assert.equal(masker.text('cuenta 3010123456'), 'cuenta ******3456');
});

test('maskShortNumbersAreKept', () => {
  assert.equal(masker.text('status=200 latencyMs=1234567'), 'status=200 latencyMs=1234567');
});

test('maskConfiguredSecretsAreHidden', () => {
  assert.equal(masker.text(`x-api-key=${API_KEY}`), 'x-api-key=[secreto]');
});

test('maskJwtIsReplaced', () => {
  assert.equal(masker.text('Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'), 'Bearer [token]');
  assert.equal(masker.text('token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln'), 'token eyJ…[JWT]');
});

test('maskJweIsReplacedBeforeJwt', () => {
  const jwe = `eyJhbGciOiJSU0EifQ.${'a'.repeat(120)}.${'b'.repeat(16)}.${'c'.repeat(40)}.${'d'.repeat(22)}`;
  assert.equal(masker.text(`doc ${jwe} fin`), 'doc [JWE] fin');
});

test('maskLongHexTokensAreShortened', () => {
  assert.equal(masker.text(`h=${'ab'.repeat(32)}`), 'h=abababab…');
});

test('maskEmailsKeepDomain', () => {
  assert.equal(masker.text('mail juan.perez@example.com'), 'mail j***@example.com');
});

test('maskSensitiveJsonKeysInEscapedText', () => {
  const raw = '{\\"customerName\\":\\"Juan Perez\\",\\"session\\":\\"AYABeLongSessionValue\\"}';
  assert.equal(masker.text(raw), '{\\"customerName\\":\\"J***\\",\\"session\\":\\"AYAB…\\"}');
});

test('maskObjectRecursivelyByKeyAndValue', () => {
  const masked = masker.value({
    accountId: '3010123456',
    holder: { fullName: 'Ana Lopez' },
    resumeToken: 'abcdefghijklmnop',
    list: [DPI, 7, null, true],
  });
  assert.deepEqual(masked, {
    accountId: '******3456',
    holder: { fullName: 'A***' },
    resumeToken: 'abcd…',
    list: ['25*********01', 7, null, true],
  });
});

test('maskIgnoresEmptySecrets', () => {
  const plain = createMasker({ secrets: ['', undefined] });
  assert.equal(plain.text('hola'), 'hola');
});

test('maskNonStringValuesPassThroughText', () => {
  assert.equal(masker.text(undefined), '');
  assert.equal(masker.text(12), '12');
});
