/* BiblioTech – interfaz (se comunica con el servidor mediante la API REST) */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');

/* ---------- Fechas ---------- */
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function diff(a, b) { return Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 864e5); }
function fmtDate(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d} ${MONTHS[+m - 1]} ${y}`; }
const fmtCOP = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);

/* ---------- Datos (vienen del servidor) ---------- */
let db = { books: [], readers: [], loans: [], profile: { name: '', email: '', phone: '', avatar: null }, config: { institution: '', loanDays: 14, maxBooks: 4 }, readNotifs: [] };
async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'bibliotech', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) { throw new Error('No hay conexión con el servidor.'); }
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Sesión expirada.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
async function refresh() { db = await api('GET', '/api/state'); updateChrome(); render(); }

/* ---------- Lógica de negocio ---------- */
const bookById = id => db.books.find(b => b.id === id);
const readerById = id => db.readers.find(r => r.id === id);
const activeLoansOfBook = id => db.loans.filter(l => l.bookId === id && !l.returnedAt).length;
const activeLoansOfReader = id => db.loans.filter(l => l.readerId === id && !l.returnedAt).length;
const availCopies = b => Math.max(0, b.copies - activeLoansOfBook(b.id));
function st(l) {
  if (l.returnedAt) return 'returned';
  const n = diff(l.due, todayISO());
  if (n < 0) return 'overdue';
  if (n <= 3) return 'due-soon';
  return 'active';
}
const readerOverdue = id => db.loans.some(l => l.readerId === id && st(l) === 'overdue');
function dueText(l) {
  const s = st(l), n = diff(l.due, todayISO());
  if (s === 'returned') return l.returnedAt > l.due ? 'Devuelto con retraso' : 'Devuelto a tiempo';
  if (s === 'overdue') return `Vencido hace ${-n} día${-n === 1 ? '' : 's'}`;
  if (n === 0) return 'Vence hoy';
  if (s === 'due-soon') return `Vence en ${n} día${n === 1 ? '' : 's'}`;
  return `Quedan ${n} días`;
}
const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/* ---------- UI helpers ---------- */
const C = {
  btn: 'flex items-center gap-2 h-10 px-4 rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-colors shadow-sm active:scale-95',
  btn2: 'flex items-center gap-2 h-10 px-4 rounded-lg bg-surface-container-low text-on-surface font-label-md text-label-md hover:bg-surface-container transition-colors shadow-sm active:scale-95',
  input: 'w-full h-10 px-3 rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline font-body-md text-body-md focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/25 shadow-sm',
  card: 'bg-surface-container-lowest rounded-xl shadow-sm',
  label: 'font-label-md text-label-md text-on-surface font-semibold'
};
const icon = (n, c = '') => `<span class="material-symbols-outlined ${c}">${n}</span>`;
const GRADS = ['from-primary to-primary-container', 'from-tertiary to-tertiary-container', 'from-secondary to-inverse-surface', 'from-primary-container to-secondary', 'from-tertiary-container to-primary'];
const CAT_ICON = { Literatura: 'history_edu', Tecnología: 'terminal', Historia: 'public', Filosofía: 'psychology', Ciencia: 'biotech' };
const gradFor = s => GRADS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % GRADS.length];
function avatar(name, size = 'w-9 h-9') { return `<div class="${size} rounded-full bg-primary-fixed text-primary flex items-center justify-center font-label-md text-label-md font-semibold shrink-0">${esc(initials(name))}</div>`; }
function badge(kind, text) {
  const m = {
    overdue: ['bg-error-container text-on-error-container', 'bg-error'],
    'due-soon': ['bg-secondary-container text-on-secondary-fixed', 'bg-amber-500'],
    active: ['bg-tertiary-container/20 text-tertiary', 'bg-tertiary'],
    returned: ['bg-surface-container-high text-on-surface-variant', 'bg-outline'],
    suspended: ['bg-surface-variant text-on-surface-variant', 'bg-secondary']
  }[kind];
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ${m[0]} font-label-sm text-label-sm font-semibold whitespace-nowrap"><span class="w-1.5 h-1.5 rounded-full ${m[1]}"></span>${esc(text)}</span>`;
}
const empty = (ic, title, sub = '') => `<div class="py-12 flex flex-col items-center text-center gap-2 text-on-surface-variant">${icon(ic, 'text-4xl text-outline')}<span class="font-headline-sm text-headline-sm text-on-surface">${esc(title)}</span><span class="font-body-md text-body-md max-w-sm">${esc(sub)}</span></div>`;
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast-in pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl bg-inverse-surface text-inverse-on-surface shadow-xl font-body-md text-body-md max-w-sm';
  el.innerHTML = `${icon(type === 'error' ? 'error' : 'check_circle', type === 'error' ? 'text-error-container' : 'text-tertiary-fixed')}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3200);
}
function openModal(html, wide) {
  $('#modalBox').className = `bg-surface-container-lowest rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[92vh] overflow-y-auto`;
  $('#modalBox').innerHTML = html;
  $('#modalBackdrop').classList.remove('hidden');
}
function closeModal() { $('#modalBackdrop').classList.add('hidden'); $('#modalBox').innerHTML = ''; }
function modalHead(ic, title, sub) {
  return `<div class="px-6 py-4 bg-surface-container-low flex items-center justify-between sticky top-0 z-10"><div class="flex items-center gap-3"><div class="p-2 rounded-xl bg-primary-container text-on-primary">${icon(ic, 'text-xl')}</div><div class="flex flex-col"><h2 class="font-headline-sm text-headline-sm text-on-surface font-bold">${esc(title)}</h2><span class="font-body-sm text-body-sm text-on-surface-variant">${esc(sub)}</span></div></div><button class="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container" data-action="close-modal" type="button">${icon('close', 'text-xl')}</button></div>`;
}
const field = (label, input, hint = '') => `<div class="flex flex-col gap-1.5"><label class="${C.label}">${label}</label>${input}${hint ? `<span class="font-code-sm text-code-sm text-on-surface-variant">${hint}</span>` : ''}</div>`;

/* ---------- Estado de UI ---------- */
const PAGES = ['dashboard', 'catalogo-de-libros', 'lectores', 'prestamos-y-devoluciones', 'reportes-y-estadisticas', 'configuracion'];
const ui = { page: 'dashboard', catSearch: '', catCategory: 'ALL', catAvail: 'ALL', readSearch: '', readStatus: 'ALL', readAff: 'ALL', loanTab: 'all', loanSearch: '' };

/* ---------- Páginas ---------- */
function pageHeader(kicker, title, sub, actions = '') {
  return `<div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md mb-space-lg pt-space-lg"><div class="flex flex-col"><span class="font-code-sm text-code-sm text-primary tracking-wider uppercase font-semibold">${esc(kicker)}</span><h1 class="font-headline-lg text-headline-lg text-on-surface mt-1">${esc(title)}</h1><p class="font-body-md text-body-md text-on-surface-variant">${esc(sub)}</p></div><div class="flex items-center gap-3 self-start md:self-auto flex-wrap">${actions}</div></div>`;
}
function kpi(label, value, sub, ic, color = 'text-on-surface') {
  return `<div class="${C.card} p-space-md flex flex-col justify-between hover:shadow-md transition-shadow"><div class="flex items-start justify-between"><div class="flex flex-col"><span class="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">${esc(label)}</span><span class="font-headline-lg text-headline-lg ${color} font-bold mt-1">${value}</span></div><div class="p-2.5 rounded-lg bg-surface-container text-primary">${icon(ic, 'text-xl')}</div></div><span class="font-body-sm text-body-sm text-on-surface-variant mt-3">${sub}</span></div>`;
}

