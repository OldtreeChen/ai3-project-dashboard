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
  hours: number;
};

type TaskRow = {
  task_id: PersonId;
  task_name: string;
  task_status: string | null;
  project_id: PersonId;
  project_code: string | null;
  project_name: string;
  hours: number;
};

function fmtHours(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

function todayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function firstDayOfMonthYMD() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}`;
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

export default function PeopleDashboardClient() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string>('');
  const [from, setFrom] = useState<string>(firstDayOfMonthYMD());
  const [to, setTo] = useState<string>(todayYMD());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<SummaryRow[]>([]);

  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  const selectedPerson = useMemo(() => rows.find((r) => String(r.person_id) === String(selectedPersonId)) || null, [rows, selectedPersonId]);

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

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const q = buildQuery({ from, to, departmentId });
      const data = await apiGet<{ people: SummaryRow[] }>(`/api/people-dashboard/summary${q}`);
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
      const q = buildQuery({ from, to });
      const data = await apiGet<{ tasks: TaskRow[] }>(`/api/people-dashboard/people/${encodeURIComponent(next)}/tasks${q}`);
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
          <div className="brand__title">人員任務儀表板</div>
          <div className="brand__sub">依查詢區間彙總每人填報工時，點選可查看任務與專案</div>
          <TopMenu />
        </div>
      </header>

      <main className="content">
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
            <span className="field__label">起日</span>
            <input className="field__control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">迄日</span>
            <input className="field__control" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn btn--primary" onClick={() => void load()} disabled={loading}>
            {loading ? '查詢中…' : '查詢'}
          </button>
        </div>

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
                    <th className="num">填報工時</th>
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
                          <td className="num">{fmtHours(r.hours)}</td>
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
                      <td colSpan={3} className="muted">
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
                          <th className="num">工時</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.length ? (
                          tasks.map((t) => (
                            <tr key={String(t.task_id)}>
                              <td title={t.project_name}>
                                {t.project_code ? `${t.project_code}｜${t.project_name}` : t.project_name}
                              </td>
                              <td className="task-table__desc" title={t.task_name}>
                                {t.task_name}
                              </td>
                              <td>{toZhStatus(t.task_status)}</td>
                              <td className="num">{fmtHours(t.hours)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} className="muted">
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


