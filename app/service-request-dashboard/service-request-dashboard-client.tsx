'use client';

import { useState, useEffect, useCallback } from 'react';
import TopMenu from '@/app/_components/TopMenu';

type ServiceRequest = {
  id: string;
  name: string;
  status: string;
  planEndDate: string | null;
  priority: string | null;
  createTime: string | null;
  userName: string | null;
  deptName: string | null;
};

type SummaryData = {
  overdue: ServiceRequest[];
  overdueTotal: number;
  overduePage: number;
  overduePageSize: number;
  upcoming: ServiceRequest[];
  upcomingTotal: number;
};

const STATUS_LABEL: Record<string, string> = {
  New: '未開始',
  Assigned: '已分配',
  Finished: '已完成',
  Delay: '延時申請中',
  Execute: '執行中',
  Auditing: '審核中',
  Send: '未分配',
  Again: '重分配',
  Overdue: '逾時執行中',
  AutoUpgrade: '自動升級中',
  OverdueUpgrade: '逾時自動升級中',
  Back: '返回修改中',
  FinishAuditing: '關閉審核中',
  OverdueDelay: '逾時延時申請中',
  Discard: '已作廢',
};

const PRIORITY_LABEL: Record<string, string> = {
  High: '高',
  Medium: '中',
  Low: '低',
  Urgent: '緊急',
};

function statusLabel(s: string) {
  return STATUS_LABEL[s] ?? s;
}

function priorityLabel(p: string | null) {
  if (!p) return '-';
  return PRIORITY_LABEL[p] ?? p;
}

function priorityClass(p: string | null) {
  if (p === 'Urgent') return 'priority--urgent';
  if (p === 'High') return 'priority--high';
  if (p === 'Medium') return 'priority--medium';
  return '';
}

const PAGE_SIZE = 10;

export default function ServiceRequestDashboardClient() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [autoPage, setAutoPage] = useState(false);

  const fetchData = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-requests/summary?page=${p}&pageSize=${PAGE_SIZE}`);
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

  // Auto-pagination for overdue list: cycle through pages every 8 seconds
  useEffect(() => {
    if (!autoPage || !data) return;
    const totalPages = Math.ceil(data.overdueTotal / PAGE_SIZE);
    if (totalPages <= 1) return;
    const timer = setInterval(() => {
      setPage((prev) => {
        const next = prev >= totalPages ? 1 : prev + 1;
        return next;
      });
    }, 8000);
    return () => clearInterval(timer);
  }, [autoPage, data]);

  const totalPages = data ? Math.ceil(data.overdueTotal / PAGE_SIZE) : 1;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">服務請求追蹤</div>
          <div className="brand__sub">依預計完成時間篩選：已逾期 / 近 7 天到期（審核中、執行中）</div>
          <TopMenu />
        </div>
      </header>

      <main className="content">
        {/* Section 1: Overdue */}
        <section className="sr-section">
          <div className="sr-section__header">
            <h2 className="sr-section__title">
              已逾期服務請求
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
                <span className="sr-page-info">
                  第 {page} / {totalPages} 頁
                </span>
              )}
            </div>
          </div>

          {loading && <div className="sr-loading">載入中…</div>}
          {error && <div className="sr-error">錯誤：{error}</div>}

          {!loading && data && (
            <>
              {data.overdue.length === 0 ? (
                <div className="sr-empty">目前無逾期服務請求</div>
              ) : (
                <table className="sr-table">
                  <thead>
                    <tr>
                      <th className="sr-col--name">服務請求名稱</th>
                      <th className="sr-col--status">狀態</th>
                      <th className="sr-col--priority">優先級</th>
                      <th className="sr-col--date">預計完成時間</th>
                      <th className="sr-col--user">負責人</th>
                      <th className="sr-col--dept">部門</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.overdue.map((r) => (
                      <tr key={r.id}>
                        <td className="sr-col--name" title={r.name}>{r.name}</td>
                        <td className="sr-col--status">
                          <span className="sr-status">{statusLabel(r.status)}</span>
                        </td>
                        <td className="sr-col--priority">
                          <span className={`sr-priority ${priorityClass(r.priority)}`}>
                            {priorityLabel(r.priority)}
                          </span>
                        </td>
                        <td className="sr-col--date sr-overdue-date">{r.planEndDate ?? '-'}</td>
                        <td className="sr-col--user">{r.userName ?? '-'}</td>
                        <td className="sr-col--dept">{r.deptName ?? '-'}</td>
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
                  <span className="sr-pagination__info">
                    {page} / {totalPages}
                  </span>
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
              近 7 天到期服務請求
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
                <div className="sr-empty">近 7 天無到期服務請求</div>
              ) : (
                <table className="sr-table">
                  <thead>
                    <tr>
                      <th className="sr-col--name">服務請求名稱</th>
                      <th className="sr-col--status">狀態</th>
                      <th className="sr-col--priority">優先級</th>
                      <th className="sr-col--date">預計完成時間</th>
                      <th className="sr-col--user">負責人</th>
                      <th className="sr-col--dept">部門</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.upcoming.map((r) => (
                      <tr key={r.id}>
                        <td className="sr-col--name" title={r.name}>{r.name}</td>
                        <td className="sr-col--status">
                          <span className="sr-status">{statusLabel(r.status)}</span>
                        </td>
                        <td className="sr-col--priority">
                          <span className={`sr-priority ${priorityClass(r.priority)}`}>
                            {priorityLabel(r.priority)}
                          </span>
                        </td>
                        <td className="sr-col--date">{r.planEndDate ?? '-'}</td>
                        <td className="sr-col--user">{r.userName ?? '-'}</td>
                        <td className="sr-col--dept">{r.deptName ?? '-'}</td>
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
