// Eazy Reader — ตัวประสานงานหลัก: ชั้นหนังสือ, หน้าจออ่าน, การตั้งค่า, เครื่องมือ
import { $, h, icon, ibtn, toast, openSheet, closeSheet, sheetOpen, ask, confirmBox, debounce, clamp, uid, hexLum, fmtSize, saveBlob, isIOS } from './util.js';
import { db } from './db.js';
import { importFiles, openSource, filesFromDrop } from './importer.js';
import { Pager } from './flip.js';
import { FixedView } from './fixedview.js';
import { ReflowView, FONTS, HL_COLORS } from './reflowview.js';
import { Speaker } from './tts.js';
import { rebuildPdf } from './pdfedit.js';

/* ---------- การตั้งค่า ---------- */
const DEF = {
  theme: 'cream', customBg: '#f3ead2', customFg: '#33291c', warm: 0, dim: 0, contrast: 100, gray: 0, invert: false, tint: false,
  font: 'sans', size: 19, lh: 1.75, margin: 22, justify: false, pubCss: true,
  effect: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'curl',
  breakMin: 20, wake: true, ttsRate: 1, presets: [],
};
const THEMES = {
  white: { name: 'ขาว', bg: '#ffffff', fg: '#1c1c1e' },
  cream: { name: 'ครีม', bg: '#f8f1e3', fg: '#3a2f24' },
  sepia: { name: 'ซีเปีย', bg: '#ecdcbb', fg: '#4b3a26' },
  green: { name: 'เขียวถนอมตา', bg: '#cfe8d0', fg: '#1f3a26' },
  gray: { name: 'เทา', bg: '#d6d6d4', fg: '#222222' },
  dark: { name: 'มืด', bg: '#202124', fg: '#c9c5bb' },
  black: { name: 'ดำสนิท', bg: '#000000', fg: '#9c9a94' },
};
const PRESETS = [
  { name: 'กลางวัน', theme: 'cream', warm: 0, dim: 0, contrast: 100, gray: 0, invert: false, tint: false },
  { name: 'ถนอมสายตา', theme: 'green', warm: 12, dim: 0, contrast: 95, gray: 0, invert: false, tint: true },
  { name: 'กลางคืน', theme: 'dark', warm: 30, dim: 10, contrast: 95, gray: 0, invert: false, tint: false },
  { name: 'ก่อนนอน', theme: 'black', warm: 55, dim: 30, contrast: 90, gray: 0, invert: true, tint: false },
];
const EYE_KEYS = ['theme', 'customBg', 'customFg', 'warm', 'dim', 'contrast', 'gray', 'invert', 'tint'];
function loadS() { try { return { ...DEF, ...JSON.parse(localStorage.getItem('eazyreader.settings') || '{}') }; } catch { return { ...DEF }; } }
const S = loadS();
const saveS = () => { try { localStorage.setItem('eazyreader.settings', JSON.stringify(S)); } catch { /* โหมดส่วนตัว */ } };

const reader = $('#reader'), stage = $('#stage');
const app = {
  S, stage, layerA: $('#layerA'), layerB: $('#layerB'), scroller: $('#scroller'),
  view: null, meta: null, theme: THEMES.cream, dark: false,
  onPos, zoneTap, edge, toggleUI, onKey, onWheel, saveSoon: null, selChanged, editHighlight, openExternal, ttsChanged,
};
app.pager = new Pager(stage, $('#flipcv'), { effect: () => S.effect });
app.pager.attach(stage, (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; });
const tts = new Speaker(app);

function applyTheme() {
  const t = S.theme === 'custom' ? { bg: S.customBg, fg: S.customFg } : THEMES[S.theme] || THEMES.cream;
  const dark = hexLum(t.bg) < 0.35;
  app.theme = { ...t, link: dark ? '#8ab4f8' : '#1a5fb4' }; app.dark = dark;
  const r = document.documentElement, st = r.style;
  r.dataset.dark = dark ? '1' : '0';
  st.setProperty('--bg', t.bg); st.setProperty('--fg', t.fg);
  st.setProperty('--ui', dark ? '#2b2c30' : '#fffdf8'); st.setProperty('--ui2', dark ? '#3a3b40' : '#efe9dc');
  st.setProperty('--muted', dark ? 'rgba(255,255,255,.6)' : 'rgba(40,32,24,.62)');
  st.setProperty('--stagebg', dark ? '#0c0c0d' : '#3a3836');
  const flt = [S.contrast !== 100 ? `contrast(${S.contrast}%)` : '', S.gray > 0 ? `grayscale(${S.gray}%)` : '', S.invert && dark ? 'invert(1) hue-rotate(180deg)' : ''].filter(Boolean).join(' ');
  st.setProperty('--pgfilter', flt || 'none');
  stage.classList.toggle('tint', !!S.tint && !dark);
  $('#eye-warm').style.opacity = String((S.warm / 100) * 0.6); $('#eye-warm').style.display = S.warm > 0 ? 'block' : 'none';
  $('#eye-dim').style.opacity = String((S.dim / 100) * 0.75); $('#eye-dim').style.display = S.dim > 0 ? 'block' : 'none';
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t.bg;
}
const relayoutSoon = debounce(() => { if (app.view) app.view.relayout(); }, 90);

