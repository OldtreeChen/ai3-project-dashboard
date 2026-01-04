import { prisma } from '@/lib/prisma';
import fs from 'node:fs';
import path from 'node:path';

type ColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  column_key: string;
  column_comment: string | null;
  ordinal_position: number;
};

type TablesConfig = {
  project: string;
  task: string;
  // time = 明細表（例如 TcTimeReportDetail）
  time: string;
  // timeReport = 主表（例如 TcTimeReport，可提供日期）
  timeReport?: string;
  // dictionary items（例如 QsDictionaryItem / TsDictionaryItem）
  dictionaryItem?: string;
  user: string;
  department?: string;
};

export type EcpMapping = {
  tables: TablesConfig;
  project: {
    id: string;
    code?: string;
    name: string;
    plannedHours?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    departmentId?: string;
    ownerUserId?: string;
    projectType?: string;
  };
  department?: {
    id: string;
    name: string;
  };
  task: {
    id: string;
    projectId: string;
    name: string;
    // 主要顯示用的執行人（常見：TcTask.FUserId）
    executorUserId?: string;
    // 有些 schema 用 assign/owner 表示執行人
    ownerUserId?: string;
    plannedHours?: string;
    actualHours?: string;
    status?: string;
    plannedStartAt?: string;
    plannedEndAt?: string;
    completedAt?: string;
    receivedAt?: string;
  };
  // time = 明細（常見：TcTimeReportDetail）
  time: {
    id?: string;
    timeReportId?: string;
    taskId: string;
    userId: string;
    hours: string;
    projectId?: string;
  };
  // timeReport = 表頭（常見：TcTimeReport）
  timeReport?: {
    id: string;
    workDate: string;
    userId?: string;
    departmentId?: string;
  };
  dictionaryItem?: {
    dictionaryId: string;
    value: string;
    text: string;
  };
  user: {
    id: string;
    account?: string;
    displayName: string;
    departmentId?: string;
    departmentName?: string;
  };
};

