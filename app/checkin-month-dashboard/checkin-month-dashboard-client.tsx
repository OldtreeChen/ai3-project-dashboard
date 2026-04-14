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

type LeaveEntry = { leave_type: string | null; leave_hours: number };

type PersonRow = {
  person_id: string;
  display_name: string;
  department_id: string | null;
  days: Record<string, CiDay>;
  total_checkin_days: number;
  total_late_count: number;
  leaves?: Record<string, LeaveEntry[]>;
};

type SummaryResponse = {
  month: string;
  allDays: string[];
  workdays: string[];
  holidays?: Record<string, string>;
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

const LEAVE_ABBR: Record<string, string> = {
  'Annual Leave': '年假',
  'Sick Leave': '病假',
  'Personal Leave': '事假',
  'Compensatory Leave': '補假',
  'Offical Leave': '公假',
  'Birthday Leave': '生日假',
  '生日假': '生日假',
  'Maternity Leave': '產假',
  'Paternity Leave': '陪產假',
  'Family care Leave': '家照假',
  'Funeral Leave': '喪假',
  'Marriage Leave': '婚假',
  'Menstrual Leave': '生理假',
  'Physiological Leave': '生理假',
  'Seized fake': '補休',
  'Seized Leave': '補休',
  'Home Leave': '居家假',
  'Inductrial injury Leave': '工傷假',
  '疫苗接種假': '疫苗假',
  '防疫照顧假': '防疫假',
};

function leaveAbbr(type: string | null): string {
  if (!type) return '假';
  return LEAVE_ABBR[type] || type;
}

function getDayLeaveInfo(leaves: LeaveEntry[] | undefined): { hasLeave: boolean; isFullDay: boolean; label: string; tipText: string } {
  if (!leaves || leaves.length === 0) return { hasLeave: false, isFullDay: false, label: '', tipText: '' };
  const totalHours = leaves.reduce((s, l) => s + l.leave_hours, 0);
  const isFullDay = totalHours >= 8;
  const types = [...new Set(leaves.map((l) => leaveAbbr(l.leave_type)))];
  const label = types.join('/');
  const tipText = `請假: ${label} (${totalHours}h)`;
  return { hasLeave: true, isFullDay, label, tipText };
}

export default function CheckinMonthDashboardClient() {
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
    let totalCheckinDays = 0;
    let totalLateDays = 0;
    let totalLeaveDays = 0;
    let expectedDays = 0;
    for (const p of people) {
      for (const d of pastWorkdays) {
        const ci = p.days[d];
        const { hasLeave, isFullDay } = getDayLeaveInfo(p.leaves?.[d]);
        if (ci) {
          totalCheckinDays++;
          if (ci.late_minutes != null && ci.late_minutes > 0 && !hasLeave) totalLateDays++;
          expectedDays++;
        } else if (hasLeave && isFullDay) {
          totalLeaveDays++;
          // full-day leave: not counted in expected checkin days
        } else {
          expectedDays++;
        }
      }
    }
    const missingDays = expectedDays - totalCheckinDays;
    const checkinRate = expectedDays > 0 ? (totalCheckinDays / expectedDays) * 100 : 100;
    return { count, totalCheckinDays, totalLateDays, totalLeaveDays, expectedDays, missingDays, checkinRate };
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
      const data = await apiGet<SummaryResponse>(`/api/checkin-month/summary${q}`);
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
          <div className="brand__title">{deptLabel ? `${deptLabel}　月度出勤打卡追蹤` : '月度出勤打卡追蹤'}</div>
          <div className="brand__sub">追蹤每人每日打卡紀錄、上下班時間與遲到狀況（以上班日為基準）</div>
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
              <div className="summary-strip__item">
                <div className="summary-strip__label">請假天數</div>
                <div className="summary-strip__value">
                  <span style={{ color: 'var(--primary)' }}>{totals.totalLeaveDays}</span>
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
                <span className="att-dot att-dot--weekend" style={{ marginLeft: 8 }} /> 假日
                <span style={{ marginLeft: 8, display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(96,165,250,0.5)', verticalAlign: 'middle' }} /> 請假
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
                    {allDays.map((d) => {
                      const hol = holidays[d];
                      const isOff = !workdaySet.has(d);
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
                      const missCount = pastWorkdays.filter((d) => {
                        if (p.days[d]) return false;
                        const { hasLeave, isFullDay } = getDayLeaveInfo(p.leaves?.[d]);
                        return !(hasLeave && isFullDay);
                      }).length;
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
                          {allDays.map((d) => {
                            const ci = p.days[d];
                            const past = isPast(d) || isToday(d);
                            const isWork = workdaySet.has(d);
                            const isOff = !isWork;
                            const hol = holidays[d];
                            const { hasLeave, isFullDay, label: leaveLabel, tipText: leaveTip } = getDayLeaveInfo(p.leaves?.[d]);

                            let cls = 'att-cell';
                            if (isOff) {
                              cls += ci ? ' att-cell--weekend-has' : ' att-cell--weekend';
                            } else if (!past) {
                              cls += ' att-cell--future';
                            } else if (ci) {
                              const isLate = ci.late_minutes != null && ci.late_minutes > 0;
                              if (isLate && hasLeave) {
                                cls += ' att-cell--leave';
                              } else if (isLate) {
                                cls += ' att-cell--partial';
                              } else {
                                cls += ' att-cell--ok';
                              }
                            } else if (hasLeave && isFullDay) {
                              cls += ' att-cell--leave';
                            } else if (hasLeave) {
                              cls += ' att-cell--leave-partial';
                            } else {
                              cls += ' att-cell--miss';
                            }

                            // Tooltip
                            const tipParts = [p.display_name, `${d} (${weekdayLabel(d)})`];
                            if (hol) tipParts.push(hol);
                            if (leaveTip) tipParts.push(leaveTip);
                            if (ci) {
                              if (ci.clock_in) tipParts.push(`上班: ${ci.clock_in}`);
                              if (ci.clock_out) tipParts.push(`下班: ${ci.clock_out}`);
                              if (ci.late_minutes && ci.late_minutes > 0) tipParts.push(`遲到 ${ci.late_minutes} 分鐘`);
                              if (ci.leave_early_minutes && ci.leave_early_minutes > 0) tipParts.push(`早退 ${ci.leave_early_minutes} 分鐘`);
                              tipParts.push(`打卡 ${ci.punch_count} 次`);
                            } else {
                              tipParts.push(isOff ? (hol || '假日') : past ? (hasLeave ? '' : '未打卡') : '未到');
                            }

                            // Cell content
                            let content: React.ReactNode = '';
                            if (ci) {
                              if (ci.late_minutes && ci.late_minutes > 0 && hasLeave) {
                                content = leaveLabel;
                              } else if (ci.late_minutes && ci.late_minutes > 0) {
                                content = `遲${ci.late_minutes}`;
                              } else if (ci.clock_in) {
                                content = ci.clock_in;
                              } else {
                                content = 'V';
                              }
                            } else if (hasLeave && isWork && past) {
                              content = leaveLabel;
                            } else if (isWork && past) {
                              content = '--';
                            }

                            return (
                              <td
                                key={d}
                                className={`${cls}${isToday(d) ? ' att-table__day--today' : ''}`}
                                title={tipParts.filter(Boolean).join('\n')}
                              >
                                <div style={{ fontSize: 10, lineHeight: 1.3 }}>
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
