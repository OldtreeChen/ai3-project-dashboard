'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import TopMenu from '../_components/TopMenu';
import { toZhStatus } from '@/lib/statusText';

type OwnerRow = {
  owner_id: string | number;
  owner_name: string;
  project_count: number;
  planned_hours: number;
  used_hours: number;
  remaining_hours: number;
  remaining_load_months: number;
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

export default function PmDashboardClient() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [owners, setOwners] = useState<OwnerRow[]>([]);

  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  const selectedOwner = useMemo(
    () => (selectedOwnerId ? owners.find((o) => String(o.owner_id) === String(selectedOwnerId)) : null),
    [owners, selectedOwnerId]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await apiGet<{ owners: OwnerRow[] }>('/api/pm-dashboard/summary');
        setOwners(data.owners || []);
      } catch (e: any) {
        setError(e?.message || '載入失敗');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
      const data = await apiGet<{ projects: any[] }>(`/api/pm-dashboard/pm/${encodeURIComponent(next)}/projects`);
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">PM 負載儀表板</div>
          <div className="brand__sub">以每月 900 小時產能估算剩餘負載（月）</div>
          <TopMenu />
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
            <div className="panel__title">PM 彙總</div>
            <div className="panel__meta">{loading ? '載入中…' : `${owners.length} 位`}</div>
          </div>
          <div className="panel__body">
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
                            <Link className="btn" href={`/?projectId=${encodeURIComponent(String(p.id))}`}>
                              明細
                            </Link>
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
    </div>
  );
}


