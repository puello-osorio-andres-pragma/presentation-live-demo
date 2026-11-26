const NAME_KEYS = ['name', 'fullName', 'firstName', 'lastName', 'secondName', 'customerName', 'holderName', 'accountHolder', 'accountName', 'email', 'phone', 'address'];
const TOKEN_KEYS = ['session', 'authSession', 'authNonce', 'resumeToken', 'verificationToken', 'accessToken', 'idToken', 'refreshToken', 'token', 'obst', 'handoffToken', 'documentJwe', 'signature', 'fieldsHash', 'facephiUrl'];

const JWE_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{60,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{10,}/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const EMAIL_PATTERN = /\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const HEX_PATTERN = /\b([0-9a-f]{8})[0-9a-f]{40,}\b/g;
const DPI_PATTERN = /\b(\d{2})\d{9}(\d{2})\b/g;
const ACCOUNT_PATTERN = /\b\d{8,20}\b/g;

const keyAlternation = (keys) => keys.join('|');
const escapedKeyPattern = (keys) =>
  new RegExp(`(\\\\?"(?:${keyAlternation(keys)})\\\\?"\\s*:\\s*\\\\?")([^"\\\\]+)`, 'gi');
const NAME_IN_TEXT = escapedKeyPattern(NAME_KEYS);
const TOKEN_IN_TEXT = escapedKeyPattern(TOKEN_KEYS);
const NAME_KEY_SET = new Set(NAME_KEYS.map((k) => k.toLowerCase()));
const TOKEN_KEY_SET = new Set(TOKEN_KEYS.map((k) => k.toLowerCase()));

const maskName = (value) => `${String(value).charAt(0)}***`;
const maskToken = (value) => `${String(value).slice(0, 4)}…`;
const maskAccount = (digits) => `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createMasker({ secrets = [] } = {}) {
  const secretPatterns = secrets
    .filter((s) => typeof s === 'string' && s.length > 0)
    .filter((s) => !/^\d{13}$/.test(s))
    .map((s) => new RegExp(escapeRegExp(s), 'g'));

  function text(input) {
    if (input === undefined || input === null) {
      return '';
    }
    let out = String(input);
    for (const pattern of secretPatterns) {
      out = out.replace(pattern, '[secreto]');
    }
    return out
      .replace(TOKEN_IN_TEXT, (_, prefix, value) => prefix + maskToken(value))
      .replace(NAME_IN_TEXT, (_, prefix, value) => prefix + maskName(value))
      .replace(JWE_PATTERN, '[JWE]')
      .replace(BEARER_PATTERN, 'Bearer [token]')
      .replace(JWT_PATTERN, 'eyJ…[JWT]')
      .replace(EMAIL_PATTERN, (_, first, domain) => `${first}***@${domain}`)
      .replace(HEX_PATTERN, (_, head) => `${head}…`)
      .replace(DPI_PATTERN, (_, head, tail) => `${head}*********${tail}`)
      .replace(ACCOUNT_PATTERN, maskAccount);
  }

  function value(input, key = '') {
    const lowerKey = key.toLowerCase();
    if (typeof input === 'string') {
      if (NAME_KEY_SET.has(lowerKey)) return maskName(input);
      if (TOKEN_KEY_SET.has(lowerKey)) return maskToken(input);
      return text(input);
    }
    if (Array.isArray(input)) {
      return input.map((item) => value(item));
    }
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, value(v, k)]));
    }
    return input;
  }

  return { text, value };
}