/* ---------- ชั้นหนังสือ ---------- */
const KIND = { pdf: 'PDF', epub: 'EPUB', txt: 'TXT', cbz: 'CBZ', album: 'รูปภาพ' };
const GEN = ['#8a4b2d', '#35605a', '#4a4e7a', '#7a3b52', '#5b6b2f', '#2f5d7a'];
async function renderLib() {
  const books = (await db.books()).sort((a, b) => (b.opened || b.added) - (a.opened || a.added));
  $('#lib-empty').hidden = books.length > 0;
  $('#lib-grid').replaceChildren(...books.map((b) => {
    const cover = b.cover
      ? h('div', { class: 'cover' }, h('img', { src: b.cover, alt: '', loading: 'lazy' }))
      : h('div', { class: 'cover gen', style: { background: GEN[(b.title.codePointAt(0) || 0) % GEN.length] } }, b.title.slice(0, 60));
    cover.append(h('span', { class: 'badge' }, KIND[b.kind] || b.kind));
    if (b.progress > 0) cover.append(h('div', { class: 'prog' }, h('i', { style: { width: Math.round(b.progress * 100) + '%' } })));
    const sub = b.progress >= 0.999 ? 'อ่านจบแล้ว' : b.progress > 0 ? `อ่านแล้ว ${Math.round(b.progress * 100)}%` : b.n ? `${b.n} หน้า` : b.author || 'ยังไม่ได้อ่าน';
    return h('div', { class: 'card' },
      h('button', { class: 'card-open', onclick: () => openBook(b.id), 'aria-label': 'เปิด ' + b.title }, cover,
        h('div', { class: 'card-text' }, h('div', { class: 'card-title' }, b.title), h('div', { class: 'card-sub' }, sub))),
      ibtn('more', 'ตัวเลือกของ ' + b.title, () => bookMenu(b), 'card-more'));
  }));
}
function bookMenu(b) {
  const mins = Math.round((b.time || 0) / 60);
  openSheet(b.title, h('div', { class: 'col' },
    h('p', { class: 'note' }, `${KIND[b.kind] || b.kind} · ${fmtSize(b.size || 0)}${b.author ? ' · ' + b.author : ''}${mins ? ` · อ่านไปแล้ว ${mins} นาที` : ''}`),
    h('button', { class: 'bigbtn', onclick: async () => {
      const t = await ask('เปลี่ยนชื่อ', { value: b.title });
      if (t && t.trim()) { b.title = t.trim(); await db.putBook(b); renderLib(); }
    } }, icon('pencil', 26), h('div', {}, h('b', {}, 'เปลี่ยนชื่อ'))),
    h('button', { class: 'bigbtn', onclick: async () => {
      if (await confirmBox('ลบออกจากชั้นหนังสือ?', `"${b.title}" รวมถึงบุ๊กมาร์กและโน้ตของเล่มนี้จะถูกลบออกจากแอป (ไฟล์ต้นฉบับในเครื่องคุณไม่ถูกแตะต้อง)`, 'ลบ')) { await db.del(b.id); renderLib(); toast('ลบแล้ว'); }
    } }, icon('trash', 26), h('div', {}, h('b', {}, 'ลบออกจากชั้นหนังสือ')))));
}
function busy(msg) { $('#busy').hidden = !msg; $('#busy-msg').textContent = msg || ''; }
async function doImport(files) {
  files = [...files];
  if (!files.length) return;
  closeSheet();
  busy('กำลังนำเข้า…');
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* ไม่รองรับ */ }
  let res;
  try { res = await importFiles(files, (i, n, name) => busy(`กำลังนำเข้า ${i}/${n}\n${name}`)); }
  catch (e) { res = { added: [], errors: [String(e.message || e)] }; }
  busy('');
  await renderLib();
  if (res.errors.length) {
    openSheet(`นำเข้าได้ ${res.added.length} รายการ · ไม่สำเร็จ ${res.errors.length}`, h('div', { class: 'list' }, res.errors.map((e) => h('div', { class: 'li' }, h('span', { class: 'grow' }, e)))));
  } else if (res.added.length === 1) openBook(res.added[0].id);
  else if (res.added.length) toast(`เพิ่มแล้ว ${res.added.length} รายการ`);
  else toast('ไม่พบไฟล์ที่รองรับ');
}
function addSheet() {
  const big = (ic, t, s, fn) => h('button', { class: 'bigbtn', onclick: fn }, icon(ic, 30), h('div', {}, h('b', {}, t), h('small', {}, s)));
  openSheet('เพิ่มเข้าชั้นหนังสือ', h('div', { class: 'col' },
    big('file', 'ไฟล์หนังสือ', 'EPUB · PDF · TXT · CBZ / CBR / ZIP / RAR / 7z', () => $('#in-files').click()),
    big('image', 'รูปภาพหลายรูป', 'เลือกหลายรูปพร้อมกัน รวมเป็นหนึ่งอัลบั้ม', () => $('#in-images').click()),
    isIOS ? null : big('folder', 'ทั้งโฟลเดอร์', 'แต่ละโฟลเดอร์ย่อยที่มีรูปจะกลายเป็นหนึ่งเล่ม', () => $('#in-folder').click()),
    h('p', { class: 'note' }, 'ไฟล์ทั้งหมดเก็บอยู่ในเครื่องนี้เท่านั้น · ไฟล์ที่ติดระบบป้องกันการคัดลอก (DRM) จากร้านหนังสือจะเปิดไม่ได้')));
}
for (const id of ['in-files', 'in-images', 'in-folder']) $('#' + id).addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; doImport(f); });
$('#btn-add').prepend(icon('plus', 18)); $('#btn-add').onclick = addSheet; $('#btn-add2').onclick = addSheet;
$('#btn-eye').append(icon('eye')); $('#btn-eye').onclick = () => displaySheet();
// ลากไฟล์มาวาง (เดสก์ท็อป)
let dragN = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files') && reader.hidden) { dragN++; $('#drop').hidden = false; } });
addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#drop').hidden = true; });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => { e.preventDefault(); dragN = 0; $('#drop').hidden = true; if (reader.hidden && e.dataTransfer) doImport(await filesFromDrop(e.dataTransfer)); });

