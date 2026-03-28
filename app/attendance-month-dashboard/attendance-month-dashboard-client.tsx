'use client';

import { useEffect, useMemo, useState } from 'react';
import TopMenu from '../_components/TopMenu';

type DepartmentId = string | number;
type Department = { id: DepartmentId; name: string };

type DayInfo = {
  hours: number;
  checked_in: boolean;
  clock_in: string | null;
  clock_out: string | null;
  late_minutes: number | null;
};

type PersonRow = {
  person_id: string;
  display_name: string;
  department_id: string | null;
  days: Record<string, DayInfo | number>; // DayInfo (new) or number (legacy)
  total_reported_days: number;
  total_hours: number;
  total_checkin_days: number;
};

type SummaryResponse = {
  month: string;
  workdays: string[];
  has_checkin: boolean;
  people: PersonRow[];
};

/** Normalize day value to DayInfo */
function dayInfo(v: DayInfo | number | undefined): DayInfo {
  if (!v) return { hours: 0, checked_in: false, clock_in: null, clock_out: null, late_minutes: null };
  if (typeof v === 'number') return { hours: v, checked_in: false, clock_in: null, clock_out: null, late_minutes: null };
  return v;
}

function fmtHours(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

function fmtTime(v: string | null) {
  if (!v) return '';
  // v might be "HH:MM:SS" or "HH:MM:SS.sss"
  return v.slice(0, 5);
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
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string>('');
  const [month, setMonth] = useState<string>(toMonthValue());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [workdays, setWorkdays] = useState<string[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [hasCheckin, setHasCheckin] = useState(false);

  const workdayCount = workdays.length;
  const pastWorkdays = useMemo(() => workdays.filter((d) => isPast(d) || isToday(d)), [workdays]);

  const totals = useMemo(() => {
    const count = people.length;
    const totalHours = people.reduce((acc, p) => acc + p.total_hours, 0);
    const totalReportedDays = people.reduce((acc, p) => acc + p.total_reported_days, 0);
    const totalCheckinDays = people.reduce((acc, p) => acc + (p.total_checkin_days || 0), 0);
    const expectedDays = count * pastWorkdays.length;
    const missingDays = expectedDays - totalReportedDays;
    const missingCheckinDays = expectedDays - totalCheckinDays;
    const complianceRate = expectedDays > 0 ? (totalReportedDays / expectedDays) * 100 : 100;
    const checkinRate = expectedDays > 0 ? (totalCheckinDays / expectedDays) * 100 : 100;
    return { count, totalHours, totalReportedDays, totalCheckinDays, expectedDays, missingDays, missingCheckinDays, complianceRate, checkinRate };
  }, [people, pastWorkdays]);

  useEffect(() => {
    (async () => {
      try {
        const ds = await apiGet<Department[]>('/api/departments');
        setDepartments(ds);
      } catch (e: any) {
        setError(e?.message || '載入部門失敗');
      }
    })();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const q = buildQuery({ month, departmentId });
      const data = await apiGet<SummaryResponse>(`/api/attendance-month/summary${q}`);
      setWorkdays(data.workdays || []);
      setPeople(data.people || []);
      setHasCheckin(data.has_checkin ?? false);
    } catch (e: any) {
      setError(e?.message || '查詢失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, month]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">月度出勤與工時追蹤</div>
          <div className="brand__sub">追蹤每人每日打卡狀況、工時填寫及時數（以上班日為基準）</div>
          <TopMenu />
        </div>
      </header>

      <main className="content content--wide">
        <div className="filters filters--center" style={{ marginBottom: 12 }}>
          <label className="field">
            <span className="field__label">部門</span>
            <select className="field__control" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">全部</option>
              {departments.map((d) => (
                <option key={String(d.id)} value={String(d.id)}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
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

        {/* Summary strip */}
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
                <div className="summary-strip__label">應出勤天數（截至今日）</div>
                <div className="summary-strip__value">{totals.expectedDays}</div>
              </div>
              {hasCheckin && (
                <div className="summary-strip__item">
                  <div className="summary-strip__label">已打卡天數</div>
                  <div className="summary-strip__value">
                    {totals.totalCheckinDays}
                    {totals.missingCheckinDays > 0 && (
                      <span className="badge badge--bad" style={{ marginLeft: 6, fontSize: 11 }}>
                        缺{totals.missingCheckinDays}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {hasCheckin && (
                <div className="summary-strip__item">
                  <div className="summary-strip__label">打卡率</div>
                  <div className="summary-strip__value">
                    {totals.checkinRate >= 100 ? (
                      <span className="badge badge--good">100%</span>
                    ) : totals.checkinRate >= 80 ? (
                      <span className="badge badge--warn">{totals.checkinRate.toFixed(1)}%</span>
                    ) : (
                      <span className="badge badge--bad">{totals.checkinRate.toFixed(1)}%</span>
                    )}
                  </div>
                </div>
              )}
              <div className="summary-strip__item">
                <div className="summary-strip__label">已填工時天數</div>
                <div className="summary-strip__value">{totals.totalReportedDays}</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">缺填工時天數</div>
                <div className="summary-strip__value">
                  {totals.missingDays > 0 ? (
                    <span className="badge badge--bad">{totals.missingDays}</span>
                  ) : (
                    <span className="badge badge--good">0</span>
                  )}
                </div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">工時填報率</div>
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

        {/* Calendar grid */}
        <section className="panel">
          <div className="panel__header">
            <div className="panel__title">每日出勤與工時狀況</div>
            <div className="panel__meta">
              {loading ? '載入中…' : `${people.length} 位`}
              <span style={{ marginLeft: 12 }}>
                <span className="att-dot att-dot--ok" /> 已填8h+
                <span className="att-dot att-dot--partial" style={{ marginLeft: 8 }} /> 已填&lt;8h
                <span className="att-dot att-dot--miss" style={{ marginLeft: 8 }} /> 未填
                <span className="att-dot att-dot--future" style={{ marginLeft: 8 }} /> 未到
                {hasCheckin && (
                  <>
                    <span style={{ marginLeft: 12, fontSize: 11, color: '#4caf50' }}>C</span>
                    <span style={{ marginLeft: 2 }}>=打卡</span>
                  </>
                )}
              </span>
            </div>
          </div>
          <div className="panel__body" style={{ padding: 0 }}>
            <div className="att-scroll">
              <table className="table att-table">
                <thead>
                  <tr>
                    <th className="att-table__sticky-name">人員</th>
                    {hasCheckin && <th className="att-table__sticky-checkin num">打卡天</th>}
                    <th className="att-table__sticky-days num">填報天</th>
                    <th className="att-table__sticky-hours num">總時數</th>
                    {workdays.map((d) => (
                      <th key={d} className={`att-table__day num${isToday(d) ? ' att-table__day--today' : ''}`}>
                        <div>{dayLabel(d)}</div>
                        <div className="att-table__weekday">{weekdayLabel(d)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {people.length ? (
                    people.map((p) => {
                      const missCount = pastWorkdays.filter((d) => {
                        const di = dayInfo(p.days[d]);
                        return di.hours <= 0;
                      }).length;
                      const missCheckinCount = hasCheckin
                        ? pastWorkdays.filter((d) => {
                            const di = dayInfo(p.days[d]);
                            return !di.checked_in;
                          }).length
                        : 0;
                      return (
                        <tr key={p.person_id}>
                          <td className="att-table__sticky-name" title={p.display_name}>
                            {p.display_name}
                            {missCount > 0 ? (
                              <span className="badge badge--bad" style={{ marginLeft: 4, fontSize: 10, padding: '0 4px' }}>
                                缺填{missCount}
                              </span>
                            ) : null}
                            {hasCheckin && missCheckinCount > 0 ? (
                              <span className="badge badge--warn" style={{ marginLeft: 4, fontSize: 10, padding: '0 4px' }}>
                                缺卡{missCheckinCount}
                              </span>
                            ) : null}
                          </td>
                          {hasCheckin && (
                            <td className="att-table__sticky-checkin num">
                              {p.total_checkin_days || 0}/{pastWorkdays.length}
                            </td>
                          )}
                          <td className="att-table__sticky-days num">
                            {p.total_reported_days}/{pastWorkdays.length}
                          </td>
                          <td className="att-table__sticky-hours num">{fmtHours(p.total_hours)}</td>
                          {workdays.map((d) => {
                            const di = dayInfo(p.days[d]);
                            const past = isPast(d) || isToday(d);
                            let cls = 'att-cell';
                            if (!past) {
                              cls += ' att-cell--future';
                            } else if (di.hours > 0) {
                              cls += di.hours >= 8 ? ' att-cell--ok' : ' att-cell--partial';
                            } else {
                              cls += ' att-cell--miss';
                            }

                            // Build tooltip
                            const tipParts = [p.display_name, d];
                            if (hasCheckin) {
                              tipParts.push(di.checked_in ? `打卡: ${fmtTime(di.clock_in) || '?'} ~ ${fmtTime(di.clock_out) || '?'}` : '未打卡');
                              if (di.late_minutes && di.late_minutes > 0) tipParts.push(`遲到${di.late_minutes}分`);
                            }
                            tipParts.push(di.hours > 0 ? `工時: ${fmtHours(di.hours)}h` : past ? '未填工時' : '未到');

                            return (
                              <td
                                key={d}
                                className={`${cls}${isToday(d) ? ' att-table__day--today' : ''}`}
                                title={tipParts.join('\n')}
                              >
                                <div style={{ lineHeight: 1.2 }}>
                                  {di.hours > 0 ? fmtHours(di.hours) : past ? '--' : ''}
                                </div>
                                {hasCheckin && past && (
                                  <div style={{ fontSize: 9, lineHeight: 1, marginTop: 1 }}>
                                    {di.checked_in ? (
                                      <span style={{ color: '#4caf50', fontWeight: 600 }}>C</span>
                                    ) : (
                                      <span style={{ color: '#e53935' }}>X</span>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={3 + (hasCheckin ? 1 : 0) + workdays.length} className="muted" style={{ textAlign: 'center' }}>
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
