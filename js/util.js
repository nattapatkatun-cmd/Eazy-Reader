// ตัวช่วยทั่วไป: สร้าง DOM, ไอคอน, toast, sheet
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'data') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && !['list', 'type', 'for'].includes(k)) { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(9)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  expand: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  shrink: '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.6L7 20z"/>',
  type: '<path d="M3 18l4.5-12L12 18M4.6 14h5.8M17.5 11a3 3 0 100 6 3 3 0 000-6zM20.5 11v7"/>',
  speak: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9.5a3.5 3.5 0 010 5M18 7a7 7 0 010 10"/>',
  pencil: '<path d="M4 20l1-4.2L16.2 4.6l3.2 3.2L8.2 19zM14 6.8l3.2 3.2"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2L17.500 7M10 11v5M14 11v5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  rotate: '<path d="M19.500 12a7.500 7.500 0 11-2.600-5.700M19.500 4.500v4.500H15"/>',
  download: '<path d="M12 4v11M7.500 11l4.500 4.500 4.500-4.500M5 20h14"/>',
  undo: '<path d="M8.500 14.500L4 10l4.500-4.500M4 10h10a5.500 5.500 0 010 11h-3"/>',
  eraser: '<path d="M8 20h12M4.500 14.500l8.500-9 6.500 6.500-7.500 8H8z"/>',
  marker: '<path d="M4 20h7M8.500 16l8.500-10.500 3 3L11.500 19 8 19.500zM14.500 8.500l3 3"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  folder: '<path d="M3 6.500h6l2 2.500h10V19H3z"/>',
  image: '<rect x="3.500" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.500"/><path d="M4 17l5-4.500 3.500 3 3-2.500 4.500 4"/>',
  file: '<path d="M6.500 3.500h7.500l4 4V20.500H6.500zM14 3.500v4h4"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.500"/>',
  left: '<path d="M14.500 6l-6 6 6 6"/>',
  right: '<path d="M9.500 6l6 6-6 6"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
  note: '<path d="M5 4.500h14v10l-5 5H5zM14 19.500v-5h5"/>',
  copy: '<rect x="8" y="8" width="11.500" height="11.500" rx="1.500"/><path d="M5 15.500V5h10.500"/>',
  eye: '<path d="M2.500 12s3.500-6.500 9.500-6.500 9.500 6.500 9.500 6.500-3.500 6.500-9.500 6.500S2.500 12 2.500 12z"/><circle cx="12" cy="12" r="2.800"/>',
  book: '<path d="M4 5.500c2.500-1 5.500-1 8 .5 2.500-1.500 5.500-1.500 8-.5V19c-2.500-1-5.500-1-8 .5-2.500-1.500-5.500-1.500-8-.5zM12 6v13.500"/>',
  share: '<path d="M12 15V4M8 7.500L12 3.500l4 4M5 12v8h14v-8"/>',
};
export function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.7'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}
export function ibtn(name, label, onclick, cls = '') {
  return h('button', { class: 'ibtn ' + cls, title: label, 'aria-label': label, onclick }, icon(name));
}

let toastT;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
}

// แผ่น sheet ด้านล่าง (เปิดได้ทีละแผ่น)
let sheetClose = null;
export function openSheet(title, body, { tall = false, onClose } = {}) {
  closeSheet();
  const wrap = $('#sheet');
  const el = h('div', { class: 'sheet-box' + (tall ? ' tall' : '') },
    h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-title' }, title), ibtn('close', 'ปิด', () => closeSheet())),
    h('div', { class: 'sheet-body' }, body));
  wrap.replaceChildren(h('div', { class: 'sheet-bg', onclick: () => closeSheet() }), el);
  wrap.classList.add('on');
  sheetClose = onClose || (() => {});
  return el;
}
export function closeSheet() {
  const wrap = $('#sheet');
  if (!wrap.classList.contains('on')) return false;
  wrap.classList.remove('on'); wrap.replaceChildren();
  const f = sheetClose; sheetClose = null; f && f();
  return true;
}
export const sheetOpen = () => $('#sheet').classList.contains('on');

// กล่องถามข้อความ / ยืนยัน (ไม่ใช้ prompt ของเบราว์เซอร์)
export function ask(title, { value = '', multiline = false, ok = 'ตกลง', placeholder = '' } = {}) {
  return new Promise((res) => {
    const inp = multiline ? h('textarea', { class: 'inp', rows: 4, placeholder }) : h('input', { class: 'inp', type: 'text', placeholder });
    inp.value = value;
    let done = false;
    const fin = (v) => { if (done) return; done = true; closeSheet(); res(v); };
    openSheet(title, h('div', { class: 'col' }, inp,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => fin(null) }, 'ยกเลิก'),
        h('button', { class: 'btn', onclick: () => fin(inp.value) }, ok))), { onClose: () => fin(null) });
    if (!multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fin(inp.value); });
    setTimeout(() => inp.focus(), 50);
  });
}
export function confirmBox(title, msg, ok = 'ยืนยัน') {
  return new Promise((res) => {
    let done = false;
    const fin = (v) => { if (done) return; done = true; closeSheet(); res(v); };
    openSheet(title, h('div', { class: 'col' }, h('p', { class: 'muted' }, msg),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => fin(false) }, 'ยกเลิก'),
        h('button', { class: 'btn danger', onclick: () => fin(true) }, ok))), { onClose: () => fin(false) });
  });
}

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const natSort = (a, b) => collator.compare(a, b);
export const extOf = (n) => (/\.([a-z0-9]+)$/i.exec(n || '') || [, ''])[1].toLowerCase();
export const baseName = (n) => (n || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '');
export const IMG_EXT = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp', 'heic', 'heif'];
export const isImageName = (n) => IMG_EXT.includes(extOf(n)) && !/(^|\/)(\._|__MACOSX\/)/.test(n);
export const mimeOf = (n) => ({
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', svg: 'image/svg+xml', css: 'text/css', ttf: 'font/ttf', otf: 'font/otf',
  woff: 'font/woff', woff2: 'font/woff2', xhtml: 'application/xhtml+xml', html: 'text/html',
}[extOf(n)] || 'application/octet-stream');
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isTouch = matchMedia('(pointer: coarse)').matches;

export function debounce(fn, ms) {
  let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}
export function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลดไม่สำเร็จ: ' + src));
    document.head.append(s);
  });
}
export function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
export function hexLum(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex) || [0, 'ff', 'ff', 'ff'];
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export async function saveBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