/* ---------- เปิด / ปิดเล่ม ---------- */
let ignorePop = false, wakeLock = null, activeSec = 0;
async function openBook(id) {
  if (app.view) { await save(); teardown(); }
  busy('กำลังเปิด…');
  try {
    const meta = await db.book(id);
    if (!meta) throw new Error('ไม่พบเล่มนี้');
    meta.view = meta.view || {}; meta.bookmarks = meta.bookmarks || []; meta.highlights = meta.highlights || [];
    const src = await openSource(meta);
    app.meta = meta;
    const fixed = src.kind === 'pdf' || src.kind === 'img';
    reader.dataset.kind = fixed ? 'fixed' : 'reflow';
    stage.className = S.tint && !app.dark ? 'tint' : '';
    $('#lib').hidden = true; reader.hidden = false; reader.classList.remove('ui');
    $('#r-title').textContent = meta.title;
    app.view = fixed ? new FixedView(app, meta, src) : new ReflowView(app, meta, src);
    app.pager.enabled = true;
    app.pager.setView(app.view);
    buildTools();
    const first = !meta.opened;
    await app.view.open(meta.pos);
    meta.opened = Date.now();
    app.saveSoon();
    if (!isIOS) history.pushState({ r: 1 }, '');
    lockWake();
    activeSec = 0;
    if (first && meta.kind === 'album' && app.view.count > 1) openGrid();
    else if (first) { reader.classList.add('ui'); setTimeout(() => { if (!sheetOpen()) reader.classList.remove('ui'); }, 2600); }
    try {
      if (!localStorage.getItem('eazyreader.hint')) { localStorage.setItem('eazyreader.hint', '1'); setTimeout(() => toast('ปัดหรือแตะขอบซ้าย–ขวาเพื่อพลิกหน้า · แตะกลางจอเพื่อเปิดเมนู', 5200), 900); }
    } catch { /* โหมดส่วนตัว */ }
  } catch (e) {
    console.error(e);
    toast('เปิดไม่ได้: ' + (e.message || e), 5000);
    teardown();
  } finally { busy(''); }
}
function teardown() {
  tts.stop(true);
  closeGrid(); closeSheet();
  setAnnot(false);
  $('#selbar').hidden = true; $('#ttsbar').hidden = true;
  if (app.view) { try { app.view.destroy(); } catch (e) { console.error(e); } }
  app.pager.setView(null);
  app.view = null; app.meta = null;
  reader.hidden = true; $('#lib').hidden = false;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  renderLib();
}
async function closeReader(viaPop) {
  if (!app.view) return;
  await save();
  teardown();
  if (!viaPop && history.state && history.state.r) { ignorePop = true; history.back(); }
}
addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  if (!app.view) return;
  if (!$('#grid').hidden || sheetOpen() || annOn) { closeGrid(); closeSheet(); setAnnot(false); history.pushState({ r: 1 }, ''); return; }
  closeReader(true);
});
async function lockWake() {
  if (!S.wake || !navigator.wakeLock || wakeLock) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch { /* ไม่อนุญาต */ }
}
async function save() {
  const v = app.view, m = app.meta;
  if (!v || !m) return;
  try { m.pos = v.getPos(); m.progress = v.progress(); if (v.kind === 'fixed') m.n = v.count; await db.putBook(m); } catch (e) { console.error(e); }
}
app.saveSoon = debounce(save, 600);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else if (app.view) lockWake(); });
addEventListener('pagehide', save);

/* ---------- แถบควบคุมของหน้าอ่าน ---------- */
$('#btn-back').append(icon('back')); $('#btn-back').onclick = () => closeReader(false);
$('#btn-bm').append(icon('bookmark')); $('#btn-bm').onclick = toggleBookmark;
const seek = $('#seek');
seek.addEventListener('change', () => { if (app.view) app.view.seek(seek.value / 1000); });
seek.addEventListener('input', () => { $('#r-label').textContent = Math.round(seek.value / 10) + '%'; });
function buildTools() {
  const v = app.view, pdf = v.kind === 'fixed' && v.isPdf;
  const tool = (ic, label, fn, id) => h('button', { class: 'tool', id, onclick: fn }, icon(ic), label);
  $('#tools').replaceChildren(...[
    v.kind === 'fixed' ? tool('grid', 'ทุกหน้า', () => openGrid()) : null,
    tool('list', 'สารบัญ', () => contentsSheet()),
    v.kind === 'reflow' || pdf ? tool('search', 'ค้นหา', () => searchSheet()) : null,
    v.kind === 'reflow' || pdf ? tool('speak', 'ฟัง', () => { reader.classList.remove('ui'); tts.on ? tts.stop() : tts.start(); }, 'tool-tts') : null,
    pdf ? tool('pencil', 'แก้ไข', () => setAnnot(true)) : null,
    tool('type', 'แสดงผล', () => displaySheet()),
  ].filter(Boolean));
}
function onPos() {
  const v = app.view;
  if (!v) return;
  const lab = v.label();
  $('#r-label').textContent = lab; $('#mini').textContent = lab;
  seek.dir = v.dir === 'rtl' && v.mode === 'paged' ? 'rtl' : 'ltr';
  seek.value = String(Math.round(v.sliderValue() * 1000));
  $('#btn-bm').classList.toggle('on', app.meta.bookmarks.some((b) => v.isBookmarked(b)));
  app.saveSoon();
}
function toggleUI() { reader.classList.toggle('ui'); }
function zoneTap(fx) {
  const v = app.view;
  if (reader.classList.contains('ui')) { reader.classList.remove('ui'); return; }
  if (v.mode !== 'paged' || (fx >= 0.3 && fx <= 0.7)) { toggleUI(); return; }
  const left = fx < 0.3, ltr = v.dir !== 'rtl';
  if (left === ltr) v.prev(); else v.next();
}
function edge(dir) { toast(dir === 'next' ? 'ถึงหน้าสุดท้ายแล้ว' : 'นี่คือหน้าแรก', 1400); }
function onKey(e) {
  const tg = e.target || {};
  if (!app.view || sheetOpen() || !$('#grid').hidden || /^(TEXTAREA|SELECT)$/.test(tg.tagName || '') || (tg.tagName === 'INPUT' && tg.type !== 'file')) return;
  const v = app.view, ltr = v.dir !== 'rtl' || v.mode !== 'paged';
  const k = e.key;
  if (k === 'ArrowRight') ltr ? v.next() : v.prev();
  else if (k === 'ArrowLeft') ltr ? v.prev() : v.next();
  else if (k === 'PageDown' || k === ' ' || (k === 'ArrowDown' && v.mode === 'paged')) v.next();
  else if (k === 'PageUp' || (k === 'ArrowUp' && v.mode === 'paged')) v.prev();
  else if (k === 'Escape') { if (annOn) setAnnot(false); else if (reader.classList.contains('ui')) closeReader(false); else toggleUI(); }
  else return;
  e.preventDefault();
}
addEventListener('keydown', onKey);
let wheelT = 0;
function onWheel(e) {
  const v = app.view;
  if (!v || v.mode !== 'paged' || sheetOpen() || annOn || app.pager.z.s > 1.02 || Math.abs(e.deltaY) < 12) return;
  const now = Date.now();
  if (now - wheelT < 320) return;
  wheelT = now;
  e.deltaY > 0 ? v.next() : v.prev();
}
stage.addEventListener('wheel', onWheel, { passive: true });
// กันเบราว์เซอร์มือถือเลื่อน/เด้งหน้าจอเองระหว่างปัดพลิกหน้า
stage.addEventListener('touchmove', (e) => { if (app.view && app.view.mode === 'paged' && e.cancelable) e.preventDefault(); }, { passive: false });
addEventListener('resize', debounce(() => { if (app.view) app.view.relayout(); }, 160));

