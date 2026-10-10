import {selectRows} from './domain.mjs';

// All steps preserve the same freshness, schedule and specialty filters.
export function searchArea(records, filters) {
  const all = selectRows(records, {...filters, radius:50});
  for (const radius of [5,10]) {
    const rows = all.filter(row=>row.km<=radius);
    if(rows.length)return {rows,radius,expanded:radius>5};
  }
  return {rows:all,radius:50,expanded:true};
}
