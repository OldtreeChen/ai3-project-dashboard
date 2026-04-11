'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import TopMenu from '@/app/_components/TopMenu';
import { toZhStatus } from '@/lib/statusText';

const STAT_STATUSES = [
  'Executing',
  'Auditing',
  'AutoUpgrade',
  'Prolong',
  'Overdue',
  'OverdueUpgrade',
  'Back',
] as const;

const OVERDUE_STATUSES = new Set(['Overdue', 'OverdueUpgrade']);

type TaskRow = {
  id: string;
  name: string;
  status: string | null;
  planEndDate: string | null;
  userName: string | null;
  projectCode: string | null;
  projectName: string | null;
};

type PersonStatRow = { userName: string; status: string; cnt: number };

type SummaryData = {
  overdue: TaskRow[];
  overdueTotal: number;
  overduePage: number;
  overduePageSize: number;
  upcoming: TaskRow[];
  upcomingTotal: number;
  personStats: PersonStatRow[];
};

type Dept = { id: string; name: string };

const PAGE_SIZE = 10;

function taskProjectLabel(r: TaskRow): string | null {
  if (r.projectCode && r.projectName) return `${r.projectCode}｜${r.projectName}`;
  if (r.projectName) return r.projectName;
  if (r.projectCode) return r.projectCode;
  return null;
}