/* ---------- บุ๊กมาร์ก ---------- */
function toggleBookmark() {
  const v = app.view, m = app.meta;
  const hit = m.bookmarks.filter((b) => v.isBookmarked(b));
  if (hit.length) { m.bookmarks = m.bookmarks.filter((b) => !hit.includes(b)); toast('เอาที่คั่นออกแล้ว', 1300); }
  else { m.bookmarks.push({ id: uid(), pos: v.bookmarkPos(), label: v.bookmarkLabel(), note: '', t: Date.now() }); toast('คั่นหน้านี้ไว้แล้ว', 1300); }
  onPos();
}

/* ---------- สารบัญ / บุ๊กมาร์ก / ไฮไลต์ ---------- */
let outlineCache = null;
async function contentsSheet(tab = 'toc') {
  const v = app.view, m = app.meta;
  const body = h('div', {});
  const tabs = [['toc', 'สารบัญ'], ['bm', `ที่คั่น (${m.bookmarks.length})`]];
  if (v.kind === 'reflow') tabs.push(['hl', `ไฮไลต์ (${m.highlights.length})`]);
  const draw = async (t) => {
    const list = h('div', { class: 'list' });
    body.replaceChildren(h('div', { class: 'seg tabs' }, tabs.map(([k, l]) => h('button', { class: k === t ? 'on' : '', onclick: () => draw(k) }, l))), list);
    const go = (fn) => async () => { closeSheet(); reader.classList.remove('ui'); await fn(); };
    if (t === 'toc') {
      let items;
      if (v.kind === 'reflow') {
        let cur = -1; v.book.toc.forEach((x, i) => { if (x.ch <= v.pos.ch) cur = i; });
        items = v.book.toc.map((x, i) => ({ label: x.label, depth: x.depth, cur: i === cur, go: () => v.goto({ ch: x.ch, frag: x.frag }) }));
      } else if (v.isPdf) {
        if (!outlineCache || outlineCache.id !== m.id) outlineCache = { id: m.id, items: await v.src.outline() };
        items = outlineCache.items.map((x) => ({ label: x.label, depth: x.depth, sub: 'หน้า ' + (x.page + 1), go: () => v.goto(x.page) }));
      } else items = [];
      if (!items.length) list.append(h('p', { class: 'note', style: { padding: '18px 4px' } }, v.kind === 'fixed' ? 'ไฟล์นี้ไม่มีสารบัญในตัว ใช้ปุ่ม "ทุกหน้า" เพื่อดูภาพรวมและกระโดดไปยังหน้าที่ต้องการ' : 'เล่มนี้ไม่มีสารบัญ'));
      for (const it of items) {
        const el = h('button', { class: 'li' + (it.cur ? ' cur' : ''), style: { paddingLeft: 4 + Math.min(it.depth, 4) * 18 + 'px' }, onclick: go(it.go) }, h('span', { class: 'grow' }, it.label), it.sub ? h('small', {}, it.sub) : null);
        list.append(el);
        if (it.cur) setTimeout(() => el.scrollIntoView({ block: 'center' }), 30);
      }
    } else if (t === 'bm') {
      if (!m.bookmarks.length) list.append(h('p', { class: 'note', style: { padding: '18px 4px' } }, 'ยังไม่มีที่คั่น แตะไอคอนที่คั่นหนังสือมุมขวาบนเพื่อคั่นหน้าที่กำลังอ่าน'));
      for (const b of m.bookmarks) {
        if (v.kind === 'fixed' && v.bookmarkIndex(b) < 0) continue;
        const where = v.kind === 'fixed' ? 'หน้า ' + (v.bookmarkIndex(b) + 1) : v.chapterLabel(b.pos.ch);
        list.append(h('div', { class: 'li' },
          h('button', { class: 'grow', style: { all: 'unset', cursor: 'pointer', flex: '1' }, onclick: go(() => v.gotoBookmark(b)) }, v.kind === 'fixed' ? where : b.label, h('small', {}, (v.kind === 'fixed' ? '' : where + ' · ') + (b.note || new Date(b.t).toLocaleDateString('th-TH')))),
          ibtn('note', 'เขียนโน้ต', async () => { const n = await ask('โน้ตของที่คั่นนี้', { value: b.note || '', multiline: true }); if (n != null) { b.note = n.trim(); app.saveSoon(); } contentsSheet('bm'); }),
          ibtn('trash', 'ลบที่คั่น', () => { m.bookmarks = m.bookmarks.filter((x) => x !== b); onPos(); contentsSheet('bm'); })));
      }
    } else {
      if (!m.highlights.length) list.append(h('p', { class: 'note', style: { padding: '18px 4px' } }, 'ยังไม่มีไฮไลต์ กดค้างที่ข้อความเพื่อเลือก แล้วเลือกสีจากแถบที่ปรากฏด้านล่าง'));
      for (const x of [...m.highlights].sort((a, b) => a.ch - b.ch || a.s - b.s)) {
        list.append(h('div', { class: 'li' }, h('span', { class: 'hlbar', style: { background: HL_COLORS[x.color] } }),
          h('button', { style: { all: 'unset', cursor: 'pointer', flex: '1', minWidth: '0', overflowWrap: 'anywhere' }, onclick: go(() => v.goto({ ch: x.ch, off: x.s })) }, x.text.slice(0, 160), h('small', {}, v.chapterLabel(x.ch) + (x.note ? ' · โน้ต: ' + x.note : ''))),
          ibtn('pencil', 'แก้ไขไฮไลต์', () => editHighlight(x.id))));
      }
    }
  };
  openSheet(app.meta.title, body, { tall: true });
  await draw(tab);
}