/* Dashboard */
function pageDashboard() {
  const t = todayISO(), act = db.loans.filter(l => !l.returnedAt);
  const over = act.filter(l => st(l) === 'overdue'), soon = act.filter(l => st(l) === 'due-soon');
  const totalCopies = db.books.reduce((a, b) => a + b.copies, 0), avail = totalCopies - act.length;
  const hr = new Date().getHours(), greet = hr < 12 ? 'Buenos días' : hr < 19 ? 'Buenas tardes' : 'Buenas noches';
  const now = new Date(), dateTxt = `${DAYS_LONG[now.getDay()]}, ${now.getDate()} de ${MONTHS_LONG[now.getMonth()]} de ${now.getFullYear()}`;
  const days = [...Array(7)].map((_, i) => addDays(t, i - 6));
  const series = days.map(d => ({ d, out: db.loans.filter(l => l.date === d).length, back: db.loans.filter(l => l.returnedAt === d).length }));
  const max = Math.max(1, ...series.map(s => Math.max(s.out, s.back)));
  const totOut = series.reduce((a, s) => a + s.out, 0), totBack = series.reduce((a, s) => a + s.back, 0);
  const bars = series.map(s => {
    const dt = new Date(s.d + 'T00:00:00');
    const h = v => `${Math.max(v ? 6 : 2, Math.round(v / max * 100))}%`;
    return `<div class="flex-1 flex flex-col items-center gap-2"><div class="h-44 w-full flex items-end justify-center gap-1.5"><div class="w-5 rounded-t bg-primary-container" style="height:${h(s.out)}" title="${s.out} préstamos"></div><div class="w-5 rounded-t bg-tertiary" style="height:${h(s.back)}" title="${s.back} devoluciones"></div></div><span class="font-label-sm text-label-sm uppercase ${s.d === t ? 'text-primary font-bold' : 'text-on-surface-variant'}">${DAYS_SHORT[dt.getDay()]} ${dt.getDate()}</span><span class="font-code-sm text-code-sm text-on-surface-variant">${s.out}/${s.back}</span></div>`;
  }).join('');
  const alerts = [...over, ...soon].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4);
  const alertHtml = alerts.length ? alerts.map(l => {
    const r = readerById(l.readerId), b = bookById(l.bookId), s = st(l);
    return `<div class="p-3 rounded-lg bg-surface-container-low flex flex-col gap-2"><div class="flex items-start justify-between gap-2"><div class="flex items-center gap-2.5 min-w-0">${avatar(r?.name)}<div class="flex flex-col min-w-0"><span class="font-label-md text-label-md text-on-surface font-semibold truncate">${esc(r?.name)}</span><span class="font-code-sm text-code-sm text-on-surface-variant truncate">${esc(r?.id)}</span></div></div>${badge(s, dueText(l))}</div><div class="flex items-center gap-2 text-on-surface">${icon('book', 'text-sm text-outline')}<span class="font-body-sm text-body-sm font-medium truncate">${esc(b?.title)}</span></div><div class="flex justify-end gap-1.5"><button class="px-2.5 py-1 rounded bg-surface-container-highest text-primary font-label-sm text-label-sm hover:bg-primary hover:text-on-primary transition-colors" data-action="renew" data-id="${l.id}" type="button">Renovar +7d</button><button class="px-2.5 py-1 rounded bg-primary-container text-on-primary font-label-sm text-label-sm hover:bg-primary transition-colors" data-action="return" data-id="${l.id}" type="button">Devolver</button></div></div>`;
  }).join('') : empty('task_alt', 'Todo al día', 'No hay préstamos vencidos ni por vencer.');
  const recent = [...db.loans].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 5);
  const counts = {}; db.loans.forEach(l => counts[l.bookId] = (counts[l.bookId] || 0) + 1);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, n]) => ({ b: bookById(id), n })).filter(x => x.b);
  return `<div class="flex flex-col gap-space-lg pt-space-lg">
  <section class="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md ${C.card} p-space-lg">
    <div class="flex flex-col gap-1"><h1 class="font-headline-lg text-headline-lg text-on-surface">¡${greet}, ${esc(db.profile.name.split(' ')[0])}! 👋</h1>
    <p class="font-body-md text-body-md text-on-surface-variant flex flex-wrap items-center gap-2"><span class="capitalize">${dateTxt}</span><span class="text-outline-variant">•</span><span class="text-tertiary font-medium">${soon.length} por vencer</span><span class="text-outline-variant">•</span><span class="${over.length ? 'text-error' : 'text-on-surface-variant'} font-medium">${over.length} vencido${over.length === 1 ? '' : 's'}</span></p></div>
    <div class="flex items-center gap-3"><button class="${C.btn2}" data-action="new-book" type="button">${icon('add_box', 'text-lg text-primary')}<span>Registrar Libro</span></button><button class="${C.btn}" data-action="new-loan" type="button">${icon('sync_alt', 'text-lg')}<span>Nuevo Préstamo</span></button></div>
  </section>
  <section class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
    ${kpi('Títulos en Catálogo', db.books.length, `${totalCopies} ejemplares en total`, 'auto_stories')}
    ${kpi('Ejemplares Disponibles', avail, totalCopies ? `${Math.round(avail / totalCopies * 100)}% de la colección` : 'Sin libros registrados', 'library_add_check', 'text-tertiary')}
    ${kpi('Lectores Registrados', db.readers.length, `${db.readers.filter(r => r.status === 'SUSPENDIDO').length} suspendido(s)`, 'groups', 'text-primary')}
    ${kpi('Préstamos en Curso', act.length, `${soon.length} por vencer · ${over.length} vencidos`, 'swap_horiz')}
  </section>
  <section class="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
    <div class="xl:col-span-8 ${C.card} p-space-lg flex flex-col gap-space-md">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><h2 class="font-headline-md text-headline-md text-on-surface">Actividad de los Últimos 7 Días</h2><p class="font-body-sm text-body-sm text-on-surface-variant">Libros prestados vs. devueltos (préstamos/devoluciones)</p></div>
      <div class="flex items-center gap-4"><span class="flex items-center gap-2 font-label-sm text-label-sm text-on-surface-variant"><span class="w-3 h-3 rounded-sm bg-primary-container"></span>Préstamos (${totOut})</span><span class="flex items-center gap-2 font-label-sm text-label-sm text-on-surface-variant"><span class="w-3 h-3 rounded-sm bg-tertiary"></span>Devoluciones (${totBack})</span></div></div>
      <div class="flex gap-2 pt-2">${bars}</div>
    </div>
    <div class="xl:col-span-4 ${C.card} p-space-lg flex flex-col gap-space-md">
      <div class="flex items-center justify-between"><div class="flex items-center gap-2">${icon('notification_important', 'text-error')}<h2 class="font-headline-sm text-headline-sm text-on-surface font-semibold">Alertas de Vencimiento</h2></div><span class="font-code-sm text-code-sm bg-error-container text-error px-2 py-0.5 rounded-full font-bold">${over.length + soon.length}</span></div>
      <div class="flex flex-col gap-3">${alertHtml}</div>
    </div>
  </section>
  <section class="${C.card} p-space-lg flex flex-col gap-space-md">
    <div class="flex items-center justify-between"><h2 class="font-headline-md text-headline-md text-on-surface">Préstamos Recientes</h2><button class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-low text-primary font-label-md text-label-md hover:bg-surface-container" data-action="nav" data-page="prestamos-y-devoluciones" type="button"><span>Ver todos</span>${icon('arrow_forward', 'text-sm')}</button></div>
    ${recent.length ? `<div class="overflow-x-auto"><table class="w-full text-left">${loanTableHead()}<tbody class="divide-y divide-surface-container-low">${recent.map(loanRow).join('')}</tbody></table></div>` : empty('sync_alt', 'Aún no hay préstamos', 'Registra el primero con el botón «Nuevo Préstamo».')}
  </section>
  <section class="flex flex-col gap-space-md"><div class="flex items-center gap-2">${icon('workspace_premium', 'text-primary')}<h2 class="font-headline-md text-headline-md text-on-surface">Libros Más Solicitados</h2></div>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md">${top.length ? top.map((x, i) => `<div class="${C.card} p-space-md flex gap-3.5 items-start hover:shadow-md transition-all"><div class="w-16 h-24 rounded-lg bg-gradient-to-br ${gradFor(x.b.category)} p-2 flex flex-col justify-between shrink-0"><span class="font-code-sm text-[10px] text-on-primary/80 font-bold uppercase">#${i + 1}</span>${icon(CAT_ICON[x.b.category] || 'menu_book', 'text-on-primary text-2xl self-center')}<span class="text-[9px] text-on-primary/90 truncate">${esc(x.b.shelf)}</span></div><div class="flex flex-col justify-between h-24 min-w-0 flex-1"><div><h3 class="font-label-md text-label-md font-bold text-on-surface truncate">${esc(x.b.title)}</h3><p class="font-body-sm text-body-sm text-on-surface-variant truncate">${esc(x.b.author)}</p></div><span class="font-code-sm text-code-sm font-semibold text-primary">${x.n} préstamo${x.n === 1 ? '' : 's'}</span></div></div>`).join('') : `<div class="${C.card} md:col-span-4">${empty('trending_up', 'Sin datos todavía', 'El ranking aparecerá cuando haya préstamos.')}</div>`}</div></section>
  </div>`;
}

/* Catálogo */
function pageCatalog() {
  const cats = [...new Set(db.books.map(b => b.category).filter(Boolean))].sort();
  return `${pageHeader('Colección', 'Catálogo de Libros', 'Registra, edita y consulta los libros de la biblioteca.', `<button class="${C.btn}" data-action="new-book" type="button">${icon('add', 'text-lg')}<span>Agregar Libro</span></button>`)}
  <div class="${C.card} p-space-md mb-space-md flex flex-col lg:flex-row gap-3">
    <div class="relative flex-1">${icon('search', 'absolute left-3 top-2.5 text-outline text-lg pointer-events-none')}<input class="${C.input} pl-9" data-filter="catSearch" placeholder="Buscar por título, autor, ISBN, categoría o signatura..." value="${esc(ui.catSearch)}"/></div>
    <select class="${C.input} lg:w-52" data-filter="catCategory"><option value="ALL">Todas las categorías</option>${cats.map(c => `<option ${ui.catCategory === c ? 'selected' : ''} value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
    <select class="${C.input} lg:w-48" data-filter="catAvail"><option value="ALL">Toda disponibilidad</option><option value="YES" ${ui.catAvail === 'YES' ? 'selected' : ''}>Disponibles</option><option value="NO" ${ui.catAvail === 'NO' ? 'selected' : ''}>Sin ejemplares</option></select>
  </div><div id="list">${catalogList()}</div>`;
}
function catalogList() {
  const q = ui.catSearch.trim().toLowerCase();
  const rows = db.books.filter(b => {
    const hay = [b.title, b.author, b.isbn, b.category, b.shelf, b.id].join(' ').toLowerCase();
    const a = availCopies(b);
    return (!q || hay.includes(q)) && (ui.catCategory === 'ALL' || b.category === ui.catCategory) && (ui.catAvail === 'ALL' || (ui.catAvail === 'YES' ? a > 0 : a === 0));
  });
  if (!db.books.length) return `<div class="${C.card}">${empty('menu_book', 'El catálogo está vacío', 'Agrega tu primer libro con el botón «Agregar Libro».')}</div>`;
  if (!rows.length) return `<div class="${C.card}">${empty('search_off', 'Sin resultados', 'Prueba con otros términos o limpia los filtros.')}</div>`;
  return `<p class="font-code-sm text-code-sm text-on-surface-variant mb-2">Mostrando ${rows.length} de ${db.books.length} títulos</p><div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-md">${rows.map(b => {
    const a = availCopies(b);
    return `<div class="${C.card} p-space-md flex gap-4 hover:shadow-md transition-shadow"><div class="w-20 h-28 rounded-lg bg-gradient-to-br ${gradFor(b.category)} p-2 flex flex-col justify-between shrink-0 shadow-sm"><span class="font-code-sm text-[10px] text-on-primary/80 font-bold uppercase">${esc(b.shelf || '—')}</span>${icon(CAT_ICON[b.category] || 'menu_book', 'text-on-primary text-3xl self-center')}<span class="text-[9px] text-on-primary/90 truncate">${esc(b.category)}</span></div>
    <div class="flex flex-col justify-between min-w-0 flex-1 gap-2"><div><h3 class="font-headline-sm text-headline-sm text-on-surface leading-snug">${esc(b.title)}</h3><p class="font-body-sm text-body-sm text-on-surface-variant">${esc(b.author)}</p><p class="font-code-sm text-code-sm text-outline mt-1">${b.isbn ? 'ISBN ' + esc(b.isbn) + ' · ' : ''}${fmtCOP(b.value)}</p></div>
    <div class="flex items-center justify-between flex-wrap gap-2">${a > 0 ? badge('active', `${a} de ${b.copies} disponible${a === 1 ? '' : 's'}`) : badge('overdue', `Prestado (0 de ${b.copies})`)}
    <div class="flex items-center gap-1"><button class="px-2.5 py-1 rounded-lg bg-primary-container text-on-primary font-label-sm text-label-sm hover:bg-primary disabled:opacity-40 disabled:cursor-not-allowed" data-action="loan-book" data-id="${b.id}" ${a ? '' : 'disabled'} type="button">Prestar</button><button class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container" title="Editar" data-action="edit-book" data-id="${b.id}" type="button">${icon('edit', 'text-base')}</button><button class="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container/40" title="Eliminar" data-action="del-book" data-id="${b.id}" type="button">${icon('delete', 'text-base')}</button></div></div></div></div>`;
  }).join('')}</div>`;
}
function bookModal(id) {
  const b = id ? bookById(id) : { title: '', author: '', isbn: '', category: '', shelf: '', copies: 1, value: 0 };
  const cats = [...new Set(['Literatura', 'Tecnología', 'Historia', 'Filosofía', 'Ciencia', ...db.books.map(x => x.category)])];
  openModal(`${modalHead('menu_book', id ? 'Editar Libro' : 'Registrar Libro', id ? b.id : 'Se asignará un código automáticamente')}
  <form class="p-6 flex flex-col gap-4" data-form="book" data-id="${id || ''}">
    ${field('Título *', `<input class="${C.input}" name="title" required value="${esc(b.title)}" placeholder="Ej. Cien Años de Soledad"/>`)}
    ${field('Autor *', `<input class="${C.input}" name="author" required value="${esc(b.author)}" placeholder="Ej. Gabriel García Márquez"/>`)}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      ${field('Categoría *', `<input class="${C.input}" name="category" list="catList" required value="${esc(b.category)}" placeholder="Elige o escribe una nueva"/><datalist id="catList">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`)}
      ${field('ISBN', `<input class="${C.input}" name="isbn" value="${esc(b.isbn)}" placeholder="978..."/>`)}
      ${field('Ubicación / Signatura', `<input class="${C.input}" name="shelf" value="${esc(b.shelf)}" placeholder="Ej. B-04"/>`)}
      ${field('Número de ejemplares *', `<input class="${C.input}" name="copies" type="number" min="1" max="999" required value="${b.copies}"/>`)}
    </div>
    ${field('Valor de reposición (COP)', `<input class="${C.input}" name="value" type="number" min="0" step="1000" value="${b.value || 0}"/>`, 'Precio del libro en pesos colombianos.')}
    <div class="flex justify-end gap-3 pt-2"><button class="px-4 py-2 rounded-lg text-on-surface-variant hover:bg-surface-container font-label-md text-label-md" data-action="close-modal" type="button">Cancelar</button><button class="${C.btn}" type="submit">${icon('check', 'text-lg')}<span>${id ? 'Guardar Cambios' : 'Registrar Libro'}</span></button></div>
  </form>`);
}

/* Lectores */
function pageReaders() {
  const late = db.readers.filter(r => readerOverdue(r.id)).length, susp = db.readers.filter(r => r.status === 'SUSPENDIDO').length;
  return `${pageHeader('Afiliados', 'Directorio de Lectores', 'Gestiona los usuarios, su estado y su historial de préstamos.', `<button class="${C.btn}" data-action="new-reader" type="button">${icon('person_add', 'text-lg')}<span>Nuevo Lector</span></button>`)}
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-space-md mb-space-md">${kpi('Registrados', db.readers.length, 'lectores', 'badge')}${kpi('Con Préstamos', new Set(db.loans.filter(l => !l.returnedAt).map(l => l.readerId)).size, 'actualmente', 'auto_stories', 'text-primary')}${kpi('En Mora', late, 'con préstamos vencidos', 'warning', late ? 'text-error' : 'text-on-surface')}${kpi('Suspendidos', susp, 'sin permiso de préstamo', 'block')}</div>
  <div class="${C.card} p-space-md mb-space-md flex flex-col lg:flex-row gap-3">
    <div class="relative flex-1">${icon('manage_search', 'absolute left-3 top-2.5 text-outline text-lg pointer-events-none')}<input class="${C.input} pl-9" data-filter="readSearch" placeholder="Buscar por nombre, documento, correo o código..." value="${esc(ui.readSearch)}"/></div>
    <select class="${C.input} lg:w-48" data-filter="readStatus"><option value="ALL">Todos los estados</option><option value="ACTIVO" ${ui.readStatus === 'ACTIVO' ? 'selected' : ''}>Al día</option><option value="MORA" ${ui.readStatus === 'MORA' ? 'selected' : ''}>En mora</option><option value="SUSPENDIDO" ${ui.readStatus === 'SUSPENDIDO' ? 'selected' : ''}>Suspendido</option></select>
    <select class="${C.input} lg:w-48" data-filter="readAff"><option value="ALL">Toda afiliación</option>${['Estudiante', 'Docente', 'Investigador', 'Público'].map(a => `<option ${ui.readAff === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
  </div><div id="list">${readersList()}</div>`;
}
function readersList() {
  if (!db.readers.length) return `<div class="${C.card}">${empty('groups', 'No hay lectores', 'Agrega el primero con «Nuevo Lector».')}</div>`;
  const q = ui.readSearch.trim().toLowerCase();
  const rows = db.readers.filter(r => {
    const mora = readerOverdue(r.id);
    const stOk = ui.readStatus === 'ALL' || (ui.readStatus === 'MORA' ? mora : ui.readStatus === 'SUSPENDIDO' ? r.status === 'SUSPENDIDO' : r.status === 'ACTIVO' && !mora);
    return (!q || [r.name, r.doc, r.email, r.id, r.phone].join(' ').toLowerCase().includes(q)) && stOk && (ui.readAff === 'ALL' || r.affiliation === ui.readAff);
  });
  if (!rows.length) return `<div class="${C.card}">${empty('search_off', 'Sin resultados', 'Ajusta la búsqueda o los filtros.')}</div>`;
  return `<div class="${C.card} overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left"><thead><tr class="bg-surface-container-low font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider"><th class="py-3 px-4">Lector</th><th class="py-3 px-4">Documento</th><th class="py-3 px-4">Contacto</th><th class="py-3 px-4">Afiliación</th><th class="py-3 px-4 text-center">En posesión</th><th class="py-3 px-4">Estado</th><th class="py-3 px-4 text-right">Acciones</th></tr></thead><tbody class="divide-y divide-surface-container font-body-sm text-body-sm">${rows.map(r => {
    const n = activeLoansOfReader(r.id), mora = readerOverdue(r.id);
    const s = r.status === 'SUSPENDIDO' ? badge('suspended', 'Suspendido') : mora ? badge('overdue', 'En mora') : badge('active', 'Al día');
    return `<tr class="hover:bg-surface-container-low/50"><td class="py-3 px-4"><div class="flex items-center gap-3">${avatar(r.name, 'w-10 h-10')}<div class="flex flex-col"><span class="font-headline-sm text-headline-sm text-on-surface">${esc(r.name)}</span><span class="font-code-sm text-code-sm text-on-surface-variant">${esc(r.id)}</span></div></div></td><td class="py-3 px-4 font-code-sm text-code-sm">${esc(r.doc)}</td><td class="py-3 px-4"><div class="flex flex-col"><span>${esc(r.email)}</span><span class="font-code-sm text-code-sm text-on-surface-variant">${esc(r.phone)}</span></div></td><td class="py-3 px-4">${esc(r.affiliation)}</td><td class="py-3 px-4 text-center"><span class="inline-flex px-2 h-6 items-center rounded-full ${n ? 'bg-primary-container text-on-primary' : 'bg-surface-container-high text-on-surface-variant'} font-code-sm text-code-sm font-semibold">${n} libro${n === 1 ? '' : 's'}</span></td><td class="py-3 px-4">${s}</td><td class="py-3 px-4 text-right"><div class="flex items-center justify-end gap-1"><button class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container" title="Editar" data-action="edit-reader" data-id="${r.id}" type="button">${icon('edit', 'text-base')}</button><button class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container" title="Historial" data-action="history-reader" data-id="${r.id}" type="button">${icon('history', 'text-base')}</button><button class="p-1.5 rounded-lg text-on-surface-variant hover:text-tertiary hover:bg-surface-container" title="${r.status === 'SUSPENDIDO' ? 'Reactivar' : 'Suspender'}" data-action="toggle-reader" data-id="${r.id}" type="button">${icon(r.status === 'SUSPENDIDO' ? 'lock_open' : 'block', 'text-base')}</button><button class="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error-container/40" title="Eliminar" data-action="del-reader" data-id="${r.id}" type="button">${icon('delete', 'text-base')}</button></div></td></tr>`;
  }).join('')}</tbody></table></div><div class="p-3 bg-surface-container-low/40 font-code-sm text-code-sm text-on-surface-variant">Mostrando ${rows.length} de ${db.readers.length} lectores</div></div>`;
}
function readerModal(id) {
  const r = id ? readerById(id) : { name: '', doc: '', email: '', phone: '', affiliation: 'Estudiante', status: 'ACTIVO' };
  openModal(`${modalHead('person', id ? 'Editar Lector' : 'Nuevo Lector', id ? r.id : 'Se asignará un código automáticamente')}
  <form class="p-6 flex flex-col gap-4" data-form="reader" data-id="${id || ''}">
    ${field('Nombre completo *', `<input class="${C.input}" name="name" required value="${esc(r.name)}"/>`)}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      ${field('Documento *', `<input class="${C.input}" name="doc" required value="${esc(r.doc)}" placeholder="CC 1.000.000.000"/>`)}
      ${field('Afiliación', `<select class="${C.input}" name="affiliation">${['Estudiante', 'Docente', 'Investigador', 'Público'].map(a => `<option ${r.affiliation === a ? 'selected' : ''}>${a}</option>`).join('')}</select>`)}
      ${field('Correo electrónico *', `<input class="${C.input}" name="email" type="email" required value="${esc(r.email)}"/>`)}
      ${field('Teléfono', `<input class="${C.input}" name="phone" type="tel" value="${esc(r.phone)}" placeholder="+57 300 000 0000"/>`)}
    </div>
    ${field('Estado de la cuenta', `<select class="${C.input}" name="status"><option value="ACTIVO" ${r.status === 'ACTIVO' ? 'selected' : ''}>Activo (habilitado para préstamos)</option><option value="SUSPENDIDO" ${r.status === 'SUSPENDIDO' ? 'selected' : ''}>Suspendido (bloqueo administrativo)</option></select>`)}
    <div class="flex justify-end gap-3 pt-2"><button class="px-4 py-2 rounded-lg text-on-surface-variant hover:bg-surface-container font-label-md text-label-md" data-action="close-modal" type="button">Cancelar</button><button class="${C.btn}" type="submit">${icon('check', 'text-lg')}<span>Guardar Lector</span></button></div>
  </form>`);
}
function historyModal(id) {
  const r = readerById(id); if (!r) return;
  const ls = db.loans.filter(l => l.readerId === id).sort((a, b) => b.date.localeCompare(a.date));
  openModal(`${modalHead('history', r.name, 'Historial de préstamos · ' + r.id)}<div class="p-6 flex flex-col gap-3">${ls.length ? ls.map(l => { const b = bookById(l.bookId); return `<div class="p-3 rounded-xl bg-surface-container-low flex items-start justify-between gap-3"><div class="flex flex-col min-w-0"><span class="font-label-md text-label-md text-on-surface font-semibold">${esc(b?.title || 'Libro eliminado')}</span><span class="font-code-sm text-code-sm text-on-surface-variant">Prestado: ${fmtDate(l.date)} · Límite: ${fmtDate(l.due)}${l.returnedAt ? ' · Devuelto: ' + fmtDate(l.returnedAt) : ''}</span></div>${badge(st(l), l.returnedAt ? 'Devuelto' : dueText(l))}</div>`; }).join('') : empty('history', 'Sin préstamos', 'Este lector todavía no ha tomado libros prestados.')}<div class="flex justify-end pt-2"><button class="${C.btn2}" data-action="close-modal" type="button">Cerrar</button></div></div>`);
}

/* Préstamos */
function loanTableHead() {
  return `<thead><tr class="bg-surface-container-low text-on-surface-variant font-label-sm text-label-sm uppercase tracking-wider"><th class="py-3 px-4">Código</th><th class="py-3 px-4">Lector</th><th class="py-3 px-4">Libro</th><th class="py-3 px-4">Salida</th><th class="py-3 px-4">Límite</th><th class="py-3 px-4">Estado</th><th class="py-3 px-4 text-right">Acciones</th></tr></thead>`;
}
function loanRow(l) {
  const r = readerById(l.readerId), b = bookById(l.bookId), s = st(l);
  const acts = s === 'returned'
    ? `<span class="font-code-sm text-code-sm text-on-surface-variant">${fmtDate(l.returnedAt)}</span>`
    : `<button class="px-2.5 py-1.5 rounded-lg bg-surface-container text-primary hover:bg-primary hover:text-on-primary font-label-md text-label-md transition-all shadow-sm flex items-center gap-1" data-action="return" data-id="${l.id}" type="button">${icon('keyboard_return', 'text-sm')}<span>Devolver</span></button><button class="px-2 py-1.5 rounded-lg bg-surface-container-high text-on-surface hover:bg-primary-fixed font-label-md text-label-md flex items-center gap-1" title="Extender 7 días" data-action="renew" data-id="${l.id}" type="button">${icon('update', 'text-sm')}<span>+7d</span></button>`;
  return `<tr class="hover:bg-surface-container-low/60 ${s === 'returned' ? 'opacity-75' : ''}"><td class="py-3 px-4 font-code-sm text-code-sm text-primary font-semibold">${esc(l.id)}</td><td class="py-3 px-4"><div class="flex items-center gap-2.5">${avatar(r?.name, 'w-8 h-8')}<div class="flex flex-col min-w-0"><span class="font-label-md text-label-md font-semibold text-on-surface truncate">${esc(r?.name || 'Lector eliminado')}</span><span class="font-code-sm text-[11px] text-on-surface-variant">${esc(r?.doc || '')}</span></div></div></td><td class="py-3 px-4"><div class="flex flex-col max-w-[220px]"><span class="font-label-md text-label-md font-semibold text-on-surface truncate">${esc(b?.title || 'Libro eliminado')}</span><span class="font-code-sm text-[11px] text-outline truncate">${esc(b?.author || '')}${b?.shelf ? ' · ' + esc(b.shelf) : ''}</span></div></td><td class="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant whitespace-nowrap">${fmtDate(l.date)}</td><td class="py-3 px-4 font-code-sm text-code-sm whitespace-nowrap ${s === 'overdue' ? 'text-error font-semibold' : s === 'due-soon' ? 'text-amber-700 font-semibold' : ''}">${fmtDate(l.due)}</td><td class="py-3 px-4">${badge(s, dueText(l))}</td><td class="py-3 px-4"><div class="flex items-center justify-end gap-1.5">${acts}</div></td></tr>`;
}
function pageLoans() {
  const c = k => k === 'all' ? db.loans.length : db.loans.filter(l => st(l) === k).length;
  const tabs = [['all', 'Todos'], ['active', 'En curso'], ['due-soon', 'Por vencer'], ['overdue', 'Vencidos'], ['returned', 'Devueltos']];
  const act = db.loans.filter(l => !l.returnedAt);
  return `${pageHeader('Circulación', 'Préstamos y Devoluciones', 'Registra préstamos, recibe devoluciones y renueva plazos.', `<button class="${C.btn}" data-action="new-loan" type="button">${icon('add_circle', 'text-lg')}<span>Registrar Nuevo Préstamo</span></button>`)}
  <div class="grid grid-cols-2 xl:grid-cols-4 gap-space-md mb-space-md">${kpi('Préstamos Activos', act.length, 'ejemplares fuera', 'import_contacts')}${kpi('Por Vencer (3 días)', c('due-soon'), 'requieren aviso', 'pending_actions')}${kpi('Vencidos', c('overdue'), 'pendientes de devolución', 'warning', c('overdue') ? 'text-error' : 'text-on-surface')}${kpi('Devueltos', c('returned'), 'en el historial', 'assignment_turned_in', 'text-tertiary')}</div>
  <div class="${C.card} p-2 mb-space-md flex flex-col md:flex-row md:items-center justify-between gap-3"><div class="flex items-center gap-1 overflow-x-auto">${tabs.map(([k, n]) => `<button class="px-4 py-2 rounded-lg font-label-md text-label-md transition-all flex items-center gap-2 shrink-0 ${ui.loanTab === k ? 'bg-primary-container text-on-primary shadow-sm font-semibold' : 'text-on-surface-variant hover:bg-surface-container-high'}" data-action="loan-tab" data-tab="${k}" type="button"><span>${n}</span><span class="px-1.5 rounded-full ${ui.loanTab === k ? 'bg-white/20' : 'bg-surface-container'} font-code-sm text-code-sm">${c(k)}</span></button>`).join('')}</div>
  <div class="relative w-full md:w-64">${icon('search', 'absolute left-3 top-2.5 text-outline text-lg pointer-events-none')}<input class="w-full h-9 pl-9 pr-3 rounded-lg bg-surface-container-low font-body-sm text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/20" data-filter="loanSearch" placeholder="Filtrar préstamos..." value="${esc(ui.loanSearch)}"/></div></div>
  <div class="${C.card} overflow-hidden" id="list">${loansList()}</div>`;
}
function loansList() {
  const q = ui.loanSearch.trim().toLowerCase();
  const rows = db.loans.filter(l => {
    if (ui.loanTab === 'active') { if (!['active', 'due-soon'].includes(st(l))) return false; }
    else if (ui.loanTab !== 'all' && st(l) !== ui.loanTab) return false;
    if (!q) return true;
    const r = readerById(l.readerId), b = bookById(l.bookId);
    return [l.id, r?.name, r?.doc, b?.title, b?.author].join(' ').toLowerCase().includes(q);
  }).sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  if (!db.loans.length) return empty('sync_alt', 'Aún no hay préstamos', 'Pulsa «Registrar Nuevo Préstamo» para crear el primero.');
  if (!rows.length) return empty('search_off', 'Sin resultados', 'No hay préstamos que coincidan con el filtro.');
  return `<div class="overflow-x-auto"><table class="w-full text-left">${loanTableHead()}<tbody class="divide-y divide-surface-container-low">${rows.map(loanRow).join('')}</tbody></table></div><div class="p-3 bg-surface-container-low/40 font-code-sm text-code-sm text-on-surface-variant">Mostrando ${rows.length} de ${db.loans.length} registros</div>`;
}
function loanModal(preBook) {
  const readers = db.readers.filter(r => r.status === 'ACTIVO');
  const books = db.books.filter(b => availCopies(b) > 0);
  if (!db.books.length) return toast('Primero agrega libros al catálogo.', 'error');
  if (!db.readers.length) return toast('Primero registra al menos un lector.', 'error');
  if (!books.length) return toast('No hay ejemplares disponibles en este momento.', 'error');
  if (!readers.length) return toast('No hay lectores activos (todos están suspendidos).', 'error');
  const days = +db.config.loanDays || 14;
  const opts = [7, 14, 30];
  if (!opts.includes(days)) opts.push(days), opts.sort((a, b) => a - b);
  openModal(`${modalHead('menu_book', 'Registrar Préstamo', 'Solo se muestran lectores activos y libros disponibles')}
  <form class="p-6 flex flex-col gap-5" data-form="loan">
    ${field('1. Lector *', `<select class="${C.input}" name="readerId" required><option value="">Selecciona un lector...</option>${readers.map(r => `<option value="${r.id}">${esc(r.name)} — ${esc(r.doc)} (${activeLoansOfReader(r.id)}/${db.config.maxBooks} libros)</option>`).join('')}</select>`)}
    ${field('2. Libro *', `<select class="${C.input}" name="bookId" required><option value="">Selecciona un libro...</option>${books.map(b => `<option value="${b.id}" ${b.id === preBook ? 'selected' : ''}>${esc(b.title)} — ${esc(b.author)} (${availCopies(b)} disp.)</option>`).join('')}</select>`)}
    <div class="flex flex-col gap-2"><span class="${C.label}">3. Plazo de préstamo</span><div class="grid grid-cols-3 gap-3">${opts.map(d => `<label class="cursor-pointer"><input class="peer sr-only" type="radio" name="days" value="${d}" ${d === days ? 'checked' : ''}/><div class="p-3 rounded-xl bg-surface-container-low text-on-surface-variant text-center font-label-md text-label-md font-semibold hover:bg-surface-container-high peer-checked:bg-primary-container peer-checked:text-on-primary peer-checked:shadow-sm transition-all">${d} días</div></label>`).join('')}</div>
    <div class="p-3 rounded-xl bg-surface-container flex items-center justify-between mt-1"><span class="flex items-center gap-2 font-body-sm text-body-sm">${icon('event_upcoming', 'text-primary text-lg')}Fecha límite:</span><span class="font-code-sm text-code-sm font-bold text-primary px-3 py-1 rounded bg-surface-container-lowest shadow-sm" id="dueText">${fmtDate(addDays(todayISO(), days))}</span></div></div>
    <div class="flex justify-end gap-3 pt-1"><button class="px-4 py-2 rounded-lg text-on-surface-variant hover:bg-surface-container font-label-md text-label-md" data-action="close-modal" type="button">Cancelar</button><button class="${C.btn}" type="submit">${icon('check_circle', 'text-lg')}<span>Confirmar Préstamo</span></button></div>
  </form>`);
}

/* Reportes */
function pageReports() {
  const counts = {}; db.loans.forEach(l => counts[l.bookId] = (counts[l.bookId] || 0) + 1);
  const rc = {}; db.loans.forEach(l => rc[l.readerId] = (rc[l.readerId] || 0) + 1);
  const cat = {}; db.loans.forEach(l => { const b = bookById(l.bookId); if (b) cat[b.category] = (cat[b.category] || 0) + 1; });
  const rank = (obj, fmt) => { const arr = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5); const m = Math.max(1, ...arr.map(x => x[1])); return arr.length ? arr.map(([k, n]) => `<div><div class="flex justify-between font-body-sm text-body-sm mb-1"><span class="font-medium text-on-surface truncate pr-2">${esc(fmt(k))}</span><span class="font-code-sm text-code-sm font-semibold">${n}</span></div><div class="w-full h-1.5 bg-surface-container rounded-full overflow-hidden"><div class="h-full bg-primary-container rounded-full" style="width:${n / m * 100}%"></div></div></div>`).join('') : empty('bar_chart', 'Sin datos', 'Aún no hay préstamos.'); };
  const ret = db.loans.filter(l => l.returnedAt), onTime = ret.filter(l => l.returnedAt <= l.due).length;
  const box = (t, ic, body) => `<div class="${C.card} p-space-lg flex flex-col gap-4"><div class="flex items-center gap-2">${icon(ic, 'text-primary')}<h2 class="font-headline-sm text-headline-sm text-on-surface">${t}</h2></div>${body}</div>`;
  return `${pageHeader('Análisis', 'Reportes y Estadísticas', 'Resumen calculado con los datos reales de tu biblioteca.', `<button class="${C.btn2}" data-action="export-csv" type="button">${icon('download', 'text-lg text-primary')}<span>Exportar préstamos (CSV)</span></button>`)}
  <div class="grid grid-cols-2 xl:grid-cols-4 gap-space-md mb-space-lg">${kpi('Préstamos Totales', db.loans.length, 'desde el inicio', 'sync_alt')}${kpi('Devoluciones', ret.length, 'registradas', 'assignment_turned_in', 'text-tertiary')}${kpi('A Tiempo', ret.length ? Math.round(onTime / ret.length * 100) + '%' : '—', 'de las devoluciones', 'schedule', 'text-primary')}${kpi('Valor del Catálogo', fmtCOP(db.books.reduce((a, b) => a + (b.value || 0) * b.copies, 0)), 'valor de reposición (COP)', 'payments')}</div>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-space-lg">${box('Libros más prestados', 'workspace_premium', `<div class="flex flex-col gap-3">${rank(counts, id => bookById(id)?.title || id)}</div>`)}${box('Lectores más activos', 'groups', `<div class="flex flex-col gap-3">${rank(rc, id => readerById(id)?.name || id)}</div>`)}${box('Préstamos por categoría', 'category', `<div class="flex flex-col gap-3">${rank(cat, k => k)}</div>`)}</div>`;
}

