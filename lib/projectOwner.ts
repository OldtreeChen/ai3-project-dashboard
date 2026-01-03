import { getEcpMapping } from '@/lib/ecpSchema';

const globalCache = globalThis as unknown as {
  __tcProjectOwnerCol?: string | null;
};

export async function getProjectOwnerColumn(): Promise<string | null> {
  if (globalCache.__tcProjectOwnerCol !== undefined) return globalCache.__tcProjectOwnerCol;
  const m = await getEcpMapping();
  // prefer explicit mapping
  const col = m.project.ownerUserId || null;
  globalCache.__tcProjectOwnerCol = col;
  return col;
}