/* ---------- เลือกข้อความ → ไฮไลต์ / โน้ต ---------- */
function dots(cur, onpick) { return Object.entries(HL_COLORS).map(([k, c]) => h('button', { class: 'dot' + (k === cur ? ' on' : ''), style: { background: c }, 'aria-label': 'ไฮไลต์สีนี้', onclick: () => onpick(k) })); }
function selChanged(sel) {
  const bar = $('#selbar');
  if (!sel || annOn) { bar.hidden = true; return; }
  const v = app.view;
  bar.replaceChildren(...dots(null, (k) => { v.addHighlight(k); bar.hidden = true; }), h('span', { class: 'sep' }),
    ibtn('note', 'ไฮไลต์พร้อมโน้ต', async () => {
      const keep = v.sel; bar.hidden = true;
      const n = await ask('โน้ตสำหรับข้อความนี้', { multiline: true });
      if (n != null) { v.sel = keep; v.addHighlight('y', n.trim()); }
    }),
    ibtn('copy', 'คัดลอก', async () => { try { await navigator.clipboard.writeText(sel.text); toast('คัดลอกแล้ว', 1200); } catch { toast('คัดลอกไม่สำเร็จ'); } }),
    ibtn('speak', 'ฟังข้อความนี้', () => tts.once(sel.text)));
  bar.hidden = false;
}
function editHighlight(id) {
  const v = app.view, hl = app.meta.highlights.find((x) => x.id === id);
  if (!hl) return;
  const note = h('textarea', { class: 'inp', rows: 3, placeholder: 'โน้ต (ไม่บังคับ)' }); note.value = hl.note || '';
  const row = h('div', { class: 'row' });
  const drawDots = () => row.replaceChildren(...dots(hl.color, (k) => { hl.color = k; v.updateHighlight(hl); drawDots(); }));
  drawDots();
  openSheet('ไฮไลต์', h('div', { class: 'col' }, h('blockquote', { class: 'q' }, hl.text), row, note,
    h('div', { class: 'row end' },
      h('button', { class: 'btn ghost', onclick: () => { v.removeHighlight(id); closeSheet(); } }, 'ลบไฮไลต์'),
      h('button', { class: 'btn', onclick: () => { hl.note = note.value.trim(); v.updateHighlight(hl); closeSheet(); } }, 'บันทึก'))));
}
function openExternal(url) {
  if (!/^https?:|^mailto:/i.test(url)) return;
  openSheet('เปิดลิงก์ภายนอก?', h('div', { class: 'col' }, h('p', { class: 'note', style: { overflowWrap: 'anywhere' } }, url),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => closeSheet() }, 'ยกเลิก'), h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer', onclick: () => closeSheet(), style: { textDecoration: 'none' } }, 'เปิด'))));
}

/* ---------- ค้นหา ---------- */
let searchTok = 0;
function searchSheet() {
  const v = app.view;
  const inp = h('input', { class: 'inp', type: 'search', placeholder: 'ค้นหาในเล่มนี้', enterKeyHint: 'search' });
  const status = h('p', { class: 'note' }, v.kind === 'fixed' ? 'ค้นได้เฉพาะ PDF ที่มีข้อความจริง (ไฟล์สแกนเป็นภาพจะค้นไม่พบ)' : '');
  const list = h('div', { class: 'list' });
  const run = async () => {
    const q = inp.value.trim(), tok = ++searchTok;
    list.replaceChildren();
    if (q.length < 2) { status.textContent = 'พิมพ์อย่างน้อย 2 ตัวอักษร'; return; }
    let n = 0, step = 0;
    for await (const r of v.search(q)) {
      if (tok !== searchTok) return;
      if (!r) { step++; if (step % 5 === 0) { status.textContent = `กำลังค้น… พบ ${n} แห่ง`; await new Promise((res) => setTimeout(res)); } continue; }
      const i = r.snippet.toLowerCase().indexOf(q.toLowerCase());
      const txt = i < 0 ? [r.snippet] : [r.snippet.slice(0, i), h('b', {}, r.snippet.slice(i, i + q.length)), r.snippet.slice(i + q.length)];
      list.append(h('button', { class: 'li', onclick: async () => { closeSheet(); reader.classList.remove('ui'); await r.go(); } }, h('span', { class: 'grow' }, '…', txt, '…', h('small', {}, r.label))));
      if (++n >= 200) break;
    }
    if (tok === searchTok) status.textContent = n ? `พบ ${n}${n >= 200 ? '+' : ''} แห่ง` : 'ไม่พบคำนี้';
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { inp.blur(); run(); } });
  openSheet('ค้นหา', h('div', { class: 'col' }, h('div', { class: 'row' }, inp, h('button', { class: 'btn', onclick: run }, 'ค้น')), status, list), { tall: true, onClose: () => { searchTok++; } });
  setTimeout(() => inp.focus(), 60);
}

/* ---------- อ่านออกเสียง ---------- */
function ttsChanged() {
  const bar = $('#ttsbar'), t = $('#tool-tts');
  if (t) t.classList.toggle('on', tts.on);
  bar.hidden = !tts.on;
  if (!tts.on) return;
  const rates = [0.8, 1, 1.2, 1.5];
  bar.replaceChildren(ibtn(tts.paused ? 'play' : 'pause', tts.paused ? 'เล่นต่อ' : 'หยุดชั่วคราว', () => tts.pause()), ibtn('stop', 'หยุดอ่าน', () => tts.stop()),
    h('button', { class: 'fb-txt', title: 'ความเร็ว', onclick: () => { S.ttsRate = rates[(rates.indexOf(S.ttsRate) + 1) % rates.length] || 1; saveS(); ttsChanged(); toast('ความเร็วใหม่จะเริ่มที่ประโยคถัดไป', 1500); } }, `เร็ว ×${S.ttsRate}`));
}