function tryLoadConfig(): any {
  try {
    const cfgPath = path.resolve(process.cwd(), 'config.json');
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function isSafeIdentifier(s: string) {
  return /^[A-Za-z0-9_]+$/.test(s);
}

export function sqlId(name: string) {
  if (!isSafeIdentifier(name)) throw new Error(`unsafe SQL identifier: ${name}`);
  return `\`${name}\``;
}

function norm(s: string) {
  return s.toLowerCase();
}

function pick(cols: Array<{ column_name: string }>, candidates: string[]) {
  const byLower = new Map(cols.map((c) => [norm(c.column_name), c.column_name]));
  for (const cand of candidates) {
    const exact = byLower.get(norm(cand));
    if (exact) return exact;
  }
  const lowers = cols.map((c) => ({ lower: norm(c.column_name), raw: c.column_name }));
  for (const cand of candidates) {
    const cl = norm(cand);
    const hit = lowers.find((c) => c.lower.includes(cl));
    if (hit) return hit.raw;
  }
  return undefined;
}

async function loadColumns(tableName: string) {
  try {
    const sql = `
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_key,
        NULLIF(c.column_comment, '') AS column_comment,
        c.ordinal_position
      FROM information_schema.columns c
      WHERE c.table_schema = DATABASE()
        AND c.table_name = ?
      ORDER BY c.ordinal_position ASC
    `;
    const rows = await prisma.$queryRawUnsafe<ColumnRow[]>(sql, tableName);
    // Prisma may return BIGINT as JS BigInt; normalize to number for JSON safety.
    return rows.map((r) => ({
      ...r,
      ordinal_position: Number((r as any).ordinal_position)
    }));
  } catch {
    type ShowRow = { Field: string; Type: string; Null: 'YES' | 'NO'; Key: string; Comment: string };
    const t = sqlId(tableName);
    const rows = await prisma.$queryRawUnsafe<ShowRow[]>(`SHOW FULL COLUMNS FROM ${t}`);
    return rows.map((r, idx) => ({
      column_name: r.Field,
      data_type: r.Type,
      is_nullable: r.Null,
      column_key: r.Key || '',
      column_comment: r.Comment ? r.Comment : null,
      ordinal_position: idx + 1
    }));
  }
}

const globalCache = globalThis as unknown as {
  __ecpCols?: Map<string, ColumnRow[]>;
  __ecpMapping?: EcpMapping;
};

async function pickExistingTable(candidates: string[]): Promise<string | null> {
  if (!candidates.length) return null;
  try {
    const placeholders = candidates.map(() => '?').join(',');
    const sql = `
      SELECT t.table_name
      FROM information_schema.tables t
      WHERE t.table_schema = DATABASE()
        AND t.table_name IN (${placeholders})
      LIMIT 1
    `;
    const row = (await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(sql, ...candidates))?.[0];
    return row?.table_name || null;
  } catch {
    return null;
  }
}

async function pickTableWithMostColumns(candidates: string[]): Promise<string | null> {
  if (!candidates.length) return null;
  try {
    const placeholders = candidates.map(() => '?').join(',');
    const sql = `
      SELECT c.table_name, COUNT(1) AS cnt
      FROM information_schema.columns c
      WHERE c.table_schema = DATABASE()
        AND c.table_name IN (${placeholders})
      GROUP BY c.table_name
      ORDER BY cnt DESC
      LIMIT 1
    `;
    const row = (await prisma.$queryRawUnsafe<Array<{ table_name: string; cnt: number }>>(sql, ...candidates))?.[0];
    return row?.table_name || null;
  } catch {
    return null;
  }
}

export async function getEcpMapping(): Promise<EcpMapping> {
  if (!globalCache.__ecpCols) globalCache.__ecpCols = new Map();

  const cfg = tryLoadConfig();
  const dictTableFromCfgRaw = cfg?.ecp?.tables?.dictionaryItem || cfg?.ecp?.tables?.dictionary;
  // If config.json points to a non-existent table (or no visible columns), ignore it and auto-pick.
  const dictTableFromCfg = dictTableFromCfgRaw ? await pickTableWithMostColumns([String(dictTableFromCfgRaw)]) : null;
  const deptTableFromCfg = cfg?.ecp?.tables?.department;
  const timeReportFromCfg = cfg?.ecp?.tables?.timeReport;
  const tables: TablesConfig = {
    project: cfg?.ecp?.tables?.project || 'TcProject',
    task: cfg?.ecp?.tables?.task || 'TcTask',
    time: cfg?.ecp?.tables?.timeDetail || cfg?.ecp?.tables?.time || 'TcTimeReportDetail',
    timeReport: timeReportFromCfg || 'TcTimeReport',
    // Prefer the table that actually has columns (some envs have QsDictionaryItem as a view with no columns visible)
    dictionaryItem: dictTableFromCfg || (await pickTableWithMostColumns(['QsDictionaryItem', 'TsDictionaryItem'])) || 'TsDictionaryItem',
    user: cfg?.ecp?.tables?.user || 'TsUser',
    department: deptTableFromCfg || (await pickExistingTable(['TsDepartment'])) || 'TsDepartment'
  };

  const tablesToLoad = Array.from(
    new Set([tables.project, tables.task, tables.time, tables.user, tables.timeReport, tables.dictionaryItem, tables.department].filter(Boolean))
  ) as string[];

  const needLoad = tablesToLoad.some((t) => !globalCache.__ecpCols!.has(t));
  if (needLoad || !globalCache.__ecpMapping) {
    for (const t of tablesToLoad) if (!globalCache.__ecpCols!.has(t)) globalCache.__ecpCols!.set(t, await loadColumns(t));

    const pCols = globalCache.__ecpCols!.get(tables.project)!;
    const tCols = globalCache.__ecpCols!.get(tables.task)!;
    const tdCols = globalCache.__ecpCols!.get(tables.time)!;
    const uCols = globalCache.__ecpCols!.get(tables.user)!;
    const thCols = tables.timeReport ? globalCache.__ecpCols!.get(tables.timeReport) || [] : [];
    const diCols = tables.dictionaryItem ? globalCache.__ecpCols!.get(tables.dictionaryItem) || [] : [];
    const deptCols = tables.department ? globalCache.__ecpCols!.get(tables.department) || [] : [];

    const mapping: EcpMapping = {
      tables,
      project: {
        id: pick(pCols, ['FId', 'id', 'projectId', 'project_id', 'projectNo', 'project_no']) || '',
        code: pick(pCols, ['FCode', 'code', 'projectCode', 'project_code', 'projCode', 'prjCode']),
        name: pick(pCols, ['FName', 'name', 'projectName', 'project_name', 'projName', 'prjName']) || '',
        plannedHours: pick(pCols, ['FPlanHours', 'planned_hours', 'plannedHours', 'planHours', 'estimateHours']),
        startDate: pick(pCols, ['FStartDate', 'start_date', 'startDate', 'begin_date', 'beginDate', 'start', 'begin']),
        endDate: pick(pCols, ['FEndDate', 'end_date', 'endDate', 'finish_date', 'finishDate', 'end', 'finish']),
        status: pick(pCols, ['FStatus', 'status', 'projectStatus', 'project_status', 'state']),
        departmentId: pick(pCols, ['FDepartmentId', 'departmentId', 'department_id', 'deptId', 'dept_id']),
        ownerUserId: pick(pCols, ['FOwnerUserId', 'FProjectOwnerId', 'ownerUserId', 'owner_user_id', 'ownerId', 'pmUserId']),
        projectType: pick(pCols, ['FProjectType', 'projectType', 'project_type', 'type', 'FType'])
      },
      task: {
        id: pick(tCols, ['FId', 'id', 'taskId', 'task_id', 'taskNo', 'task_no']) || '',
        projectId: pick(tCols, ['FProjectId', 'projectId', 'project_id', 'projectNo', 'project_no', 'prjId', 'prj_id']) || '',
        name: pick(tCols, ['FName', 'name', 'taskName', 'task_name', 'title', 'subject']) || '',
        executorUserId: pick(tCols, ['FUserId', 'executorUserId', 'executor_user_id', 'userId', 'user_id', 'assigneeId', 'assignUserId']),
        ownerUserId: pick(tCols, ['FAssignUserId', 'ownerUserId', 'owner_user_id', 'ownerId', 'assignUserId', 'assigneeId']),
        plannedHours: pick(tCols, ['FPlanHours', 'FPlannedHours', 'planned_hours', 'plannedHours', 'planHours', 'estimateHours']),
        actualHours: pick(tCols, ['FHours', 'actual_hours', 'actualHours', 'hours']),
        status: pick(tCols, ['FStatus', 'status', 'taskStatus', 'task_status', 'state']),
        plannedStartAt: pick(tCols, ['FPlanStartDate', 'FPredictStartDate', 'FPredictStartTime', 'FStandardStartTime', 'plannedStartAt', 'planned_start_at', 'planStartDate', 'plan_start_date', 'FStartDate', 'FStartTime']),
        plannedEndAt: pick(tCols, ['FPlanEndDate', 'FPredictEndDate', 'plannedEndAt', 'planned_end_at', 'planEndDate', 'plan_end_date']),
        completedAt: pick(tCols, ['FCompletedDate', 'FTaskCloseDate', 'completedAt', 'completed_at', 'completedDate', 'completed_date']),
        receivedAt: pick(tCols, ['FFirstCommitmentDate', 'FFirstCommitmentTime', 'receivedAt', 'received_at', 'firstCommitmentDate', 'createDate', 'created_at'])
      },
      time: {
        id: pick(tdCols, ['FId', 'id', 'detailId', 'detail_id', 'timeReportDetailId', 'time_report_detail_id']),
        timeReportId: pick(tdCols, ['FTimeReportId', 'timeReportId', 'time_report_id', 'reportId', 'report_id']),
        taskId: pick(tdCols, ['FTaskId', 'taskId', 'task_id', 'workItemId', 'work_item_id', 'tcTaskId']) || '',
        userId: pick(tdCols, ['FUserId', 'userId', 'user_id', 'tsUserId', 'employeeId', 'empId', 'staffId']) || '',
        projectId: pick(tdCols, ['FProjectId', 'projectId', 'project_id']),
        hours: pick(tdCols, ['FWorkTime', 'hours', 'hour', 'workHours', 'work_hours', 'manhour', 'duration']) || ''
      },
      timeReport: tables.timeReport
        ? {
            id: pick(thCols, ['FId', 'id', 'timeReportId', 'reportId']) || '',
            workDate: pick(thCols, ['FDate', 'work_date', 'workDate', 'date', 'reportDate', 'report_date']) || '',
            userId: pick(thCols, ['FUserId', 'userId', 'user_id']),
            departmentId: pick(thCols, ['FDepartmentId', 'departmentId', 'department_id'])
          }
        : undefined,
      dictionaryItem: tables.dictionaryItem
        ? {
            dictionaryId: pick(diCols, ['FDictionaryId', 'dictionaryId', 'dictionary_id']) || '',
            value: pick(diCols, ['FValue', 'value', 'val']) || '',
            text: pick(diCols, ['FText', 'text', 'name']) || ''
          }
        : undefined,
      user: {
        id: pick(uCols, ['FId', 'id', 'userId', 'user_id', 'tsUserId', 'uid']) || '',
        account: pick(uCols, ['account', 'username', 'user_name', 'login', 'loginId', 'login_id']),
        displayName: pick(uCols, ['FName', 'displayName', 'display_name', 'name', 'userName', 'fullName']) || '',
        departmentId: pick(uCols, ['FDepartmentId', 'departmentId', 'department_id', 'deptId', 'dept_id', 'orgId', 'org_id']),
        departmentName: pick(uCols, ['FDepartmentName', 'departmentName', 'department_name', 'deptName', 'dept_name', 'orgName', 'org_name'])
      }
    };

    // allow override by config.json
    const override = cfg?.ecp?.columns;
    if (override?.project) mapping.project = { ...mapping.project, ...override.project };
    if (override?.task) mapping.task = { ...mapping.task, ...override.task };
    if (override?.time) mapping.time = { ...mapping.time, ...override.time };
    if (override?.timeDetail) mapping.time = { ...mapping.time, ...override.timeDetail };
    if (override?.timeReport && mapping.timeReport) mapping.timeReport = { ...mapping.timeReport, ...override.timeReport };
    if (override?.dictionaryItem && mapping.dictionaryItem) mapping.dictionaryItem = { ...mapping.dictionaryItem, ...override.dictionaryItem };
    if (override?.user) mapping.user = { ...mapping.user, ...override.user };

    // validate overrides: drop any column mapping that doesn't exist in the actual table
    const pSet = new Set(pCols.map((c) => c.column_name));
    const tSet = new Set(tCols.map((c) => c.column_name));
    const tdSet = new Set(tdCols.map((c) => c.column_name));
    const thSet = new Set(thCols.map((c) => c.column_name));
    const uSet = new Set(uCols.map((c) => c.column_name));
    const diSet = new Set(diCols.map((c) => c.column_name));

    const keep = (set: Set<string>, v?: string) => (v && set.has(v) ? v : undefined);

    mapping.project.code = keep(pSet, mapping.project.code);
    mapping.project.plannedHours = keep(pSet, mapping.project.plannedHours);
    mapping.project.startDate = keep(pSet, mapping.project.startDate);
    mapping.project.endDate = keep(pSet, mapping.project.endDate);
    mapping.project.status = keep(pSet, mapping.project.status);
    mapping.project.departmentId = keep(pSet, mapping.project.departmentId);
    mapping.project.ownerUserId = keep(pSet, mapping.project.ownerUserId);
    mapping.project.projectType = keep(pSet, mapping.project.projectType);

    mapping.task.executorUserId = keep(tSet, mapping.task.executorUserId);
    mapping.task.ownerUserId = keep(tSet, mapping.task.ownerUserId);
    mapping.task.plannedHours = keep(tSet, mapping.task.plannedHours);
    mapping.task.actualHours = keep(tSet, mapping.task.actualHours);
    mapping.task.status = keep(tSet, mapping.task.status);
    mapping.task.plannedStartAt = keep(tSet, mapping.task.plannedStartAt);
    mapping.task.plannedEndAt = keep(tSet, mapping.task.plannedEndAt);
    mapping.task.completedAt = keep(tSet, mapping.task.completedAt);
    mapping.task.receivedAt = keep(tSet, mapping.task.receivedAt);

    mapping.time.id = keep(tdSet, mapping.time.id);
    mapping.time.timeReportId = keep(tdSet, mapping.time.timeReportId);
    mapping.time.projectId = keep(tdSet, mapping.time.projectId);
    mapping.time.taskId = keep(tdSet, mapping.time.taskId) || mapping.time.taskId;
    mapping.time.userId = keep(tdSet, mapping.time.userId) || mapping.time.userId;
    mapping.time.hours = keep(tdSet, mapping.time.hours) || mapping.time.hours;

    if (mapping.timeReport) {
      mapping.timeReport.id = keep(thSet, mapping.timeReport.id) || mapping.timeReport.id;
      mapping.timeReport.workDate = keep(thSet, mapping.timeReport.workDate) || mapping.timeReport.workDate;
      mapping.timeReport.userId = keep(thSet, mapping.timeReport.userId);
      mapping.timeReport.departmentId = keep(thSet, mapping.timeReport.departmentId);
    }

    if (mapping.dictionaryItem) {
      mapping.dictionaryItem.dictionaryId = keep(diSet, mapping.dictionaryItem.dictionaryId) || mapping.dictionaryItem.dictionaryId;
      mapping.dictionaryItem.value = keep(diSet, mapping.dictionaryItem.value) || mapping.dictionaryItem.value;
      mapping.dictionaryItem.text = keep(diSet, mapping.dictionaryItem.text) || mapping.dictionaryItem.text;
    }

    if (deptCols.length > 0) {
      mapping.department = {
        id: pick(deptCols, ['FId', 'id', 'departmentId', 'deptId']) || '',
        name: pick(deptCols, ['FName', 'name', 'departmentName', 'deptName']) || ''
      };
    }

    mapping.user.account = keep(uSet, mapping.user.account);
    mapping.user.departmentId = keep(uSet, mapping.user.departmentId);
    mapping.user.departmentName = keep(uSet, mapping.user.departmentName);

    if (!mapping.project.id || !mapping.project.name || !mapping.task.id || !mapping.task.projectId || !mapping.task.name || !mapping.user.id || !mapping.user.displayName) {
      throw new Error(
        [
          '無法自動推測必要欄位（請到 /schema 確認欄位，或在 config.json 補 ecp.columns 對應）。',
          `tables: ${JSON.stringify(tables)}`
        ].join('\n')
      );
    }

    globalCache.__ecpMapping = mapping;
  }

  // Always sanitize cached mapping as config.json may change and global cache survives hot reload.
  // This prevents returning mappings pointing to non-existent columns (e.g. FOwnerUserId).
  try {
    const m2 = globalCache.__ecpMapping!;
    const cols2 = globalCache.__ecpCols!;
    const p2 = cols2.get(m2.tables.project) || [];
    const t2 = cols2.get(m2.tables.task) || [];
    const td2 = cols2.get(m2.tables.time) || [];
    const u2 = cols2.get(m2.tables.user) || [];
    const th2 = m2.tables.timeReport ? (cols2.get(m2.tables.timeReport) || []) : [];
    const di2 = m2.tables.dictionaryItem ? (cols2.get(m2.tables.dictionaryItem) || []) : [];

    const pSet = new Set(p2.map((c) => c.column_name));
    const tSet = new Set(t2.map((c) => c.column_name));
    const tdSet = new Set(td2.map((c) => c.column_name));
    const thSet = new Set(th2.map((c) => c.column_name));
    const uSet = new Set(u2.map((c) => c.column_name));
    const diSet = new Set(di2.map((c) => c.column_name));
    // deptCols is already loaded if exists
    // const deptSet ...

    const keep = (set: Set<string>, v?: string) => (v && set.has(v) ? v : undefined);

    m2.project.code = keep(pSet, m2.project.code);
    m2.project.plannedHours = keep(pSet, m2.project.plannedHours);
    m2.project.startDate = keep(pSet, m2.project.startDate);
    m2.project.endDate = keep(pSet, m2.project.endDate);
    m2.project.status = keep(pSet, m2.project.status);
    m2.project.departmentId = keep(pSet, m2.project.departmentId);
    m2.project.ownerUserId = keep(pSet, m2.project.ownerUserId);
    m2.project.projectType = keep(pSet, m2.project.projectType);

    m2.task.executorUserId = keep(tSet, m2.task.executorUserId);
    m2.task.ownerUserId = keep(tSet, m2.task.ownerUserId);
    m2.task.plannedHours = keep(tSet, m2.task.plannedHours);
    m2.task.actualHours = keep(tSet, m2.task.actualHours);
    m2.task.status = keep(tSet, m2.task.status);
    m2.task.plannedStartAt = keep(tSet, m2.task.plannedStartAt);
    m2.task.plannedEndAt = keep(tSet, m2.task.plannedEndAt);
    m2.task.completedAt = keep(tSet, m2.task.completedAt);
    m2.task.receivedAt = keep(tSet, m2.task.receivedAt);

    m2.time.id = keep(tdSet, m2.time.id);
    m2.time.timeReportId = keep(tdSet, m2.time.timeReportId);
    m2.time.projectId = keep(tdSet, m2.time.projectId);
    m2.time.taskId = keep(tdSet, m2.time.taskId) || m2.time.taskId;
    m2.time.userId = keep(tdSet, m2.time.userId) || m2.time.userId;
    m2.time.hours = keep(tdSet, m2.time.hours) || m2.time.hours;

    if (m2.timeReport) {
      m2.timeReport.id = keep(thSet, m2.timeReport.id) || m2.timeReport.id;
      m2.timeReport.workDate = keep(thSet, m2.timeReport.workDate) || m2.timeReport.workDate;
      m2.timeReport.userId = keep(thSet, m2.timeReport.userId);
      m2.timeReport.departmentId = keep(thSet, m2.timeReport.departmentId);
    }

    if (m2.dictionaryItem) {
      m2.dictionaryItem.dictionaryId = keep(diSet, m2.dictionaryItem.dictionaryId) || m2.dictionaryItem.dictionaryId;
      m2.dictionaryItem.value = keep(diSet, m2.dictionaryItem.value) || m2.dictionaryItem.value;
      m2.dictionaryItem.text = keep(diSet, m2.dictionaryItem.text) || m2.dictionaryItem.text;
    }

    m2.user.account = keep(uSet, m2.user.account);
    m2.user.departmentId = keep(uSet, m2.user.departmentId);
    m2.user.departmentName = keep(uSet, m2.user.departmentName);
  } catch {
    // ignore sanitize errors; mapping will be validated by API usage anyway
  }

  return globalCache.__ecpMapping!;
}

export async function getEcpColumns() {
  const m = await getEcpMapping();
  const cols = globalCache.__ecpCols!;
  const normalize = (rows: ColumnRow[]) =>
    (rows || []).map((r) => ({
      ...r,
      ordinal_position: Number((r as any).ordinal_position)
    }));
  return {
    tables: m.tables,
    columns: {
      [m.tables.project]: normalize(cols.get(m.tables.project) || []),
      [m.tables.task]: normalize(cols.get(m.tables.task) || []),
      [m.tables.time]: normalize(cols.get(m.tables.time) || []),
      [m.tables.user]: normalize(cols.get(m.tables.user) || []),
      ...(m.tables.timeReport ? { [m.tables.timeReport]: normalize(cols.get(m.tables.timeReport) || []) } : {}),
      ...(m.tables.dictionaryItem ? { [m.tables.dictionaryItem]: normalize(cols.get(m.tables.dictionaryItem) || []) } : {})
    }
  };
}


