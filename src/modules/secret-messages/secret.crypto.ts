import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { env, jwtAccessSecret } from '../../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/** Development and test derive a key so the API runs without setup; production requires SECRET_MESSAGES_KEY. */
const key = env.SECRET_MESSAGES_KEY
  ? Buffer.from(env.SECRET_MESSAGES_KEY, 'base64')
  : createHash('sha256').update(`secret-messages:${jwtAccessSecret}`).digest();

export function encryptBody(plain: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptBody(stored: string) {
  const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !tag || !data) throw new Error('Malformed secret message body');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
