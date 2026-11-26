import { createHash, createHmac } from 'node:crypto';

const SEPARATOR = ' | ';
const DEFAULT_CURRENCY = 'GTQ';

export function canonicalString({ productId, transactionReference, amount, currency, date, merchantKey }) {
  return [productId, transactionReference, amount, currency ?? DEFAULT_CURRENCY, date, merchantKey].join(SEPARATOR);
}

export function signTransaction(transaction, signingSecret) {
  return createHmac('sha256', signingSecret).update(canonicalString(transaction), 'utf8').digest('hex');
}

export function fieldsHash(transaction) {
  return createHash('sha256').update(canonicalString(transaction), 'utf8').digest('hex');
}
