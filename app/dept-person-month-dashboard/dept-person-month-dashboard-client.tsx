'use client';

import { useEffect, useMemo, useState } from 'react';
import TopMenu from '../_components/TopMenu';

type DepartmentId = string | number;
type PersonId = string | number;

type Department = { id: DepartmentId; name: string };
type Person = { id: PersonId; display_name: string; department_id: DepartmentId | null };

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
  const [departments, setDepartments] = useState<Department[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const [departmentId, setDepartmentId] = useState<string>('');
  const [personId, setPersonId] = useState<string>('');
  const [month, setMonth] = useState<string>(toMonthValue());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<SummaryRow[]>([]);

  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  const selectedPerson = useMemo(
    () => (selectedPersonId ? people.find((p) => String(p.id) === String(selectedPersonId)) : null),
    [people, selectedPersonId]
  );

  useEffect(() => {
    (async () => {
      try {
        setError('');
        const ds = await apiGet<Department[]>('/api/departments');
        setDepartments(ds);
      } catch (e: any) {
        setError(e?.message || '載入部門失敗');
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setError('');
        const q = buildQuery({ departmentId });
        const rows = await apiGet<any[]>(`/api/people${q}`);
        const normalized: Person[] = rows.map((r) => ({
          id: r.id,
          display_name: r.display_name,
          department_id: r.department_id ?? null
        }));
        setPeople(normalized);
        setPersonId('');
        setSelectedPersonId('');
        setTasks([]);
        setTasksError('');
      } catch (e: any) {
        setError(e?.message || '載入人員失敗');
      }
    })();
  }, [departmentId]);

  const loadSummary = async () => {
    setLoading(true);
    setError('');
    try {
      const q = buildQuery({ month, departmentId, personId });
      const data = await apiGet<{ people: SummaryRow[] }>(`/api/dept-person-month/summary${q}`);
      setRows(data.people || []);
      setSelectedPersonId('');
      setTasks([]);
      setTasksError('');
    } catch (e: any) {
      setError(e?.message || '查詢失敗');
    } finally {
      setLoading(false);
    }
  };

  const toggleDetails = async (pid: string) => {
    const next = String(pid);
    if (selectedPersonId && String(selectedPersonId) === next) {
      setSelectedPersonId('');
      setTasks([]);
      setTasksError('');
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">部門 / 人員 任務統計（月）</div>
          <div className="brand__sub">依「接收任務月份」篩選，統計每人：接收總時數 / 已執行 / 剩餘</div>
          <TopMenu />
        </div>

        <div className="filters">
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
            <span className="field__label">人員</span>
            <select className="field__control" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">全部</option>
              {people.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">月份</span>
            <input className="field__control" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>

          <button className="btn btn--primary" onClick={() => void loadSummary()} disabled={loading}>
            {loading ? '查詢中…' : '查詢'}
          </button>
        </div>
      </header>

      <main className="content">
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
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>人員</th>
                    <th className="num">任務數</th>
                    <th className="num">接收總時數</th>
                    <th className="num">已執行</th>
                    <th className="num">剩餘</th>
                    <th style={{ width: 84 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((r) => {
                      const isSelected = selectedPersonId && String(r.person_id) === String(selectedPersonId);
                      return (
                        <tr key={String(r.person_id)} style={isSelected ? { background: 'rgba(96,165,250,0.10)' } : undefined}>
                          <td>{r.display_name}</td>
                          <td className="num">{Number(r.task_count || 0)}</td>
                          <td className="num">{fmtHours(r.received_total_hours)}</td>
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
                      <td colSpan={6} className="muted">
                        尚無資料
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {selectedPersonId ? (
              <section className="panel" style={{ marginTop: 12 }}>
                <div className="panel__header">
                  <div className="panel__title">{selectedPerson?.display_name || selectedPersonId} 的任務明細</div>
                  <div className="panel__meta">
                    {tasksLoading ? '載入中…' : tasksError ? `錯誤：${tasksError}` : `${tasks.length} 筆`}
                  </div>
                </div>
                <div className="panel__body">
                  <div className="table-scroll">
                    <table className="table task-table">
                      <thead>
                        <tr>
                          <th>專案</th>
                          <th>任務</th>
                          <th>狀態</th>
                          <th>接收日</th>
                          <th className="num">預估</th>
                          <th className="num">已執行</th>
                          <th className="num">剩餘</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.length ? (
                          tasks.map((t) => (
                            <tr key={String(t.task_id)}>
                              <td title={t.project_name || ''}>
                                {t.project_code ? `${t.project_code}｜${t.project_name || ''}` : t.project_name || <span className="muted">--</span>}
                              </td>
                              <td className="task-table__desc" title={t.task_name}>
                                {t.task_name}
                              </td>
                              <td>{t.task_status || <span className="muted">--</span>}</td>
                              <td>{t.received_at ? String(t.received_at).slice(0, 10) : <span className="muted">--</span>}</td>
                              <td className="num">{fmtHours(t.planned_hours)}</td>
                              <td className="num">{fmtHours(t.used_hours)}</td>
                              <td className="num">{fmtHours(t.remaining_hours)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={7} className="muted">
                              尚無任務
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}


