'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import TopMenu from './_components/TopMenu';
import { toZhStatus } from '@/lib/statusText';

type Project = {
  id: string | number;
  code: string | null;
  name: string;
  planned_hours: number;
  start_date: string | null;
  end_date: string | null;
  planned_end_date?: string | null;
  actual_hours: number;
  status?: string | null;
  status_zh?: string | null;
  owner_user_id?: string | number | null;
  owner_name?: string | null;
  project_type?: string | null;
  department_id?: string | number | null;
};

type DepartmentId = string | number;
type Department = { id: DepartmentId; name: string };
type PersonId = string | number;
type Person = { id: PersonId; display_name: string; department_id: DepartmentId | null };
type Owner = { id: PersonId; display_name: string };

type TaskRow = {
  task_id: string | number;
  task_name: string;
  executor_user_id: string | number | null;
  executor_name: string | null;
  task_status: string | null;
  task_planned_hours: number;
  actual_hours: number;
  remaining_hours: number;
  planned_end_at: string | null;
  completed_at: string | null;
};

type PeopleRow = { person_id: string | number; display_name: string; hours: number; task_count: number };

function fmtHours(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

function fmtDateTime(v: unknown) {
  const s = String(v ?? '').trim();
  if (!s) return '--';
  // DB datetime may already be string; show date portion if it looks like ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.replace('T', ' ').slice(0, 19);
  return s;
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

function getUrlProjectId(): string {
  try {
    const usp = new URLSearchParams(window.location.search);
    return (usp.get('projectId') || '').trim();
  } catch {
    return '';
  }
}

export default function DashboardClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptLookup, setDeptLookup] = useState<Department[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);

  const [projectId, setProjectId] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [ownerId, setOwnerId] = useState<string>('');
  const [searchText, setSearchText] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const [summary, setSummary] = useState<any>(null);
  const [peopleBreakdown, setPeopleBreakdown] = useState<any>(null);
  const [tasksBreakdown, setTasksBreakdown] = useState<any>(null);
  const [milestones, setMilestones] = useState<Array<{
    id: string; name: string; plan_date: string | null; actual_date: string | null;
    status: string | null; description: string | null;
  }>>([]);

  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [personTasksLoading, setPersonTasksLoading] = useState(false);
  const [personTasksError, setPersonTasksError] = useState('');
  const [personTasks, setPersonTasks] = useState<TaskRow[]>([]);

  const didInitRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        setError('');
        const [ps, ds, allDs] = await Promise.all([
          apiGet<Project[]>('/api/projects'),
          apiGet<Department[]>('/api/departments'),
          apiGet<Department[]>('/api/departments?all=1')
        ]);
        setDepartments(ds);
        setDeptLookup(allDs);
        setProjects(ps);
        // If URL contains ?projectId=..., prefer it (used by PM dashboard modal/deeplink).
        const urlProjectId = getUrlProjectId();
        const exists = urlProjectId ? ps.some((p) => String(p.id) === String(urlProjectId)) : false;
        setProjectId(exists ? String(urlProjectId) : ps[0]?.id ? String(ps[0].id) : '');
        didInitRef.current = true;
      } catch (e: any) {
        setError(e?.message || '載入失敗');
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const q = buildQuery({ departmentId });
        const rows = await apiGet<any[]>(`/api/people${q}`);
        const normalized: Person[] = rows.map((r) => ({
          id: r.id,
          display_name: r.display_name,
          department_id: r.department_id
        }));
        setPeople(normalized);
        // owners
        const ownerRows = await apiGet<any[]>(`/api/project-owners${q}`);
        const os: Owner[] = ownerRows.map((r) => ({ id: r.id, display_name: r.display_name }));
        setOwners(os);
        setOwnerId('');
      } catch (e: any) {
        setError(e?.message || '載入人員失敗');
      }
    })();
  }, [departmentId]);

  const loadProjects = async (opts?: { useFallbackFromOwner?: boolean }) => {
    const base = { departmentId, ownerId, q: searchText || undefined };
    const q1 = buildQuery(base);
    const list = await apiGet<Project[]>(`/api/projects${q1}`);
    if (ownerId && departmentId && opts?.useFallbackFromOwner && (!list || list.length === 0)) {
      const q2 = buildQuery({ departmentId, q: searchText || undefined });
      return await apiGet<Project[]>(`/api/projects${q2}`);
    }
    return list;
  };

  const refreshProjects = async () => {
    try {
      setError('');
      const ps = await loadProjects({ useFallbackFromOwner: true });
      setProjects(ps);
      // keep selection if still exists; otherwise prefer URL ?projectId=...; otherwise pick first project.
      // Use functional update to avoid race conditions during initial load.
      setProjectId((prev) => {
        const prevId = String(prev || '').trim();
        if (prevId && ps.some((p) => String(p.id) === prevId)) return prevId;
        const urlProjectId = getUrlProjectId();
        if (urlProjectId && ps.some((p) => String(p.id) === String(urlProjectId))) return String(urlProjectId);
        return ps[0]?.id ? String(ps[0].id) : '';
      });
    } catch (e: any) {
      setError(e?.message || '載入專案失敗');
    }
  };

  useEffect(() => {
    // Avoid firing filter refresh before initial list is ready; prevents UI flash / selection resets.
    if (!didInitRef.current) return;
    void refreshProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, ownerId]);

  const apply = async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const [s, pb, tb, ms] = await Promise.all([
        apiGet(`/api/projects/${projectId}/summary`),
        apiGet(`/api/projects/${projectId}/people-breakdown`),
        apiGet(`/api/projects/${projectId}/tasks-breakdown`),
        apiGet<{ milestones: any[] }>(`/api/projects/${projectId}/milestones`),
      ]);
      setSummary(s);
      setPeopleBreakdown(pb);
      setTasksBreakdown(tb);
      setMilestones(ms.milestones || []);
    } catch (e: any) {
      setError(e?.message || '載入失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    void apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const planned = Number(summary?.planned_hours || 0);
  const actual = Number(summary?.actual_hours || 0);
  const diff = planned - actual;
  const isOverBudget = diff < 0;

  const peopleRows: PeopleRow[] = (peopleBreakdown?.people || []) as any;
  const taskRows: TaskRow[] = (tasksBreakdown?.tasks || []) as any;

  const selectedProject = useMemo(
    () => (projectId ? projects.find((p) => String(p.id) === String(projectId)) || null : null),
    [projects, projectId]
  );
  const plannedEndInfo = useMemo(() => {
    const raw = selectedProject?.planned_end_date || null;
    if (!raw) return { text: null as string | null, overdue: false };
    const d = new Date(raw);
    const overdue = Number.isFinite(d.getTime()) ? d.getTime() < Date.now() : false;
    return { text: fmtDateTime(raw), overdue };
  }, [selectedProject?.planned_end_date]);
  const selectedDepartmentName = useMemo(() => {
    if (!selectedProject?.department_id) return null;
    const source = deptLookup.length ? deptLookup : departments;
    const hit = source.find((d) => String(d.id) === String(selectedProject.department_id));
    return hit?.name || null;
  }, [departments, deptLookup, selectedProject?.department_id]);

  const selectedPerson = useMemo(
    () => (selectedPersonId ? peopleRows.find((r) => String(r.person_id) === String(selectedPersonId)) : null),
    [peopleRows, selectedPersonId]
  );

  const togglePersonDetails = async (pid: string) => {
    if (selectedPersonId && String(selectedPersonId) === String(pid)) {
      setSelectedPersonId('');
      setPersonTasks([]);
      setPersonTasksError('');
      return;
    }
    setSelectedPersonId(pid);
    setPersonTasksLoading(true);
    setPersonTasksError('');
    try {
      const data = await apiGet<{ tasks: TaskRow[] }>(`/api/projects/${projectId}/people/${encodeURIComponent(pid)}/tasks`);
      setPersonTasks(data.tasks || []);
    } catch (e: any) {
      setPersonTasksError(e?.message || '載入明細失敗');
      setPersonTasks([]);
    } finally {
      setPersonTasksLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">各專案任務工時明細表</div>
          <div className="brand__sub">任務實際時數以任務本身為準（任務加總＝專案已填報時數）</div>
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
            <span className="field__label">人員（專案負責人）</span>
            <select className="field__control" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">全部</option>
              {owners.map((o) => (
                <option key={String(o.id)} value={String(o.id)}>
                  {o.display_name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">專案</span>
            <select className="field__control" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => {
                const typeTag = p.project_type ? `【${p.project_type}】` : '';
                const statusTag = p.status ? `（${p.status_zh || toZhStatus(p.status)}）` : '';
                const label = `${typeTag}${p.code ? `${p.code}｜` : ''}${p.name}${statusTag}`;
                return (
                  <option key={String(p.id)} value={String(p.id)}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>

          <div className="searchbox">
            <input
              className="field__control"
              placeholder="搜尋專案名稱…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void refreshProjects();
              }}
            />
            <button className="btn btn--primary" onClick={() => void refreshProjects()} disabled={loading}>
              {loading ? '查詢中…' : '查詢'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="panel__body">
              <div className="badge badge--bad">載入失敗：{error}</div>
            </div>
          </div>
        ) : null}

        <section className="cards">
          <div className="card">
            <div className="card__label">專案預估時數</div>
            <div className="card__value">{fmtHours(planned)} h</div>
          </div>
          <div className="card">
            <div className="card__label">已填報時數</div>
            <div className="card__value">{fmtHours(actual)} h</div>
          </div>
          <div className="card">
            <div className="card__label">剩餘 / 超支</div>
            <div className="card__value">
              {isOverBudget ? (
                <span className="badge badge--bad">超支 {fmtHours(Math.abs(diff))}h</span>
              ) : (
                <span className="badge badge--good">剩餘 {fmtHours(diff)}h</span>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card__label">專案資訊</div>
            <div className="card__hint" style={{ marginTop: 6, lineHeight: 1.65 }}>
              <div>
                <span className="muted">部門：</span>
                {selectedDepartmentName || <span className="muted">--</span>}
              </div>
              <div>
                <span className="muted">計畫結束：</span>
                {plannedEndInfo.text ? (
                  <span>
                    {plannedEndInfo.text}{' '}
                    {plannedEndInfo.overdue ? <span className="badge badge--bad">逾期</span> : null}
                  </span>
                ) : (
                  <span className="muted">--</span>
                )}
              </div>
              <div>
                <span className="muted">狀態：</span>
                {selectedProject?.status ? selectedProject.status_zh || toZhStatus(selectedProject.status) : <span className="muted">--</span>}
              </div>
              <div>
                <span className="muted">負責人：</span>
                {selectedProject?.owner_name || <span className="muted">--</span>}
              </div>
            </div>
          </div>
        </section>

        {milestones.length > 0 && (
          <section className="panel" style={{ marginTop: 12 }}>
            <div className="panel__header">
              <div className="panel__title">專案里程碑</div>
              <div className="panel__meta">{milestones.length} 個</div>
            </div>
            <div className="panel__body">
              <div className="table-scroll">
                <table className="table milestone-table">
                  <thead>
                    <tr>
                      <th>里程碑名稱</th>
                      <th>計畫日期</th>
                      <th>實際完成日期</th>
                      <th>狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {milestones.map((ms) => {
                      const overdue =
                        ms.plan_date && !ms.actual_date
                          ? new Date(ms.plan_date).getTime() < Date.now()
                          : false;
                      return (
                        <tr key={ms.id}>
                          <td title={ms.description || undefined}>{ms.name}</td>
                          <td className={overdue ? 'milestone-date--overdue' : ''}>
                            {ms.plan_date || <span className="muted">--</span>}
                            {overdue && <span className="badge badge--bad" style={{ marginLeft: 6 }}>逾期</span>}
                          </td>
                          <td>{ms.actual_date || <span className="muted">--</span>}</td>
                          <td>{ms.status ? toZhStatus(ms.status) : <span className="muted">--</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        <section className="panel" style={{ marginTop: 12 }}>
          <div className="panel__header">
            <div className="panel__title">任務工時（彙總）</div>
            <div className="panel__meta">{taskRows.length} 個任務</div>
          </div>
          <div className="panel__body">
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
                  {taskRows.length ? (
                    taskRows.map((t) => {
                      const plannedH = Number(t.task_planned_hours || 0);
                      const actualH = Number(t.actual_hours || 0);
                      const remainingH = Number(t.remaining_hours ?? plannedH - actualH);
                      return (
                        <tr key={String(t.task_id)}>
                          <td className="task-table__desc" title={t.task_name}>
                            {t.task_name}
                          </td>
                          <td>{t.executor_name || <span className="muted">--</span>}</td>
                          <td>{toZhStatus(t.task_status)}</td>
                          <td className="num">{fmtHours(plannedH)}</td>
                          <td className="num">{fmtHours(actualH)}</td>
                          <td className="num">
                            {remainingH >= 0 ? (
                              <span className="badge badge--good">{fmtHours(remainingH)}h</span>
                            ) : (
                              <span className="badge badge--bad">超支 {fmtHours(Math.abs(remainingH))}h</span>
                            )}
                          </td>
                          <td>{fmtDateTime(t.planned_end_at)}</td>
                          <td>{fmtDateTime(t.completed_at)}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="muted">
                        此專案尚無任務
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="panel" style={{ marginTop: 12 }}>
          <div className="panel__header">
            <div className="panel__title">人員工時（彙總）</div>
            <div className="panel__meta">{peopleRows.length} 位</div>
          </div>
          <div className="panel__body">
            <div className="table-scroll">
              <table className="table people-summary-table">
                <thead>
                  <tr>
                    <th>人員</th>
                    <th className="num">已填寫時數</th>
                    <th className="num">任務數</th>
                    <th className="num">平均任務填寫時數</th>
                    <th style={{ width: 84 }} />
                  </tr>
                </thead>
                <tbody>
                  {peopleRows.length ? (
                    peopleRows.map((r) => {
                      const hours = Number(r.hours || 0);
                      const taskCount = Number(r.task_count || 0);
                      const avgHours = taskCount > 0 ? hours / taskCount : 0;
                      const isSelected = selectedPersonId && String(r.person_id) === String(selectedPersonId);
                      return (
                        <tr key={String(r.person_id)} style={isSelected ? { background: 'rgba(96,165,250,0.10)' } : undefined}>
                          <td>{r.display_name}</td>
                          <td className="num">{fmtHours(hours)}</td>
                          <td className="num">{taskCount}</td>
                          <td className="num">{fmtHours(avgHours)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn" type="button" onClick={() => void togglePersonDetails(String(r.person_id))}>
                              明細
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="muted">
                        尚無工時資料
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {selectedPersonId ? (
              <div className="panel" style={{ marginTop: 12 }}>
                <div className="panel__header">
                  <div className="panel__title">{selectedPerson?.display_name || selectedPersonId} 的任務明細</div>
                  <div className="panel__meta">
                    {personTasksLoading ? '載入中…' : personTasksError ? `錯誤：${personTasksError}` : `${personTasks.length} 個任務`}
                  </div>
                </div>
                <div className="panel__body">
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
                        {personTasks.length ? (
                          personTasks.map((t) => {
                            const plannedH = Number(t.task_planned_hours || 0);
                            const actualH = Number(t.actual_hours ?? 0);
                            const remainingH =
                              t.remaining_hours !== undefined && t.remaining_hours !== null ? Number(t.remaining_hours) : plannedH - actualH;
                            return (
                              <tr key={String(t.task_id)}>
                                <td className="task-table__desc" title={t.task_name}>
                                  {t.task_name}
                                </td>
                                <td>{t.executor_name || <span className="muted">--</span>}</td>
                                <td>{toZhStatus(t.task_status)}</td>
                                <td className="num">{fmtHours(plannedH)}</td>
                                <td className="num">{fmtHours(actualH)}</td>
                                <td className="num">
                                  {remainingH >= 0 ? (
                                    <span className="badge badge--good">{fmtHours(remainingH)}h</span>
                                  ) : (
                                    <span className="badge badge--bad">超支 {fmtHours(Math.abs(remainingH))}h</span>
                                  )}
                                </td>
                                <td>{fmtDateTime(t.planned_end_at)}</td>
                                <td>{fmtDateTime(t.completed_at)}</td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={8} className="muted">
                              此人員尚無任務
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}



