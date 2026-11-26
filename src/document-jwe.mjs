import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';

const b64url = (buffer) => Buffer.from(buffer).toString('base64url');

export function buildDocumentJwe({ publicKeyPem, kid, documentNumber }) {
  const header = b64url(JSON.stringify({ alg: 'RSA-OAEP-256', enc: 'A256GCM', kid }));
  const cek = randomBytes(32);
  const iv = randomBytes(12);
  const encryptedKey = publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    cek,
  );
  const cipher = createCipheriv('aes-256-gcm', cek, iv);
  cipher.setAAD(Buffer.from(header, 'ascii'));
  const plain = JSON.stringify({ documentType: 'DPI', documentNumber });
  const cipherText = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [header, b64url(encryptedKey), b64url(iv), b64url(cipherText), b64url(cipher.getAuthTag())].join('.');
}
