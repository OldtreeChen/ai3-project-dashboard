'use client';

import { useState, useEffect, useCallback } from 'react';
import TopMenu from '@/app/_components/TopMenu';
const STATUS_LABEL: Record<string, string> = {
  New: '新建',
  Send: '延時申請中',
  Auditing: '審核中',
  Execute: '執行中',
  Executing: '執行中',
  OverdueExecute: '延時執行中',
  AutoUpgrade: '自動升級中',
  Overdue: '逾時執行中',
  OverdueUpgrade: '逾時自動升級中',
  Back: '返回修改中',
  FinishAuditing: '完成審核',
  Finished: '已完成',
  Discard: '作廢',
  Discarded: '作廢',
};
function zhStatus(s: string | null) {
  if (!s) return '-';
  return STATUS_LABEL[s] ?? s;
}

type TaskRow = {
  id: string;
  name: string;
  status: string | null;
  planEndDate: string | null;
  userName: string | null;
  projectCode: string | null;
  projectName: string | null;
};

type SummaryData = {
  overdue: TaskRow[];
  overdueTotal: number;
  overduePage: number;
  overduePageSize: number;
  upcoming: TaskRow[];
  upcomingTotal: number;
};

const PAGE_SIZE = 10;

export default function TaskTrackingDashboardClient() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [autoPage, setAutoPage] = useState(false);
  const [deptLabel, setDeptLabel] = useState('');

  const fetchData = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/task-tracking/summary?page=${p}&pageSize=${PAGE_SIZE}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      const json: SummaryData = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? '載入失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(page);
  }, [fetchData, page]);

  useEffect(() => {
    fetch('/api/departments')
      .then((r) => r.json())
      .then((ds: Array<{ name: string }>) => setDeptLabel(ds.map((d) => d.name).join('、')))
      .catch(() => {});
  }, []);

  // Auto-pagination for overdue list every 8 seconds
  useEffect(() => {
    if (!autoPage || !data) return;
    const totalPages = Math.ceil(data.overdueTotal / PAGE_SIZE);
    if (totalPages <= 1) return;
    const timer = setInterval(() => {
      setPage((prev) => (prev >= totalPages ? 1 : prev + 1));
    }, 8000);
    return () => clearInterval(timer);
  }, [autoPage, data]);

  const totalPages = data ? Math.ceil(data.overdueTotal / PAGE_SIZE) : 1;

  const taskProjectLabel = (r: TaskRow) => {
    if (r.projectCode && r.projectName) return `${r.projectCode}｜${r.projectName}`;
    if (r.projectName) return r.projectName;
    if (r.projectCode) return r.projectCode;
    return null;
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">{deptLabel ? `${deptLabel}　任務追蹤` : '任務追蹤'}</div>
          <div className="brand__sub">依預計完成時間篩選：已逾期 / 近 7 天到期</div>
          <TopMenu />
        </div>
      </header>

      <main className="content">
        {/* Section 1: Overdue */}
        <section className="sr-section">
          <div className="sr-section__header">
            <h2 className="sr-section__title">
              已逾期任務
              {data && (
                <span className="sr-section__badge sr-section__badge--overdue">
                  {data.overdueTotal} 筆
                </span>
              )}
            </h2>
            <div className="sr-section__controls">
              <label className="sr-autopager">
                <input
                  type="checkbox"
                  checked={autoPage}
                  onChange={(e) => setAutoPage(e.target.checked)}
                />
                <span> 自動翻頁（8秒）</span>
              </label>
              {totalPages > 1 && (
                <span className="sr-page-info">第 {page} / {totalPages} 頁</span>
              )}
            </div>
          </div>

          {loading && <div className="sr-loading">載入中…</div>}
          {error && <div className="sr-error">錯誤：{error}</div>}

          {!loading && data && (
            <>
              {data.overdue.length === 0 ? (
                <div className="sr-empty">目前無逾期任務</div>
              ) : (
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
                    {data.overdue.map((r) => (
                      <tr key={r.id}>
                        <td title={r.name}>{r.name}</td>
                        <td title={taskProjectLabel(r) ?? ''}>{taskProjectLabel(r) ?? '-'}</td>
                        <td><span className="sr-status">{zhStatus(r.status)}</span></td>
                        <td className="sr-overdue-date">{r.planEndDate ?? '-'}</td>
                        <td>{r.userName ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {totalPages > 1 && (
                <div className="sr-pagination">
                  <button
                    className="btn btn--sm"
                    disabled={page <= 1}
                    onClick={() => { setAutoPage(false); setPage((p) => Math.max(1, p - 1)); }}
                  >
                    &laquo; 上頁
                  </button>
                  <span className="sr-pagination__info">{page} / {totalPages}</span>
                  <button
                    className="btn btn--sm"
                    disabled={page >= totalPages}
                    onClick={() => { setAutoPage(false); setPage((p) => Math.min(totalPages, p + 1)); }}
                  >
                    下頁 &raquo;
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Section 2: Upcoming 7 days */}
        <section className="sr-section">
          <div className="sr-section__header">
            <h2 className="sr-section__title">
              近 7 天到期任務
              {data && (
                <span className="sr-section__badge sr-section__badge--upcoming">
                  {data.upcomingTotal} 筆
                </span>
              )}
            </h2>
          </div>

          {!loading && data && (
            <>
              {data.upcoming.length === 0 ? (
                <div className="sr-empty">近 7 天無到期任務</div>
              ) : (
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
                    {data.upcoming.map((r) => (
                      <tr key={r.id}>
                        <td title={r.name}>{r.name}</td>
                        <td title={taskProjectLabel(r) ?? ''}>{taskProjectLabel(r) ?? '-'}</td>
                        <td><span className="sr-status">{zhStatus(r.status)}</span></td>
                        <td>{r.planEndDate ?? '-'}</td>
                        <td>{r.userName ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
