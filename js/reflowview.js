// ตัวอ่านแบบข้อความไหล: EPUB / TXT (แบ่งหน้าเป็นคอลัมน์ หรือเลื่อนลงทีละบท)
import { h, clamp, sleep, esc, uid, debounce } from './util.js';

const FONT_URL = new URL('../fonts/', import.meta.url).href;
const SANS = 'system-ui,-apple-system,"Sukhumvit Set","Noto Sans Thai","Thonburi","Segoe UI",sans-serif';
export const FONTS = {
  pub: { label: 'ตามต้นฉบับ', css: '' },
  sans: { label: 'ไม่มีหัว (ระบบ)', css: SANS },
  sarabun: { label: 'สารบรรณ', css: '"Sarabun",' + SANS },
  serif: { label: 'Noto Serif', css: '"Noto Serif Thai",Georgia,"Times New Roman",serif' },
  georgia: { label: 'Georgia', css: 'Georgia,"Iowan Old Style","Noto Serif Thai","Times New Roman",serif' },
};
export const HL_COLORS = { y: '#ffd640', g: '#78dc82', b: '#6eb4ff', p: '#ff8cbe' };

export class ReflowView {
  kind = 'reflow';
  zoomable = false;
  mouseDrag = false;
  constructor(app, meta, book) {
    this.app = app; this.meta = meta; this.book = book;
    this.stage = app.stage; this.pos = { ch: 0, off: 0 }; this.sel = null;
    this.total = book.weights.reduce((a, b) => a + b, 0);
    this.cum = []; let c = 0; for (const w of book.weights) { this.cum.push(c); c += w; }
    this.onScrollD = debounce(() => this.onScroll(), 140);
  }
  get count() { return this.book.count; }
  get dir() { return this.meta.view.dir || 'ltr'; }
  get mode() { return this.meta.view.mode || 'paged'; }
  get tapOnly() { return this.mode === 'scroll'; }
  get paper() { return this.app.theme.bg; }
  get front() { return this.fa.layer; }
  get back() { return this.fb.layer; }
  hasSelection() { const s = this.fa.win && this.fa.win.getSelection(); return !!(s && !s.isCollapsed); }

  mk(layer) {
    const el = h('iframe', { class: 'rf', title: 'เนื้อหาหนังสือ' });
    layer.replaceChildren(el);
    return { el, layer, ch: -1, page: 0, pages: 1, ready: false, want: -1, p: null };
  }
  async open(pos) {
    this.fa = this.mk(this.app.layerA); this.fb = this.mk(this.app.layerB);
    this.fa.layer.classList.add('front'); this.fb.layer.classList.remove('front');
    this.app.scroller.replaceChildren();
    this.measure();
    this.app.pager.resize();
    await this.goto(pos && typeof pos === 'object' ? pos : { ch: 0, off: 0 });
  }
  destroy() { this.fa.layer.replaceChildren(); this.fb.layer.replaceChildren(); this.book.destroy(); }
  measure() {
    this.SW = this.stage.clientWidth; this.SH = this.stage.clientHeight;
    const sp = this.meta.view.spread || 'auto';
    this.two = this.mode === 'paged' && (sp === 'two' || (sp === 'auto' && this.SW >= 700 && this.SW / this.SH >= 0.8));
    this.stage.classList.toggle('scrollmode', this.mode === 'scroll');
    this.stage.classList.toggle('reflow-scroll', this.mode === 'scroll');
  }

