import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import dotenv from 'dotenv';
import { migrate, openDb, seedIfEmpty } from './db.js';

dotenv.config(); // 如果沒有 .env 也不會失敗

function tryLoadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadConfig() {
  const configPath = path.resolve(process.cwd(), 'config.json');
  const fileCfg = tryLoadJson(configPath) || {};

  const port = Number(process.env.PORT || fileCfg.port || 5179);
  const dbPath = process.env.DB_PATH || fileCfg.dbPath || './data/hours.db';

  return { port, dbPath };
}

function parseDateParam(v) {
  if (!v) return null;
  // 接受 YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function parseIntParam(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i <= 0) return null;
  return i;
}

const { port, dbPath } = loadConfig();
const db = openDb({ dbPath });
migrate(db);
seedIfEmpty(db);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// --- API ---

app.get('/api/projects', (req, res) => {
  const rows = db.prepare(`
    SELECT
      p.id, p.code, p.name, p.planned_hours, p.start_date, p.end_date,
      COALESCE(SUM(te.hours), 0) AS actual_hours
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id
    LEFT JOIN time_entries te ON te.task_id = t.id
    GROUP BY p.id
    ORDER BY p.id DESC
  `).all();
  res.json(rows);
});

app.get('/api/people', (req, res) => {
  const departmentId = parseIntParam(req.query.departmentId);
  const rows = db.prepare(`
    SELECT id, account, display_name, department_id
    FROM people
    ${departmentId ? 'WHERE department_id = ?' : ''}
    ORDER BY display_name
  `).all(...(departmentId ? [departmentId] : []));
  res.json(rows);
});