/* Configuración */
function pageSettings() {
  const p = db.profile, c = db.config;
  return `${pageHeader('Sistema', 'Configuración y Perfil', 'Edita tu perfil, las políticas de préstamo y los respaldos.')}
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
  <div class="lg:col-span-8 flex flex-col gap-space-lg">
    <section class="${C.card} p-space-lg flex flex-col gap-space-md"><h2 class="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">${icon('badge', 'text-primary')}Perfil</h2>
      <div class="bg-surface-container-low rounded-xl p-space-md flex items-center gap-space-lg"><div class="w-20 h-20 rounded-full overflow-hidden bg-primary-fixed text-primary flex items-center justify-center text-2xl font-bold shadow-md shrink-0">${p.avatar ? `<img class="w-full h-full object-cover" src="${p.avatar}" alt="Foto de perfil"/>` : esc(initials(p.name))}</div>
      <div class="flex flex-col gap-2"><span class="font-body-sm text-body-sm text-on-surface-variant">JPG, PNG o WebP. Máx. 2 MB. Se guarda en el servidor.</span><div class="flex gap-2"><label class="${C.btn2} cursor-pointer">${icon('file_upload', 'text-base text-primary')}<span>Cambiar foto</span><input accept="image/*" class="hidden" id="avatarInput" type="file"/></label>${p.avatar ? `<button class="flex items-center gap-1 px-3 h-10 rounded-lg text-error hover:bg-error-container font-label-md text-label-md" data-action="del-avatar" type="button">${icon('delete', 'text-base')}<span>Quitar</span></button>` : ''}</div></div></div>
      <form class="grid grid-cols-1 md:grid-cols-2 gap-space-md" data-form="profile">
        ${field('Nombre y apellidos *', `<input class="${C.input}" name="name" required value="${esc(p.name)}"/>`)}
        ${field('Correo electrónico *', `<input class="${C.input}" name="email" type="email" required value="${esc(p.email)}"/>`)}
        ${field('Teléfono', `<input class="${C.input}" name="phone" type="tel" value="${esc(p.phone)}"/>`)}
        <div class="flex items-end"><button class="${C.btn} w-full justify-center" type="submit">${icon('check', 'text-base')}<span>Guardar perfil</span></button></div>
      </form></section>
    <section class="${C.card} p-space-lg flex flex-col gap-space-md"><h2 class="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">${icon('account_balance', 'text-tertiary')}Parámetros de la biblioteca</h2>
      <form class="grid grid-cols-1 md:grid-cols-2 gap-space-md" data-form="config">
        <div class="md:col-span-2">${field('Nombre de la biblioteca', `<input class="${C.input}" name="institution" value="${esc(c.institution)}"/>`)}</div>
        ${field('Plazo de préstamo estándar (días)', `<input class="${C.input}" name="loanDays" type="number" min="1" max="90" value="${c.loanDays}"/>`)}
        ${field('Máximo de libros por lector', `<input class="${C.input}" name="maxBooks" type="number" min="1" max="20" value="${c.maxBooks}"/>`)}
        <div class="md:col-span-2 flex justify-end"><button class="${C.btn}" type="submit">${icon('check', 'text-base')}<span>Guardar parámetros</span></button></div>
      </form></section>
    <section class="${C.card} p-space-lg flex flex-col gap-space-md"><h2 class="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">${icon('lock', 'text-primary')}Cambiar contraseña</h2>
      <form class="grid grid-cols-1 md:grid-cols-3 gap-space-md" data-form="password" autocomplete="off">
        ${field('Contraseña actual', `<input class="${C.input}" name="current" type="password" autocomplete="current-password" required/>`)}
        ${field('Nueva contraseña (mín. 8)', `<input class="${C.input}" name="next" type="password" minlength="8" autocomplete="new-password" required/>`)}
        ${field('Confirmar nueva', `<input class="${C.input}" name="confirm" type="password" minlength="8" autocomplete="new-password" required/>`)}
        <div class="md:col-span-3 flex justify-end"><button class="${C.btn}" type="submit">${icon('check', 'text-base')}<span>Actualizar contraseña</span></button></div>
      </form></section></div>
  <div class="lg:col-span-4 flex flex-col gap-space-lg"><section class="${C.card} p-space-lg flex flex-col gap-4"><h2 class="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">${icon('database', 'text-primary')}Datos y respaldo</h2>
    <div class="grid grid-cols-3 gap-2 text-center">${[['Libros', db.books.length], ['Lectores', db.readers.length], ['Préstamos', db.loans.length]].map(([n, v]) => `<div class="p-2 rounded bg-surface-container-low"><span class="font-headline-sm text-headline-sm block">${v}</span><span class="font-label-sm text-[10px] text-on-surface-variant uppercase">${n}</span></div>`).join('')}</div>
    <button class="${C.btn} justify-center" data-action="export-json" type="button">${icon('download', 'text-lg')}<span>Exportar respaldo (.json)</span></button>
    <label class="${C.btn2} justify-center cursor-pointer">${icon('upload_file', 'text-lg')}<span>Importar respaldo</span><input accept=".json,application/json" class="hidden" id="importInput" type="file"/></label>
    <hr class="border-surface-container"/>
    <button class="${C.btn2} justify-center" data-action="clear-data" type="button">${icon('playlist_remove', 'text-lg text-error')}<span>Vaciar todo y empezar de cero</span></button>
    <button class="${C.btn2} justify-center" data-action="reset-demo" type="button">${icon('restart_alt', 'text-lg')}<span>Restaurar datos de ejemplo</span></button>
    <p class="font-body-sm text-body-sm text-on-surface-variant">Los datos se guardan en la base de datos del servidor (SQLite). Exporta un respaldo con regularidad.</p></section></div></div>`;
}

