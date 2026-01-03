## 專案工時儀表板（hours-dashboard）

### 目標
- 顯示 **專案總工時狀態**
- 顯示 **每位人員在各任務的工時使用狀態**

### 啟動方式（本機）
先確定你有安裝 Node.js（建議 18+）。

```bash
cd hours-dashboard
npm install
npm run dev
```

啟動後開啟：`http://localhost:5179`

### DB 連線（MariaDB / MySQL）
本專案的 Prisma datasource 會讀 `DATABASE_URL`（建議用環境變數），或讀專案根目錄的 `config.json`（避免每次都要設定 env）。

#### 方式 A：PowerShell 設定環境變數（推薦）
```powershell
$env:DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/DBNAME"
npx prisma db pull
npx prisma generate
npm run dev
```

> 注意：密碼若含 `!` 等特殊字元，需要 URL encode（例如 `!` → `%21`）。

#### 方式 B：使用 `config.json`
1. 複製 `config.example.json` 為 `config.json`
2. 填入 `databaseUrl`

```json
{
  "port": 5179,
  "databaseUrl": "mysql://USER:PASSWORD@HOST:3306/DBNAME"
}
```

> 注意：`config.json` 會包含密碼，請勿提交到版本庫。

### 環境變數（舊版 / 可忽略）
早期 Express 版會用 `.env`，目前 Next.js + Prisma 以 `DATABASE_URL` / `config.json` 為主。

- `PORT`：服務埠號（預設 `5179`）
- `DB_PATH`：SQLite 檔案路徑（預設 `./data/hours.db`）

### 資料模型（SQLite）
- `projects`：專案（含預估時數 planned_hours）
- `people`：人員
- `tasks`：任務（隸屬專案，含負責人 owner）
- `time_entries`：工時填報（對應任務、人員、日期、時數）

### 下一步（你要我接哪一種資料庫？）
目前先用 SQLite 方便落地與示範；你告訴我你要接的實際 DB（SQL Server / MySQL / PostgreSQL / Oracle），我就把 DB layer 換成對應 driver，並把查詢改成正式版。


