'use client';

import { useEffect, useMemo, useState } from 'react';
import TopMenu from '../_components/TopMenu';

type LastCommit = {
  short_id: string;
  title: string;
  author_name: string;
  committed_date: string;
  message: string;
};

type Project = {
  id: number;
  name: string;
  name_with_namespace: string;
  path_with_namespace: string;
  web_url: string;
  default_branch: string | null;
  last_activity_at: string;
  group: string;
  group_name: string;
  last_commit: LastCommit | null;
};

type ApiResponse = {
  total: number;
  fetched_at: string;
  projects: Project[];
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '--';
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '剛才';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小時前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth} 個月前`;
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 9999;
  const now = new Date();
  const d = new Date(dateStr);
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}

function freshness(days: number): { cls: string; label: string } {
  if (days <= 1) return { cls: 'badge--good', label: '活躍' };
  if (days <= 7) return { cls: 'badge--ok', label: '本週' };
  if (days <= 30) return { cls: 'badge--warn', label: '本月' };
  if (days <= 90) return { cls: 'badge--stale', label: '季度內' };
  return { cls: 'badge--bad', label: '超過90天' };
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

type SortKey = 'name' | 'group' | 'last_commit' | 'author' | 'days';

export default function GitlabDashboardClient() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [freshnessFilter, setFreshnessFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('last_commit');
  const [sortAsc, setSortAsc] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/gitlab/projects', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json: ApiResponse = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message || '查詢失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Extract unique groups
  const groups = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.projects.map((p) => p.group));
    return [...set].sort();
  }, [data]);

  // Filter & sort
  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.projects;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.name_with_namespace.toLowerCase().includes(q) ||
          p.path_with_namespace.toLowerCase().includes(q) ||
          (p.last_commit?.author_name || '').toLowerCase().includes(q)
      );
    }

    if (groupFilter) {
      list = list.filter((p) => p.group === groupFilter);
    }

    if (freshnessFilter) {
      list = list.filter((p) => {
        const days = daysSince(p.last_commit?.committed_date || p.last_activity_at);
        switch (freshnessFilter) {
          case 'active': return days <= 1;
          case 'week': return days <= 7;
          case 'month': return days <= 30;
          case 'stale': return days > 30 && days <= 90;
          case 'dead': return days > 90;
          default: return true;
        }
      });
    }

    // Sort
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'group':
          cmp = a.group.localeCompare(b.group);
          break;
        case 'last_commit': {
          const da = a.last_commit?.committed_date || a.last_activity_at || '';
          const db = b.last_commit?.committed_date || b.last_activity_at || '';
          cmp = da.localeCompare(db);
          break;
        }
        case 'author': {
          const aa = a.last_commit?.author_name || '';
          const ab = b.last_commit?.author_name || '';
          cmp = aa.localeCompare(ab);
          break;
        }
        case 'days': {
          const daysA = daysSince(a.last_commit?.committed_date || a.last_activity_at);
          const daysB = daysSince(b.last_commit?.committed_date || b.last_activity_at);
          cmp = daysA - daysB;
          break;
        }
      }
      return sortAsc ? cmp : -cmp;
    });

    return sorted;
  }, [data, search, groupFilter, freshnessFilter, sortKey, sortAsc]);

  // Stats
  const stats = useMemo(() => {
    if (!data) return { total: 0, active: 0, week: 0, month: 0, stale: 0, dead: 0 };
    const projects = data.projects;
    let active = 0, week = 0, month = 0, stale = 0, dead = 0;
    for (const p of projects) {
      const days = daysSince(p.last_commit?.committed_date || p.last_activity_at);
      if (days <= 1) active++;
      else if (days <= 7) week++;
      else if (days <= 30) month++;
      else if (days <= 90) stale++;
      else dead++;
    }
    return { total: projects.length, active, week, month, stale, dead };
  }, [data]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'name' || key === 'group');
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortAsc ? ' ▲' : ' ▼';
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">GitLab 專案提交追蹤</div>
          <div className="brand__sub">追蹤所有專案最後提交時間與活躍度</div>
          <TopMenu />
        </div>
      </header>

      <main className="content content--wide">
        {/* Filters */}
        <div className="filters filters--center" style={{ marginBottom: 12 }}>
          <label className="field">
            <span className="field__label">搜尋</span>
            <input
              className="field__control"
              type="text"
              placeholder="專案名稱 / 路徑 / 作者"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 200 }}
            />
          </label>
          <label className="field">
            <span className="field__label">Group</span>
            <select className="field__control" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
              <option value="">全部</option>
              {groups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">活躍度</span>
            <select className="field__control" value={freshnessFilter} onChange={(e) => setFreshnessFilter(e.target.value)}>
              <option value="">全部</option>
              <option value="active">今日活躍</option>
              <option value="week">本週內</option>
              <option value="month">本月內</option>
              <option value="stale">30-90天未提交</option>
              <option value="dead">超過90天</option>
            </select>
          </label>
          <button className="btn btn--primary" onClick={() => void loadData()} disabled={loading}>
            {loading ? '載入中…' : '重新整理'}
          </button>
        </div>

        {/* Stats */}
        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panel__header">
            <div className="panel__title">專案活躍度概覽</div>
            <div className="panel__meta">
              {data ? `共 ${stats.total} 個專案` : ''}
              {data ? ` · 更新時間 ${fmtDate(data.fetched_at)}` : ''}
            </div>
          </div>
          <div className="panel__body">
            <div className="summary-strip">
              <div className="summary-strip__item" style={{ cursor: 'pointer' }} onClick={() => setFreshnessFilter('')}>
                <div className="summary-strip__label">全部專案</div>
                <div className="summary-strip__value">{stats.total}</div>
              </div>
              <div className="summary-strip__item" style={{ cursor: 'pointer' }} onClick={() => setFreshnessFilter('active')}>
                <div className="summary-strip__label">今日活躍</div>
                <div className="summary-strip__value"><span className="badge badge--good">{stats.active}</span></div>
              </div>
              <div className="summary-strip__item" style={{ cursor: 'pointer' }} onClick={() => setFreshnessFilter('week')}>
                <div className="summary-strip__label">本週內</div>
                <div className="summary-strip__value"><span className="badge badge--ok">{stats.week}</span></div>
              </div>
              <div className="summary-strip__item" style={{ cursor: 'pointer' }} onClick={() => setFreshnessFilter('month')}>
                <div className="summary-strip__label">本月內</div>
                <div className="summary-strip__value"><span className="badge badge--warn">{stats.month}</span></div>
              </div>
              <div className="summary-strip__item" style={{ cursor: 'pointer' }} onClick={() => setFreshnessFilter('stale')}>
                <div className="summary-strip__label">30-90天</div>
                <div className="summary-strip__value"><span className="badge badge--stale">{stats.stale}</span></div>
              </div>
              <div className="summary-strip__item" style={{ cursor: 'pointer' }} onClick={() => setFreshnessFilter('dead')}>
                <div className="summary-strip__label">超過90天</div>
                <div className="summary-strip__value"><span className="badge badge--bad">{stats.dead}</span></div>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <section className="panel" style={{ marginBottom: 12 }}>
            <div className="panel__body">
              <span className="badge badge--bad">錯誤：{error}</span>
            </div>
          </section>
        ) : null}

        {/* Project table */}
        <section className="panel">
          <div className="panel__header">
            <div className="panel__title">專案列表</div>
            <div className="panel__meta">{loading ? '載入中…' : `${filtered.length} 個專案`}</div>
          </div>
          <div className="panel__body" style={{ padding: 0 }}>
            <div className="att-scroll">
              <table className="table gitlab-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th className="gitlab-table__sortable" onClick={() => handleSort('group')}>
                      Group{sortIcon('group')}
                    </th>
                    <th className="gitlab-table__sortable" onClick={() => handleSort('name')}>
                      專案名稱{sortIcon('name')}
                    </th>
                    <th className="gitlab-table__sortable" onClick={() => handleSort('last_commit')}>
                      最後提交時間{sortIcon('last_commit')}
                    </th>
                    <th className="gitlab-table__sortable" onClick={() => handleSort('days')}>
                      距今{sortIcon('days')}
                    </th>
                    <th>活躍度</th>
                    <th className="gitlab-table__sortable" onClick={() => handleSort('author')}>
                      提交者{sortIcon('author')}
                    </th>
                    <th>提交訊息</th>
                    <th>Commit</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length ? (
                    filtered.map((p, idx) => {
                      const commitDate = p.last_commit?.committed_date || p.last_activity_at;
                      const days = daysSince(commitDate);
                      const fresh = freshness(days);
                      return (
                        <tr key={p.id}>
                          <td className="muted">{idx + 1}</td>
                          <td>
                            <span className="gitlab-group">{p.group}</span>
                          </td>
                          <td>
                            <a
                              href={p.web_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="gitlab-project-link"
                            >
                              {p.name}
                            </a>
                          </td>
                          <td className="num">{fmtDate(commitDate)}</td>
                          <td className="num">{timeAgo(commitDate)}</td>
                          <td>
                            <span className={`badge ${fresh.cls}`}>{fresh.label}</span>
                          </td>
                          <td>{p.last_commit?.author_name || '--'}</td>
                          <td className="gitlab-commit-msg" title={p.last_commit?.message || ''}>
                            {p.last_commit?.message || '--'}
                          </td>
                          <td>
                            {p.last_commit ? (
                              <a
                                href={`${p.web_url}/-/commit/${p.last_commit.short_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="gitlab-commit-id"
                              >
                                {p.last_commit.short_id}
                              </a>
                            ) : '--'}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="muted" style={{ textAlign: 'center' }}>
                        {loading ? '載入中…' : '無符合條件的專案'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
