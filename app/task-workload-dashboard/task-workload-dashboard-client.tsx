'use client';

import { useEffect, useMemo, useState } from 'react';
import TopMenu from '../_components/TopMenu';

type Department = { id: string | number; name: string };

type TaskChunk = {
  task_id: string;
  task_name: string;
  project_code: string | null;
  project_name: string | null;
  hours: number;
};

type DayLoad = {
  hours: number;
  tasks: TaskChunk[];
};

type PersonRecord = {
  person_id: string;
  display_name: string;
  total_month_hours: number;
  task_count: number;
  days: Record<string, DayLoad>;
};

type WorkloadResponse = {
  month: string;
  allDays: string[];
  workdays: string[];
  holidays?: Record<string, string>;
  workday_count: number;
  people: PersonRecord[];
};

function toMonthValue(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
  return res.json() as Promise<T>;
}

function dayLabel(dateStr: string) {
  return String(Number(dateStr.slice(8, 10)));
}

function weekdayLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()] || '';
}

function isWeekend(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00').getDay();
  return d === 0 || d === 6;
}

function isToday(dateStr: string) {
  const now = new Date();
  return dateStr === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Return background + text color based on daily load hours */
function loadCellStyle(hours: number): React.CSSProperties {
  if (hours <= 0) return {};
  // Thresholds: 0~2 faint, 2~4 light, 4~6 medium, 6~8 warm, 8~10 orange, >10 red
  if (hours <= 2) return { background: 'rgba(74,222,128,0.12)', color: 'rgba(74,222,128,0.70)' };
  if (hours <= 4) return { background: 'rgba(74,222,128,0.22)', color: 'rgba(74,222,128,0.90)' };
  if (hours <= 6) return { background: 'rgba(251,191,36,0.18)', color: 'rgba(251,191,36,0.90)' };
  if (hours <= 8) return { background: 'rgba(251,191,36,0.30)', color: 'rgba(251,191,36,1.00)' };
  if (hours <= 10) return { background: 'rgba(251,146,60,0.30)', color: 'rgba(251,146,60,1.00)' };
  return { background: 'rgba(251,113,133,0.30)', color: 'rgba(251,113,133,1.00)' };
}

/** Colour band label for legend */
const LEGEND = [
  { label: '1–2h', style: { background: 'rgba(74,222,128,0.12)', color: 'rgba(74,222,128,0.70)' } },
  { label: '2–4h', style: { background: 'rgba(74,222,128,0.22)', color: 'rgba(74,222,128,0.90)' } },
  { label: '4–6h', style: { background: 'rgba(251,191,36,0.18)', color: 'rgba(251,191,36,0.90)' } },
  { label: '6–8h', style: { background: 'rgba(251,191,36,0.30)', color: 'rgba(251,191,36,1.00)' } },
  { label: '8–10h', style: { background: 'rgba(251,146,60,0.30)', color: 'rgba(251,146,60,1.00)' } },
  { label: '>10h', style: { background: 'rgba(251,113,133,0.30)', color: 'rgba(251,113,133,1.00)' } },
];

export default function TaskWorkloadDashboardClient() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [month, setMonth] = useState(toMonthValue());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [allDays, setAllDays] = useState<string[]>([]);
  const [workdaySet, setWorkdaySet] = useState<Set<string>>(new Set());
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [workdayCount, setWorkdayCount] = useState(0);

  // Totals
  const totals = useMemo(() => {
    const totalPeople = people.length;
    const totalHours = people.reduce((s, p) => s + p.total_month_hours, 0);
    const avgHours = totalPeople > 0 ? totalHours / totalPeople : 0;
    const expectedHours = workdayCount * 8 * 0.8;
    return { totalPeople, totalHours, avgHours, expectedHours };
  }, [people, workdayCount]);

  useEffect(() => {
    (async () => {
      try {
        const ds = await apiGet<Department[]>('/api/departments');
        setDepartments(ds);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const q = buildQuery({ month, departmentId });
      const data = await apiGet<WorkloadResponse>(`/api/task-workload/summary${q}`);
      setAllDays(data.allDays || []);
      setWorkdaySet(new Set(data.workdays || []));
      setHolidays(data.holidays || {});
      setPeople(data.people || []);
      setWorkdayCount(data.workday_count || 0);
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
          <div className="brand__title">任務負載分析</div>
          <div className="brand__sub">將任務預估時數依工作日均攤，顯示每人每日的任務負載量</div>
          <TopMenu />
        </div>
      </header>

      <main className="content content--wide">
        {/* Filters */}
        <div className="filters filters--center" style={{ marginBottom: 12 }}>
          <label className="field">
            <span className="field__label">部門</span>
            <select className="field__control" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">全部</option>
              {departments.map((d) => (
                <option key={String(d.id)} value={String(d.id)}>{d.name}</option>
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
          <span className="badge" style={{ marginLeft: 6 }}>上班日 {workdayCount} 天</span>
        </div>

        {/* Summary strip */}
        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panel__header">
            <div className="panel__title">當月負載概況</div>
            <div className="panel__meta">{totals.totalPeople} 位</div>
          </div>
          <div className="panel__body">
            <div className="summary-strip">
              <div className="summary-strip__item">
                <div className="summary-strip__label">人員數</div>
                <div className="summary-strip__value">{totals.totalPeople}</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">應完成工時（×0.8）</div>
                <div className="summary-strip__value">{totals.expectedHours.toFixed(0)} h</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">總任務負載時數</div>
                <div className="summary-strip__value" style={{ color: 'var(--primary)' }}>
                  {totals.totalHours.toFixed(1)} h
                </div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">人均負載</div>
                <div className="summary-strip__value">
                  <span style={{
                    color: totals.avgHours > totals.expectedHours
                      ? 'var(--bad)'
                      : totals.avgHours > totals.expectedHours * 0.8
                      ? 'var(--warn)'
                      : 'var(--good)',
                  }}>
                    {totals.avgHours.toFixed(1)} h
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <section className="panel" style={{ marginBottom: 12 }}>
            <div className="panel__body">
              <span className="badge badge--bad">錯誤：{error}</span>
            </div>
          </section>
        )}

        {/* Workload calendar grid */}
        <section className="panel">
          <div className="panel__header">
            <div className="panel__title">每日任務負載（工作日均攤）</div>
            <div className="panel__meta" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {loading ? '載入中…' : `${people.length} 位`}
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {LEGEND.map((l) => (
                  <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ ...l.style, display: 'inline-block', width: 28, height: 14, borderRadius: 3, fontSize: 9, textAlign: 'center', lineHeight: '14px', fontWeight: 600 }}>
                      {l.label.replace('h', '')}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{l.label}</span>
                  </span>
                ))}
              </span>
            </div>
          </div>
          <div className="panel__body" style={{ padding: 0 }}>
            <div className="att-scroll">
              <table className="table att-table">
                <thead>
                  <tr>
                    <th className="att-table__sticky-name">人員</th>
                    <th className="att-table__sticky-days num" style={{ minWidth: 52 }}>月合計</th>
                    <th className="att-table__sticky-hours num">任務數</th>
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
                  {people.length ? people.map((p) => (
                    <tr key={p.person_id}>
                      {/* Name */}
                      <td className="att-table__sticky-name" title={p.display_name}>
                        {p.display_name}
                      </td>
                      {/* Month total */}
                      <td className="att-table__sticky-days num" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                        {p.total_month_hours.toFixed(1)}
                      </td>
                      {/* Task count */}
                      <td className="att-table__sticky-hours num" style={{ color: 'var(--muted)' }}>
                        {p.task_count}
                      </td>
                      {/* Day cells */}
                      {allDays.map((d) => {
                        const isWork = workdaySet.has(d);
                        const hol = holidays[d];
                        const dayData = p.days[d];
                        const hours = dayData?.hours ?? 0;

                        if (!isWork) {
                          return (
                            <td
                              key={d}
                              className={`att-cell att-cell--weekend${isToday(d) ? ' att-table__day--today' : ''}`}
                              title={hol || weekdayLabel(d)}
                            />
                          );
                        }

                        const cellStyle = loadCellStyle(hours);
                        const tipLines = [p.display_name, `${d} (${weekdayLabel(d)})`];
                        if (hours > 0 && dayData?.tasks) {
                          tipLines.push(`合計 ${hours.toFixed(1)}h`);
                          for (const t of dayData.tasks) {
                            const proj = t.project_code ? `[${t.project_code}] ` : t.project_name ? `[${t.project_name}] ` : '';
                            tipLines.push(`• ${proj}${t.task_name}（${t.hours}h）`);
                          }
                        } else {
                          tipLines.push('無任務');
                        }

                        return (
                          <td
                            key={d}
                            className={`att-cell${isToday(d) ? ' att-table__day--today' : ''}`}
                            style={cellStyle}
                            title={tipLines.join('\n')}
                          >
                            {hours > 0 ? (
                              <div style={{ fontSize: 10, lineHeight: 1.2, fontWeight: 600 }}>
                                {hours.toFixed(1)}
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={3 + allDays.length} className="muted" style={{ textAlign: 'center' }}>
                        {loading ? '載入中…' : '尚無資料'}
                      </td>
                    </tr>
                  )}
                </tbody>
                {/* Totals footer */}
                {people.length > 0 && (
                  <tfoot>
                    <tr className="ps-row--total">
                      <td className="att-table__sticky-name" style={{ fontWeight: 700 }}>合計</td>
                      <td className="att-table__sticky-days num" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                        {people.reduce((s, p) => s + p.total_month_hours, 0).toFixed(1)}
                      </td>
                      <td className="att-table__sticky-hours num" style={{ color: 'var(--muted)' }}>
                        {people.reduce((s, p) => s + p.task_count, 0)}
                      </td>
                      {allDays.map((d) => {
                        if (!workdaySet.has(d)) return <td key={d} className="att-cell att-cell--weekend" />;
                        const total = people.reduce((s, p) => s + (p.days[d]?.hours ?? 0), 0);
                        const avg = people.length > 0 ? total / people.length : 0;
                        const style = loadCellStyle(avg);
                        return (
                          <td
                            key={d}
                            className={`att-cell${isToday(d) ? ' att-table__day--today' : ''}`}
                            style={style}
                            title={`${d}\n全員合計 ${total.toFixed(1)}h\n人均 ${avg.toFixed(1)}h`}
                          >
                            {avg > 0 ? (
                              <div style={{ fontSize: 10, lineHeight: 1.2, fontWeight: 600 }}>
                                {avg.toFixed(1)}
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
