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

type MonthMilestone = {
  id: string;
  milestone_name: string;
  project_id: string;
  project_name: string;
  project_status: string | null;
  plan_date: string | null;
  ms_status: string | null;
  owner_name: string | null;
  dept_name: string | null;
  date_changed_from: string | null;
  changes: {
    old_date: string;
    new_date: string | null;
    changed_at: string;
    reason: string | null;
    delay_type: string | null;
  }[];
};

type MilestoneStats = { total: number; finished: number; rate: number };

type MonthMilestonesData = {
  month: string;
  date_range: { from: string; to_exclusive: string };
  goLive: MonthMilestone[];
  acceptance: MonthMilestone[];
  goLiveStats: MilestoneStats;
  acceptanceStats: MilestoneStats;
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

/** Date display — if changed this month, show ~~old~~ → new */
function DateCell({ ms }: { ms: MonthMilestone }) {
  if (!ms.date_changed_from || ms.date_changed_from === ms.plan_date) {
    return <span>{ms.plan_date || '--'}</span>;
  }
  return (
    <span className="mm-date-change" title={ms.changes.map((c) => `${c.changed_at}${c.reason ? `：${c.reason}` : ''}`).join('\n')}>
      <span className="mm-date--old">{ms.date_changed_from}</span>
      <span className="mm-date--arrow">→</span>
      <span className="mm-date--new">{ms.plan_date || '--'}</span>
    </span>
  );
}

/** Milestone status badge */
function MsStatusBadge({ status }: { status: string | null }) {
  const s = status ?? '';
  let cls = 'mm-status';
  if (s === 'Finished') cls += ' mm-status--done';
  else if (s === 'Overdue' || s === 'OverdueUpgrade' || s === 'AutoUpgrade') cls += ' mm-status--overdue';
  else if (s === 'Executing' || s === 'Assigned') cls += ' mm-status--active';
  else cls += ' mm-status--idle';
  const label = {
    Finished: '已完成',
    Executing: '執行中',
    Overdue: '已逾期',
    OverdueUpgrade: '逾期升級',
    AutoUpgrade: '自動升級',
    Assigned: '已分配',
    New: '待開始',
  }[s] ?? (s || '--');
  return <span className={cls}>{label}</span>;
}

/** Completion progress bar */
function CompletionBar({ stats }: { stats: MilestoneStats }) {
  const { total, finished, rate } = stats;
  return (
    <div className="mm-rate">
      <div className="mm-rate__bar">
        <div className="mm-rate__fill" style={{ width: `${rate}%` }} />
      </div>
      <span className="mm-rate__text">
        {finished}/{total} 完成 <strong>{rate}%</strong>
      </span>
    </div>
  );
}

/** Truncate project name: strip prefix like 【AI】 and suffix like _PM/_SE */
function shortProjName(name: string): string {
  return name
    .replace(/^【[^】]*】/, '')
    .replace(/_(?:PM|SE|雲服|雲租)$/, '')
    .trim();
}

function MonthMilestoneCard({
  title,
  items,
  stats,
  variant,
}: {
  title: string;
  items: MonthMilestone[];
  stats: MilestoneStats;
  variant: 'golive' | 'acceptance';
}) {
  const changedCount = items.filter((m) => m.date_changed_from && m.date_changed_from !== m.plan_date).length;

  // Sort: finished at bottom, then by plan_date asc
  const sorted = [...items].sort((a, b) => {
    const aF = a.ms_status === 'Finished' ? 1 : 0;
    const bF = b.ms_status === 'Finished' ? 1 : 0;
    if (aF !== bF) return aF - bF;
    return (a.plan_date ?? '').localeCompare(b.plan_date ?? '');
  });

  return (
    <div className="mm-card">
      <div className="mm-card__header">
        <div style={{ flex: 1 }}>
          <h2 className={`mm-card__title mm-card__title--${variant}`}>
            {title}
            <span className={`mm-badge mm-badge--${variant}`}>{items.length} 個</span>
            {changedCount > 0 && (
              <span className="mm-badge mm-badge--changed">⚡ {changedCount} 項本月變更</span>
            )}
          </h2>
          <CompletionBar stats={stats} />
        </div>
      </div>
      {!items.length ? (
        <div className="mm-empty">本月尚無此類里程碑</div>
      ) : (
        <table className="mm-table">
          <thead>
            <tr>
              <th className="mm-col--status-sm">狀態</th>
              <th className="mm-col--name">里程碑</th>
              <th className="mm-col--proj">專案</th>
              <th className="mm-col--date">計畫日期</th>
              <th className="mm-col--owner">負責人</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((ms) => {
              const hasChange = ms.date_changed_from && ms.date_changed_from !== ms.plan_date;
              const isDone = ms.ms_status === 'Finished';
              return (
                <tr
                  key={ms.id}
                  className={isDone ? 'mm-row--done' : hasChange ? 'mm-row--changed' : ''}
                >
                  <td className="mm-col--status-sm">
                    <MsStatusBadge status={ms.ms_status} />
                  </td>
                  <td className="mm-col--name" title={ms.milestone_name}>
                    {ms.milestone_name}
                  </td>
                  <td className="mm-col--proj" title={ms.project_name}>
                    {shortProjName(ms.project_name)}
                  </td>
                  <td className="mm-col--date">
                    {isDone ? (
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{ms.plan_date || '--'}</span>
                    ) : (
                      <DateCell ms={ms} />
                    )}
                  </td>
                  <td className="mm-col--owner">{ms.owner_name || '--'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function ProjectTrackingDashboardClient() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [monthData, setMonthData] = useState<MonthMilestonesData | null>(null);
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

      const [summaryRes, monthRes] = await Promise.all([
        fetch(`/api/project-tracking/summary${q}`),
        fetch(`/api/project-tracking/month-milestones${q}`),
      ]);

      if (!summaryRes.ok) {
        const err = await summaryRes.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${summaryRes.status}`);
      }
      setData(await summaryRes.json());
      if (monthRes.ok) setMonthData(await monthRes.json());
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
          <div className="brand__sub">本月上線/驗收里程碑，及逾期與近 7 天到期的專案與里程碑</div>
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

        {/* ── 本月上線 / 驗收里程碑 ── */}
        {monthData && (
          <section style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                本月里程碑（{monthData.month}）
              </h2>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                依里程碑名稱含「上線」或「驗收」篩選；⚡ 表示本月有日期變更
              </span>
            </div>
            <div className="mm-grid">
              <MonthMilestoneCard
                title="預計上線"
                items={monthData.goLive}
                stats={monthData.goLiveStats}
                variant="golive"
              />
              <MonthMilestoneCard
                title="預計驗收"
                items={monthData.acceptance}
                stats={monthData.acceptanceStats}
                variant="acceptance"
              />
            </div>
          </section>
        )}

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
