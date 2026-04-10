'use client';

import { useEffect, useMemo, useState } from 'react';
import TopMenu from '../_components/TopMenu';

type DepartmentId = string | number;
type Department = { id: DepartmentId; name: string };

type PersonRow = {
  person_id: string;
  display_name: string;
  department_id: string | null;
  days: Record<string, number>;
  total_reported_days: number;
  total_hours: number;
};

type SummaryResponse = {
  month: string;
  allDays: string[];
  workdays: string[];
  holidays?: Record<string, string>; // date -> description
  people: PersonRow[];
};

function fmtHours(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

function toMonthValue(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function buildQuery(params: Record<string, string | number | null | undefined>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return (await res.json()) as T;
}

function dayLabel(dateStr: string) {
  return String(Number(dateStr.slice(8, 10)));
}

function weekdayLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const map = ['日', '一', '二', '三', '四', '五', '六'];
  return map[d.getDay()] || '';
}

function isWeekend(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00').getDay();
  return d === 0 || d === 6;
}

function isToday(dateStr: string) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return dateStr === `${y}-${m}-${d}`;
}

function isPast(dateStr: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return target.getTime() < now.getTime();
}

export default function AttendanceMonthDashboardClient() {
  const [deptLabel, setDeptLabel] = useState<string>('');
  const [month, setMonth] = useState<string>(toMonthValue());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allDays, setAllDays] = useState<string[]>([]);
  const [workdaySet, setWorkdaySet] = useState<Set<string>>(new Set());
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [people, setPeople] = useState<PersonRow[]>([]);

  const workdayCount = useMemo(() => workdaySet.size, [workdaySet]);
  const pastWorkdays = useMemo(
    () => [...workdaySet].filter((d) => isPast(d) || isToday(d)),
    [workdaySet]
  );

  const totals = useMemo(() => {
    const count = people.length;
    const totalHours = people.reduce((acc, p) => acc + p.total_hours, 0);
    const totalReportedDays = people.reduce((acc, p) => acc + p.total_reported_days, 0);
    const expectedDays = count * pastWorkdays.length;
    const missingDays = expectedDays - totalReportedDays;
    const complianceRate = expectedDays > 0 ? (totalReportedDays / expectedDays) * 100 : 100;
    return { count, totalHours, totalReportedDays, expectedDays, missingDays, complianceRate };
  }, [people, pastWorkdays]);

  useEffect(() => {
    apiGet<Department[]>('/api/departments')
      .then((ds) => setDeptLabel(ds.map((d) => d.name).join('、')))
      .catch(() => {});
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const q = buildQuery({ month });
      const data = await apiGet<SummaryResponse>(`/api/attendance-month/summary${q}`);
      setAllDays(data.allDays || data.workdays || []);
      setWorkdaySet(new Set(data.workdays || []));
      setHolidays(data.holidays || {});
      setPeople(data.people || []);
    } catch (e: any) {
      setError(e?.message || '查詢失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">{deptLabel ? `${deptLabel}　月度工時填報追蹤` : '月度工時填報追蹤'}</div>
          <div className="brand__sub">追蹤每人每日是否填寫工時及填報時數（以上班日為基準）</div>
          <TopMenu />
        </div>
      </header>

      <main className="content content--wide">
        <div className="filters filters--center" style={{ marginBottom: 12 }}>
          <label className="field">
            <span className="field__label">月份</span>
            <input className="field__control" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <button className="btn btn--primary" onClick={() => void loadData()} disabled={loading}>
            {loading ? '查詢中…' : '重新整理'}
          </button>
          <span className="badge" style={{ marginLeft: 6 }}>
            上班日 {workdayCount} 天
          </span>
        </div>

        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panel__header">
            <div className="panel__title">當月份合計</div>
            <div className="panel__meta">{totals.count} 位</div>
          </div>
          <div className="panel__body">
            <div className="summary-strip">
              <div className="summary-strip__item">
                <div className="summary-strip__label">人員數</div>
                <div className="summary-strip__value">{totals.count}</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">應填天數（截至今日）</div>
                <div className="summary-strip__value">{totals.expectedDays}</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">已填天數</div>
                <div className="summary-strip__value">{totals.totalReportedDays}</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">缺填天數</div>
                <div className="summary-strip__value">
                  {totals.missingDays > 0 ? (
                    <span className="badge badge--bad">{totals.missingDays}</span>
                  ) : (
                    <span className="badge badge--good">0</span>
                  )}
                </div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">填報率</div>
                <div className="summary-strip__value">
                  {totals.complianceRate >= 100 ? (
                    <span className="badge badge--good">100%</span>
                  ) : totals.complianceRate >= 80 ? (
                    <span className="badge badge--warn">{totals.complianceRate.toFixed(1)}%</span>
                  ) : (
                    <span className="badge badge--bad">{totals.complianceRate.toFixed(1)}%</span>
                  )}
                </div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">總工時</div>
                <div className="summary-strip__value">{fmtHours(totals.totalHours)}h</div>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <section className="panel" style={{ marginBottom: 12 }}>
            <div className="panel__body">
              <span className="badge badge--bad">錯誤：{error}</span>
            </div>
          </section>
        ) : null}

        <section className="panel">
          <div className="panel__header">
            <div className="panel__title">每日工時填報狀況</div>
            <div className="panel__meta">
              {loading ? '載入中…' : `${people.length} 位`}
              <span style={{ marginLeft: 12 }}>
                <span className="att-dot att-dot--ok" /> 已填8h+
                <span className="att-dot att-dot--partial" style={{ marginLeft: 8 }} /> &lt;8h
                <span className="att-dot att-dot--miss" style={{ marginLeft: 8 }} /> 未填
                <span className="att-dot att-dot--future" style={{ marginLeft: 8 }} /> 未到
                <span className="att-dot att-dot--weekend" style={{ marginLeft: 8 }} /> 假日
              </span>
            </div>
          </div>
          <div className="panel__body" style={{ padding: 0 }}>
            <div className="att-scroll">
              <table className="table att-table">
                <thead>
                  <tr>
                    <th className="att-table__sticky-name">人員</th>
                    <th className="att-table__sticky-days num">已填天數</th>
                    <th className="att-table__sticky-hours num">總時數</th>
                    {allDays.map((d) => {
                      const we = isWeekend(d);
                      const hol = holidays[d];
                      const isOff = we || hol !== undefined;
                      return (
                        <th
                          key={d}
                          className={`att-table__day num${isToday(d) ? ' att-table__day--today' : ''}${isOff ? ' att-table__day--weekend' : ''}`}
                          title={hol || undefined}
                        >
                          <div>{dayLabel(d)}</div>
                          <div className="att-table__weekday">{hol ? '假' : weekdayLabel(d)}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {people.length ? (
                    people.map((p) => {
                      const missCount = pastWorkdays.filter((d) => !p.days[d] || p.days[d] <= 0).length;
                      return (
                        <tr key={p.person_id}>
                          <td className="att-table__sticky-name" title={p.display_name}>
                            {p.display_name}
                            {missCount > 0 ? (
                              <span className="badge badge--bad" style={{ marginLeft: 6, fontSize: 10, padding: '0 5px' }}>
                                缺{missCount}
                              </span>
                            ) : null}
                          </td>
                          <td className="att-table__sticky-days num">
                            {p.total_reported_days}/{pastWorkdays.length}
                          </td>
                          <td className="att-table__sticky-hours num">{fmtHours(p.total_hours)}</td>
                          {allDays.map((d) => {
                            const hours = p.days[d] || 0;
                            const past = isPast(d) || isToday(d);
                            const isWork = workdaySet.has(d);
                            const hol = holidays[d];
                            const isOff = !isWork;
                            let cls = 'att-cell';
                            if (isOff) {
                              cls += hours > 0 ? ' att-cell--weekend-has' : ' att-cell--weekend';
                            } else if (!past) {
                              cls += ' att-cell--future';
                            } else if (hours > 0) {
                              cls += hours >= 8 ? ' att-cell--ok' : ' att-cell--partial';
                            } else {
                              cls += ' att-cell--miss';
                            }
                            const tipLabel = isOff ? (hol || '假日') : hours > 0 ? `${fmtHours(hours)}h` : past ? '未填' : '未到';
                            return (
                              <td
                                key={d}
                                className={`${cls}${isToday(d) ? ' att-table__day--today' : ''}`}
                                title={`${p.display_name}｜${d} (${weekdayLabel(d)})｜${tipLabel}`}
                              >
                                {hours > 0 ? fmtHours(hours) : (isWork && past) ? '--' : ''}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={3 + allDays.length} className="muted" style={{ textAlign: 'center' }}>
                        尚無資料
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
