'use client';

import { useEffect, useMemo, useState } from 'react';
import TopMenu from '../_components/TopMenu';
import { toZhStatus } from '@/lib/statusText';

type DepartmentId = string | number;
type PersonId = string | number;

type Department = { id: DepartmentId; name: string };

type SummaryRow = {
  person_id: PersonId;
  display_name: string;
  department_id: DepartmentId | null;
  task_count: number;
  received_total_hours: number;
  used_hours: number;
  remaining_hours: number;
};

type TaskRow = {
  task_id: PersonId;
  task_name: string;
  task_status: string | null;
  received_at: string | null;
  planned_end_at?: string | null;
  completed_at?: string | null;
  planned_hours: number;
  used_hours: number;
  remaining_hours: number;
  project_id: PersonId | null;
  project_code: string | null;
  project_name: string | null;
};

function fmtHours(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

function fmtDateTime(v: unknown) {
  const s = String(v ?? '').trim();
  if (!s) return '--';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.replace('T', ' ').slice(0, 19);
  return s;
}

function getWorkdaysInMonth(monthValue: string) {
  const m = String(monthValue || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return 0;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]); // 1-12
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || mm < 1 || mm > 12) return 0;
  const daysInMonth = new Date(yyyy, mm, 0).getDate();
  let workdays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(yyyy, mm - 1, d).getDay(); // 0 Sun ... 6 Sat
    if (day === 0 || day === 6) continue;
    workdays++;
  }
  return workdays;
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

