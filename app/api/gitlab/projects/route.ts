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

async function fetchAllProjects(): Promise<GitLabProject[]> {
  const all: GitLabProject[] = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const url = `${GITLAB_URL}/api/v4/projects?per_page=${perPage}&page=${page}&order_by=last_activity_at&sort=desc&simple=true`;
    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`GitLab API ${res.status}`);
    const data: GitLabProject[] = await res.json();
    if (data.length === 0) break;
    all.push(...data);
    const totalPages = Number(res.headers.get('X-Total-Pages') || '1');
    if (page >= totalPages) break;
    page++;
  }
  return all;
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
    return Response.json({ error: 'GITLAB_URL or GITLAB_TOKEN not configured' }, { status: 500 });
  }

  try {
    const projects = await fetchAllProjects();

    // Filter out archived and empty repos
    const active = projects.filter((p) => !p.archived && !p.empty_repo);

    // Fetch last commit for each project (in batches of 20 to avoid overwhelming)
    const batchSize = 20;
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
      fetched_at: new Date().toISOString(),
      projects: results,
    });
  } catch (err: any) {
    return Response.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
