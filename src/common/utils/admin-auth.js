'use strict';

const crypto = require('crypto');

const SCRYPT_PREFIX = '$scrypt$';
const SALT_LEN = 16;
const KEY_LEN = 32;

/** 密码哈希（scrypt + 随机盐），存入 param_config.admin_password.value.v */
function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN);
  return `${SCRYPT_PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * 校验密码。明文 legacy 仍可读；匹配时 migrate=true 表示应改写为哈希。
 * @returns {{ ok: boolean, migrate?: boolean }}
 */
function verifyPassword(password, stored) {
  if (!stored) return { ok: false };
  const saved = String(stored);
  if (!saved.startsWith(SCRYPT_PREFIX)) {
    const ok = String(password) === saved;
    return { ok, migrate: ok };
  }
  const parts = saved.split('$');
  if (parts.length < 4) return { ok: false };
  const salt = Buffer.from(parts[2], 'hex');
  const expected = parts[3];
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN);
  return { ok: hash.toString('hex') === expected, migrate: false };
}

function isHashedPassword(stored) {
  return stored && String(stored).startsWith(SCRYPT_PREFIX);
}

module.exports = { hashPassword, verifyPassword, isHashedPassword };
