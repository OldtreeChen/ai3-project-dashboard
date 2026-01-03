import './globals.css';

export const metadata = {
  title: '專案工時儀表板',
  description: 'Projects / Tasks / People / Hours'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}



