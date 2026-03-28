import GitlabDashboardClient from './gitlab-dashboard-client';

export const metadata = { title: 'GitLab 專案提交追蹤' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <GitlabDashboardClient />;
}
