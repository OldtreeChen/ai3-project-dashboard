/**
 * Count Mon–Fri weekdays in [startStr, endStr] inclusive.
 * O(1) formula — no holiday lookup.
 * Returns at least 1 to avoid division-by-zero.
 */
export function countWeekdays(startStr: string, endStr: string): number {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  if (end < start) return 1;
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const fullWeeks = Math.floor(totalDays / 7);
  const remaining = totalDays % 7;
  const startDow = start.getDay();
  let weekdays = fullWeeks * 5;
  for (let i = 0; i < remaining; i++) {
    const dow = (startDow + i) % 7;
    if (dow !== 0 && dow !== 6) weekdays++;
  }
  return Math.max(weekdays, 1);
}

export function toDateStrSafe(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Total calendar days from startStr to endStr (inclusive).
 * Returns at least 1 to avoid division-by-zero.
 */
export function calDaysTotal(startStr: string, endStr: string): number {
  const s = new Date(startStr + 'T00:00:00');
  const e = new Date(endStr + 'T00:00:00');
  if (e < s) return 1;
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

/**
 * Calendar days within a month that overlap with [planStart, planEnd].
 * monthStart  : "YYYY-MM-01" (inclusive)
 * monthEndExcl: "YYYY-MM-01" of next month (exclusive)
 */
export function calDaysInMonth(
  planStart: string,
  planEnd: string,
  monthStart: string,
  monthEndExcl: string,
): number {
  // Convert exclusive month-end to inclusive last day
  const lastDayMs = new Date(monthEndExcl + 'T00:00:00').getTime() - 86400000;
  const monthEndIncl = new Date(lastDayMs).toISOString().slice(0, 10);
  const os = planStart > monthStart ? planStart : monthStart;
  const oe = planEnd < monthEndIncl ? planEnd : monthEndIncl;
  if (os > oe) return 0;
  return calDaysTotal(os, oe);
}