app.get('/api/departments', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name
    FROM departments
    ORDER BY name
  `).all();
  res.json(rows);
});

app.get('/api/projects/:projectId/summary', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId)) return res.status(400).json({ error: 'invalid projectId' });

  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  const personId = parseIntParam(req.query.personId);
  const departmentId = parseIntParam(req.query.departmentId);

  const project = db.prepare(`
    SELECT id, code, name, planned_hours, start_date, end_date
    FROM projects
    WHERE id = ?
  `).get(projectId);
  if (!project) return res.status(404).json({ error: 'project not found' });

  const taskCount = db.prepare(`
    SELECT COUNT(1) AS task_count
    FROM tasks
    WHERE project_id = ?
  `).get(projectId);

  const totals = db.prepare(`
    WITH tef AS (
      SELECT te.task_id, te.person_id, te.hours
      FROM time_entries te
      JOIN tasks t ON t.id = te.task_id
      JOIN people pe ON pe.id = te.person_id
      WHERE t.project_id = ?
      ${from && to ? 'AND te.work_date BETWEEN ? AND ?' : ''}
      ${personId ? 'AND te.person_id = ?' : ''}
      ${departmentId ? 'AND pe.department_id = ?' : ''}
    )
    SELECT
      COALESCE(SUM(hours), 0) AS actual_hours,
      COUNT(DISTINCT person_id) AS people_count
    FROM tef
  `).get(
    ...[
      projectId,
      ...(from && to ? [from, to] : []),
      ...(personId ? [personId] : []),
      ...(departmentId ? [departmentId] : [])
    ]
  );

  res.json({
    ...project,
    date_filter: (from && to) ? { from, to } : null,
    filters: {
      personId: personId || null,
      departmentId: departmentId || null
    },
    task_count: taskCount?.task_count ?? 0,
    ...totals
  });
});

app.get('/api/projects/:projectId/people-breakdown', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId)) return res.status(400).json({ error: 'invalid projectId' });

  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  const personId = parseIntParam(req.query.personId);
  const departmentId = parseIntParam(req.query.departmentId);

  const strictRows = db.prepare(`
    WITH tef AS (
      SELECT te.person_id, te.task_id, te.hours
      FROM time_entries te
      JOIN tasks t ON t.id = te.task_id
      JOIN people pe ON pe.id = te.person_id
      WHERE t.project_id = ?
      ${from && to ? 'AND te.work_date BETWEEN ? AND ?' : ''}
      ${personId ? 'AND te.person_id = ?' : ''}
      ${departmentId ? 'AND pe.department_id = ?' : ''}
    )
    SELECT
      pe.id AS person_id,
      pe.display_name,
      COALESCE(SUM(tef.hours), 0) AS hours,
      COUNT(DISTINCT tef.task_id) AS task_touched_count
    FROM people pe
    LEFT JOIN tef ON tef.person_id = pe.id
    ${departmentId ? 'WHERE pe.department_id = ?' : ''}
    GROUP BY pe.id
    ORDER BY hours DESC, pe.display_name ASC
  `).all(
    ...[
      projectId,
      ...(from && to ? [from, to] : []),
      ...(personId ? [personId] : []),
      ...(departmentId ? [departmentId] : []),
      ...(departmentId ? [departmentId] : [])
    ]
  );

  res.json({
    date_filter: (from && to) ? { from, to } : null,
    filters: { personId: personId || null, departmentId: departmentId || null },
    people: strictRows
  });
});

app.get('/api/projects/:projectId/tasks-breakdown', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId)) return res.status(400).json({ error: 'invalid projectId' });

  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  const personId = parseIntParam(req.query.personId);
  const departmentId = parseIntParam(req.query.departmentId);

  const rows = db.prepare(`
    WITH tef AS (
      SELECT te.task_id, te.hours
      FROM time_entries te
      JOIN tasks t ON t.id = te.task_id
      JOIN people pe ON pe.id = te.person_id
      WHERE t.project_id = ?
      ${from && to ? 'AND te.work_date BETWEEN ? AND ?' : ''}
      ${personId ? 'AND te.person_id = ?' : ''}
      ${departmentId ? 'AND pe.department_id = ?' : ''}
    ),
    agg AS (
      SELECT task_id, COALESCE(SUM(hours), 0) AS actual_hours
      FROM tef
      GROUP BY task_id
    )
    SELECT
      t.id AS task_id,
      t.name AS task_name,
      t.planned_hours AS task_planned_hours,
      t.status AS task_status,
      owner.display_name AS owner_name,
      COALESCE(agg.actual_hours, 0) AS actual_hours
    FROM tasks t
    LEFT JOIN people owner ON owner.id = t.owner_person_id
    LEFT JOIN agg ON agg.task_id = t.id
    WHERE t.project_id = ?
    ORDER BY actual_hours DESC, t.id ASC
  `).all(
    ...[
      projectId,
      ...(from && to ? [from, to] : []),
      ...(personId ? [personId] : []),
      ...(departmentId ? [departmentId] : []),
      projectId
    ]
  );

  res.json({
    date_filter: (from && to) ? { from, to } : null,
    filters: { personId: personId || null, departmentId: departmentId || null },
    tasks: rows
  });
});

app.get('/api/projects/:projectId/person-task-matrix', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId)) return res.status(400).json({ error: 'invalid projectId' });

  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  const personId = parseIntParam(req.query.personId);
  const departmentId = parseIntParam(req.query.departmentId);

  const rows = db.prepare(`
    SELECT
      pe.id AS person_id,
      pe.display_name,
      t.id AS task_id,
      t.name AS task_name,
      COALESCE(SUM(te.hours), 0) AS hours
    FROM time_entries te
    JOIN people pe ON pe.id = te.person_id
    JOIN tasks t ON t.id = te.task_id
    WHERE t.project_id = ?
    ${from && to ? 'AND te.work_date BETWEEN ? AND ?' : ''}
    ${personId ? 'AND te.person_id = ?' : ''}
    ${departmentId ? 'AND pe.department_id = ?' : ''}
    GROUP BY pe.id, t.id
    ORDER BY pe.display_name ASC, t.id ASC
  `).all(
    ...[
      projectId,
      ...(from && to ? [from, to] : []),
      ...(personId ? [personId] : []),
      ...(departmentId ? [departmentId] : [])
    ]
  );

  res.json({
    date_filter: (from && to) ? { from, to } : null,
    filters: { personId: personId || null, departmentId: departmentId || null },
    rows
  });
});

app.get('/api/projects/:projectId/daily-hours', (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId)) return res.status(400).json({ error: 'invalid projectId' });

  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  if (!(from && to)) return res.status(400).json({ error: 'from/to required (YYYY-MM-DD)' });

  const personId = parseIntParam(req.query.personId);
  const departmentId = parseIntParam(req.query.departmentId);

  const rows = db.prepare(`
    SELECT
      te.work_date AS date,
      COALESCE(SUM(te.hours), 0) AS hours
    FROM time_entries te
    JOIN tasks t ON t.id = te.task_id
    JOIN people pe ON pe.id = te.person_id
    WHERE t.project_id = ?
      AND te.work_date BETWEEN ? AND ?
      ${personId ? 'AND te.person_id = ?' : ''}
      ${departmentId ? 'AND pe.department_id = ?' : ''}
    GROUP BY te.work_date
    ORDER BY te.work_date ASC
  `).all(
    ...[
      projectId,
      from,
      to,
      ...(personId ? [personId] : []),
      ...(departmentId ? [departmentId] : [])
    ]
  );

  res.json({
    date_filter: { from, to },
    filters: { personId: personId || null, departmentId: departmentId || null },
    rows
  });
});

// --- Static dashboard ---
const publicDir = path.resolve(process.cwd(), 'public');
app.use('/', express.static(publicDir));

app.listen(port, () => {
  console.log(`[hours-dashboard] listening on http://localhost:${port}`);
  console.log(`[hours-dashboard] db: ${dbPath}`);
});


