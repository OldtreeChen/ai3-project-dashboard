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

interface GitLabBranch {
  name: string;
  default: boolean;
  merged: boolean;
  protected: boolean;
  commit: GitLabCommit;
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

async function fetchBranches(projectId: number, limit: number = 10): Promise<GitLabBranch[]> {
  try {
    const url = `${GITLAB_URL}/api/v4/projects/${projectId}/repository/branches?per_page=${limit}&order_by=updated&sort=desc`;
    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
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

    // Fetch branches (with latest commits) in batches of 10
    const batchSize = 10;
    const results: any[] = [];

    for (let i = 0; i < active.length; i += batchSize) {
      const batch = active.slice(i, i + batchSize);
      const branchResults = await Promise.all(
        batch.map((p) => fetchBranches(p.id, 10))
      );
      for (let j = 0; j < batch.length; j++) {
        const p = batch[j];
        const branches = branchResults[j];

        // Sort branches by commit date desc to find the most recent
        const sortedBranches = branches
          .filter((b) => b.commit)
          .sort((a, b) => new Date(b.commit.committed_date).getTime() - new Date(a.commit.committed_date).getTime());

        const latestBranch = sortedBranches[0] || null;
        const c = latestBranch?.commit || null;

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
                branch: latestBranch!.name,
              }
            : null,
          branch_count: branches.length,
          branches: sortedBranches.map((b) => ({
            name: b.name,
            is_default: b.default,
            merged: b.merged,
            protected: b.protected,
            last_commit: {
              short_id: b.commit.short_id,
              title: b.commit.title,
              author_name: b.commit.author_name,
              committed_date: b.commit.committed_date,
              message: b.commit.message?.split('\n')[0] || b.commit.title,
            },
          })),
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
