import { describe, expect, it } from 'vitest';
import { generateSparseVector, sparseDotProduct } from '../server/utils/sparse-vectors';

describe('sparse vectors', () => {
  it('normalizes related word forms and scores overlap', () => {
    const query = generateSparseVector('invoices');
    const document = generateSparseVector('invoice payment');
    expect(sparseDotProduct(query, document)).toBeGreaterThan(0);
  });

  it('returns an empty vector for noise-only input', () => {
    expect(generateSparseVector('the and of')).toEqual({});
  });
});
