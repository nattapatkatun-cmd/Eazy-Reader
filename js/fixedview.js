// ตัวอ่านแบบหน้าคงที่: PDF, รูปภาพ, การ์ตูน (ปัดซ้ายขวา / เลื่อนลง / สองหน้าคู่ / ขวาไปซ้าย)
import { h, clamp, ask } from './util.js';
import { toBase, rotCtx, drawAnnots, hitAnnot } from './pdfedit.js';

export class FixedView {
  kind = 'fixed';
  mouseDrag = true;
  constructor(app, meta, src) {
    this.app = app; this.meta = meta; this.src = src;
    this.stage = app.stage; this.front = app.layerA; this.back = app.layerB; this.scroller = app.scroller;
    this.pos = 0; this.annot = null; this.undo = [];
    this.lastTap = { t: 0, x: 0, y: 0 };
    this.onScroll = this.onScroll.bind(this);
  }
  get isPdf() { return this.src.kind === 'pdf'; }
  get count() { return this.src.count; }
  get dir() { return this.meta.view.dir || 'ltr'; }
  get mode() { return this.meta.view.mode || 'paged'; }
  get tapOnly() { return this.mode === 'scroll'; }
  get zoomable() { return this.mode === 'paged'; }
  get paper() { return this.app.S.invert && this.app.dark ? '#2a2a2c' : '#f4f0e6'; }

  async open(pos) {
    this.front.classList.add('front'); this.back.classList.remove('front');
    this.pos = clamp(typeof pos === 'number' ? pos : 0, 0, Math.max(0, this.count - 1));
    await this.relayout();
  }
  destroy() {
    this.io && this.io.disconnect();
    this.scroller.removeEventListener('scroll', this.onScroll);
    this.scroller.replaceChildren(); this.front.replaceChildren(); this.back.replaceChildren();
    this.src.destroy();
  }
  measure() {
    this.SW = this.stage.clientWidth; this.SH = this.stage.clientHeight;
    const sp = this.meta.view.spread || 'auto';
    this.two = this.mode === 'paged' && this.count > 1 && (sp === 'two' || (sp === 'auto' && this.SW >= 600 && this.SW / this.SH >= 0.8));
  }
  spreadOf(i) {
    if (!this.two) return [i];
    if (i === 0) return [0];
    const s = i % 2 === 1 ? i : i - 1;
    return s + 1 < this.count ? [s, s + 1] : [s];
  }
  firstOf(i) { return this.spreadOf(clamp(i, 0, this.count - 1))[0]; }
  target(dir) {
    const sp = this.spreadOf(this.pos);
    if (dir === 'next') { const n = sp[sp.length - 1] + 1; return n < this.count ? n : -1; }
    return sp[0] > 0 ? this.firstOf(sp[0] - 1) : -1;
  }
  canGo(dir) { return this.mode === 'paged' && this.target(dir) >= 0; }

  async relayout() {
    this.pos = clamp(this.pos, 0, Math.max(0, this.count - 1));
    this.measure();
    this.app.pager.resize();
    this.stage.classList.toggle('scrollmode', this.mode === 'scroll');
    this.io && this.io.disconnect(); this.io = null;
    this.scroller.removeEventListener('scroll', this.onScroll);
    if (this.mode === 'scroll') {
      this.front.replaceChildren(); this.back.replaceChildren();
      await this.buildScroll();
    } else {
      this.scroller.replaceChildren();
      this.pos = this.firstOf(this.pos);
      await this.fill(this.front, this.pos);
      this.warm();
    }
    this.app.onPos();
  }