  /* ----- สไตล์ที่ครอบเนื้อหา ----- */
  css() {
    const S = this.app.S, th = this.app.theme, W = this.SW, H = this.SH, paged = this.mode === 'paged';
    const m = S.margin, pv = Math.max(14, Math.round(m * 0.9)), gap = 2 * m, cw = Math.max(80, Math.floor(W / (this.two ? 2 : 1) - gap));
    const f = FONTS[S.font] || FONTS.sans;
    const face = (n, file, w, st = 'normal') => `@font-face{font-family:"${n}";src:url("${FONT_URL}${file}") format("woff");font-weight:${w};font-style:${st};font-display:swap}`;
    return `
${face('Sarabun', 'Sarabun-Regular.woff', 400)}${face('Sarabun', 'Sarabun-Bold.woff', 700)}${face('Sarabun', 'Sarabun-Italic.woff', 400, 'italic')}${face('Noto Serif Thai', 'NotoSerifThai.woff', '100 900')}
html{margin:0!important;padding:0!important;background:transparent!important;-webkit-text-size-adjust:100%;text-size-adjust:100%;${paged ? 'height:100%;overflow:hidden!important' : 'height:auto!important;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch'}}
body{box-sizing:border-box!important;background:transparent!important;color:${th.fg}!important;font-size:${S.size}px!important;line-height:${S.lh}!important;overflow-wrap:break-word;word-break:normal;-webkit-tap-highlight-color:transparent;${S.justify ? 'text-align:justify!important;' : ''}
${paged ? `margin:0!important;width:${W}px!important;height:${H}px!important;max-width:none!important;min-width:0!important;padding:${pv}px ${m}px!important;column-width:${cw}px!important;column-count:auto!important;column-gap:${gap}px!important;column-fill:auto!important;overflow:visible!important;position:static!important;touch-action:none`
    : `margin:0 auto!important;max-width:46em!important;height:auto!important;padding:${pv + 6}px ${m}px 90px!important;touch-action:pan-y pinch-zoom`}}
body *{color:inherit!important;background-color:transparent!important;max-width:100%;box-sizing:border-box}
body p,body div,body li,body blockquote,body dd,body td,body span{line-height:inherit!important}
${f.css ? `body,body *{font-family:${f.css}!important}` : ''}
img,svg,video{max-width:100%!important;${paged ? `max-height:${Math.max(120, H - 2 * pv - 8)}px!important;` : ''}object-fit:contain;break-inside:avoid;page-break-inside:avoid}
img{height:auto${this.app.dark ? ';filter:brightness(.84)' : ''}}
body :is(p,div,figure):has(>img,>svg){text-indent:0!important}
a{color:${th.link}!important}
pre{white-space:pre-wrap!important}
h1,h2,h3,h4{break-after:avoid;page-break-after:avoid;line-height:1.35!important}
body mark.bl-hl{color:inherit!important;border-radius:2px}
${Object.entries(HL_COLORS).map(([k, v]) => `body mark.bl-hl.bl-${k}{background-color:${v}${this.app.dark ? '66' : '8c'}!important}`).join('')}
body mark.bl-hl.bl-n{box-shadow:0 2px 0 ${th.fg}}
::selection{background:rgba(70,130,255,.35)}
.bl-ui{${paged ? 'display:none!important' : 'display:flex'};justify-content:space-between;gap:12px;margin:56px 0 0;font-family:${SANS}!important;-webkit-user-select:none;user-select:none}
.bl-ui span{padding:12px 18px;border:1px solid;border-radius:999px;opacity:.7;font-size:15px!important;cursor:pointer}
::highlight(bl-flash){background-color:#ffd54a;color:#111}
::highlight(bl-tts){background-color:rgba(90,150,255,.38)}
`;
  }
  wrap(c) {
    const csp = `default-src 'none'; img-src blob: data:; media-src blob: data:; style-src 'unsafe-inline'; font-src blob: data: ${location.origin}`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style id="bl-pub"${this.app.S.pubCss ? '' : ' media="not all"'}>${c.css}</style><style id="bl-style">${this.css()}</style></head><body class="${esc(c.cls || '')}">${c.html}<span id="bl-end"></span></body></html>`;
  }

  /* ----- โหลดบทเข้า iframe ----- */
  ensure(fr, ch) {
    if (fr.ch === ch && fr.ready) return Promise.resolve();
    if (fr.want === ch && fr.p) return fr.p;
    fr.want = ch;
    fr.p = (fr.p || Promise.resolve()).catch(() => {}).then(() => (fr.want === ch && !(fr.ch === ch && fr.ready) ? this.load(fr, ch) : null));
    return fr.p;
  }
  async load(fr, ch) {
    fr.ready = false; fr.ch = -1;
    const c = await this.book.getChapter(ch);
    await new Promise((res) => {
      const t = setTimeout(res, 8000);
      fr.el.onload = () => { clearTimeout(t); res(); };
      fr.el.srcdoc = this.wrap(c);
    });
    const doc = fr.doc = fr.el.contentDocument; fr.win = fr.el.contentWindow;
    fr.styleEl = doc.getElementById('bl-style'); fr.pubEl = doc.getElementById('bl-pub');
    fr.ch = ch; fr.page = 0;
    const nav = doc.createElement('div'); nav.className = 'bl-ui';
    nav.innerHTML = `<span data-bl-nav="-1" ${ch > 0 ? '' : 'style="visibility:hidden"'}>‹ บทก่อนหน้า</span><span data-bl-nav="1" ${ch + 1 < this.count ? '' : 'style="visibility:hidden"'}>บทถัดไป ›</span>`;
    doc.body.append(nav);
    this.bind(fr);
    this.index(fr);
    fr.text = fr.nodes.map((n) => n.data).join('');
    for (const hl of this.meta.highlights) if (hl.ch === ch) this.wrapRange(fr, hl);
    this.countPages(fr);
    try { await Promise.race([doc.fonts.ready, sleep(600)]); } catch { /* ไม่รองรับ */ }
    this.countPages(fr);
    fr.ready = true;
  }
  bind(fr) {
    const doc = fr.doc;
    this.app.pager.attach(doc, (e) => ({ x: e.clientX, y: e.clientY }));
    doc.addEventListener('click', (e) => { const t = e.target.nodeType === 1 ? e.target : e.target.parentElement; if (t && t.closest('a')) e.preventDefault(); });
    doc.addEventListener('dragstart', (e) => e.preventDefault());
    doc.addEventListener('touchmove', (e) => { if (this.mode === 'paged' && e.cancelable && !this.hasSelection()) e.preventDefault(); }, { passive: false });
    doc.addEventListener('keydown', (e) => this.app.onKey(e));
    doc.addEventListener('wheel', (e) => this.app.onWheel(e), { passive: true });
    doc.addEventListener('selectionchange', debounce(() => this.onSel(fr), 220));
    fr.win.addEventListener('scroll', () => { if (fr === this.fa && this.mode === 'scroll') this.onScrollD(); }, { passive: true });
  }

  /* ----- ดัชนีตัวอักษร: ใช้ระบุตำแหน่งอ่าน ไฮไลต์ ค้นหา ----- */
  index(fr) {
    const nodes = [], starts = [], map = new Map();
    let t = 0;
    const w = fr.doc.createTreeWalker(fr.doc.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('.bl-ui') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    while (w.nextNode()) { const n = w.currentNode; map.set(n, nodes.length); nodes.push(n); starts.push(t); t += n.data.length; }
    fr.nodes = nodes; fr.starts = starts; fr.nmap = map; fr.len = t;
  }
  locate(fr, off) {
    const s = fr.starts;
    if (!s.length) return [-1, 0];
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= off) lo = mid; else hi = mid - 1; }
    return [lo, Math.min(off - s[lo], fr.nodes[lo].data.length)];
  }
  rectAt(fr, off) {
    let [i, local] = this.locate(fr, clamp(off, 0, Math.max(0, fr.len - 1)));
    if (i < 0) return null;
    const r = fr.doc.createRange();
    for (let steps = 0; i < fr.nodes.length && steps < 300; steps++) {
      const node = fr.nodes[i], L = node.data.length;
      if (local < L) {
        r.setStart(node, local); r.setEnd(node, local + 1);
        const rs = r.getClientRects();
        for (const q of rs) if (q.width > 0 || q.height > 0) return q;
        if (local + 1 < L && steps % 6 !== 5) { local++; continue; }
      }
      i++; local = 0;
    }
    return null;
  }
  pageOf(fr, off) {
    const r = this.rectAt(fr, off);
    if (!r) return fr.pages - 1;
    return clamp(Math.floor((r.left + fr.page * this.SW + 1) / this.SW), 0, fr.pages - 1);
  }
  offsetOfPage(fr, n) {
    if (n <= 0) return 0;
    let lo = 0, hi = fr.len;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.pageOf(fr, mid) >= n) hi = mid; else lo = mid + 1; }
    return lo;
  }
  topOffset(fr) { // โหมดเลื่อน: ตัวอักษรแรกที่มองเห็น
    let lo = 0, hi = fr.len;
    while (lo < hi) { const mid = (lo + hi) >> 1; const r = this.rectAt(fr, mid); if (!r || r.bottom > 6) hi = mid; else lo = mid + 1; }
    return lo;
  }
  pointOffset(fr, node, off) {
    if (node.nodeType === 3) { const i = fr.nmap.get(node); return i == null ? 0 : fr.starts[i] + Math.min(off, node.data.length); }
    const r = fr.doc.createRange();
    try { r.setStart(node, off); } catch { return 0; }
    let lo = 0, hi = fr.nodes.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (r.comparePoint(fr.nodes[mid], 0) >= 0) hi = mid; else lo = mid + 1; }
    return lo < fr.nodes.length ? fr.starts[lo] : fr.len;
  }
  rangeOf(fr, s, e) {
    const [i, a] = this.locate(fr, s), [j, b] = this.locate(fr, Math.max(s, e - 1));
    if (i < 0) return null;
    const r = fr.doc.createRange();
    r.setStart(fr.nodes[i], a); r.setEnd(fr.nodes[j], Math.min(fr.nodes[j].data.length, b + 1));
    return r;
  }

  /* ----- แบ่งหน้า ----- */
  countPages(fr) {
    if (this.mode !== 'paged') { fr.pages = 1; fr.page = 0; fr.doc.body.style.transform = ''; return; }
    const end = fr.doc.getElementById('bl-end');
    const left = end ? end.getBoundingClientRect().left + fr.page * this.SW : 0;
    fr.pages = Math.max(1, Math.floor((left + 0.5) / this.SW) + 1);
    if (fr.page >= fr.pages) this.setPage(fr, fr.pages - 1);
  }
  setPage(fr, n) {
    fr.page = clamp(n, 0, fr.pages - 1);
    fr.doc.body.style.transform = fr.page ? `translateX(${-fr.page * this.SW}px)` : '';
  }
  restyle(fr) {
    if (!fr.doc || fr.ch < 0) return;
    fr.styleEl.textContent = this.css();
    fr.pubEl.media = this.app.S.pubCss ? 'all' : 'not all';
    fr.page = 0; fr.doc.body.style.transform = '';
    this.countPages(fr);
  }
  async relayout() {
    this.app.pager.abortAll();
    this.measure();
    this.app.pager.resize();
    this.restyle(this.fa); this.restyle(this.fb);
    if (this.fa.ch >= 0) this.show(this.fa, this.pos.off);
    setTimeout(() => { if (this.fa.ch >= 0 && this.mode === 'paged') { const p = this.fa.pages; this.countPages(this.fa); if (p !== this.fa.pages) this.show(this.fa, this.pos.off); } }, 500);
  }
  show(fr, off, last) {
    if (this.mode === 'paged') {
      this.setPage(fr, last ? fr.pages - 1 : this.pageOf(fr, off));
      this.pos = { ch: fr.ch, off: last ? this.offsetOfPage(fr, fr.page) : off };
    } else {
      const r = this.rectAt(fr, off);
      fr.win.scrollTo(0, off <= 0 || !r ? 0 : Math.max(0, r.top + fr.win.scrollY - 14));
      this.pos = { ch: fr.ch, off };
    }
    this.app.onPos();
  }
  async goto(p) {
    this.app.pager.abortAll();
    const fr = this.fa, ch = clamp(p.ch | 0, 0, this.count - 1);
    await this.ensure(fr, ch);
    if (fr.ch !== ch) return;
    let off = p.off || 0;
    if (p.frag) {
      const el = fr.doc.getElementById(p.frag) || fr.doc.getElementsByName(p.frag)[0];
      if (el) { const r = fr.doc.createRange(); r.setStartBefore(el); off = this.pointOffset(fr, r.startContainer, r.startOffset); }
    }
    if (p.frac != null) off = Math.floor(clamp(p.frac, 0, 1) * fr.len);
    this.show(fr, clamp(off, 0, fr.len), p.last);
    this.preload();
  }
  preload() { if (this.mode === 'paged') this.ensure(this.fb, this.fa.ch).catch(() => {}); }

  /* ----- ส่วนที่ Pager เรียกใช้ ----- */
  canGo(dir) {
    if (this.mode !== 'paged') return false;
    const f = this.fa;
    return dir === 'next' ? f.page + 1 < f.pages || f.ch + 1 < this.count : f.page > 0 || f.ch > 0;
  }
  async prepare(dir) {
    const f = this.fa, b = this.fb;
    let ch = f.ch, page;
    if (dir === 'next') { if (f.page + 1 < f.pages) page = f.page + 1; else { ch++; page = 0; } }
    else if (f.page > 0) page = f.page - 1; else { ch--; page = -1; }
    if (ch < 0 || ch >= this.count) return false;
    await this.ensure(b, ch);
    if (b.ch !== ch || !b.ready) return false;
    this.countPages(b);
    this.setPage(b, page < 0 ? b.pages - 1 : page);
    return true;
  }
  commit() {
    const f = this.fa; this.fa = this.fb; this.fb = f;
    this.fa.layer.classList.add('front'); this.fb.layer.classList.remove('front');
    this.pos = { ch: this.fa.ch, off: this.offsetOfPage(this.fa, this.fa.page) };
    this.sel = null; this.app.selChanged(null);
    this.app.onPos();
    this.preload();
  }
  abort() {}
  pageRect(layer, side) {
    if (side === 'single') return { x: 0, y: 0, w: this.SW, h: this.SH };
    return { x: side === 'left' ? 0 : this.SW / 2, y: 0, w: this.SW / 2, h: this.SH };
  }
  next() { if (this.mode === 'paged') return this.app.pager.go('next'); this.fa.win.scrollBy({ top: this.SH * 0.85, behavior: 'smooth' }); return Promise.resolve(true); }
  prev() { if (this.mode === 'paged') return this.app.pager.go('prev'); this.fa.win.scrollBy({ top: -this.SH * 0.85, behavior: 'smooth' }); return Promise.resolve(true); }
  onEdge(dir) { this.app.edge(dir); }
  onScroll() {
    const fr = this.fa;
    if (!fr.ready || this.mode !== 'scroll') return;
    this.pos = { ch: fr.ch, off: this.topOffset(fr) };
    this.app.onPos();
  }
  onTap(pt, e) {
    const t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
    if (t && t.closest) {
      const nav = t.closest('[data-bl-nav]');
      if (nav) { const d = +nav.dataset.blNav; this.goto({ ch: this.fa.ch + d, off: 0 }); return; }
      const a = t.closest('a[href]');
      if (a) { this.follow(a.getAttribute('href')); return; }
      const m = t.closest('mark.bl-hl');
      if (m) { this.app.editHighlight(m.dataset.hid); return; }
    }
    if (this.hasSelection()) return;
    this.app.zoneTap(pt.x / this.SW, e);
  }
  follow(href) {
    if (!href) return;
    if (href[0] === '#') { this.goto({ ch: this.fa.ch, frag: decodeURIComponent(href.slice(1)) }); return; }
    const r = this.book.resolve(this.fa.ch, href);
    if (!r) return;
    if (r.external) this.app.openExternal(r.external); else this.goto(r);
  }

  /* ----- สถานะ ----- */
  getPos() { return { ch: this.pos.ch, off: this.pos.off }; }
  frac() { const f = this.fa; return f.len ? clamp(this.pos.off / f.len, 0, 1) : 0; }
  sliderValue() { return this.total ? (this.cum[this.pos.ch] + this.book.weights[this.pos.ch] * this.frac()) / this.total : 0; }
  progress() {
    const f = this.fa;
    if (this.pos.ch === this.count - 1 && (this.mode === 'paged' ? f.page >= f.pages - 1 : f.win && f.win.scrollY + this.SH >= f.doc.documentElement.scrollHeight - 8)) return 1;
    return this.sliderValue();
  }
  chapterLabel(ch) {
    let lab = '';
    for (const t of this.book.toc) { if (t.ch <= ch) lab = t.label; else break; }
    return lab || 'ส่วนที่ ' + (ch + 1);
  }
  label() {
    const f = this.fa, pct = Math.round(this.progress() * 100);
    return (this.mode === 'paged' ? `หน้า ${f.page + 1}/${f.pages} ของบท · ` : '') + `บท ${this.pos.ch + 1}/${this.count} · ${pct}%`;
  }
  seek(fr) {
    const x = clamp(fr, 0, 1) * this.total;
    let ch = 0;
    while (ch + 1 < this.count && this.cum[ch + 1] <= x) ch++;
    return this.goto({ ch, frac: (x - this.cum[ch]) / this.book.weights[ch] });
  }
  bookmarkPos() { return { ch: this.pos.ch, off: this.pos.off }; }
  bookmarkLabel() { return (this.fa.text || '').slice(this.pos.off, this.pos.off + 60).replace(/\s+/g, ' ').trim() || this.chapterLabel(this.pos.ch); }
  isBookmarked(b) {
    const f = this.fa;
    if (b.pos.ch !== f.ch || !f.ready) return false;
    return this.mode === 'paged' ? this.pageOf(f, b.pos.off) === f.page : Math.abs(b.pos.off - this.pos.off) < 400;
  }
  gotoBookmark(b) { return this.goto(b.pos); }

  /* ----- เลือกข้อความ / ไฮไลต์ ----- */
  onSel(fr) {
    if (fr !== this.fa || !fr.ready) return;
    const s = fr.win.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) { this.sel = null; this.app.selChanged(null); return; }
    const r = s.getRangeAt(0);
    const a = this.pointOffset(fr, r.startContainer, r.startOffset), b = this.pointOffset(fr, r.endContainer, r.endOffset);
    if (b <= a) { this.sel = null; this.app.selChanged(null); return; }
    this.sel = { ch: fr.ch, s: a, e: b, text: fr.text.slice(a, b) };
    this.app.selChanged(this.sel);
  }
  clearSelection() { try { this.fa.win.getSelection().removeAllRanges(); } catch { /* ไม่มี */ } this.sel = null; }
  frames(ch) { return [this.fa, this.fb].filter((f) => f.ch === ch && f.doc); }
  wrapRange(fr, hl) {
    const [i0] = this.locate(fr, hl.s);
    if (i0 < 0) return;
    const list = [];
    for (let i = i0; i < fr.nodes.length && fr.starts[i] < hl.e; i++) list.push([fr.nodes[i], fr.starts[i]]);
    for (const [node, ns] of list) {
      const a = Math.max(hl.s, ns) - ns, b = Math.min(hl.e, ns + node.data.length) - ns;
      if (a >= b || !node.data.slice(a, b).trim()) continue;
      const r = fr.doc.createRange(); r.setStart(node, a); r.setEnd(node, b);
      const m = fr.doc.createElement('mark');
      m.className = `bl-hl bl-${hl.color}${hl.note ? ' bl-n' : ''}`; m.dataset.hid = hl.id;
      try { r.surroundContents(m); } catch { /* ข้ามช่วงที่ครอบไม่ได้ */ }
    }
    this.index(fr);
  }
  unwrap(fr, id) {
    for (const m of fr.doc.querySelectorAll(`mark.bl-hl[data-hid="${id}"]`)) { const p = m.parentNode; m.replaceWith(...m.childNodes); p.normalize(); }
    this.index(fr);
  }
  addHighlight(color, note = '') {
    const s = this.sel;
    if (!s) return null;
    const hl = { id: uid(), ch: s.ch, s: s.s, e: s.e, color, note, text: s.text.slice(0, 400), t: Date.now() };
    this.meta.highlights.push(hl);
    this.clearSelection();
    for (const f of this.frames(hl.ch)) this.wrapRange(f, hl);
    this.app.saveSoon();
    return hl;
  }
  updateHighlight(hl) { for (const f of this.frames(hl.ch)) { this.unwrap(f, hl.id); this.wrapRange(f, hl); } this.app.saveSoon(); }
  removeHighlight(id) {
    const i = this.meta.highlights.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [hl] = this.meta.highlights.splice(i, 1);
    for (const f of this.frames(hl.ch)) this.unwrap(f, id);
    this.app.saveSoon();
  }
  mark(name, s, e) { // ไฮไลต์ชั่วคราว (ผลค้นหา / ประโยคที่กำลังอ่านออกเสียง) ไม่แตะ DOM
    const fr = this.fa, H = fr.win && fr.win.Highlight, reg = fr.win && fr.win.CSS && fr.win.CSS.highlights;
    if (!H || !reg) return;
    if (s == null) { reg.delete(name); return; }
    const r = this.rangeOf(fr, s, e);
    if (r) reg.set(name, new H(r));
  }
  async gotoFlash(ch, off, len) {
    await this.goto({ ch, off });
    this.mark('bl-flash', off, off + len);
    setTimeout(() => this.mark('bl-flash', null), 5000);
  }

  /* ----- อ่านออกเสียง / ค้นหา ----- */
  async ttsText() { return { text: (this.fa.text || '').slice(this.pos.off), base: this.pos.off }; }
  ttsMark(s, e) {
    const fr = this.fa;
    if (s == null) { this.mark('bl-tts', null); return; }
    if (this.mode === 'paged') {
      const p = this.pageOf(fr, s);
      if (p !== fr.page) { this.setPage(fr, p); this.pos = { ch: fr.ch, off: this.offsetOfPage(fr, p) }; this.app.onPos(); }
    } else {
      const r = this.rectAt(fr, s);
      if (r && (r.top < 0 || r.bottom > this.SH - 40)) fr.win.scrollTo({ top: r.top + fr.win.scrollY - this.SH * 0.25, behavior: 'smooth' });
    }
    this.mark('bl-tts', s, e);
  }
  async ttsAdvance() {
    if (this.fa.ch + 1 >= this.count) return false;
    await this.goto({ ch: this.fa.ch + 1, off: 0 });
    return true;
  }
  async *search(q) {
    const needle = q.toLowerCase();
    for (let ch = 0; ch < this.count; ch++) {
      const t = await this.book.text(ch), low = t.toLowerCase();
      let at = low.indexOf(needle), n = 0;
      while (at >= 0 && n < 25) {
        const a = Math.max(0, at - 30), pos = at;
        yield { label: this.chapterLabel(ch), snippet: t.slice(a, at + needle.length + 50).replace(/\s+/g, ' '), at: [at - a, needle.length], go: () => this.gotoFlash(ch, pos, needle.length) };
        at = low.indexOf(needle, at + needle.length); n++;
      }
      yield null;
    }
  }
}
