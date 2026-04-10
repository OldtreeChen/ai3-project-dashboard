import './globals.css';

export const metadata = {
  title: 'AI技術服務部工時儀表板',
  description: '部門/人員任務工時追蹤'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}



