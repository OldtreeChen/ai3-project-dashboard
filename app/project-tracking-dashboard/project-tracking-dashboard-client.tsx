'use client';

import { useCallback, useEffect, useState } from 'react';
import TopMenu from '../_components/TopMenu';
import { toZhStatus } from '@/lib/statusText';

type ProjectRow = {
  id: string;
  name: string;
  status: string | null;
  plan_end_date: string | null;
  owner_name: string | null;
  dept_name: string | null;
};

type MilestoneRow = {
  id: string;
  milestone_name: string;
  project_id: string;
  project_name: string;
  plan_date: string | null;
  status: string | null;
  owner_name: string | null;
  dept_name: string | null;
};

type SummaryData = {
  overdueProjects: ProjectRow[];
  upcomingProjects: ProjectRow[];
  overdueMilestones: MilestoneRow[];
  upcomingMilestones: MilestoneRow[];
};

type Dept = { id: string; name: string };

function Badge({ count, variant }: { count: number; variant: 'overdue' | 'upcoming' }) {
  return (
    <span className={`sr-section__badge sr-section__badge--${variant === 'overdue' ? 'overdue' : 'upcoming'}`}>
      {count} 筆
    </span>
  );
}

function ProjectTable({ rows, highlightOverdue }: { rows: ProjectRow[]; highlightOverdue?: boolean }) {
  if (!rows.length) return <div className="sr-empty">目前無資料</div>;
  return (
    <table className="sr-table">
      <thead>
        <tr>
          <th className="sr-col--name">專案名稱</th>
          <th className="sr-col--status">狀態</th>
          <th className="sr-col--date">計畫結束日</th>
          <th className="sr-col--user">負責人</th>
          <th className="sr-col--dept">部門</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="sr-col--name" title={r.name}>{r.name}</td>
            <td className="sr-col--status">
              <span className="sr-status">{toZhStatus(r.status)}</span>
            </td>
            <td className={`sr-col--date${highlightOverdue ? ' sr-overdue-date' : ''}`}>{r.plan_end_date || '--'}</td>
            <td className="sr-col--user">{r.owner_name || '--'}</td>
            <td className="sr-col--dept">{r.dept_name || '--'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MilestoneTable({ rows, highlightOverdue }: { rows: MilestoneRow[]; highlightOverdue?: boolean }) {
  if (!rows.length) return <div className="sr-empty">目前無資料</div>;
  return (
    <table className="sr-table">
      <thead>
        <tr>
          <th className="sr-col--name">里程碑名稱</th>
          <th className="sr-col--name">所屬專案</th>
          <th className="sr-col--status">狀態</th>
          <th className="sr-col--date">計畫完成日</th>
          <th className="sr-col--user">負責人</th>
          <th className="sr-col--dept">部門</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="sr-col--name" title={r.milestone_name}>{r.milestone_name}</td>
            <td className="sr-col--name" title={r.project_name}>{r.project_name}</td>
            <td className="sr-col--status">
              <span className="sr-status">{toZhStatus(r.status)}</span>
            </td>
            <td className={`sr-col--date${highlightOverdue ? ' sr-overdue-date' : ''}`}>{r.plan_date || '--'}</td>
            <td className="sr-col--user">{r.owner_name || '--'}</td>
            <td className="sr-col--dept">{r.dept_name || '--'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ProjectTrackingDashboardClient() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);

  const fetchData = useCallback(async (deptId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (deptId) params.set('departmentId', deptId);
      const q = params.toString() ? `?${params}` : '';
      const res = await fetch(`/api/project-tracking/summary${q}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e: any) {
      setError(e?.message ?? '載入失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/departments');
        const ds: Dept[] = await res.json();
        setDepts(ds || []);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => { fetchData(selectedDeptId); }, [fetchData, selectedDeptId]);

  const selectDept = (id: string | null) => { setSelectedDeptId(id); };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">專案追蹤</div>
          <div className="brand__sub">已逾期與近 7 天到期的專案及里程碑</div>
          <TopMenu />
        </div>
      </header>

      <main className="content content--wide">
        <div className="dept-tabs" style={{ marginBottom: 16 }}>
          <button
            className={`dept-tab${selectedDeptId === null ? ' dept-tab--active' : ''}`}
            onClick={() => selectDept(null)}
          >全部</button>
          {depts.map((d) => (
            <button
              key={d.id}
              className={`dept-tab${selectedDeptId === d.id ? ' dept-tab--active' : ''}`}
              onClick={() => selectDept(d.id)}
            >{d.name}</button>
          ))}
        </div>

        {loading && <div className="sr-loading">載入中…</div>}
        {error && <div className="sr-error">錯誤：{error}</div>}

        {data && (
          <>
            {/* 已逾期專案 */}
            <section className="sr-section">
              <div className="sr-section__header">
                <h2 className="sr-section__title">
                  已逾期專案
                  <Badge count={data.overdueProjects.length} variant="overdue" />
                </h2>
              </div>
              <ProjectTable rows={data.overdueProjects} highlightOverdue />
            </section>

            {/* 近7天到期專案 */}
            <section className="sr-section">
              <div className="sr-section__header">
                <h2 className="sr-section__title">
                  近 7 天到期專案
                  <Badge count={data.upcomingProjects.length} variant="upcoming" />
                </h2>
              </div>
              <ProjectTable rows={data.upcomingProjects} />
            </section>

            {/* 已逾期里程碑 */}
            <section className="sr-section">
              <div className="sr-section__header">
                <h2 className="sr-section__title">
                  已逾期里程碑
                  <Badge count={data.overdueMilestones.length} variant="overdue" />
                </h2>
              </div>
              <MilestoneTable rows={data.overdueMilestones} highlightOverdue />
            </section>

            {/* 近7天到期里程碑 */}
            <section className="sr-section">
              <div className="sr-section__header">
                <h2 className="sr-section__title">
                  近 7 天到期里程碑
                  <Badge count={data.upcomingMilestones.length} variant="upcoming" />
                </h2>
              </div>
              <MilestoneTable rows={data.upcomingMilestones} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
