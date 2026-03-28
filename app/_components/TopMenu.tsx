'use client';

import { usePathname } from 'next/navigation';

type LinkItem = { href: string; label: string };

const LINKS: LinkItem[] = [
  { href: '/', label: '各專案任務工時明細表' },
  { href: '/pm-dashboard', label: 'PM 負載彙總表' },
  { href: '/dept-person-month-dashboard', label: '部門/人員任務（月）' },
  { href: '/attendance-month-dashboard', label: '月度工時填報追蹤' },
  { href: '/checkin-month-dashboard', label: '月度出勤打卡追蹤' },
  { href: '/gitlab-dashboard', label: 'GitLab 專案追蹤' },
];

export default function TopMenu() {
  const pathname = usePathname() || '/';
  return (
    <div className="menu">
      {LINKS.map((l) => {
        const isActive = pathname === l.href;
        return (
          <a key={l.href} className={`menu__link${isActive ? ' menu__link--active' : ''}`} href={l.href}>
            {l.label}
          </a>
        );
      })}
    </div>
  );
}


