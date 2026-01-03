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
    return await prisma.$queryRawUnsafe<ColumnRow[]>(sql, tableName);
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

export async function getEcpMapping(): Promise<EcpMapping> {
  if (!globalCache.__ecpCols) globalCache.__ecpCols = new Map();

  const cfg = tryLoadConfig();
  const tables: TablesConfig = {
    project: cfg?.ecp?.tables?.project || 'TcProject',
    task: cfg?.ecp?.tables?.task || 'TcTask',
    time: cfg?.ecp?.tables?.timeDetail || cfg?.ecp?.tables?.time || 'TcTimeReportDetail',
    timeReport: cfg?.ecp?.tables?.timeReport || 'TcTimeReport',
    dictionaryItem: cfg?.ecp?.tables?.dictionaryItem || cfg?.ecp?.tables?.dictionary || 'QsDictionaryItem',
    user: cfg?.ecp?.tables?.user || 'TsUser'
  };

  const tablesToLoad = Array.from(
    new Set([tables.project, tables.task, tables.time, tables.user, tables.timeReport, tables.dictionaryItem].filter(Boolean))
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

  return globalCache.__ecpMapping!;
}

export async function getEcpColumns() {
  const m = await getEcpMapping();
  const cols = globalCache.__ecpCols!;
  return {
    tables: m.tables,
    columns: {
      [m.tables.project]: cols.get(m.tables.project) || [],
      [m.tables.task]: cols.get(m.tables.task) || [],
      [m.tables.time]: cols.get(m.tables.time) || [],
      [m.tables.user]: cols.get(m.tables.user) || [],
      ...(m.tables.timeReport ? { [m.tables.timeReport]: cols.get(m.tables.timeReport) || [] } : {}),
      ...(m.tables.dictionaryItem ? { [m.tables.dictionaryItem]: cols.get(m.tables.dictionaryItem) || [] } : {})
    }
  };
}