/* ---------- การแสดงผล + ถนอมสายตา ---------- */
function seg(opts, cur, onpick) {
  const el = h('div', { class: 'seg' });
  const draw = (c) => el.replaceChildren(...opts.map(([k, l]) => h('button', { class: k === c ? 'on' : '', onclick: () => { draw(k); onpick(k); } }, l)));
  draw(cur);
  return el;
}
function field(label, ...kids) { return h('div', { class: 'field' }, h('span', { class: 'lab' }, label), kids); }
function slider(label, key, min, max, step, fmt, after) {
  const val = h('span', { class: 'val' }, fmt(S[key]));
  const inp = h('input', { type: 'range', min, max, step, 'aria-label': label });
  inp.value = S[key];
  inp.addEventListener('input', () => { S[key] = +inp.value; val.textContent = fmt(S[key]); saveS(); after(); });
  return h('div', { class: 'field' }, h('span', { class: 'lab' }, label), inp, val);
}
function toggle(label, on, onchange) {
  const b = h('button', { class: 'sw-toggle', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label });
  b.onclick = () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); onchange(v); };
  return h('div', { class: 'field tg' }, h('span', { class: 'lab' }, label), b);
}
function displaySheet() {
  const v = app.view, m = app.meta;
  const eye = () => { applyTheme(); if (v && v.kind === 'reflow') relayoutSoon(); };
  const text = () => relayoutSoon();
  const body = h('div', {});
  const draw = () => {
    const secs = [];
    if (v) {
      const bookSet = (k) => (val) => { m.view[k] = val; app.saveSoon(); v.relayout(); if (k === 'mode') { closeSheet(); } };
      secs.push(h('div', { class: 'sec' }, h('h3', {}, 'การอ่านเล่มนี้'),
        field('วิธีเปิดหน้า', seg([['paged', 'ปัดซ้าย–ขวา'], ['scroll', 'เลื่อนบน–ล่าง']], v.mode, bookSet('mode'))),
        field('ทิศทาง (มังงะใช้ขวา→ซ้าย)', seg([['ltr', 'ซ้าย → ขวา'], ['rtl', 'ขวา → ซ้าย']], v.dir, bookSet('dir'))),
        field('จำนวนหน้า', seg([['auto', 'อัตโนมัติ'], ['one', 'หน้าเดียว'], ['two', 'สองหน้าคู่']], m.view.spread || 'auto', bookSet('spread')))));
    }
    secs.push(h('div', { class: 'sec' }, h('h3', {}, 'เอฟเฟกต์พลิกหน้า'),
      seg([['curl', 'ม้วนกระดาษ'], ['slide', 'เลื่อน'], ['none', 'ไม่มี']], S.effect, (k) => { S.effect = k; saveS(); })));
    if (!v || v.kind === 'reflow') {
      secs.push(h('div', { class: 'sec' }, h('h3', {}, 'ตัวอักษร (EPUB / TXT)'),
        h('div', { class: 'chips', style: { marginBottom: '8px' } }, Object.entries(FONTS).map(([k, f]) => h('button', { class: 'chip' + (S.font === k ? ' on' : ''), onclick: () => { S.font = k; saveS(); text(); draw(); } }, f.label))),
        slider('ขนาด', 'size', 12, 36, 1, (x) => x + ' px', text),
        slider('ระยะบรรทัด', 'lh', 1.2, 2.6, 0.05, (x) => x.toFixed(2), text),
        slider('ขอบกระดาษ', 'margin', 8, 64, 2, (x) => x + ' px', text),
        toggle('จัดชิดขอบสองด้าน', S.justify, (x) => { S.justify = x; saveS(); text(); }),
        toggle('ใช้การจัดหน้าของสำนักพิมพ์', S.pubCss, (x) => { S.pubCss = x; saveS(); text(); })));
    }
    const all = [...PRESETS, ...S.presets];
    secs.push(h('div', { class: 'sec' }, h('h3', {}, 'โหมดถนอมสายตา'),
      h('div', { class: 'chips', style: { marginBottom: '12px' } },
        all.map((p, i) => h('button', { class: 'chip', onclick: () => { for (const k of EYE_KEYS) if (p[k] !== undefined) S[k] = p[k]; saveS(); eye(); draw(); } }, p.name,
          i >= PRESETS.length ? h('span', { class: 'x', role: 'button', 'aria-label': 'ลบชุดนี้', onclick: (e) => { e.stopPropagation(); S.presets.splice(i - PRESETS.length, 1); saveS(); draw(); } }, '×') : null)),
        h('button', { class: 'chip', onclick: async () => { const n = await ask('ตั้งชื่อชุดการตั้งค่านี้', { placeholder: 'เช่น อ่านบนรถ' }); if (n && n.trim()) { const p = { name: n.trim().slice(0, 24) }; for (const k of EYE_KEYS) p[k] = S[k]; S.presets.push(p); saveS(); } displaySheet(); } }, '+ บันทึกชุดปัจจุบัน')),
      h('div', { class: 'swatches', style: { marginBottom: '10px' } },
        Object.entries(THEMES).map(([k, t]) => h('button', { class: 'sw' + (S.theme === k ? ' on' : ''), style: { background: t.bg, color: t.fg }, title: t.name, 'aria-label': 'ธีม ' + t.name, onclick: () => { S.theme = k; saveS(); eye(); draw(); } }, 'ก')),
        h('button', { class: 'sw' + (S.theme === 'custom' ? ' on' : ''), style: { background: S.customBg, color: S.customFg }, title: 'กำหนดเอง', 'aria-label': 'ธีมกำหนดเอง', onclick: () => { S.theme = 'custom'; saveS(); eye(); draw(); } }, '✎')),
      S.theme === 'custom' ? field('สีกำหนดเอง',
        h('input', { type: 'color', value: S.customBg, 'aria-label': 'สีพื้น', oninput: (e) => { S.customBg = e.target.value; saveS(); eye(); } }), h('span', { class: 'muted' }, 'พื้น'),
        h('input', { type: 'color', value: S.customFg, 'aria-label': 'สีตัวอักษร', oninput: (e) => { S.customFg = e.target.value; saveS(); eye(); } }), h('span', { class: 'muted' }, 'ตัวอักษร')) : null,
      slider('แสงอุ่น', 'warm', 0, 100, 1, (x) => x + '%', applyTheme),
      slider('หรี่แสง', 'dim', 0, 100, 1, (x) => x + '%', applyTheme)));
    if (!v || v.kind === 'fixed') {
      secs.push(h('div', { class: 'sec' }, h('h3', {}, 'หน้า PDF / รูปภาพ'),
        toggle('ย้อมหน้ากระดาษตามสีธีม', S.tint, (x) => { S.tint = x; saveS(); applyTheme(); }),
        toggle('กลับสีหน้าเมื่อใช้ธีมมืด', S.invert, (x) => { S.invert = x; saveS(); applyTheme(); }),
        slider('คอนทราสต์', 'contrast', 60, 140, 1, (x) => x + '%', applyTheme),
        slider('ขาวดำ', 'gray', 0, 100, 1, (x) => x + '%', applyTheme)));
    }
    secs.push(h('div', { class: 'sec' }, h('h3', {}, 'สุขภาพสายตา'),
      field('เตือนพักสายตา', seg([[0, 'ปิด'], [20, '20 นาที'], [30, '30 นาที'], [45, '45 นาที']], S.breakMin, (k) => { S.breakMin = k; activeSec = 0; saveS(); })),
      toggle('เปิดหน้าจอค้างไว้ขณะอ่าน', S.wake, (x) => { S.wake = x; saveS(); if (x) lockWake(); else if (wakeLock) wakeLock.release().catch(() => {}); })));
    body.replaceChildren(...secs);
  };
  draw();
  openSheet('การแสดงผล', body, { tall: true });
}

