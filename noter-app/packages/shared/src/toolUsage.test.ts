import { applyToolUsage, toolUsageSummary, toolUsageLabel, totalToolCalls, emptyToolRecord, type ToolUsageState } from './toolUsage';

describe('applyToolUsage', () => {
  it('increments day/month/total and rolls buckets when the date advances', () => {
    let r = applyToolUsage(undefined, '2026-06-14', '2026-06');
    expect(r).toMatchObject({ countDay: 1, countMonth: 1, total: 1 });
    r = applyToolUsage(r, '2026-06-14', '2026-06');
    expect(r).toMatchObject({ countDay: 2, countMonth: 2, total: 2 });
    // next day, same month → day resets, month + total keep growing
    r = applyToolUsage(r, '2026-06-15', '2026-06');
    expect(r).toMatchObject({ countDay: 1, countMonth: 3, total: 3 });
    // next month → both day + month reset, total keeps growing
    r = applyToolUsage(r, '2026-07-01', '2026-07');
    expect(r).toMatchObject({ countDay: 1, countMonth: 1, total: 4 });
  });
});

describe('toolUsageSummary', () => {
  it('returns most-used-first with stale buckets zeroed', () => {
    const state: ToolUsageState = {
      create_task: { day: '2026-06-14', month: '2026-06', countDay: 3, countMonth: 5, total: 20 },
      get_note: { day: '2026-06-13', month: '2026-06', countDay: 9, countMonth: 4, total: 8 }, // stale day
    };
    const rows = toolUsageSummary(state, '2026-06-14', '2026-06');
    expect(rows.map((r) => r.tool)).toEqual(['create_task', 'get_note']); // by total desc
    expect(rows[1].countDay).toBe(0); // get_note's day bucket is stale → 0
    expect(rows[1].countMonth).toBe(4); // month still current
  });
});

describe('labels + totals', () => {
  it('labels known tools and falls back to the raw name', () => {
    expect(toolUsageLabel('create_task')).toBe('Skapa uppgift');
    expect(toolUsageLabel('mcp_call_tool')).toBe('Anropa MCP-verktyg');
    expect(toolUsageLabel('something_new')).toBe('something_new');
  });
  it('totalToolCalls sums all-time counts', () => {
    expect(totalToolCalls({ a: emptyToolRecord('d', 'm'), b: { ...emptyToolRecord('d', 'm'), total: 7 } })).toBe(7);
  });
});
