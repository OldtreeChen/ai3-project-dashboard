/**
 * Builds the SQL department filter for project-tracking queries.
 *
 * Reads PROJECT_DEPT_KEYWORDS env var (comma-separated), defaulting to
 * 'AI專案一部,AI專案二部'.
 *
 * Example:
 *   PROJECT_DEPT_KEYWORDS=AI智能研發  →  AND (dp.FName LIKE '%AI智能研發%')
 */
export function getProjectDeptFilter(deptNameCol: string): string {
  const raw = process.env.PROJECT_DEPT_KEYWORDS || 'AI專案一部,AI專案二部';
  const keywords = raw.split(',').map((k) => k.trim()).filter(Boolean);
  if (!keywords.length) return '';
  const clauses = keywords.map((k) => `${deptNameCol} LIKE '%${k.replace(/'/g, "''")}%'`).join(' OR ');
  return `AND (${clauses})`;
}
