'use client';

import { useEffect, useMemo, useState } from 'react';
import TopMenu from '../_components/TopMenu';

type DepartmentId = string | number;
type Department = { id: DepartmentId; name: string };

type CiDay = {
  clock_in: string | null;
  clock_out: string | null;
  late_minutes: number | null;
  leave_early_minutes: number | null;
  punch_count: number;
};

type PersonRow = {
  person_id: string;
  display_name: string;
  department_id: string | null;
  days: Record<string, CiDay>;
  total_checkin_days: number;
  total_late_count: number;
};

type SummaryResponse = {
  month: string;
  workdays: string[];
  people: PersonRow[];
};

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

export default function CheckinMonthDashboardClient() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string>('');
  const [month, setMonth] = useState<string>(toMonthValue());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [workdays, setWorkdays] = useState<string[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);

  const workdayCount = workdays.length;
  const pastWorkdays = useMemo(() => workdays.filter((d) => isPast(d) || isToday(d)), [workdays]);

  const totals = useMemo(() => {
    const count = people.length;
    const totalCheckinDays = people.reduce((acc, p) => acc + p.total_checkin_days, 0);
    const totalLateDays = people.reduce((acc, p) => acc + p.total_late_count, 0);
    const expectedDays = count * pastWorkdays.length;
    const missingDays = expectedDays - totalCheckinDays;
    const checkinRate = expectedDays > 0 ? (totalCheckinDays / expectedDays) * 100 : 100;
    return { count, totalCheckinDays, totalLateDays, expectedDays, missingDays, checkinRate };
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
      const data = await apiGet<SummaryResponse>(`/api/checkin-month/summary${q}`);
      setWorkdays(data.workdays || []);
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
  }, [departmentId, month]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">月度出勤打卡追蹤</div>
          <div className="brand__sub">追蹤每人每日打卡紀錄、上下班時間與遲到狀況（以上班日為基準）</div>
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

        {/* Summary */}
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
              <div className="summary-strip__item">
                <div className="summary-strip__label">已打卡天數</div>
                <div className="summary-strip__value">{totals.totalCheckinDays}</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">缺卡天數</div>
                <div className="summary-strip__value">
                  {totals.missingDays > 0 ? (
                    <span className="badge badge--bad">{totals.missingDays}</span>
                  ) : (
                    <span className="badge badge--good">0</span>
                  )}
                </div>
              </div>
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
              <div className="summary-strip__item">
                <div className="summary-strip__label">遲到天數</div>
                <div className="summary-strip__value">
                  {totals.totalLateDays > 0 ? (
                    <span className="badge badge--warn">{totals.totalLateDays}</span>
                  ) : (
                    <span className="badge badge--good">0</span>
                  )}
                </div>
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
            <div className="panel__title">每日打卡狀況</div>
            <div className="panel__meta">
              {loading ? '載入中…' : `${people.length} 位`}
              <span style={{ marginLeft: 12 }}>
                <span className="att-dot att-dot--ok" /> 正常
                <span className="att-dot att-dot--partial" style={{ marginLeft: 8 }} /> 遲到
                <span className="att-dot att-dot--miss" style={{ marginLeft: 8 }} /> 缺卡
                <span className="att-dot att-dot--future" style={{ marginLeft: 8 }} /> 未到
              </span>
            </div>
          </div>
          <div className="panel__body" style={{ padding: 0 }}>
            <div className="att-scroll">
              <table className="table att-table">
                <thead>
                  <tr>
                    <th className="att-table__sticky-name">人員</th>
                    <th className="att-table__sticky-days num">打卡天</th>
                    <th className="att-table__sticky-hours num">遲到</th>
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
                      const missCount = pastWorkdays.filter((d) => !p.days[d]).length;
                      return (
                        <tr key={p.person_id}>
                          <td className="att-table__sticky-name" title={p.display_name}>
                            {p.display_name}
                            {missCount > 0 ? (
                              <span className="badge badge--bad" style={{ marginLeft: 4, fontSize: 10, padding: '0 4px' }}>
                                缺{missCount}
                              </span>
                            ) : null}
                            {p.total_late_count > 0 ? (
                              <span className="badge badge--warn" style={{ marginLeft: 4, fontSize: 10, padding: '0 4px' }}>
                                遲{p.total_late_count}
                              </span>
                            ) : null}
                          </td>
                          <td className="att-table__sticky-days num">
                            {p.total_checkin_days}/{pastWorkdays.length}
                          </td>
                          <td className="att-table__sticky-hours num">
                            {p.total_late_count > 0 ? (
                              <span className="badge badge--warn">{p.total_late_count}</span>
                            ) : (
                              '0'
                            )}
                          </td>
                          {workdays.map((d) => {
                            const ci = p.days[d];
                            const past = isPast(d) || isToday(d);
                            let cls = 'att-cell';
                            if (!past) {
                              cls += ' att-cell--future';
                            } else if (ci) {
                              const isLate = ci.late_minutes != null && ci.late_minutes > 0;
                              cls += isLate ? ' att-cell--partial' : ' att-cell--ok';
                            } else {
                              cls += ' att-cell--miss';
                            }

                            // Tooltip
                            const tipParts = [p.display_name, d];
                            if (ci) {
                              if (ci.clock_in) tipParts.push(`上班: ${ci.clock_in}`);
                              if (ci.clock_out) tipParts.push(`下班: ${ci.clock_out}`);
                              if (ci.late_minutes && ci.late_minutes > 0) tipParts.push(`遲到 ${ci.late_minutes} 分鐘`);
                              if (ci.leave_early_minutes && ci.leave_early_minutes > 0) tipParts.push(`早退 ${ci.leave_early_minutes} 分鐘`);
                              tipParts.push(`打卡 ${ci.punch_count} 次`);
                            } else {
                              tipParts.push(past ? '未打卡' : '未到');
                            }

                            // Cell content
                            let content = '';
                            if (!past) {
                              content = '';
                            } else if (ci) {
                              if (ci.late_minutes && ci.late_minutes > 0) {
                                content = `遲${ci.late_minutes}`;
                              } else if (ci.clock_in) {
                                content = ci.clock_in;
                              } else {
                                content = 'V';
                              }
                            } else {
                              content = '--';
                            }

                            return (
                              <td
                                key={d}
                                className={`${cls}${isToday(d) ? ' att-table__day--today' : ''}`}
                                title={tipParts.join('\n')}
                              >
                                <div style={{ fontSize: ci?.late_minutes && ci.late_minutes > 0 ? 10 : 11, lineHeight: 1.3 }}>
                                  {content}
                                </div>
                                {ci && ci.clock_out && past ? (
                                  <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1 }}>
                                    {ci.clock_out}
                                  </div>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={3 + workdays.length} className="muted" style={{ textAlign: 'center' }}>
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
