import { NextRequest } from 'next/server';

const GITLAB_URL = process.env.GITLAB_URL || '';
const GITLAB_TOKEN = process.env.GITLAB_TOKEN || '';

interface GitLabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  path_with_namespace: string;
  web_url: string;
  default_branch: string | null;
  last_activity_at: string;
  archived: boolean;
  empty_repo: boolean;
  namespace: {
    id: number;
    name: string;
    full_path: string;
    kind: string;
    parent_id: number | null;
  };
}

interface GitLabCommit {
  id: string;
  short_id: string;
  title: string;
  author_name: string;
  authored_date: string;
  committer_name: string;
  committed_date: string;
  message: string;
}

async function fetchProjects(limit: number): Promise<{ projects: GitLabProject[]; totalOnServer: number }> {
  const perPage = Math.min(limit, 100);
  const maxPages = Math.ceil(limit / perPage);
  const all: GitLabProject[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const remaining = limit - all.length;
    const thisPage = Math.min(remaining, perPage);
    const url = `${GITLAB_URL}/api/v4/projects?per_page=${thisPage}&page=${page}&order_by=last_activity_at&sort=desc&simple=true&archived=false`;
    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitLab API ${res.status}: ${body.slice(0, 200)}`);
    }
    const totalOnServer = Number(res.headers.get('X-Total') || '0');
    const data: GitLabProject[] = await res.json();
    if (data.length === 0) return { projects: all, totalOnServer };
    all.push(...data);
    if (all.length >= limit) return { projects: all.slice(0, limit), totalOnServer };
    const totalPages = Number(res.headers.get('X-Total-Pages') || '1');
    if (page >= totalPages) return { projects: all, totalOnServer };
  }
  return { projects: all, totalOnServer: all.length };
}

async function fetchLastCommit(projectId: number, branch: string | null): Promise<GitLabCommit | null> {
  try {
    const ref = branch ? `&ref_name=${encodeURIComponent(branch)}` : '';
    const url = `${GITLAB_URL}/api/v4/projects/${projectId}/repository/commits?per_page=1${ref}`;
    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const commits: GitLabCommit[] = await res.json();
    return commits[0] || null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!GITLAB_URL || !GITLAB_TOKEN) {
    return Response.json({
      error: `GITLAB_URL or GITLAB_TOKEN not configured. GITLAB_URL=${GITLAB_URL ? 'set' : 'empty'}, GITLAB_TOKEN=${GITLAB_TOKEN ? 'set' : 'empty'}`,
    }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get('limit') || '25'), 500);

    const { projects, totalOnServer } = await fetchProjects(limit);

    // Filter empty repos
    const active = projects.filter((p) => !p.empty_repo);

    // Fetch last commit in batches of 10
    const batchSize = 10;
    const results: any[] = [];

    for (let i = 0; i < active.length; i += batchSize) {
      const batch = active.slice(i, i + batchSize);
      const commits = await Promise.all(
        batch.map((p) => fetchLastCommit(p.id, p.default_branch))
      );
      for (let j = 0; j < batch.length; j++) {
        const p = batch[j];
        const c = commits[j];
        results.push({
          id: p.id,
          name: p.name,
          name_with_namespace: p.name_with_namespace,
          path_with_namespace: p.path_with_namespace,
          web_url: p.web_url,
          default_branch: p.default_branch,
          last_activity_at: p.last_activity_at,
          group: p.namespace?.full_path || '',
          group_name: p.namespace?.name || '',
          last_commit: c
            ? {
                short_id: c.short_id,
                title: c.title,
                author_name: c.author_name,
                committed_date: c.committed_date,
                message: c.message?.split('\n')[0] || c.title,
              }
            : null,
        });
      }
    }

    return Response.json({
      total: results.length,
      totalOnServer,
      limit,
      fetched_at: new Date().toISOString(),
      projects: results,
    });
  } catch (err: any) {
    return Response.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
