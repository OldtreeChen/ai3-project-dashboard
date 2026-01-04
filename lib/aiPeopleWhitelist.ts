import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';

export type DeptWhitelist = { deptName: string; emails: string[]; names: string[] };

// Source: user-provided whitelist screenshots (AI專案一部 / AI專案二部)
export const AI_DEPT_WHITELISTS: Record<'dept1' | 'dept2', DeptWhitelist> = {
  dept1: {
    deptName: 'AI專案一部',
    emails: [
      'yuwen.wang@chainsea.com.tw',
      'kevin.hsu@chainsea.com.tw',
      'wayne.chu@ai3.cloud',
      'edwin.zhan@ai3.cloud',
      'howard.chang@ai3.cloud',
      'andy.chen@ai3.cloud',
      'rex.lo@ai3.cloud',
      'yi.chou@ai3.cloud',
      'jonathan.kao@ai3.cloud',
      'eddie.jiang@ai3.cloud',
      'ned.shiu@ai3.cloud',
      'zhi-yan.wu@ai3.cloud',
      'alice.wu@ai3.cloud',
      'sam.shen@ai3.cloud',
      'xavier.chen@ai3.cloud',
      'alan.chang2@ai3.cloud',
      'marcus.huang@ai3.cloud',
      'ken.lee@ai3.cloud',
      'jenny.feng@ai3.cloud',
      'ronica.lee@ai3.cloud',
      'eugene.yeh@ai3.cloud',
      'allie.wu@ai3.cloud',
      'lance.wu@ai3.cloud',
      'win.wu@chainsea.com.tw',
      'roy.cheng@ai3.cloud'
    ],
    names: [
      '王育文',
      '徐文澤',
      '朱惟宇',
      '詹鈞翔',
      '張紘齊',
      '陳柏仲',
      '羅弘翔',
      '周儀',
      '高仲揚',
      '江維鴻',
      '許鈞喨',
      '吳芷妍',
      '吳家齊',
      '沈子欽',
      '陳治瑋',
      '張世暉',
      '黃宇晨',
      '李冠嘉',
      '馮雅',
      '李若菲',
      '葉修文',
      '吳宛穎',
      '吳宗憲',
      '吳印',
      '鄭翔之'
    ]
  },
  dept2: {
    deptName: 'AI專案二部',
    emails: [
      'tina.wang@ai3.cloud',
      'shih-yu.wu@ai3.cloud',
      'alex.liwu@ai3.cloud',
      'xander.wang@ai3.cloud',
      'melody.lee@ai3.cloud',
      'chloe.wu@ai3.cloud',
      'oldtree.chen@qbiai.com',
      'jason.cheng@ai3.cloud',
      'brian.hsieh@ai3.cloud',
      'dennis.ting@ai3.cloud',
      'daniel.lee@ai3.cloud',
      'anka.liao@ai3.cloud',
      'leo.lee@ai3.cloud',
      'mark.liao@ai3.cloud'
    ],
    names: [
      '王祉元',
      '吳詩瑀',
      '李吳孟修',
      '王子豪',
      '李芷瑩',
      '吳玟萱',
      '陳慕霖-專案二部',
      '鄭傑丞',
      '謝政棋',
      '丁歆翰',
      '李偉誠',
      '廖育霆',
      '李騏亘',
      '廖明信'
    ]
  }
};

const globalCache = globalThis as unknown as {
  __aiDeptIds?: { dept1Id: string | null; dept2Id: string | null };
};

export async function getAiDeptIds(): Promise<{ dept1Id: string | null; dept2Id: string | null }> {
  if (globalCache.__aiDeptIds) return globalCache.__aiDeptIds;
  const m = await getEcpMapping();
  if (!m.tables.department || !m.department) {
    globalCache.__aiDeptIds = { dept1Id: null, dept2Id: null };
    return globalCache.__aiDeptIds;
  }
  const D = sqlId(m.tables.department);
  const dId = sqlId(m.department.id);
  const dName = sqlId(m.department.name);

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `
      SELECT d.${dId} AS id, d.${dName} AS name
      FROM ${D} d
      WHERE d.${dName} LIKE '%AI專案一部%'
         OR d.${dName} LIKE '%AI專案二部%'
    `
  );

  const dept1 = rows.find((r) => String(r.name || '').includes('AI專案一部'))?.id || null;
  const dept2 = rows.find((r) => String(r.name || '').includes('AI專案二部'))?.id || null;
  globalCache.__aiDeptIds = { dept1Id: dept1, dept2Id: dept2 };
  return globalCache.__aiDeptIds;
}

export function buildWhitelistWhere(opts: {
  uName: string; // sql identifier (may include backticks)
  uAccount: string | null;
  departmentId: string | null;
  dept1Id: string | null;
  dept2Id: string | null;
}) {
  const { uName, uAccount, departmentId, dept1Id, dept2Id } = opts;

  const addClause = (_deptId: string, wl: DeptWhitelist) => {
    const args: any[] = [];
    let cond = `(`;
    const parts: string[] = [];

    // Normalize display name: strip anything after "(" or "（"
    const baseNameExpr = `TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(u.${uName}, '（', 1), '(', 1))`;

    if (uAccount && wl.emails.length) {
      const ps = wl.emails.map(() => '?').join(',');
      parts.push(`LOWER(u.${uAccount}) IN (${ps})`);
      args.push(...wl.emails.map((e) => e.toLowerCase()));
    }
    if (wl.names.length) {
      const ps2 = wl.names.map(() => '?').join(',');
      parts.push(`${baseNameExpr} IN (${ps2})`);
      args.push(...wl.names);
    }

    // If neither is available, make it impossible (avoid leaking users)
    if (!parts.length) {
      parts.push('1=0');
    }
    cond += parts.join(' OR ') + ')';
    return { cond, args };
  };

  // If departmentId is specified and matches one of the AI depts, filter only that dept's whitelist.
  if (departmentId && dept1Id && departmentId === dept1Id) {
    const c = addClause(dept1Id, AI_DEPT_WHITELISTS.dept1);
    return { where: ` AND ${c.cond}`, args: c.args };
  }
  if (departmentId && dept2Id && departmentId === dept2Id) {
    const c = addClause(dept2Id, AI_DEPT_WHITELISTS.dept2);
    return { where: ` AND ${c.cond}`, args: c.args };
  }

  // Default: show both depts but only whitelisted users.
  if (dept1Id && dept2Id) {
    const c1 = addClause(dept1Id, AI_DEPT_WHITELISTS.dept1);
    const c2 = addClause(dept2Id, AI_DEPT_WHITELISTS.dept2);
    return { where: ` AND (${c1.cond} OR ${c2.cond})`, args: [...c1.args, ...c2.args] };
  }

  // If we can't resolve dept ids, don't apply whitelist (avoid empty results).
  return { where: '', args: [] as any[] };
}


