import crypto from 'node:crypto';
import { config } from './config.js';

export function randomId(prefix = '') {
  return `${prefix}${crypto.randomBytes(16).toString('hex')}`;
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

const MAX_PASSWORD_LENGTH = 1024;

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('비밀번호는 최소 10자 이상이어야 합니다.');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('비밀번호가 너무 깁니다.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash, alg: 'scrypt' };
}

export function verifyPassword(password, passwordRecord) {
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) return false;
  if (!passwordRecord?.salt || !passwordRecord?.hash) return false;
  const expected = Buffer.from(passwordRecord.hash, 'hex');
  const actual = crypto.scryptSync(password, passwordRecord.salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function encryptionKey() {
  return crypto.createHash('sha256').update(config.secretKey).digest();
}

export function encryptSecret(plainText) {
  if (!plainText) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  };
}

export function decryptSecret(record) {
  if (!record?.iv || !record?.tag || !record?.data) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}
