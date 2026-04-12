'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import TopMenu from '../_components/TopMenu';
import { toZhStatus } from '@/lib/statusText';

const PM_STAT_STATUSES = [
  'Assigned', 'New', 'Executing', 'ExecuteAuditing', 'ExecuteBack',
  'Overdue', 'OverdueUpgrade', 'AutoUpgrade',
] as const;

const PM_OVERDUE_STATUSES = new Set(['Overdue', 'OverdueUpgrade']);

type OwnerRow = {
  owner_id: string | number;
  owner_name: string;
  project_count: number;
  planned_hours: number;
  used_hours: number;
  remaining_hours: number;
  remaining_load_months: number;
};

type Department = { id: string | number; name: string };

type PmStatusStatRow = { owner_name: string; status: string; cnt: number };

type SummaryResponse = {
  owners: OwnerRow[];
  pmStatusStats?: PmStatusStatRow[];
  project_type_map?: Record<string, string>;
};

type ProjectRow = {
  id: string | number;
  code: string | null;
  name: string;
  status: string | null;
  status_zh?: string | null;
  project_type: string | null;
  planned_hours: number;
  used_hours: number;
  remaining_hours: number;
};

function fmtHours(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

function fmtMonths(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(2);
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return (await res.json()) as T;
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

export default function PmDashboardClient() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  const [ownerOptions, setOwnerOptions] = useState<OwnerRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [departmentId, setDepartmentId] = useState<string>('');
  const [ownerFilterId, setOwnerFilterId] = useState<string>('');

  const [pmStatusStats, setPmStatusStats] = useState<PmStatusStatRow[]>([]);
  const [projectTypeMap, setProjectTypeMap] = useState<Record<string, string>>({});
  // store raw type values selected (server-side values)
  const [selectedProjectTypeValues, setSelectedProjectTypeValues] = useState<string[]>([]);
  const [projectTypePanelOpen, setProjectTypePanelOpen] = useState(false);
  const projectTypeTouched = useRef(false);

  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  const [projectModalProjectId, setProjectModalProjectId] = useState<string>('');
  const [projectModalProjectName, setProjectModalProjectName] = useState<string>('');

  const selectedOwner = useMemo(
    () => (selectedOwnerId ? owners.find((o) => String(o.owner_id) === String(selectedOwnerId)) : null),
    [owners, selectedOwnerId]
  );

  const totals = useMemo(() => {
    const project_count = owners.reduce((acc, o) => acc + Number(o.project_count || 0), 0);
    const planned_hours = owners.reduce((acc, o) => acc + Number(o.planned_hours || 0), 0);
    const used_hours = owners.reduce((acc, o) => acc + Number(o.used_hours || 0), 0);
    const remaining_hours = owners.reduce((acc, o) => acc + Number(o.remaining_hours || 0), 0);
    const remaining_load_months = remaining_hours / 900;
    return { project_count, planned_hours, used_hours, remaining_hours, remaining_load_months };
  }, [owners]);

  const pmStatusPivot = useMemo(() => {
    if (!pmStatusStats.length) return [];
    const map = new Map<string, Record<string, number>>();
    for (const r of pmStatusStats) {
      if (!map.has(r.owner_name)) map.set(r.owner_name, {});
      map.get(r.owner_name)![r.status] = r.cnt;
    }
    return Array.from(map.entries())
      .map(([name, counts]) => ({
        name,
        counts,
        overdueCnt: (counts['Overdue'] ?? 0) + (counts['OverdueUpgrade'] ?? 0),
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.overdueCnt - a.overdueCnt || b.total - a.total);
  }, [pmStatusStats]);

  const projectTypeOptions = useMemo(() => {
    const entries = Object.entries(projectTypeMap || {});
    // Stable: sort by zh label then raw value
    return entries
      .map(([raw, zh]) => ({ raw, zh: String(zh || raw) }))
      .sort((a, b) => a.zh.localeCompare(b.zh, 'zh-Hant') || a.raw.localeCompare(b.raw));
  }, [projectTypeMap]);

  // 預設一律「全選」（包含人時案）。若使用者沒手動操作且不是全選，就自動補回全選。
  const effectiveSelectedProjectTypeValues = useMemo(() => {
    if (!projectTypeOptions.length) return selectedProjectTypeValues;
    return selectedProjectTypeValues.length ? selectedProjectTypeValues : projectTypeOptions.map((t) => t.raw);
  }, [projectTypeOptions, selectedProjectTypeValues]);

  const selectedProjectTypesParam = useMemo(() => {
    return effectiveSelectedProjectTypeValues.length ? effectiveSelectedProjectTypeValues.join(',') : '';
  }, [effectiveSelectedProjectTypeValues]);

  useEffect(() => {
    if (!projectTypeOptions.length) return;
    if (projectTypeTouched.current) return;
    if (selectedProjectTypeValues.length === projectTypeOptions.length) return;
    setSelectedProjectTypeValues(projectTypeOptions.map((t) => t.raw));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectTypeOptions, selectedProjectTypeValues.length]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError('');
        const ds = await apiGet<Department[]>('/api/departments');
        setDepartments(ds || []);
      } catch (e: any) {
        setError(e?.message || '載入失敗');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // refresh owner dropdown options when department changes (options should remain selectable even when summary is filtered by ownerId)
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const q = buildQuery({ departmentId, projectTypes: selectedProjectTypesParam });
        const data = await apiGet<SummaryResponse>(`/api/pm-dashboard/summary${q}`);
        setOwnerOptions(data.owners || []);
        if (data.pmStatusStats) setPmStatusStats(data.pmStatusStats);
        if (data.project_type_map) setProjectTypeMap(data.project_type_map);
      } catch (e: any) {
        setError(e?.message || '載入失敗');
        setOwnerOptions([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [departmentId, selectedProjectTypesParam]);

  // refresh summary whenever filters change
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const q = buildQuery({ departmentId, ownerId: ownerFilterId, projectTypes: selectedProjectTypesParam });
        const data = await apiGet<SummaryResponse>(`/api/pm-dashboard/summary${q}`);
        const nextOwners = data.owners || [];
        setOwners(nextOwners);
        if (data.pmStatusStats) setPmStatusStats(data.pmStatusStats);
        if (data.project_type_map) setProjectTypeMap(data.project_type_map);

        // if current selection is not in the filtered summary, clear details
        const stillExists = selectedOwnerId ? nextOwners.some((o) => String(o.owner_id) === String(selectedOwnerId)) : true;
        if (!stillExists) {
          setSelectedOwnerId('');
          setProjects([]);
          setProjectsError('');
        }
      } catch (e: any) {
        setError(e?.message || '載入失敗');
        setOwners([]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, ownerFilterId, selectedProjectTypesParam]);

  const toggleOwner = async (ownerId: string) => {
    const next = String(ownerId);
    if (selectedOwnerId && String(selectedOwnerId) === next) {
      setSelectedOwnerId('');
      setProjects([]);
      setProjectsError('');
      return;
    }
    setSelectedOwnerId(next);
    setProjectsLoading(true);
    setProjectsError('');
    try {
      const q = buildQuery({ projectTypes: selectedProjectTypesParam });
      const data = await apiGet<{ projects: any[] }>(`/api/pm-dashboard/pm/${encodeURIComponent(next)}/projects${q}`);
      const normalized: ProjectRow[] = (data.projects || []).map((p: any) => ({
        id: p.id,
        code: p.code ?? null,
        name: p.name,
        status: p.status ?? null,
        status_zh: p.status_zh ?? null,
        project_type: p.project_type ?? null,
        planned_hours: Number(p.planned_hours || 0),
        used_hours: Number(p.used_hours || 0),
        remaining_hours: Number(p.remaining_hours || 0)
      }));
      setProjects(normalized);
    } catch (e: any) {
      setProjectsError(e?.message || '載入明細失敗');
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  };

  const closeProjectModal = () => {
    setProjectModalProjectId('');
    setProjectModalProjectName('');
  };

  // Close project modal with ESC
  useEffect(() => {
    if (!projectModalProjectId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeProjectModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [projectModalProjectId]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">PM 負載彙總表</div>
          <div className="brand__sub">以每月 900 小時產能估算剩餘負載（月）</div>
          <TopMenu />
        </div>
      </header>

      <main className="content">
        <div className="filters filters--center" style={{ marginBottom: 12 }}>
          <label className="field">
            <span className="field__label">部門</span>
            <select
              className="field__control"
              value={departmentId}
              onChange={(e) => {
                const v = e.target.value;
                setDepartmentId(v);
                // changing dept should reset owner filter + details
                setOwnerFilterId('');
                setSelectedOwnerId('');
                setProjects([]);
                setProjectsError('');
              }}
            >
              <option value="">全部</option>
              {departments.map((d) => (
                <option key={String(d.id)} value={String(d.id)}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">負責人</span>
            <select
              className="field__control"
              value={ownerFilterId}
              onChange={(e) => {
                const v = e.target.value;
                setOwnerFilterId(v);
                // owner filter changes should reset details selection (avoid mismatch)
                setSelectedOwnerId('');
                setProjects([]);
                setProjectsError('');
              }}
            >
              <option value="">全部</option>
              {ownerOptions.map((o) => (
                <option key={String(o.owner_id)} value={String(o.owner_id)}>
                  {o.owner_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panel__header">
            <div className="panel__title">專案類型（多選）</div>
            <div className="panel__meta">
              已選 {effectiveSelectedProjectTypeValues.length}/{projectTypeOptions.length}
            </div>
            <div className="panel__actions">
              <button className="btn" type="button" onClick={() => setProjectTypePanelOpen((v) => !v)}>
                {projectTypePanelOpen ? '收合' : '展開'}
              </button>
            </div>
          </div>
          {projectTypePanelOpen ? (
            <div className="panel__body">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  projectTypeTouched.current = true;
                  setSelectedProjectTypeValues(projectTypeOptions.map((t) => t.raw));
                }}
                disabled={!projectTypeOptions.length}
              >
                全選
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  projectTypeTouched.current = true;
                  const withoutMainPower = projectTypeOptions
                    .filter((t) => String(t.zh).trim() !== '人時案')
                    .map((t) => t.raw);
                  setSelectedProjectTypeValues(withoutMainPower.length ? withoutMainPower : projectTypeOptions.map((t) => t.raw));
                }}
                disabled={!projectTypeOptions.length}
              >
                排除人時案
              </button>
            </div>

            <div className="checklist">
              {projectTypeOptions.length ? (
                projectTypeOptions.map((t) => {
                  const checked = effectiveSelectedProjectTypeValues.includes(t.raw);
                  return (
                    <label key={t.raw} className="checklist__item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          projectTypeTouched.current = true;
                          const base = effectiveSelectedProjectTypeValues;
                          const next = e.target.checked ? Array.from(new Set([...base, t.raw])) : base.filter((x) => x !== t.raw);
                          setSelectedProjectTypeValues(next);
                          setSelectedOwnerId('');
                          setProjects([]);
                          setProjectsError('');
                        }}
                      />
                      <span className="checklist__label">{t.zh}</span>
                      <span className="checklist__meta muted">({t.raw})</span>
                    </label>
                  );
                })
              ) : (
                <div className="muted">載入中…</div>
              )}
            </div>
            </div>
          ) : null}
        </section>

        {error ? (
          <section className="panel" style={{ marginBottom: 12 }}>
            <div className="panel__body">
              <span className="badge badge--bad">錯誤：{error}</span>
            </div>
          </section>
        ) : null}

        {!loading && pmStatusPivot.length > 0 && (
          <section className="sr-section sr-section--ps" style={{ marginBottom: 12 }}>
            <div className="sr-section__header">
              <h2 className="sr-section__title">PM 專案狀態統計</h2>
            </div>
            <div className="ps-scroll">
              <table className="ps-table">
                <thead>
                  <tr>
                    <th className="ps-col--name">PM</th>
                    {PM_STAT_STATUSES.map((s) => (
                      <th key={s} className={`ps-col--status${PM_OVERDUE_STATUSES.has(s) ? ' ps-col--alert' : ''}`}>
                        {toZhStatus(s)}
                      </th>
                    ))}
                    <th className="ps-col--total">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {pmStatusPivot.map(({ name, counts, total }) => (
                    <tr key={name}>
                      <td className="ps-col--name">{name}</td>
                      {PM_STAT_STATUSES.map((s) => {
                        const v = counts[s] ?? 0;
                        return (
                          <td key={s} className={`ps-col--status${PM_OVERDUE_STATUSES.has(s) && v > 0 ? ' ps-val--alert' : ''}`}>
                            {v > 0 ? v : <span className="ps-zero">-</span>}
                          </td>
                        );
                      })}
                      <td className="ps-col--total">{total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="panel">
          <div className="panel__header">
            <div className="panel__title">PM 負載彙總</div>
            <div className="panel__meta">{loading ? '載入中…' : `${owners.length} 位`}</div>
          </div>
          <div className="panel__body">
            <div className="summary-strip" style={{ marginBottom: 12 }}>
              <div className="summary-strip__item">
                <div className="summary-strip__label">專案數</div>
                <div className="summary-strip__value">{Number(totals.project_count || 0)}</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">預估</div>
                <div className="summary-strip__value">{fmtHours(totals.planned_hours)}h</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">已用</div>
                <div className="summary-strip__value">{fmtHours(totals.used_hours)}h</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">剩餘</div>
                <div className="summary-strip__value">{fmtHours(totals.remaining_hours)}h</div>
              </div>
              <div className="summary-strip__item">
                <div className="summary-strip__label">剩餘負載（月）</div>
                <div className="summary-strip__value">{fmtMonths(totals.remaining_load_months)}</div>
              </div>
            </div>

            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>PM</th>
                    <th className="num">專案數</th>
                    <th className="num">預估</th>
                    <th className="num">已用</th>
                    <th className="num">剩餘</th>
                    <th className="num">剩餘負載（月）</th>
                    <th style={{ width: 84 }} />
                  </tr>
                </thead>
                <tbody>
                  {owners.length ? (
                    owners.map((o) => {
                      const isSelected = selectedOwnerId && String(o.owner_id) === String(selectedOwnerId);
                      return (
                        <tr key={String(o.owner_id)} style={isSelected ? { background: 'rgba(96,165,250,0.10)' } : undefined}>
                          <td>{o.owner_name || <span className="muted">--</span>}</td>
                          <td className="num">{Number(o.project_count || 0)}</td>
                          <td className="num">{fmtHours(o.planned_hours)}</td>
                          <td className="num">{fmtHours(o.used_hours)}</td>
                          <td className="num">{fmtHours(o.remaining_hours)}</td>
                          <td className="num">{fmtMonths(o.remaining_load_months)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn" type="button" onClick={() => void toggleOwner(String(o.owner_id))}>
                              明細
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="muted">
                        尚無資料
                      </td>
                    </tr>
                  )}
                </tbody>
                {owners.length > 0 && (
                  <tfoot>
                    <tr className="ps-row--total">
                      <td>合計</td>
                      <td className="num">{Number(totals.project_count || 0)}</td>
                      <td className="num">{fmtHours(totals.planned_hours)}</td>
                      <td className="num">{fmtHours(totals.used_hours)}</td>
                      <td className="num">{fmtHours(totals.remaining_hours)}</td>
                      <td className="num">{fmtMonths(totals.remaining_load_months)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </section>

        {selectedOwnerId ? (
          <section className="panel" style={{ marginTop: 12 }}>
            <div className="panel__header">
              <div className="panel__title">{selectedOwner?.owner_name || selectedOwnerId}｜專案明細</div>
              <div className="panel__meta">{projectsLoading ? '載入中…' : projectsError ? `錯誤：${projectsError}` : `${projects.length} 筆`}</div>
            </div>
            <div className="panel__body">
              <div className="table-scroll">
                <table className="table pm-project-table">
                  <thead>
                    <tr>
                      <th>專案類型</th>
                      <th>專案</th>
                      <th>狀態</th>
                      <th className="num">預估</th>
                      <th className="num">已用</th>
                      <th className="num">剩餘</th>
                      <th style={{ width: 84 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {projects.length ? (
                      projects.map((p) => (
                        <tr key={String(p.id)}>
                          <td>{p.project_type || <span className="muted">--</span>}</td>
                          <td className="pm-project-table__desc" title={p.name}>
                            {p.code ? `${p.code}｜${p.name}` : p.name}
                          </td>
                          <td>{p.status_zh || toZhStatus(p.status)}</td>
                          <td className="num">{fmtHours(p.planned_hours)}</td>
                          <td className="num">{fmtHours(p.used_hours)}</td>
                          <td className="num">{fmtHours(p.remaining_hours)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn"
                              type="button"
                              onClick={() => {
                                setProjectModalProjectId(String(p.id));
                                setProjectModalProjectName(p.name || String(p.id));
                              }}
                            >
                              明細
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="muted">
                          尚無資料
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}
      </main>

      {projectModalProjectId ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeProjectModal();
          }}
        >
          <div className="modal modal--iframe" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div>
                <div className="modal__title">專案明細｜{projectModalProjectName}</div>
                <div className="panel__meta" style={{ marginTop: 2 }}>
                  不會離開此頁面（ESC / 點背景 / 右上角關閉）
                </div>
              </div>
              <button className="modal__close" type="button" onClick={closeProjectModal}>
                關閉
              </button>
            </div>
            <div className="modal__body modal__body--iframe">
              <iframe title="project-detail" className="modal__iframe" src={`/?projectId=${encodeURIComponent(projectModalProjectId)}`} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


