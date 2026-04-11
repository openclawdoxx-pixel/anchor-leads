// crm/lib/filters.ts
import type { FilterState } from './types';

export type QueryPlan = {
  in?: Array<[string, string[] | number[]]>;
  lte?: Array<[string, number]>;
  gte?: Array<[string, number]>;
  eq?: Array<[string, string | number | boolean]>;
  notNull?: string[];
  isNull?: string[];
  ilike?: Array<[string, string]>;
};

export function buildQueryFromFilters(f: FilterState): QueryPlan {
  const plan: QueryPlan = {};

  if (f.state?.length) {
    (plan.in ??= []).push(['state', f.state]);
  }
  if (f.city) {
    (plan.ilike ??= []).push(['city', `%${f.city}%`]);
  }
  if (f.best_pitch?.length) {
    (plan.in ??= []).push(['best_pitch', f.best_pitch]);
  }
  if (f.site_builder?.length) {
    (plan.in ??= []).push(['site_builder', f.site_builder]);
  }
  if (f.booking_path_quality?.length) {
    (plan.in ??= []).push(['booking_path_quality', f.booking_path_quality]);
  }
  if (typeof f.review_count_max === 'number') {
    (plan.lte ??= []).push(['review_count', f.review_count_max]);
  }
  if (typeof f.review_count_min === 'number') {
    (plan.gte ??= []).push(['review_count', f.review_count_min]);
  }
  if (typeof f.digital_maturity_max === 'number') {
    (plan.lte ??= []).push(['digital_maturity', f.digital_maturity_max]);
  }
  if (f.has_owner_name === true) {
    (plan.notNull ??= []).push('owner_name');
  } else if (f.has_owner_name === false) {
    (plan.isNull ??= []).push('owner_name');
  }
  if (f.call_status === 'never_called') {
    (plan.isNull ??= []).push('latest_outcome');
  }

  return plan;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyPlanToQuery(query: any, plan: QueryPlan): any {
  let q = query;
  for (const [col, values] of plan.in ?? []) q = q.in(col, values);
  for (const [col, v] of plan.lte ?? []) q = q.lte(col, v);
  for (const [col, v] of plan.gte ?? []) q = q.gte(col, v);
  for (const [col, v] of plan.eq ?? []) q = q.eq(col, v);
  for (const col of plan.notNull ?? []) q = q.not(col, 'is', null);
  for (const col of plan.isNull ?? []) q = q.is(col, null);
  for (const [col, pattern] of plan.ilike ?? []) q = q.ilike(col, pattern);
  return q;
}
