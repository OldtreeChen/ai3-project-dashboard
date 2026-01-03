// 狀態字典（依你提供的 Qs.DictionaryItem.sql）
// key: FValue（英文代碼）
// value: FText（中文顯示）
export const STATUS_ZH_MAP: Record<string, string> = {
  New: '新增',
  Assigned: '已分配',
  Executing: '執行中',
  Auditing: '審核中',
  Back: '返回修改中',
  ExecuteBack: '返回修改中',
  FinishBack: '返回修改中',
  Finished: '已關閉',
  Discarded: '已作廢',
  Cancel: '取消',
  Revising: '修訂中',
  AutoUpgrade: '自動升級中',
  Prolong: '延時申請中',
  Overdue: '逾時執行中',
  OverdueUpgrade: '逾時自動升級中',
  FinishAuditing: '關閉審核中',
  UnAssigned: '未分配',
  OverdueDelay: '逾時延時申請中'
};

export function toZhStatus(v: unknown) {
  const s = String(v ?? '').trim();
  if (!s) return '--';
  return STATUS_ZH_MAP[s] || s;
}