function TaskTable({ rows }: { rows: TaskRow[] }) {
  return (
    <table className="sr-table">
      <colgroup>
        <col style={{ width: '30%' }} />
        <col style={{ width: '28%' }} />
        <col style={{ width: '10%' }} />
        <col style={{ width: '16%' }} />
        <col style={{ width: '16%' }} />
      </colgroup>
      <thead>
        <tr>
          <th>任務名稱</th>
          <th>專案</th>
          <th>狀態</th>
          <th>預計完成時間</th>
          <th>負責人</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td title={r.name}>{r.name}</td>
            <td title={taskProjectLabel(r) ?? ''}>{taskProjectLabel(r) ?? '-'}</td>
            <td><span className="sr-status">{toZhStatus(r.status)}</span></td>
            <td>{r.planEndDate ?? '-'}</td>
            <td>{r.userName ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function TaskTrackingDashboardClient() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [autoPage, setAutoPage] = useState(false);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);

  const fetchData = useCallback(async (p: number, deptId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
      if (deptId) params.set('deptId', deptId);
      const res = await fetch(`/api/task-tracking/summary?${params}`);
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

  useEffect(() => { fetchData(page, selectedDeptId); }, [fetchData, page, selectedDeptId]);

  useEffect(() => {
    fetch('/api/departments')
      .then((r) => r.json())
      .then((ds: Dept[]) => setDepts(ds))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!autoPage || !data) return;
    const totalPages = Math.ceil(data.overdueTotal / PAGE_SIZE);
    if (totalPages <= 1) return;
    const timer = setInterval(() => {
      setPage((prev) => (prev >= totalPages ? 1 : prev + 1));
    }, 8000);
    return () => clearInterval(timer);
  }, [autoPage, data]);

  const personPivot = useMemo(() => {
    if (!data?.personStats?.length) return [];
    const map = new Map<string, Record<string, number>>();
    for (const r of data.personStats) {
      if (!map.has(r.userName)) map.set(r.userName, {});
      map.get(r.userName)![r.status] = r.cnt;
    }
    return Array.from(map.entries())
      .map(([name, counts]) => ({
        name,
        counts,
        overdueCnt: (counts['Overdue'] ?? 0) + (counts['OverdueUpgrade'] ?? 0),
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.overdueCnt - a.overdueCnt || b.total - a.total);
  }, [data]);

  const totalPages = data ? Math.ceil(data.overdueTotal / PAGE_SIZE) : 1;

  const selectedDeptName = selectedDeptId
    ? (depts.find((d) => d.id === selectedDeptId)?.name ?? '')
    : depts.map((d) => d.name).join('、');

  function selectDept(id: string | null) {
    setSelectedDeptId(id);
    setPage(1);
    setAutoPage(false);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">{selectedDeptName ? `${selectedDeptName}　任務追蹤` : '任務追蹤'}</div>
          <div className="brand__sub">依預計完成時間篩選：已逾期 / 近 7 天到期</div>
          <TopMenu />
        </div>
      </header>

      <main className="content content--wide">

        {/* Department selector */}
        {depts.length > 0 && (
          <div className="dept-tabs">
            <button
              className={`dept-tab${selectedDeptId === null ? ' dept-tab--active' : ''}`}
              onClick={() => selectDept(null)}
            >
              全部
            </button>
            {depts.map((d) => (
              <button
                key={d.id}
                className={`dept-tab${selectedDeptId === d.id ? ' dept-tab--active' : ''}`}
                onClick={() => selectDept(d.id)}
              >
                {d.name}
              </button>
            ))}
          </div>
        )}

        {!loading && personPivot.length > 0 && (
          <section className="sr-section sr-section--ps">
            <div className="sr-section__header">
              <h2 className="sr-section__title">人員狀態統計</h2>
            </div>
            <div className="ps-scroll">
              <table className="ps-table">
                <thead>
                  <tr>
                    <th className="ps-col--name">人員</th>
                    {STAT_STATUSES.map((s) => (
                      <th key={s} className={`ps-col--status${OVERDUE_STATUSES.has(s) ? ' ps-col--alert' : ''}`}>
                        {toZhStatus(s)}
                      </th>
                    ))}
                    <th className="ps-col--total">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {personPivot.map(({ name, counts, total }) => (
                    <tr key={name}>
                      <td className="ps-col--name">{name}</td>
                      {STAT_STATUSES.map((s) => {
                        const v = counts[s] ?? 0;
                        return (
                          <td key={s} className={`ps-col--status${OVERDUE_STATUSES.has(s) && v > 0 ? ' ps-val--alert' : ''}`}>
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

        <section className="sr-section">
          <div className="sr-section__header">
            <h2 className="sr-section__title">
              已逾期任務
              {data && <span className="sr-section__badge sr-section__badge--overdue">{data.overdueTotal} 筆</span>}
            </h2>
            <div className="sr-section__controls">
              <label className="sr-autopager">
                <input type="checkbox" checked={autoPage} onChange={(e) => setAutoPage(e.target.checked)} />
                <span> 自動翻頁（8秒）</span>
              </label>
              {totalPages > 1 && <span className="sr-page-info">第 {page} / {totalPages} 頁</span>}
            </div>
          </div>

          {loading && <div className="sr-loading">載入中…</div>}
          {error && <div className="sr-error">錯誤：{error}</div>}

          {!loading && data && (
            <>
              {data.overdue.length === 0
                ? <div className="sr-empty">目前無逾期任務</div>
                : <TaskTable rows={data.overdue} />
              }
              {totalPages > 1 && (
                <div className="sr-pagination">
                  <button className="btn btn--sm" disabled={page <= 1}
                    onClick={() => { setAutoPage(false); setPage((p) => Math.max(1, p - 1)); }}>
                    &laquo; 上頁
                  </button>
                  <span className="sr-pagination__info">{page} / {totalPages}</span>
                  <button className="btn btn--sm" disabled={page >= totalPages}
                    onClick={() => { setAutoPage(false); setPage((p) => Math.min(totalPages, p + 1)); }}>
                    下頁 &raquo;
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="sr-section">
          <div className="sr-section__header">
            <h2 className="sr-section__title">
              近 7 天到期任務
              {data && <span className="sr-section__badge sr-section__badge--upcoming">{data.upcomingTotal} 筆</span>}
            </h2>
          </div>
          {!loading && data && (
            data.upcoming.length === 0
              ? <div className="sr-empty">近 7 天無到期任務</div>
              : <TaskTable rows={data.upcoming} />
          )}
        </section>

      </main>
    </div>
  );
}
