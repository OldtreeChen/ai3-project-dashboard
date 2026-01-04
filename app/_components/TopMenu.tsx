'use client';

import { usePathname } from 'next/navigation';

type LinkItem = { href: string; label: string };

const LINKS: LinkItem[] = [
  { href: '/', label: '各專案工時明細表' },
  { href: '/pm-dashboard', label: 'PM 負載儀表板' },
  { href: '/people-dashboard', label: '人員任務儀表板' },
  { href: '/dept-person-month-dashboard', label: '部門/人員任務（月）' },
  { href: '/schema', label: '資料表探索' }
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