/* ---------- เตือนพักสายตา + นับเวลาอ่าน ---------- */
setInterval(() => {
  if (!app.view || document.hidden) return;
  activeSec += 5; app.meta.time = (app.meta.time || 0) + 5;
  if (S.breakMin > 0 && activeSec >= S.breakMin * 60 && !sheetOpen() && !annOn && !tts.on) {
    activeSec = 0;
    let n = 20;
    const ring = h('div', { class: 'ring' }, String(n));
    openSheet('พักสายตาสักครู่', h('div', { class: 'col' }, h('p', { class: 'muted' }, `คุณอ่านต่อเนื่องมา ${S.breakMin} นาทีแล้ว ลองมองไปไกล ๆ ราว 6 เมตร แล้วกะพริบตาช้า ๆ 20 วินาที`), ring,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => closeSheet() }, 'ข้าม'))), { onClose: () => clearInterval(iv) });
    const iv = setInterval(() => { ring.textContent = String(--n); if (n <= 0) { closeSheet(); toast('พักเสร็จแล้ว อ่านต่อได้เลย', 1800); } }, 1000);
  }
}, 5000);

/* ---------- มุมมองโฟลเดอร์ (ทุกหน้า) + จัดการหน้า PDF ---------- */
let gridState = null;
function closeGrid() { const g = $('#grid'); if (g.hidden) return; g.hidden = true; g.replaceChildren(); if (gridState && gridState.io) gridState.io.disconnect(); gridState = null; }
function openGrid(manage = false, sel = -1) {
  const v = app.view, g = $('#grid');
  if (!v || v.kind !== 'fixed') return;
  closeGrid(); closeSheet();
  const st = gridState = { manage, sel, queue: [], running: 0 };
  const body = h('div', { class: 'g-body' });
  const pump = () => {
    while (st.running < 2 && st.queue.length) {
      const cell = st.queue.shift();
      if (cell._done || !cell._want) continue;
      st.running++; cell._done = true;
      v.src.thumb(cell._i, 110).then((c) => { if (gridState === st) cell.firstChild.replaceChildren(c); }).catch(() => { cell._done = false; }).finally(() => { st.running--; pump(); });
    }
  };
  st.io = new IntersectionObserver((ents) => { for (const e of ents) { e.target._want = e.isIntersecting; if (e.isIntersecting && !e.target._done) st.queue.push(e.target); } pump(); }, { root: body, rootMargin: '300px 0px' });
  const cur = new Set(v.mode === 'paged' ? v.spreadOf(v.pos) : [v.pos]);
  const cells = [];
  for (let i = 0; i < v.count; i++) {
    const cell = h('button', { class: 'cell' + (cur.has(i) ? ' cur' : '') + (i === st.sel ? ' sel' : ''), 'aria-label': 'หน้า ' + (i + 1), onclick: async () => {
      if (st.manage) { st.sel = i; cells.forEach((c, k) => c.classList.toggle('sel', k === i)); drawFoot(); return; }
      closeGrid(); reader.classList.remove('ui'); await v.goto(i);
    } }, h('div', { class: 'th' }), h('span', {}, String(i + 1)));
    cell._i = i; cells.push(cell); st.io.observe(cell);
  }
  body.append(...cells);
  const foot = h('div', { class: 'g-foot' });
  const tool = (ic, label, fn, dis) => h('button', { class: 'tool', onclick: fn, disabled: !!dis, style: dis ? { opacity: '.35' } : null }, icon(ic), label);
  const op = async (fn, keepSel) => { await fn(); v.src.invalidate(); app.meta.n = v.count; outlineCache = null; await v.relayout(); app.saveSoon(); openGrid(true, keepSel); };
  const order = () => app.meta.pdf.order;
  function drawFoot() {
    if (!st.manage) { foot.hidden = true; return; }
    foot.hidden = false;
    const i = st.sel, none = i < 0;
    foot.replaceChildren(
      tool('left', 'ย้ายมาก่อน', () => op(() => { const o = order(); [o[i - 1], o[i]] = [o[i], o[i - 1]]; }, i - 1), none || i === 0),
      tool('right', 'ย้ายไปหลัง', () => op(() => { const o = order(); [o[i + 1], o[i]] = [o[i], o[i + 1]]; }, i + 1), none || i >= v.count - 1),
      tool('rotate', 'หมุน', () => op(() => { order()[i].r = (order()[i].r + 90) % 360; }, i), none),
      tool('trash', 'ลบหน้า', async () => { if (await confirmBox('ลบหน้านี้?', `หน้า ${i + 1} จะถูกเอาออกจากเล่มในแอป (ไฟล์ต้นฉบับไม่เปลี่ยน)`, 'ลบหน้า')) op(() => { order().splice(i, 1); }, Math.min(i, v.count - 2)); else openGrid(true, i); }, none || v.count < 2),
      tool('plus', 'เพิ่มไฟล์', () => $('#in-merge').click()),
      tool('download', 'ส่งออก', () => exportSheet()));
  }
  g.replaceChildren(
    h('div', { class: 'g-head' }, ibtn('close', 'ปิด', () => closeGrid()), h('div', { class: 'r-title' }, st.manage ? 'จัดการหน้า — แตะเพื่อเลือก' : app.meta.title),
      v.isPdf ? h('button', { class: 'btn ' + (st.manage ? '' : 'ghost'), onclick: () => openGrid(!st.manage) }, st.manage ? 'เสร็จ' : 'จัดการหน้า') : null),
    body, foot);
  drawFoot();
  g.hidden = false;
  const focus = cells[st.sel >= 0 ? st.sel : v.pos];
  if (focus) focus.scrollIntoView({ block: 'center' });
}
async function reopen(pos) {
  const m = app.meta;
  try { app.view.destroy(); } catch { /* ปิดแล้ว */ }
  const src = await openSource(m);
  app.view = new FixedView(app, m, src);
  app.pager.setView(app.view);
  outlineCache = null;
  await app.view.open(pos);
}
$('#in-merge').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  const v = app.view, m = app.meta;
  if (!files.length || !v || !v.isPdf) return;
  busy('กำลังรวมไฟล์…');
  try {
    const marks = m.bookmarks.map((b) => v.bookmarkIndex(b));
    const out = await rebuildPdf(m, await db.file(m.id), { flatten: false, extra: files });
    await db.putFile(m.id, out.blob);
    m.pdf.order = out.order; m.pdf.annots = out.annots; m.size = out.blob.size; m.n = out.order.length;
    { const kept = []; m.bookmarks.forEach((b, i) => { if (marks[i] >= 0) kept.push({ ...b, pos: { p: marks[i], s: marks[i] } }); }); m.bookmarks = kept; }
    const pos = v.getPos();
    closeGrid();
    await reopen(pos);
    await save();
    toast(`เพิ่มแล้ว รวมเป็น ${m.n} หน้า`);
    openGrid(true, -1);
  } catch (err) { console.error(err); toast(err.message || 'รวมไฟล์ไม่สำเร็จ', 4500); }
  finally { busy(''); }
});
function exportSheet() {
  const m = app.meta;
  const make = async () => { busy('กำลังสร้างไฟล์ PDF…'); try { return (await rebuildPdf(m, await db.file(m.id), { flatten: true })).blob; } finally { busy(''); } };
  const name = m.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) + ' (แก้ไข).pdf';
  const big = (ic, t, s, fn) => h('button', { class: 'bigbtn', onclick: async () => { closeSheet(); try { await fn(); } catch (e) { console.error(e); toast(e.message || 'ส่งออกไม่สำเร็จ', 4500); } } }, icon(ic, 30), h('div', {}, h('b', {}, t), h('small', {}, s)));
  openSheet('ส่งออก PDF ที่แก้ไขแล้ว', h('div', { class: 'col' },
    big('share', 'บันทึก / แชร์ไฟล์', 'ได้ไฟล์ PDF ใหม่ที่รวมลายขีดเขียน การหมุน และลำดับหน้าปัจจุบัน', async () => saveBlob(await make(), name)),
    big('book', 'เก็บเป็นเล่มใหม่ในชั้นหนังสือ', 'เล่มเดิมยังอยู่และแก้ต่อได้', async () => { const b = await make(); busy('กำลังบันทึก…'); try { await importFiles([new File([b], name, { type: 'application/pdf' })]); } finally { busy(''); } toast('เพิ่มเล่มใหม่ในชั้นหนังสือแล้ว'); }),
    h('p', { class: 'note' }, 'ไฟล์ต้นฉบับในเครื่องคุณจะไม่ถูกแก้ไข')));
}