/* ---------- Render / navegación ---------- */
const RENDER = { 'dashboard': pageDashboard, 'catalogo-de-libros': pageCatalog, 'lectores': pageReaders, 'prestamos-y-devoluciones': pageLoans, 'reportes-y-estadisticas': pageReports, 'configuracion': pageSettings };
function render() {
  $('#view').innerHTML = `<div class="w-full">${RENDER[ui.page]()}</div>`;
  document.querySelectorAll('aside nav a[data-page]').forEach(a => {
    const on = a.dataset.page === ui.page;
    a.className = `flex items-center gap-3 px-space-md py-2.5 rounded-lg transition-colors ${on ? 'nav-active' : 'nav-idle'}`;
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
}
function refreshList() {
  const el = $('#list'); if (!el) return;
  if (ui.page === 'catalogo-de-libros') el.innerHTML = catalogList();
  else if (ui.page === 'lectores') el.innerHTML = readersList();
  else if (ui.page === 'prestamos-y-devoluciones') el.innerHTML = loansList();
}
function showPage(p) {
  ui.page = PAGES.includes(p) ? p : 'dashboard';
  history.replaceState(null, '', '#' + ui.page);
  closePanels(); render(); window.scrollTo({ top: 0 });
}
function updateChrome() {
  $('#hdrName').textContent = db.profile.name;
  $('#hdrAvatar').innerHTML = db.profile.avatar ? `<img class="w-full h-full object-cover" src="${db.profile.avatar}" alt=""/>` : esc(initials(db.profile.name));
  const act = db.loans.filter(l => !l.returnedAt).length, tot = db.books.reduce((a, b) => a + b.copies, 0), av = tot - act, pct = tot ? Math.round(av / tot * 100) : 0;
  $('#sideAvailPct').textContent = pct + '%'; $('#sideAvailBar').style.width = pct + '%';
  $('#sideAvailTxt').textContent = `${av} de ${tot} ejemplares en estantería`;
  const n = buildNotifs().filter(x => !db.readNotifs.includes(x.id)).length, b = $('#notifBadge');
  b.textContent = n > 9 ? '9+' : n; b.classList.toggle('hidden', !n);
  if (!$('#notifPanel').classList.contains('hidden')) renderNotifs();
}

/* ---------- Notificaciones ---------- */
function buildNotifs() {
  const out = [];
  db.loans.filter(l => !l.returnedAt).forEach(l => {
    const s = st(l); if (s !== 'overdue' && s !== 'due-soon') return;
    const r = readerById(l.readerId), b = bookById(l.bookId);
    out.push({ id: `${s}-${l.id}-${l.due}`, kind: s, title: s === 'overdue' ? 'Préstamo vencido' : 'Préstamo por vencer', text: `${r?.name || 'Lector'} · «${b?.title || 'Libro'}» — ${dueText(l)}`, order: l.due });
  });
  db.books.filter(b => availCopies(b) === 0).forEach(b => out.push({ id: `nostock-${b.id}-${activeLoansOfBook(b.id)}`, kind: 'stock', title: 'Sin ejemplares disponibles', text: `«${b.title}» tiene todos sus ejemplares prestados.`, order: '9999' }));
  return out.sort((a, b) => a.order.localeCompare(b.order));
}
function renderNotifs() {
  const list = buildNotifs(), p = $('#notifPanel');
  const ic = { overdue: ['error', 'text-error'], 'due-soon': ['schedule', 'text-amber-600'], stock: ['inventory_2', 'text-secondary'] };
  p.innerHTML = `<div class="px-4 py-3 bg-surface-container-low flex items-center justify-between"><span class="font-headline-sm text-headline-sm">Notificaciones</span><button class="font-label-md text-label-md text-primary hover:underline" data-action="read-all" type="button">Marcar todas como leídas</button></div><div class="max-h-96 overflow-y-auto divide-y divide-surface-container-low">${list.length ? list.map(n => { const read = db.readNotifs.includes(n.id); return `<button class="w-full text-left px-4 py-3 flex gap-3 hover:bg-surface-container-low ${read ? 'opacity-60' : ''}" data-action="open-notif" data-id="${esc(n.id)}" data-kind="${n.kind}" type="button">${icon(ic[n.kind][0], ic[n.kind][1] + ' mt-0.5')}<div class="flex flex-col min-w-0 flex-1"><span class="font-label-md text-label-md font-semibold text-on-surface">${esc(n.title)}</span><span class="font-body-sm text-body-sm text-on-surface-variant">${esc(n.text)}</span></div>${read ? '' : '<span class="w-2 h-2 rounded-full bg-primary mt-2 shrink-0"></span>'}</button>`; }).join('') : empty('notifications_off', 'Sin notificaciones', 'Estás al día con todo.')}</div>`;
}
function closePanels() { $('#notifPanel').classList.add('hidden'); $('#searchResults').classList.add('hidden'); }

/* ---------- Búsqueda global ---------- */
function runSearch() {
  const q = $('#globalSearch').value.trim().toLowerCase(), box = $('#searchResults');
  $('#notifPanel').classList.add('hidden');
  if (!q) { box.classList.add('hidden'); return; }
  const res = db.books.filter(b => [b.title, b.author, b.isbn, b.shelf, b.category].join(' ').toLowerCase().includes(q)).slice(0, 6);
  box.innerHTML = res.length ? res.map(b => { const a = availCopies(b); return `<div class="px-4 py-3 flex items-center justify-between gap-3 hover:bg-surface-container-low"><button class="flex items-center gap-3 min-w-0 flex-1 text-left" data-action="search-pick" data-id="${b.id}" type="button"><div class="w-8 h-11 rounded bg-gradient-to-br ${gradFor(b.category)} flex items-center justify-center shrink-0">${icon(CAT_ICON[b.category] || 'menu_book', 'text-on-primary text-base')}</div><div class="flex flex-col min-w-0"><span class="font-label-md text-label-md font-semibold truncate">${esc(b.title)}</span><span class="font-body-sm text-body-sm text-on-surface-variant truncate">${esc(b.author)} · ${esc(b.shelf || 'sin ubicación')}</span></div></button><div class="flex items-center gap-2 shrink-0">${a ? badge('active', a + ' disp.') : badge('overdue', 'Prestado')}${a ? `<button class="px-2 py-1 rounded bg-primary-container text-on-primary font-label-sm text-label-sm" data-action="loan-book" data-id="${b.id}" type="button">Prestar</button>` : ''}</div></div>`; }).join('') + `<button class="w-full px-4 py-2.5 text-left font-label-md text-label-md text-primary bg-surface-container-low hover:bg-surface-container" data-action="search-all" type="button">Ver todos los resultados en el catálogo →</button>` : `<div class="px-4 py-6 text-center font-body-md text-body-md text-on-surface-variant">No se encontraron libros para «${esc($('#globalSearch').value)}».</div>`;
  box.classList.remove('hidden');
}

/* ---------- Acciones ---------- */
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 500);
}
const enc = encodeURIComponent;
const ACTIONS = {
  nav: d => showPage(d.page),
  'close-modal': closeModal,
  'new-loan': () => loanModal(),
  'loan-book': d => { closePanels(); loanModal(d.id); },
  'new-book': () => bookModal(),
  'edit-book': d => bookModal(d.id),
  'del-book': async d => {
    const b = bookById(d.id); if (!b) return;
    if (!confirm(`¿Eliminar «${b.title}» del catálogo?`)) return;
    await api('DELETE', '/api/books/' + enc(d.id)); await refresh(); toast('Libro eliminado.');
  },
  'new-reader': () => readerModal(),
  'edit-reader': d => readerModal(d.id),
  'history-reader': d => historyModal(d.id),
  'toggle-reader': async d => {
    const r = readerById(d.id); if (!r) return;
    const res = await api('POST', `/api/readers/${enc(d.id)}/toggle`); await refresh();
    toast(res.status === 'ACTIVO' ? `${r.name} fue reactivado.` : `${r.name} fue suspendido.`);
  },
  'del-reader': async d => {
    const r = readerById(d.id); if (!r) return;
    if (!confirm(`¿Eliminar al lector ${r.name}?`)) return;
    await api('DELETE', '/api/readers/' + enc(d.id)); await refresh(); toast('Lector eliminado.');
  },
  return: async d => {
    const l = db.loans.find(x => x.id === d.id); if (!l || l.returnedAt) return;
    const title = bookById(l.bookId)?.title || l.id;
    await api('POST', `/api/loans/${enc(d.id)}/return`); await refresh(); toast(`Devolución registrada: ${title}`);
  },
  renew: async d => {
    const res = await api('POST', `/api/loans/${enc(d.id)}/renew`); await refresh(); toast(`Plazo extendido hasta el ${fmtDate(res.due)}.`);
  },
  'loan-tab': d => { ui.loanTab = d.tab; render(); },
  'toggle-notifs': () => { const p = $('#notifPanel'); $('#searchResults').classList.add('hidden'); if (p.classList.contains('hidden')) { renderNotifs(); p.classList.remove('hidden'); } else p.classList.add('hidden'); },
  'read-all': async () => {
    db.readNotifs = [...new Set([...db.readNotifs, ...buildNotifs().map(n => n.id)])]; updateChrome();
    await api('PUT', '/api/notifs', { readNotifs: db.readNotifs });
  },
  'open-notif': async d => {
    if (!db.readNotifs.includes(d.id)) db.readNotifs.push(d.id);
    ui.loanSearch = ''; ui.loanTab = d.kind === 'overdue' ? 'overdue' : d.kind === 'due-soon' ? 'due-soon' : 'all';
    showPage(d.kind === 'stock' ? 'catalogo-de-libros' : 'prestamos-y-devoluciones'); updateChrome();
    await api('PUT', '/api/notifs', { readNotifs: db.readNotifs });
  },
  'search-pick': d => { const b = bookById(d.id); ui.catSearch = b ? b.title : ''; ui.catCategory = 'ALL'; ui.catAvail = 'ALL'; $('#globalSearch').value = ''; showPage('catalogo-de-libros'); },
  'search-all': () => { ui.catSearch = $('#globalSearch').value.trim(); ui.catCategory = 'ALL'; ui.catAvail = 'ALL'; $('#globalSearch').value = ''; showPage('catalogo-de-libros'); },
  'del-avatar': async () => { await api('PUT', '/api/profile', { ...db.profile, avatar: null }); await refresh(); toast('Foto eliminada.'); },
  'export-json': () => { download(`bibliotech_respaldo_${todayISO()}.json`, JSON.stringify({ app: 'BiblioTech', version: 3, exportedAt: new Date().toISOString(), ...db }, null, 2), 'application/json'); toast('Respaldo descargado.'); },
  'export-csv': () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Código', 'Lector', 'Documento', 'Libro', 'Autor', 'Salida', 'Límite', 'Devuelto', 'Estado'], ...db.loans.map(l => { const r = readerById(l.readerId), b = bookById(l.bookId); return [l.id, r?.name, r?.doc, b?.title, b?.author, l.date, l.due, l.returnedAt || '', dueText(l)]; })];
    download(`prestamos_${todayISO()}.csv`, '﻿' + rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv'); toast('CSV descargado.');
  },
  'clear-data': async () => {
    if (!confirm('Se borrarán todos los libros, lectores y préstamos. Tu perfil y parámetros se conservan. ¿Continuar?')) return;
    await api('POST', '/api/admin/clear'); await refresh(); toast('Biblioteca vaciada. ¡Agrega tus libros!');
  },
  'reset-demo': async () => {
    if (!confirm('Se reemplazarán todos los datos por los datos de ejemplo. ¿Continuar?')) return;
    await api('POST', '/api/admin/reset-demo'); await refresh(); toast('Datos de ejemplo restaurados.');
  },
  logout: async () => { try { await api('POST', '/api/logout'); } finally { location.href = '/login.html'; } }
};
const FORMS = {
  async book(f, id) {
    const body = { title: f.get('title'), author: f.get('author'), category: f.get('category'), isbn: f.get('isbn'), shelf: f.get('shelf'), copies: f.get('copies'), value: f.get('value') };
    if (id) await api('PUT', '/api/books/' + enc(id), body); else await api('POST', '/api/books', body);
    closeModal(); await refresh(); toast(id ? 'Libro actualizado.' : 'Libro registrado en el catálogo.');
  },
  async reader(f, id) {
    const body = { name: f.get('name'), doc: f.get('doc'), email: f.get('email'), phone: f.get('phone'), affiliation: f.get('affiliation'), status: f.get('status') };
    if (id) await api('PUT', '/api/readers/' + enc(id), body); else await api('POST', '/api/readers', body);
    closeModal(); await refresh(); toast(id ? 'Lector actualizado.' : 'Lector registrado.');
  },
  async loan(f) {
    if (!f.get('readerId') || !f.get('bookId')) throw new Error('Selecciona un lector y un libro.');
    const res = await api('POST', '/api/loans', { readerId: f.get('readerId'), bookId: f.get('bookId'), days: f.get('days') });
    closeModal(); await refresh(); toast(`Préstamo ${res.id} registrado. Vence el ${fmtDate(res.due)}.`);
  },
  async profile(f) {
    await api('PUT', '/api/profile', { name: f.get('name'), email: f.get('email'), phone: f.get('phone') });
    await refresh(); toast('Perfil actualizado.');
  },
  async config(f) {
    await api('PUT', '/api/config', { institution: f.get('institution'), loanDays: f.get('loanDays'), maxBooks: f.get('maxBooks') });
    await refresh(); toast('Parámetros guardados.');
  },
  async password(f) {
    if (f.get('next') !== f.get('confirm')) throw new Error('La confirmación no coincide con la nueva contraseña.');
    await api('POST', '/api/password', { current: f.get('current'), next: f.get('next') });
    document.querySelector('form[data-form="password"]')?.reset(); toast('Contraseña actualizada.');
  }
};

