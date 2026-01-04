import TopMenu from '../_components/TopMenu';
import PendingProjectsClient from './pending-projects-client';

export default function PendingProjectsPage() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand__title">新增 / 已分配專案清單</div>
          <div className="brand__sub">列出狀態為「新增」「已分配」的【AI】專案</div>
          <TopMenu />
        </div>
      </header>
      <main className="content">
        <PendingProjectsClient />
      </main>
    </div>
  );
}