/* ---------- แถบขีดเขียนบน PDF ---------- */
let annOn = false;
const ann = { tool: 'pen', size: 1, colors: { pen: '#d32f2f', hl: '#ffd400', text: '#1a56c4' } };
const PALETTE = ['#111111', '#d32f2f', '#1a56c4', '#1e8e3e', '#ffd400', '#ff7a00'];
function setAnnot(on) {
  const v = app.view, bar = $('#annbar');
  if (!on) { if (!annOn) return; annOn = false; bar.hidden = true; if (v && v.kind === 'fixed') v.setAnnotate(null); return; }
  if (!v || !v.isPdf) return;
  annOn = true; reader.classList.remove('ui'); $('#selbar').hidden = true;
  const push = () => v.setAnnotate({ tool: ann.tool, size: ann.size, color: ann.colors[ann.tool] || '#000' });
  const draw = () => {
    const t = (id, ic, label) => ibtn(ic, label, () => { ann.tool = id; push(); draw(); }, ann.tool === id ? 'on' : '');
    bar.replaceChildren(...[
      ibtn('left', 'หน้าก่อน', () => (v.dir === 'rtl' ? v.next() : v.prev())), ibtn('right', 'หน้าถัดไป', () => (v.dir === 'rtl' ? v.prev() : v.next())), h('span', { class: 'sep' }),
      t('pen', 'pencil', 'ปากกา'), t('hl', 'marker', 'ปากกาเน้นข้อความ'), t('text', 'text', 'ใส่ข้อความ'), t('eraser', 'eraser', 'ยางลบ (แตะที่เส้น)'), h('span', { class: 'sep' }),
      ann.tool === 'eraser' ? null : PALETTE.map((c) => h('button', { class: 'dot' + (ann.colors[ann.tool] === c ? ' on' : ''), style: { background: c }, 'aria-label': 'สี ' + c, onclick: () => { ann.colors[ann.tool] = c; push(); draw(); } })),
      ann.tool === 'eraser' ? null : [0, 1, 2].map((s) => h('button', { class: 'sz' + (ann.size === s ? ' on' : ''), 'aria-label': 'ขนาด ' + (s + 1), onclick: () => { ann.size = s; push(); draw(); } }, h('i', { style: { width: 5 + s * 5 + 'px', height: 5 + s * 5 + 'px' } }))),
      h('span', { class: 'sep' }), ibtn('undo', 'ย้อนกลับ', () => { if (!v.undoAnnot()) toast('ไม่มีอะไรให้ย้อน', 1200); }),
      h('button', { class: 'fb-txt', onclick: () => setAnnot(false) }, 'เสร็จ')].flat().filter(Boolean));
  };
  push().then(draw);
  bar.hidden = false;
  toast('ซูมหน้าก่อนกดแก้ไขได้ หากต้องการเขียนละเอียด', 2600);
}

/* ---------- เริ่มทำงาน ---------- */
applyTheme();
renderLib();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
}
window.__eazy = { app, db, importFiles, openBook, tts }; // สำหรับตรวจสอบ/ดีบัก