/* ---------- Eventos ---------- */
const fail = err => toast(err.message || 'Ocurrió un error.', 'error');
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]');
  if (t) {
    e.preventDefault();
    const fn = ACTIONS[t.dataset.action];
    if (fn) { try { Promise.resolve(fn(t.dataset, t)).catch(fail); } catch (err) { fail(err); } }
    return;
  }
  if (e.target === $('#modalBackdrop')) closeModal();
  if (!e.target.closest('#notifPanel') && !e.target.closest('#searchResults') && e.target.id !== 'globalSearch') closePanels();
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  try { await FORMS[f.dataset.form]?.(new FormData(f), f.dataset.id || ''); }
  catch (err) { fail(err); }
  finally { if (btn) btn.disabled = false; }
});
document.addEventListener('input', e => {
  const k = e.target.dataset?.filter;
  if (k) { ui[k] = e.target.value; refreshList(); }
});
document.addEventListener('change', e => {
  if (e.target.name === 'days') { const el = $('#dueText'); if (el) el.textContent = fmtDate(addDays(todayISO(), parseInt(e.target.value))); }
  if (e.target.id === 'avatarInput') {
    const file = e.target.files[0]; if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Selecciona una imagen (JPG, PNG o WebP).', 'error');
    if (file.size > 2 * 1024 * 1024) return toast('La imagen supera los 2 MB.', 'error');
    const rd = new FileReader();
    rd.onload = async ev => {
      try { await api('PUT', '/api/profile', { ...db.profile, avatar: ev.target.result }); await refresh(); toast('Foto actualizada.'); } catch (err) { fail(err); }
    };
    rd.readAsDataURL(file);
  }
  if (e.target.id === 'importInput') {
    const file = e.target.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = async ev => {
      let p;
      try { p = JSON.parse(ev.target.result); } catch { return toast('El archivo no es un respaldo válido de BiblioTech.', 'error'); }
      if (!confirm('Se reemplazarán los datos actuales por los del respaldo. ¿Continuar?')) return;
      try { await api('POST', '/api/admin/import', p); await refresh(); toast('Respaldo restaurado.'); } catch (err) { fail(err); }
    };
    rd.readAsText(file); e.target.value = '';
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closePanels(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#globalSearch').focus(); }
});
$('#globalSearch').addEventListener('input', runSearch);
$('#globalSearch').addEventListener('focus', runSearch);
$('#globalSearch').addEventListener('keydown', e => { if (e.key === 'Enter') ACTIONS['search-all'](); });
window.addEventListener('hashchange', () => { const p = location.hash.slice(1); if (p !== ui.page && PAGES.includes(p)) showPage(p); });

ui.page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
refresh().catch(err => {
  $('#view').innerHTML = `<div class="pt-space-xl">${empty('cloud_off', 'No se pudieron cargar los datos', err.message)}</div>`;
});