  /* ----- โหมดปัดหน้า ----- */
  async fill(layer, start) {
    const pages = this.spreadOf(start);
    const tok = layer._tok = (layer._tok || 0) + 1;
    const slotW = this.two ? this.SW / 2 : this.SW;
    const els = await Promise.all(pages.map((i) => this.src.render(i, slotW, this.SH, 1)));
    if (layer._tok !== tok) return false;
    const ltr = this.dir !== 'rtl';
    const spread = h('div', { class: 'spread' });
    layer._pages = pages.map((i, k) => {
      const el = els[k], sc = Math.min(slotW / el._w, this.SH / el._h), w = el._w * sc, hh = el._h * sc;
      let side = 'single';
      if (this.two) side = i === 0 ? (ltr ? 'right' : 'left') : (k === 0) === ltr ? 'left' : 'right';
      const x = side === 'single' ? (this.SW - w) / 2 : side === 'left' ? this.SW / 2 - w : this.SW / 2, y = (this.SH - hh) / 2;
      const pg = h('div', { class: 'pg', style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' } });
      pg.append(el); pg._i = i; pg._w = w; pg._h = hh;
      spread.append(pg);
      this.overlay(pg);
      return { i, side, x, y, w, h: hh, pg };
    });
    layer.replaceChildren(spread);
    return true;
  }
  warm() { // เตรียมหน้าข้างเคียงไว้ล่วงหน้าให้พลิกได้ทันที
    const slotW = this.two ? this.SW / 2 : this.SW;
    for (const d of ['next', 'prev']) {
      const t = this.target(d);
      if (t >= 0) for (const i of this.spreadOf(t)) this.src.render(i, slotW, this.SH, 1).catch(() => {});
    }
  }
  pageRect(layer, side) {
    const p = (layer._pages || []).find((q) => q.side === side);
    if (p) return { x: p.x, y: p.y, w: p.w, h: p.h };
    if (side === 'single') return { x: 0, y: 0, w: this.SW, h: this.SH };
    return { x: side === 'left' ? 0 : this.SW / 2, y: 0, w: this.SW / 2, h: this.SH };
  }
  async prepare(dir) {
    const t = this.target(dir);
    if (t < 0) return false;
    this.pending = t;
    return this.fill(this.back, t);
  }
  commit() {
    const f = this.front; this.front = this.back; this.back = f;
    this.front.classList.add('front'); this.back.classList.remove('front');
    this.pos = this.pending;
    if (this.annot) this.front.classList.add('annotating');
    this.back.classList.remove('annotating');
    this.app.onPos();
    this.warm();
  }
  abort() { this.pending = null; }
  zoomEl() { return this.front.firstElementChild; }
  onZoomEnd(s) {
    if (!this.isPdf || s < 1.3) return;
    const slotW = this.two ? this.SW / 2 : this.SW, q = Math.min(3, Math.ceil(s * 2) / 2);
    for (const p of this.front._pages || []) {
      this.src.render(p.i, slotW, this.SH, q).then((c) => {
        if (p.pg.isConnected && this.app.pager.z.s >= 1.3 && p.pg.firstElementChild !== c) p.pg.firstElementChild.replaceWith(c);
      }).catch(() => {});
    }
  }
  next() { return this.mode === 'paged' ? this.app.pager.go('next') : this.scrollBy(1); }
  prev() { return this.mode === 'paged' ? this.app.pager.go('prev') : this.scrollBy(-1); }
  scrollBy(d) { this.scroller.scrollBy({ top: d * this.SH * 0.85, behavior: 'smooth' }); return Promise.resolve(true); }
  async goto(i) {
    this.app.pager.abortAll();
    this.pos = clamp(i | 0, 0, this.count - 1);
    if (this.mode === 'scroll') { const it = this.items[this.pos]; if (it) this.scroller.scrollTop = it.offsetTop; }
    else { this.pos = this.firstOf(this.pos); await this.fill(this.front, this.pos); this.app.pager.resetZoom(); this.warm(); }
    this.app.onPos();
  }

  /* ----- โหมดเลื่อนลง ----- */
  async buildScroll() {
    let ar = 0.7;
    try { const s = await this.src.size(this.pos); ar = s.w / s.h; } catch { /* ใช้ค่าเริ่มต้น */ }
    const w = Math.min(this.SW, 1100);
    this.items = [];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < this.count; i++) {
      const it = h('div', { class: 'sp', style: { width: w + 'px', aspectRatio: String(ar) } });
      it._i = i; this.items.push(it); frag.append(it);
    }
    this.scroller.replaceChildren(frag);
    this.io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        const it = e.target;
        if (e.isIntersecting) this.loadItem(it, w); else if (it._el) { it._el = null; it.replaceChildren(); }
      }
    }, { root: this.scroller, rootMargin: '120% 0px' });
    this.items.forEach((it) => this.io.observe(it));
    const cur = this.items[this.pos];
    if (cur) this.scroller.scrollTop = cur.offsetTop;
    this.scroller.addEventListener('scroll', this.onScroll, { passive: true });
  }
  async loadItem(it, w) {
    if (it._el) return;
    it._el = true;
    try {
      const el = await this.src.render(it._i, w, 1e6, 1);
      if (!it._el) return;
      const anchor = this.items[this.pos], before = anchor ? anchor.offsetTop : 0;
      it.style.aspectRatio = String(el._w / el._h);
      const pg = h('div', { class: 'pg flow' }); pg.append(el); pg._i = it._i;
      it.replaceChildren(pg); it._el = el;
      this.overlay(pg);
      // กันหน้ากระโดดเมื่อรูปด้านบนโหลดเสร็จแล้วสัดส่วนเปลี่ยน
      if (anchor && it._i < this.pos) this.scroller.scrollTop += anchor.offsetTop - before;
    } catch { it._el = null; }
  }
  onScroll() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const y = this.scroller.scrollTop + this.SH * 0.35;
      let i = this.pos;
      while (i > 0 && this.items[i].offsetTop > y) i--;
      while (i < this.count - 1 && this.items[i + 1].offsetTop <= y) i++;
      if (this.scroller.scrollTop + this.SH >= this.scroller.scrollHeight - 4) i = this.count - 1;
      if (i !== this.pos) { this.pos = i; this.src.cur = i; this.app.onPos(); }
    });
  }

  /* ----- สถานะ ----- */
  getPos() { return this.pos; }
  lastShown() { const sp = this.mode === 'paged' ? this.spreadOf(this.pos) : [this.pos]; return sp[sp.length - 1]; }
  progress() { return this.count ? (this.lastShown() + 1) / this.count : 0; }
  label() {
    const sp = this.mode === 'paged' ? this.spreadOf(this.pos) : [this.pos];
    return (sp.length > 1 ? `${sp[0] + 1}–${sp[1] + 1}` : `${sp[0] + 1}`) + ` / ${this.count}`;
  }
  seek(fr) { return this.goto(Math.round(fr * (this.count - 1))); }
  sliderValue() { return this.count > 1 ? this.pos / (this.count - 1) : 0; }
  bookmarkPos() { return { p: this.pos, s: this.isPdf ? this.src.order[this.pos].s : undefined }; }
  bookmarkIndex(b) { if (this.isPdf && b.pos.s != null) { const i = this.src.order.findIndex((o) => o.s === b.pos.s); return i; } return b.pos.p; }
  isBookmarked(b) { const i = this.bookmarkIndex(b); const sp = this.mode === 'paged' ? this.spreadOf(this.pos) : [this.pos]; return sp.includes(i); }
  bookmarkLabel() { return 'หน้า ' + (this.pos + 1); }
  gotoBookmark(b) { const i = this.bookmarkIndex(b); if (i >= 0) return this.goto(i); }

  onTap(pt, e) {
    const now = performance.now(), lt = this.lastTap;
    const fx = pt.x / this.SW;
    if (this.mode === 'paged' && fx > 0.3 && fx < 0.7 && now - lt.t < 320 && Math.hypot(pt.x - lt.x, pt.y - lt.y) < 40) {
      this.lastTap = { t: 0, x: 0, y: 0 };
      this.app.pager.zoomAt(pt, this.app.pager.z.s > 1.02 ? 1 : 2.4);
      this.app.toggleUI();
      return;
    }
    this.lastTap = { t: now, x: pt.x, y: pt.y };
    this.app.zoneTap(fx, e);
  }
  onEdge(dir) { this.app.edge(dir); }

  /* ----- อ่านออกเสียง / ค้นหา (เฉพาะ PDF ที่มีข้อความ) ----- */
  async ttsText() {
    if (!this.isPdf) return null;
    const sp = this.mode === 'paged' ? this.spreadOf(this.pos) : [this.pos];
    let t = '';
    for (const i of sp) t += (await this.src.text(i)) + '\n';
    return { text: t, base: 0 };
  }
  ttsMark() {}
  async ttsAdvance() {
    const sp = this.mode === 'paged' ? this.spreadOf(this.pos) : [this.pos];
    const n = sp[sp.length - 1] + 1;
    if (n >= this.count) return false;
    await this.goto(n);
    return true;
  }
  async *search(q) {
    if (!this.isPdf) return;
    const needle = q.toLowerCase();
    for (let i = 0; i < this.count; i++) {
      const t = (await this.src.text(i)).replace(/\s+/g, ' ');
      const low = t.toLowerCase();
      let at = low.indexOf(needle), n = 0;
      while (at >= 0 && n < 3) {
        yield { label: 'หน้า ' + (i + 1), snippet: t.slice(Math.max(0, at - 30), at + needle.length + 50), at: [Math.min(30, at), needle.length], go: () => this.goto(i) };
        at = low.indexOf(needle, at + needle.length); n++;
      }
      yield null; // ให้ UI ได้อัปเดตความคืบหน้า
    }
  }

  /* ----- ขีดเขียนบน PDF ----- */
  annotsOf(src) { const a = this.meta.pdf.annots; return a[src] || (a[src] = []); }
  overlay(pg) {
    if (!this.isPdf) return;
    const o = this.src.order[pg._i];
    const list = this.meta.pdf.annots[o.s];
    if (!this.annot && !(list && list.length)) return;
    let c = pg.querySelector('canvas.ann');
    if (!c) {
      c = h('canvas', { class: 'ann' });
      pg.append(c);
      c.addEventListener('pointerdown', (e) => this.annDown(e, pg, c));
      c.addEventListener('pointermove', (e) => this.annMove(e, pg, c));
      const end = (e) => this.annUp(e, pg, c);
      c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    }
    this.drawOverlay(pg, c);
  }
  drawOverlay(pg, c, live) {
    const o = this.src.order[pg._i];
    const w = pg._w || pg.offsetWidth, hh = pg._h || pg.offsetHeight, k = Math.min(window.devicePixelRatio || 1, 2.5);
    if (c.width !== Math.round(w * k) || c.height !== Math.round(hh * k)) { c.width = Math.round(w * k); c.height = Math.round(hh * k); }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const sw = o.r === 90 || o.r === 270, Wb = sw ? hh : w, Hb = sw ? w : hh;
    rotCtx(ctx, o.r, Wb, Hb);
    drawAnnots(ctx, live ? [...(this.meta.pdf.annots[o.s] || []), live] : this.meta.pdf.annots[o.s], Wb, Hb);
  }
  refreshOverlays() {
    for (const pg of this.stage.querySelectorAll('.pg')) {
      const c = pg.querySelector('canvas.ann');
      if (c) this.drawOverlay(pg, c); else this.overlay(pg);
    }
  }
  async setAnnotate(tool) { // tool = null เพื่อออกจากโหมด
    if (tool && this.mode !== 'paged') { this.meta.view.mode = 'paged'; await this.relayout(); }
    this.annot = tool;
    this.app.pager.enabled = !tool;
    this.front.classList.toggle('annotating', !!tool);
    this.refreshOverlays();
  }
  annPoint(e, pg, c) {
    const r = c.getBoundingClientRect(), o = this.src.order[pg._i];
    const [x, y] = toBase(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1), o.r);
    const sw = o.r === 90 || o.r === 270;
    return { x, y, o, aspect: sw ? r.height / r.width : r.width / r.height };
  }
  async annDown(e, pg, c) {
    const t = this.annot;
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const p = this.annPoint(e, pg, c), list = this.annotsOf(p.o.s);
    if (t.tool === 'text') {
      const text = await ask('ข้อความที่จะใส่บนหน้า', { multiline: true });
      if (text && text.trim()) { list.push({ t: 'text', x: p.x, y: p.y, s: t.size * 0.02 + 0.012, c: t.color, text: text.trim() }); this.undo.push(p.o.s); this.changed(pg, c); }
      return;
    }
    if (t.tool === 'eraser') { this.erase(p, list, pg, c); this.stroke = { erase: true, id: e.pointerId }; }
    else {
      const hl = t.tool === 'hl';
      this.stroke = { id: e.pointerId, a: { t: 'ink', c: t.color, a: hl ? 0.38 : 1, w: hl ? 0.012 + t.size * 0.008 : 0.0016 + t.size * 0.0018, pts: [p.x, p.y] } };
    }
    try { c.setPointerCapture(e.pointerId); } catch { /* ไม่รองรับ */ }
  }
  annMove(e, pg, c) {
    const s = this.stroke;
    if (!s || s.id !== e.pointerId) return;
    e.preventDefault();
    const p = this.annPoint(e, pg, c);
    if (s.erase) { this.erase(p, this.annotsOf(p.o.s), pg, c); return; }
    const n = s.a.pts.length;
    if (Math.hypot(p.x - s.a.pts[n - 2], p.y - s.a.pts[n - 1]) < 0.0015) return;
    s.a.pts.push(+p.x.toFixed(4), +p.y.toFixed(4));
    this.drawOverlay(pg, c, s.a);
  }
  annUp(e, pg, c) {
    const s = this.stroke;
    if (!s || s.id !== e.pointerId) return;
    this.stroke = null;
    if (s.erase) return;
    const o = this.src.order[pg._i];
    this.annotsOf(o.s).push(s.a); this.undo.push(o.s);
    this.changed(pg, c);
  }
  erase(p, list, pg, c) {
    const i = hitAnnot(list, p.x, p.y, p.aspect);
    if (i >= 0) { list.splice(i, 1); this.changed(pg, c); }
  }
  changed(pg, c) { this.drawOverlay(pg, c); this.src.kind === 'pdf' && this.app.saveSoon(); }
  undoAnnot() {
    const s = this.undo.pop();
    if (s == null) return false;
    const list = this.meta.pdf.annots[s];
    if (list && list.length) { list.pop(); this.refreshOverlays(); this.app.saveSoon(); }
    return true;
  }
}
