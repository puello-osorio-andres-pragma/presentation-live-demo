import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { buildDocumentJwe } from '../src/document-jwe.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const KID = '132fed48-0857-4a18-8cb1-76e3162759e0';

const fromB64url = (part) => Buffer.from(part, 'base64url');

test('buildDocumentJweProducesCompactSerializationWithProtectedHeader', () => {
  const jwe = buildDocumentJwe({ publicKeyPem: PEM, kid: KID, documentNumber: '2547896510101' });
  const parts = jwe.split('.');

  assert.equal(parts.length, 5);
  assert.deepEqual(JSON.parse(fromB64url(parts[0]).toString('utf8')), { alg: 'RSA-OAEP-256', enc: 'A256GCM', kid: KID });
  assert.equal(fromB64url(parts[2]).length, 12);
  assert.equal(fromB64url(parts[4]).length, 16);
});

test('buildDocumentJweDecryptsToDpiDocument', () => {
  const jwe = buildDocumentJwe({ publicKeyPem: PEM, kid: KID, documentNumber: '2547896510101' });
  const [header, encryptedKey, iv, cipherText, tag] = jwe.split('.');
  const cek = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    fromB64url(encryptedKey),
  );
  const decipher = createDecipheriv('aes-256-gcm', cek, fromB64url(iv));
  decipher.setAAD(Buffer.from(header, 'ascii'));
  decipher.setAuthTag(fromB64url(tag));
  const plain = Buffer.concat([decipher.update(fromB64url(cipherText)), decipher.final()]).toString('utf8');

  assert.equal(cek.length, 32);
  assert.deepEqual(JSON.parse(plain), { documentType: 'DPI', documentNumber: '2547896510101' });
});
