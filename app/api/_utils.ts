export function parseDateParam(v: string | null) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

export function parseIdParam(v: string | null) {
  if (v === null || v === '') return null;
  return v;
}

export function parseIntParam(v: string | null) {
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i <= 0) return null;
  return i;
}