export default function DeptPersonMonthDashboardClient() {
  const [deptLabel, setDeptLabel] = useState<string>('');

  const [month, setMonth] = useState<string>(toMonthValue());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<SummaryRow[]>([]);

  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  // 每月應完成工時：上班日 * 8 小時（100%）
  const [workdayCount, setWorkdayCount] = useState(0);
  const expectedHours = useMemo(() => workdayCount * 8, [workdayCount]);

  const totals = useMemo(() => {
    const peopleCount = rows.length;
    const expected_total = expectedHours * peopleCount;
    const received_total = rows.reduce((acc, r) => acc + Number(r.received_total_hours || 0), 0);
    const used_total = rows.reduce((acc, r) => acc + Number(r.used_hours || 0), 0);
    const remaining_total = rows.reduce((acc, r) => acc + Number(r.remaining_hours || 0), 0);
    const gap_total = expected_total - received_total;
    return { peopleCount, expected_total, received_total, gap_total, used_total, remaining_total };
  }, [rows, expectedHours]);

  const chartRows = useMemo(() => {
    // Sort by received hours desc for readability
    return [...rows].sort((a, b) => Number(b.received_total_hours || 0) - Number(a.received_total_hours || 0));
  }, [rows]);

  const chartScaleMax = useMemo(() => {
    const maxReceived = chartRows.reduce((m, r) => Math.max(m, Number(r.received_total_hours || 0)), 0);
    // Bar length should cover either expected or received (whichever is larger) for each person
    return Math.max(expectedHours, maxReceived, 1);
  }, [chartRows, expectedHours]);

  const selectedPerson = useMemo(() => {
    if (!selectedPersonId) return null;
    const hit = rows.find((r) => String(r.person_id) === String(selectedPersonId));
    return hit ? { id: hit.person_id, display_name: hit.display_name } : null;
  }, [rows, selectedPersonId]);

  const closeModal = () => {
    setSelectedPersonId('');
    setTasks([]);
    setTasksError('');
  };

  useEffect(() => {
    apiGet<Department[]>('/api/departments')
      .then((ds) => setDeptLabel(ds.map((d) => d.name).join('、')))
      .catch(() => {});
  }, []);

  const loadSummary = async () => {
    setLoading(true);
    setError('');
    try {
      const q = buildQuery({ month });
      const data = await apiGet<{ people: SummaryRow[]; workday_count?: number }>(`/api/dept-person-month/summary${q}`);
      setRows(data.people || []);
      setWorkdayCount(data.workday_count || getWorkdaysInMonth(month));
      setSelectedPersonId('');
      setTasks([]);
      setTasksError('');
    } catch (e: any) {
      setError(e?.message || '查詢失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const toggleDetails = async (pid: string) => {
    const next = String(pid);
    if (selectedPersonId && String(selectedPersonId) === next) {
      closeModal();
      return;
    }
    setSelectedPersonId(next);
    setTasksLoading(true);
    setTasksError('');
    try {
      const q = buildQuery({ month });
      const data = await apiGet<{ tasks: TaskRow[] }>(`/api/dept-person-month/people/${encodeURIComponent(next)}/tasks${q}`);
      setTasks(data.tasks || []);
    } catch (e: any) {
      setTasksError(e?.message || '載入明細失敗');
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  };

  // Close modal with ESC
  useEffect(() => {
    if (!selectedPersonId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPersonId]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">{deptLabel ? `${deptLabel}　部門 / 人員 任務統計（月）` : '部門 / 人員 任務統計（月）'}</div>
          <div className="brand__sub">依「接收任務月份」篩選，統計每人：接收總時數 / 已執行 / 剩餘</div>
          <TopMenu />
        </div>
      </header>

      <main className="content">
        <div className="filters filters--center" style={{ marginBottom: 12 }}>
          <label className="field">
            <span className="field__label">月份</span>
            <input className="field__control" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <button className="btn btn--primary" onClick={() => void loadSummary()} disabled={loading}>
            {loading ? '查詢中…' : '重新整理'}
          </button>
          <span className="badge" style={{ marginLeft: 6 }}>
            上班日 {workdayCount} 天｜應完成 {fmtHours(expectedHours)}h
          </span>
        </div>

        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panel__header">
            <div className="panel__title">當月份合計</div>
            <div className="panel__meta">{totals.peopleCount} 位</div>
          </div>
          <div className="panel__body">
            <div className="summary-strip">
              <div className="summary-strip__item">
                <div className="summary-strip__label">應完成工時</div>
                <div className="summary-strip__value">{fmtHours(totals.expected_total)}h</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">接收總時數</div>
                <div className="summary-strip__value">{fmtHours(totals.received_total)}h</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">任務缺口</div>
                <div className="summary-strip__value">
                  {totals.gap_total > 0 ? (
                    <span className="badge badge--warn">缺 {fmtHours(totals.gap_total)}h</span>
                  ) : totals.gap_total < 0 ? (
                    <span className="badge badge--good">超出 {fmtHours(Math.abs(totals.gap_total))}h</span>
                  ) : (
                    <span className="badge badge--good">剛好</span>
                  )}
                </div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">已執行</div>
                <div className="summary-strip__value">{fmtHours(totals.used_total)}h</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">剩餘</div>
                <div className="summary-strip__value">{fmtHours(totals.remaining_total)}h</div>
              </div>
            </div>
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              註：合計為「人員彙總」目前顯示資料的加總（會隨部門/月份篩選變動）。
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
            <div className="panel__title">人員彙總</div>
            <div className="panel__meta">{rows.length} 位</div>
          </div>
          <div className="panel__body">
            <div className="chart" style={{ marginBottom: 12 }}>
              {chartRows.length ? (
                <div className="hchart">
                  <div className="hchart__legend">
                    <span className="badge" style={{ borderColor: 'rgba(74,222,128,0.35)', color: 'rgba(74,222,128,0.95)' }}>
                      已執行
                    </span>
                    <span className="badge" style={{ borderColor: 'rgba(96,165,250,0.45)', color: 'rgba(96,165,250,0.95)' }}>
                      接收剩餘
                    </span>
                    <span className="badge badge--warn">任務缺口</span>
                    <span className="badge badge--bad">超出應完成</span>
                    <span className="muted" style={{ marginLeft: 8 }}>
                      以 {fmtHours(chartScaleMax)}h 為最大尺度
                    </span>
                  </div>

                  {chartRows.map((r) => {
                    const received = Number(r.received_total_hours || 0);
                    const used = Number(r.used_hours || 0);
                    const exec = Math.max(used, 0);
                    const remainInReceived = Math.max(received - exec, 0);
                    const gap = Math.max(expectedHours - received, 0);
                    const over = Math.max(received - expectedHours, 0);
                    const totalLen = Math.max(expectedHours, received, 0);

                    const pct = (v: number) => `${(Math.max(v, 0) / chartScaleMax) * 100}%`;
                    const rightText =
                      over > 0
                        ? `超出 ${fmtHours(over)}h`
                        : gap > 0
                          ? `缺 ${fmtHours(gap)}h`
                          : `OK`;

                    return (
                      <div className="hchart__row" key={String(r.person_id)}>
                        <div className="hchart__label" title={r.display_name}>
                          {r.display_name}
                        </div>
                        <div className="hchart__bar" title={`接收 ${fmtHours(received)}h / 應完成 ${fmtHours(expectedHours)}h / 已執行 ${fmtHours(exec)}h`}>
                          <div className="stackbar">
                            <div className="stackbar__seg stackbar__seg--used" style={{ width: pct(exec) }} />
                            <div className="stackbar__seg stackbar__seg--recv" style={{ width: pct(remainInReceived) }} />
                            <div className="stackbar__seg stackbar__seg--gap" style={{ width: pct(gap) }} />
                            <div className="stackbar__seg stackbar__seg--over" style={{ width: pct(over) }} />
                          </div>
                          <div className="hchart__meta muted">
                            接收 {fmtHours(received)}h｜已執行 {fmtHours(exec)}h｜剩餘 {fmtHours(r.remaining_hours)}h｜{rightText}
                            {totalLen === 0 ? '（無資料）' : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="chart-empty">尚無資料</div>
              )}
            </div>

            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>人員</th>
                    <th className="num">任務數</th>
                    <th className="num">應完成工時</th>
                    <th className="num">接收總時數</th>
                    <th className="num">任務缺口</th>
                    <th className="num">已執行</th>
                    <th className="num">剩餘</th>
                    <th style={{ width: 84 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((r) => {
                      const isSelected = selectedPersonId && String(r.person_id) === String(selectedPersonId);
                      const gap = expectedHours - Number(r.received_total_hours || 0);
                      return (
                        <tr key={String(r.person_id)} style={isSelected ? { background: 'rgba(96,165,250,0.10)' } : undefined}>
                          <td>{r.display_name}</td>
                          <td className="num">{Number(r.task_count || 0)}</td>
                          <td className="num">{fmtHours(expectedHours)}</td>
                          <td className="num">{fmtHours(r.received_total_hours)}</td>
                          <td className="num">
                            {gap > 0 ? (
                              <span className="badge badge--warn">缺 {fmtHours(gap)}h</span>
                            ) : (
                              <span className="badge badge--good">已足夠</span>
                            )}
                          </td>
                          <td className="num">{fmtHours(r.used_hours)}</td>
                          <td className="num">{fmtHours(r.remaining_hours)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn" type="button" onClick={() => void toggleDetails(String(r.person_id))}>
                              明細
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="muted">
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

      {selectedPersonId ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div>
                <div className="modal__title">{selectedPerson?.display_name || selectedPersonId} 的任務明細</div>
                <div className="panel__meta" style={{ marginTop: 2 }}>
                  {tasksLoading ? '載入中…' : tasksError ? `錯誤：${tasksError}` : `${tasks.length} 筆`}
                </div>
              </div>
              <button className="modal__close" type="button" onClick={closeModal}>
                關閉
              </button>
            </div>
            <div className="modal__body">
              <div className="table-scroll">
                <table className="table task-table">
                  <thead>
                    <tr>
                      <th>任務描述</th>
                      <th>執行人</th>
                      <th>狀態</th>
                      <th className="num">預估時數</th>
                      <th className="num">實際時數</th>
                      <th className="num">剩餘時數</th>
                      <th>預計結束時間</th>
                      <th>實際完成時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.length ? (
                      tasks.map((t) => (
                        <tr key={String(t.task_id)}>
                          <td
                            className="task-table__desc"
                            title={`${t.project_code ? `${t.project_code}｜` : ''}${t.project_name || ''}｜${t.task_name}`}
                          >
                            {(t.project_code || t.project_name) ? (
                              <span className="muted">
                                {t.project_code ? `${t.project_code}｜` : ''}
                                {t.project_name || ''}
                                {'｜'}
                              </span>
                            ) : null}
                            {t.task_name}
                          </td>
                          <td>{selectedPerson?.display_name || <span className="muted">--</span>}</td>
                          <td>{toZhStatus(t.task_status)}</td>
                          <td className="num">{fmtHours(t.planned_hours)}</td>
                          <td className="num">{fmtHours(t.used_hours)}</td>
                          <td className="num">
                            {Number(t.remaining_hours || 0) >= 0 ? (
                              <span className="badge badge--good">{fmtHours(t.remaining_hours)}h</span>
                            ) : (
                              <span className="badge badge--bad">超支 {fmtHours(Math.abs(Number(t.remaining_hours || 0)))}h</span>
                            )}
                          </td>
                          <td>{fmtDateTime(t.planned_end_at)}</td>
                          <td>{fmtDateTime(t.completed_at)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={8} className="muted">
                          尚無任務
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


