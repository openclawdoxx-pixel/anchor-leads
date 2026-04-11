import { describe, it, expect } from 'vitest';
import { buildQueryFromFilters } from './filters';
import type { FilterState } from './types';

describe('buildQueryFromFilters', () => {
  it('returns no conditions for empty filters', () => {
    const result = buildQueryFromFilters({});
    expect(result).toEqual({});
  });

  it('handles state multi-select', () => {
    const result = buildQueryFromFilters({ state: ['NY', 'PA'] });
    expect(result.in).toEqual([['state', ['NY', 'PA']]]);
  });

  it('handles review_count_max as lte', () => {
    const result = buildQueryFromFilters({ review_count_max: 25 });
    expect(result.lte).toEqual([['review_count', 25]]);
  });

  it('handles has_owner_name=true as not-null', () => {
    const result = buildQueryFromFilters({ has_owner_name: true });
    expect(result.notNull).toEqual(['owner_name']);
  });

  it('handles never_called call_status', () => {
    const result = buildQueryFromFilters({ call_status: 'never_called' });
    expect(result.isNull).toEqual(['latest_outcome']);
  });

  it('combines multiple filters', () => {
    const f: FilterState = {
      state: ['NY'],
      review_count_max: 50,
      has_owner_name: true,
    };
    const result = buildQueryFromFilters(f);
    expect(result.in).toEqual([['state', ['NY']]]);
    expect(result.lte).toEqual([['review_count', 50]]);
    expect(result.notNull).toEqual(['owner_name']);
  });
});
