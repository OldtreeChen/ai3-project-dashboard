const $ = (sel) => document.querySelector(sel);

function fmtHours(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function buildQuery(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

async function apiGet(path) {
  const res = await fetch(path, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return await res.json();
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = html;
}

function badgeForDiff(diff) {
  if (diff >= 0) return `<span class="badge badge--good">剩餘 ${fmtHours(diff)}h</span>`;
  const over = Math.abs(diff);
  return `<span class="badge badge--bad">超支 ${fmtHours(over)}h</span>`;
}

function renderBar(percent) {
  const p = clamp(percent, 0, 100);
  return `<div class="bar"><div style="width:${p}%"></div></div>`;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function setLoading(isLoading) {
  const btn = $('#applyBtn');
  btn.disabled = !!isLoading;
  btn.textContent = isLoading ? '載入中…' : '套用';
}

async function loadDepartments() {
  const deps = await apiGet('/api/departments');
  const sel = $('#departmentSelect');
  sel.innerHTML = `<option value="">全部</option>` + deps.map(d => {
    return `<option value="${d.id}">${escapeHtml(d.name)}</option>`;
  }).join('');
  return deps;
}

async function loadPeople(departmentId) {
  const q = buildQuery({ departmentId });
  const people = await apiGet(`/api/people${q}`);
  const sel = $('#personSelect');
  sel.innerHTML = `<option value="">全部</option>` + people.map(p => {
    return `<option value="${p.id}">${escapeHtml(p.display_name)}</option>`;
  }).join('');
  return people;
}

async function loadProjects() {
  const projects = await apiGet('/api/projects');
  const sel = $('#projectSelect');
  sel.innerHTML = projects.map(p => {
    const label = p.code ? `${p.code}｜${p.name}` : p.name;
    return `<option value="${p.id}">${label}</option>`;
  }).join('');
  return projects;
}

function renderTrendChart(targetEl, rows, from, to) {
  const el = targetEl;
  if (!rows?.length) {
    el.innerHTML = `<div class="chart-empty">尚無趨勢資料（${from} ~ ${to}）</div>`;
    return;
  }

  const w = 1000;
  const h = 200;
  const pad = { l: 42, r: 18, t: 18, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const xs = rows.map((_, i) => i);
  const ys = rows.map(r => Number(r.hours || 0));
  const maxY = Math.max(...ys, 1);

  const x = (i) => pad.l + (xs.length === 1 ? innerW / 2 : (i / (xs.length - 1)) * innerW);
  const y = (v) => pad.t + (1 - (v / maxY)) * innerH;

  const pts = rows.map((r, i) => `${x(i)},${y(Number(r.hours || 0))}`).join(' ');

  const yTicks = 4;
  const grid = Array.from({ length: yTicks + 1 }).map((_, i) => {
    const vv = (maxY * i) / yTicks;
    const yy = y(vv);
    return `
      <line x1="${pad.l}" y1="${yy}" x2="${w - pad.r}" y2="${yy}" stroke="rgba(255,255,255,0.08)" />
      <text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="rgba(255,255,255,0.65)">${fmtHours(vv)}</text>
    `;
  }).join('');

  const firstLabel = rows[0]?.date || '';
  const lastLabel = rows[rows.length - 1]?.date || '';

  el.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="daily hours trend">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(96,165,250,0.25)" />
          <stop offset="100%" stop-color="rgba(96,165,250,0.00)" />
        </linearGradient>
        <linearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="rgba(74,222,128,0.95)" />
          <stop offset="100%" stop-color="rgba(96,165,250,0.95)" />
        </linearGradient>
      </defs>

      ${grid}
      <path d="M ${pad.l},${pad.t + innerH} L ${pts} L ${w - pad.r},${pad.t + innerH} Z" fill="url(#trendFill)" />
      <polyline points="${pts}" fill="none" stroke="url(#trendStroke)" stroke-width="2.5" />
      ${rows.map((r, i) => {
        const cx = x(i);
        const cy = y(Number(r.hours || 0));
        const title = `${r.date}：${fmtHours(r.hours)} h`;
        return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="rgba(255,255,255,0.92)"><title>${escapeHtml(title)}</title></circle>`;
      }).join('')}

      <text x="${pad.l}" y="${h - 8}" font-size="11" fill="rgba(255,255,255,0.65)">${escapeHtml(firstLabel)}</text>
      <text x="${w - pad.r}" y="${h - 8}" text-anchor="end" font-size="11" fill="rgba(255,255,255,0.65)">${escapeHtml(lastLabel)}</text>
    </svg>
  `;
}

async function loadAndRender(projectId, from, to, departmentId, personId) {
  const q = buildQuery({ from, to, departmentId, personId });

  const [summary, people, tasks, matrix, trend] = await Promise.all([
    apiGet(`/api/projects/${projectId}/summary${q}`),
    apiGet(`/api/projects/${projectId}/people-breakdown${q}`),
    apiGet(`/api/projects/${projectId}/tasks-breakdown${q}`),
    apiGet(`/api/projects/${projectId}/person-task-matrix${q}`),
    (from && to) ? apiGet(`/api/projects/${projectId}/daily-hours${q}`) : Promise.resolve({ rows: [] })
  ]);

  const planned = Number(summary.planned_hours || 0);
  const actual = Number(summary.actual_hours || 0);
  const diff = planned - actual;

  setText('plannedHours', `${fmtHours(planned)} h`);
  setText('actualHours', `${fmtHours(actual)} h`);
  setText('remainingHours', `${fmtHours(Math.abs(diff))} h`);
  setHtml('remainingHint', badgeForDiff(diff));

  const percent = planned > 0 ? (actual / planned) * 100 : 0;
  $('#progressBar').style.width = `${clamp(percent, 0, 100)}%`;
  setText('progressText', planned > 0 ? `${fmtHours(percent)}%（${fmtHours(actual)} / ${fmtHours(planned)} h）` : '--');

  // trend
  setText('trendMeta', from && to ? `${from} ~ ${to}` : '請先選擇日期區間');
  renderTrendChart($('#trendChart'), trend.rows || [], from, to);

  // people table
  const peopleRows = people.people || [];
  const maxPeopleHours = peopleRows.reduce((m, r) => Math.max(m, Number(r.hours || 0)), 0) || 1;
  setText('peopleMeta', from && to ? `${from} ~ ${to}` : '全期間');
  const peopleTbody = $('#peopleTable tbody');
  peopleTbody.innerHTML = peopleRows.map(r => {
    const h = Number(r.hours || 0);
    const p = (h / maxPeopleHours) * 100;
    return `
      <tr>
        <td>${escapeHtml(r.display_name)}</td>
        <td class="num">${fmtHours(h)}</td>
        <td class="num">${r.task_touched_count}</td>
        <td>${renderBar(p)}</td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="4" class="muted">尚無工時資料</td></tr>`;

  // tasks table
  const taskRows = tasks.tasks || [];
  setText('tasksMeta', `${taskRows.length} 個任務`);
  const tasksTbody = $('#tasksTable tbody');
  tasksTbody.innerHTML = taskRows.map(t => {
    const plannedH = Number(t.task_planned_hours || 0);
    const actualH = Number(t.actual_hours || 0);
    const d = plannedH - actualH;
    const badge = d >= 0
      ? `<span class="badge badge--good">+${fmtHours(d)}h</span>`
      : `<span class="badge badge--bad">-${fmtHours(Math.abs(d))}h</span>`;
    return `
      <tr>
        <td>${escapeHtml(t.task_name)}</td>
        <td>${t.owner_name ? escapeHtml(t.owner_name) : '<span class="muted">未指派</span>'}</td>
        <td class="num">${fmtHours(plannedH)}</td>
        <td class="num">${fmtHours(actualH)}</td>
        <td class="num">${badge}</td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="5" class="muted">此專案尚無任務</td></tr>`;

  // matrix
  const rows = matrix.rows || [];
  const peopleNames = uniq(rows.map(r => r.display_name)).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const tasksList = uniq(rows.map(r => `${r.task_id}:::${r.task_name}`))
    .map(s => {
      const [id, name] = s.split(':::');
      return { id: Number(id), name };
    })
    .sort((a, b) => a.id - b.id);

  const map = new Map(); // key: person|task -> hours
  for (const r of rows) {
    map.set(`${r.display_name}|||${r.task_id}`, Number(r.hours || 0));
  }

  const thead = $('#matrixTable thead');
  const tbody = $('#matrixTable tbody');
  thead.innerHTML = `
    <tr>
      <th>人員</th>
      ${tasksList.map(t => `<th class="num">${escapeHtml(t.name)}</th>`).join('')}
      <th class="num">小計</th>
    </tr>
  `;

  tbody.innerHTML = peopleNames.map(name => {
    let sum = 0;
    const tds = tasksList.map(t => {
      const h = map.get(`${name}|||${t.id}`) || 0;
      sum += h;
      return `<td class="num">${h ? fmtHours(h) : ''}</td>`;
    }).join('');
    return `
      <tr>
        <td>${escapeHtml(name)}</td>
        ${tds}
        <td class="num"><strong>${fmtHours(sum)}</strong></td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="2" class="muted">尚無資料</td></tr>`;
}

function todayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  try {
    await Promise.all([loadProjects(), loadDepartments()]);
    const sel = $('#projectSelect');
    const depSel = $('#departmentSelect');
    const personSel = $('#personSelect');
    const from = $('#fromDate');
    const to = $('#toDate');

    // 預設給一個合理區間：本月 1 日 ~ 今天
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstYMD = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}`;
    from.value = firstYMD;
    to.value = todayYMD();

    const apply = async () => {
      const projectId = sel.value;
      const f = from.value;
      const t = to.value;
      const departmentId = depSel.value;
      const personId = personSel.value;
      setLoading(true);
      try {
        await loadAndRender(projectId, f, t, departmentId, personId);
      } finally {
        setLoading(false);
      }
    };

    const applySafe = () => apply().catch(err => alert(err.message));

    $('#applyBtn').addEventListener('click', applySafe);
    sel.addEventListener('change', applySafe);

    depSel.addEventListener('change', async () => {
      await loadPeople(depSel.value);
      applySafe();
    });
    personSel.addEventListener('change', applySafe);

    $('#resetBtn').addEventListener('click', async () => {
      depSel.value = '';
      await loadPeople('');
      personSel.value = '';
      applySafe();
    });

    await loadPeople('');

    await applySafe();
  } catch (err) {
    console.error(err);
    document.body.innerHTML = `<div style="padding:24px;color:#fff;font-family:system-ui">載入失敗：${err.message}</div>`;
  }
}

main();


