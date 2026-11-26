import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalString, signTransaction, fieldsHash } from '../src/merchant-signature.mjs';

const TRANSACTION = {
  productId: 'PRD-DEMO',
  transactionReference: 'ORD-2026-000123',
  amount: '1333.00',
  currency: 'GTQ',
  date: '2026-11-25T15:30:00Z',
  merchantKey: 'mk_demo_comercio',
};

test('canonicalStringJoinsFieldsInContractOrder', () => {
  assert.equal(
    canonicalString(TRANSACTION),
    'PRD-DEMO | ORD-2026-000123 | 1333.00 | GTQ | 2026-11-25T15:30:00Z | mk_demo_comercio',
  );
});

test('canonicalStringDefaultsCurrencyToGtq', () => {
  assert.match(canonicalString({ ...TRANSACTION, currency: undefined }), / \| GTQ \| /);
});

test('signTransactionProducesLowercaseHmacHex', () => {
  assert.equal(
    signTransaction(TRANSACTION, 'demo-secret-no-usar-en-produccion'),
    '5642d605b5f3163f01cba8851ed241ee2bb67ffd70b2e1485c1c0c568b06f2b5',
  );
});

test('fieldsHashIsSha256OfCanonicalString', () => {
  assert.equal(fieldsHash(TRANSACTION), 'cda9e545587cc8bc8788730136f3dbff0d822cc1199f1ab5171528479de0f6bf');
});
