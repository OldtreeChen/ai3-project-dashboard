'use client';

import { useEffect, useMemo, useState } from 'react';
import TopMenu from '../_components/TopMenu';

type Table = {
  table_name: string;
  table_comment: string | null;
  score: number;
  hits: string[];
  columns: Array<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_key: string;
    column_comment: string | null;
    ordinal_position: number;
  }>;
};

export default function SchemaPage() {
  const [q, setQ] = useState(
    'project,proj,prj,task,issue,ticket,time,hour,hours,timesheet,worklog,manhour,employee,emp,user,member,staff,people'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tables, setTables] = useState<Table[]>([]);

  const grouped = useMemo(() => {
    const groups: Record<string, Table[]> = { 專案: [], 任務: [], 工時: [], 員工: [], 其他: [] };
    for (const t of tables) {
      const name = t.table_name.toLowerCase();
      if (name.includes('project') || name.includes('proj') || name.includes('prj')) groups.專案.push(t);
      else if (name.includes('task') || name.includes('issue') || name.includes('ticket') || name.includes('workitem')) groups.任務.push(t);
      else if (name.includes('time') || name.includes('hour') || name.includes('timesheet') || name.includes('worklog') || name.includes('manhour'))
        groups.工時.push(t);
      else if (name.includes('employee') || name.includes('emp') || name.includes('user') || name.includes('member') || name.includes('staff') || name.includes('people'))
        groups.員工.push(t);
      else groups.其他.push(t);
    }
    return groups;
  }, [tables]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/introspect?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      setTables(data.tables || []);
    } catch (e: any) {
      setError(e?.message || '載入失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">資料表探索</div>
          <div className="brand__sub">從既有 MariaDB 表找出「專案 / 任務 / 工時 / 員工」候選</div>
          <TopMenu />
        </div>
      </header>

      <main className="content">
        <div className="filters filters--center" style={{ marginBottom: 12 }}>
          <label className="field" style={{ minWidth: 520 }}>
            <span className="field__label">關鍵字（逗號分隔）</span>
            <input className="field__control" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button className="btn btn--primary" onClick={() => void load()} disabled={loading}>
            {loading ? '掃描中…' : '重新掃描'}
          </button>
          <a className="btn" href="/" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            回 Dashboard
          </a>
        </div>

        {error ? (
          <section className="panel" style={{ marginBottom: 12 }}>
            <div className="panel__body">
              <span className="badge badge--bad">錯誤：{error}</span>
            </div>
          </section>
        ) : null}

        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panel__header">
            <div className="panel__title">操作</div>
            <div className="panel__meta">把你確認的表名/欄位貼回來，我就能幫你把 dashboard 查詢改成正式版</div>
          </div>
          <div className="panel__body">
            <div className="muted" style={{ lineHeight: 1.7 }}>
              建議先從每一類挑 1~2 張最像的表，觀察欄位是否包含：
              <br />
              - 專案：專案代碼/名稱/起訖日
              <br />
              - 任務：任務名稱/所屬專案/負責人
              <br />
              - 工時：日期/工時數/對應任務/對應員工
              <br />
              - 員工：帳號/姓名/部門
            </div>
          </div>
        </section>

        {Object.entries(grouped).map(([groupName, list]) => (
          <section key={groupName} className="panel" style={{ marginBottom: 12 }}>
            <div className="panel__header">
              <div className="panel__title">
                {groupName}（{list.length}）
              </div>
              <div className="panel__meta">依 table 名稱粗分，分數越高越接近需求</div>
            </div>
            <div className="panel__body">
              {list.length ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  {list.map((t) => (
                    <div key={t.table_name} style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.03)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <strong>{t.table_name}</strong>{' '}
                          <span className="muted" style={{ fontSize: 12 }}>
                            score={t.score} {t.hits?.length ? `hits=${t.hits.join(',')}` : ''}
                          </span>
                          {t.table_comment ? (
                            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                              {t.table_comment}
                            </div>
                          ) : null}
                        </div>
                        <button
                          className="btn"
                          onClick={() => void navigator.clipboard.writeText(t.table_name)}
                          style={{ height: 30 }}
                        >
                          複製表名
                        </button>
                      </div>
                      <div className="table-scroll" style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', borderRadius: 0 }}>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>欄位</th>
                              <th>型別</th>
                              <th className="num">NULL</th>
                              <th className="num">KEY</th>
                              <th>備註</th>
                            </tr>
                          </thead>
                          <tbody>
                            {t.columns.map((c) => (
                              <tr key={c.column_name}>
                                <td>{c.column_name}</td>
                                <td>{c.data_type}</td>
                                <td className="num">{c.is_nullable}</td>
                                <td className="num">{c.column_key || ''}</td>
                                <td className="muted">{c.column_comment || ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">沒有找到符合的表（可調整關鍵字再掃描）。</div>
              )}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}



