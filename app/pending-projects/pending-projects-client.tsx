'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Row = {
  id: string | number;
  code: string | null;
  name: string;
  planned_hours: number;
  status: string;
  status_zh?: string | null;
  project_type_raw?: string | null;
  project_type?: string | null;
  department_id?: string | number | null;
  owner_user_id?: string | number | null;
  owner_name?: string | null;
};

function fmtHours(v: unknown) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return (await res.json()) as T;
}

export default function PendingProjectsClient() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await apiGet<{ projects: Row[] }>('/api/pending-projects');
        setRows(data.projects || []);
      } catch (e: any) {
        setError(e?.message || '載入失敗');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const counts = useMemo(() => {
    const by = { New: 0, Assigned: 0, total: rows.length };
    for (const r of rows) {
      if (r.status === 'New') by.New += 1;
      if (r.status === 'Assigned') by.Assigned += 1;
    }
    return by;
  }, [rows]);

  return (
    <section className="panel">
      <div className="panel__header">
        <div className="panel__title">清單</div>
        <div className="panel__meta">
          {loading ? '載入中…' : error ? `錯誤：${error}` : `共 ${counts.total} 筆（新增 ${counts.New}、已分配 ${counts.Assigned}）`}
        </div>
      </div>
      <div className="panel__body">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>專案類型</th>
                <th>專案</th>
                <th>狀態</th>
                <th>負責人</th>
                <th className="num">預估</th>
                <th style={{ width: 84 }} />
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((p) => (
                  <tr key={String(p.id)}>
                    <td>{p.project_type || <span className="muted">--</span>}</td>
                    <td title={p.name}>{p.code ? `${p.code}｜${p.name}` : p.name}</td>
                    <td>{p.status_zh || <span className="muted">{p.status}</span>}</td>
                    <td>{p.owner_name || <span className="muted">--</span>}</td>
                    <td className="num">{fmtHours(p.planned_hours)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="btn" href={`/?projectId=${encodeURIComponent(String(p.id))}`}>
                        明細
                      </Link>
                    </td>
                  </tr>
                ))
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
      </div>
    </section>
  );
}


