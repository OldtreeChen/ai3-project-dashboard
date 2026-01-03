import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DEFAULT_DB_PATH = './data/hours.db';

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function openDb({ dbPath } = {}) {
  const resolved = path.resolve(process.cwd(), dbPath || DEFAULT_DB_PATH);
  ensureDirForFile(resolved);
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      planned_hours REAL NOT NULL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT UNIQUE,
      display_name TEXT NOT NULL,
      department_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
      ,FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      owner_person_id INTEGER,
      planned_hours REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(owner_person_id) REFERENCES people(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      hours REAL NOT NULL CHECK (hours >= 0),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);
    CREATE INDEX IF NOT EXISTS idx_time_entries_person ON time_entries(person_id);
    CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(work_date);
    CREATE INDEX IF NOT EXISTS idx_people_department ON people(department_id);
  `);
}

export function seedIfEmpty(db) {
  const hasProject = db.prepare('SELECT 1 FROM projects LIMIT 1').get();
  if (hasProject) return;

  const insertDepartment = db.prepare(
    'INSERT INTO departments (name) VALUES (?)'
  );
  const insertProject = db.prepare(
    'INSERT INTO projects (code, name, planned_hours, start_date, end_date) VALUES (?, ?, ?, ?, ?)'
  );
  const insertPerson = db.prepare(
    'INSERT INTO people (account, display_name, department_id) VALUES (?, ?, ?)'
  );
  const insertTask = db.prepare(
    'INSERT INTO tasks (project_id, name, owner_person_id, planned_hours, status) VALUES (?, ?, ?, ?, ?)'
  );
  const insertEntry = db.prepare(
    'INSERT INTO time_entries (task_id, person_id, work_date, hours, note) VALUES (?, ?, ?, ?, ?)'
  );

  const tx = db.transaction(() => {
    const depRD = insertDepartment.run('研發').lastInsertRowid;
    const depPM = insertDepartment.run('專案').lastInsertRowid;
    const depOPS = insertDepartment.run('營運').lastInsertRowid;

    const p1 = insertProject.run('WB-2026', 'Wallboard 儀表板導入與工時管理', 480, '2025-12-01', '2026-03-31').lastInsertRowid;
    const p2 = insertProject.run('OPS-2026', '1999 話務中心營運優化', 320, '2025-12-15', '2026-02-28').lastInsertRowid;

    const alice = insertPerson.run('alice', '王小明', depPM).lastInsertRowid;
    const bob = insertPerson.run('bob', '陳小華', depRD).lastInsertRowid;
    const carol = insertPerson.run('carol', '林怡君', depOPS).lastInsertRowid;

    const t11 = insertTask.run(p1, '需求盤點與資料模型', alice, 80, 'open').lastInsertRowid;
    const t12 = insertTask.run(p1, 'API 開發與權限', bob, 120, 'open').lastInsertRowid;
    const t13 = insertTask.run(p1, '前端儀表板與視覺化', carol, 160, 'open').lastInsertRowid;
    const t14 = insertTask.run(p1, '上線與監控', alice, 120, 'open').lastInsertRowid;

    const t21 = insertTask.run(p2, '排班規則調整', bob, 120, 'open').lastInsertRowid;
    const t22 = insertTask.run(p2, 'KPI 報表優化', carol, 100, 'open').lastInsertRowid;
    const t23 = insertTask.run(p2, '告警與值班流程', alice, 100, 'open').lastInsertRowid;

    const entries = [
      [t11, alice, '2025-12-02', 6, '訪談與欄位整理'],
      [t11, alice, '2025-12-03', 7.5, 'ERD 初版'],
      [t12, bob, '2025-12-05', 8, 'API skeleton'],
      [t12, bob, '2025-12-06', 6, '查詢彙總'],
      [t13, carol, '2025-12-10', 7, 'Dashboard layout'],
      [t13, carol, '2025-12-11', 8, '圖表/表格'],
      [t14, alice, '2025-12-20', 4, '部署腳本'],

      [t21, bob, '2025-12-18', 5, '規則討論'],
      [t22, carol, '2025-12-19', 6.5, 'KPI 指標整理'],
      [t23, alice, '2025-12-21', 3.5, '告警流程草案']
    ];

    for (const e of entries) insertEntry.run(...e);
  });

  tx();
}


