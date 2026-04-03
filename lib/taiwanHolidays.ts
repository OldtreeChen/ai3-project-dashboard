/**
 * Taiwan government holiday calendar from 人事行政總處
 * Data source: https://github.com/ruyut/TaiwanCalendar
 */

type CalendarDay = {
  date: string;       // YYYYMMDD
  week: string;
  isHoliday: boolean;
  description: string;
};

type HolidayInfo = {
  isHoliday: boolean;
  description: string;
};

// In-memory cache: year -> Map<'YYYY-MM-DD', HolidayInfo>
const cache = new Map<number, Map<string, HolidayInfo>>();

const CDN_URL = 'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data';

async function fetchYear(year: number): Promise<Map<string, HolidayInfo>> {
  if (cache.has(year)) return cache.get(year)!;

  const map = new Map<string, HolidayInfo>();
  try {
    const res = await fetch(`${CDN_URL}/${year}.json`, {
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 86400 }, // cache for 24 hours
    });
    if (!res.ok) {
      console.warn(`Failed to fetch Taiwan holidays for ${year}: ${res.status}`);
      cache.set(year, map);
      return map;
    }
    const data: CalendarDay[] = await res.json();
    for (const d of data) {
      // Convert YYYYMMDD -> YYYY-MM-DD
      const iso = `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`;
      map.set(iso, { isHoliday: d.isHoliday, description: d.description });
    }
  } catch (err) {
    console.warn(`Error fetching Taiwan holidays for ${year}:`, err);
  }
  cache.set(year, map);
  return map;
}

/**
 * Get all days in a month as YYYY-MM-DD strings.
 */
function getAllDaysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const lastDay = new Date(year, month, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

/**
 * Get workdays for a given month, excluding official Taiwan government holidays.
 * Falls back to simple Mon-Fri if holiday data is unavailable.
 */
export async function getWorkdays(year: number, month: number): Promise<string[]> {
  const allDays = getAllDaysInMonth(year, month);
  const holidays = await fetchYear(year);

  if (holidays.size === 0) {
    // Fallback: simple weekday filter
    return allDays.filter((ds) => {
      const dow = new Date(ds + 'T00:00:00').getDay();
      return dow !== 0 && dow !== 6;
    });
  }

  return allDays.filter((ds) => {
    const info = holidays.get(ds);
    if (info) return !info.isHoliday;
    // If date not in calendar data, use weekday logic as fallback
    const dow = new Date(ds + 'T00:00:00').getDay();
    return dow !== 0 && dow !== 6;
  });
}

/**
 * Get holiday map for a given month.
 * Returns Map<'YYYY-MM-DD', { isHoliday, description }> for days with description only.
 * Used by frontend to display holiday labels.
 */
export async function getHolidayMap(year: number, month: number): Promise<Record<string, string>> {
  const holidays = await fetchYear(year);
  const allDays = getAllDaysInMonth(year, month);
  const result: Record<string, string> = {};

  for (const ds of allDays) {
    const info = holidays.get(ds);
    if (info && info.isHoliday) {
      result[ds] = info.description || '';
    }
  }
  return result;
}
