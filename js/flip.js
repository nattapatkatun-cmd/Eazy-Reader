// ตัวจัดการท่าทางนิ้ว + เอฟเฟกต์พลิกหน้า (ม้วนกระดาษตามนิ้ว / เลื่อน / ไม่มี)
import { clamp } from './util.js';

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function clipHalf(poly, M, n) { // เก็บส่วนที่อยู่ฝั่ง n ของเส้นพับ
  const out = [];
  const side = (p) => (p[0] - M[0]) * n[0] + (p[1] - M[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

export class Pager {
  constructor(stage, canvas, opts) {
    this.stage = stage; this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.opts = opts; // { effect(): 'curl'|'slide'|'none' }
    this.ptrs = new Map(); this.g = null; this.f = null; this.view = null;
    this.z = { s: 1, x: 0, y: 0 };
    this.enabled = true;
    this.resize();
  }
  setView(v) { this.abortAll(); this.view = v; this.resetZoom(); }
  resize() {
    this.SW = this.stage.clientWidth; this.SH = this.stage.clientHeight;
    this.k = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width = Math.max(1, Math.round(this.SW * this.k)); this.cv.height = Math.max(1, Math.round(this.SH * this.k));
    this.resetZoom();
  }
  get busy() { return !!this.f; }

  /* ----- ต่อสายอีเวนต์เข้ากับพื้นที่อ่าน (stage หรือเอกสารใน iframe) ----- */
  attach(target, map) {
    const on = (t, fn) => target.addEventListener(t, fn, { passive: false });
    on('pointerdown', (e) => this.down(e, map(e), target));
    on('pointermove', (e) => this.move(e, map(e)));
    on('pointerup', (e) => this.up(e, map(e), false));
    on('pointercancel', (e) => this.up(e, map(e), true));
  }
  down(e, pt, target) {
    if (!this.view || !this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.ptrs.set(e.pointerId, pt);
    if (target.setPointerCapture && e.pointerType !== 'mouse') { try { target.setPointerCapture(e.pointerId); } catch { /* ไม่รองรับ */ } }
    if (this.ptrs.size === 2 && this.view.zoomable) {
      if (this.g && this.g.type === 'flip') this.release(true);
      const [a, b] = [...this.ptrs.values()];
      this.g = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: this.z.s, x0: this.z.x, y0: this.z.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    } else if (this.ptrs.size === 1) {
      this.g = { type: 'pending', id: e.pointerId, sx: pt.x, sy: pt.y, x: pt.x, y: pt.y, t: performance.now(), mouse: e.pointerType === 'mouse', trail: [] };
    }
  }
  move(e, pt) {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.set(e.pointerId, pt);
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch') {
      if (this.ptrs.size < 2) return;
      const [a, b] = [...this.ptrs.values()];
      const s = clamp(g.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0), 1, 6);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.z.x = cx - (g.cx - g.x0) * (s / g.s0); this.z.y = cy - (g.cy - g.y0) * (s / g.s0); this.z.s = s;
      this.applyZoom(); e.preventDefault();
      return;
    }
    if (g.id !== e.pointerId) return;
    const dx = pt.x - g.sx, dy = pt.y - g.sy;
    g.x = pt.x; g.y = pt.y;
    g.trail.push({ x: pt.x, t: performance.now() }); if (g.trail.length > 6) g.trail.shift();
    if (g.type === 'pending' && Math.hypot(dx, dy) > 9) {
      const v = this.view;
      if (this.z.s > 1.02) { g.type = 'pan'; g.x0 = this.z.x; g.y0 = this.z.y; }
      else if (v.tapOnly || (g.mouse && !v.mouseDrag) || (v.hasSelection && v.hasSelection())) g.type = 'ignore';
      else if (Math.abs(dx) > Math.abs(dy) * 0.8) {
        g.type = 'flip';
        const ltr = v.dir !== 'rtl';
        this.start((dx < 0) === ltr ? 'next' : 'prev', g);
      } else g.type = 'ignore';
    }
    if (g.type === 'pan') { this.z.x = g.x0 + dx; this.z.y = g.y0 + dy; this.applyZoom(); e.preventDefault(); }
    else if (g.type === 'flip') { e.preventDefault(); if (this.f && this.f.ready && !this.f.anim) this.paintFromPointer(); }
  }
  up(e, pt, cancelled) {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch') {
      if (this.z.s < 1.06) this.resetZoom(); else this.view.onZoomEnd && this.view.onZoomEnd(this.z.s);
      this.g = this.ptrs.size ? { type: 'ignore', id: -1 } : null;
      return;
    }
    if (g.id !== e.pointerId) return;
    this.g = null;
    if (g.type === 'pending' && !cancelled && performance.now() - g.t < 550) this.view.onTap(pt, e);
    else if (g.type === 'flip') this.release(cancelled);
  }

  /* ----- ซูม (เฉพาะหน้าแบบรูป/PDF) ----- */
  applyZoom() {
    const z = this.z, el = this.view && this.view.zoomEl && this.view.zoomEl();
    if (z.s <= 1) { z.s = 1; z.x = 0; z.y = 0; }
    z.x = clamp(z.x, this.SW - this.SW * z.s, 0); z.y = clamp(z.y, this.SH - this.SH * z.s, 0);
    if (el) { el.style.transformOrigin = '0 0'; el.style.transform = z.s === 1 ? '' : `translate(${z.x}px,${z.y}px) scale(${z.s})`; }
  }
  resetZoom() { this.z = { s: 1, x: 0, y: 0 }; if (this.view) this.applyZoom(); }
  zoomAt(pt, s) {
    const z = this.z;
    if (s <= 1) { this.resetZoom(); return; }
    z.x = pt.x - (pt.x - z.x) * (s / z.s); z.y = pt.y - (pt.y - z.y) * (s / z.s); z.s = s;
    this.applyZoom();
    this.view.onZoomEnd && this.view.onZoomEnd(s);
  }

  /* ----- พลิกหน้า ----- */
  go(dir) { return this.start(dir, null); }
  async start(dir, g) {
    const v = this.view;
    if (!v || !this.enabled) return false;
    if (this.f) this.finishNow();
    if (!v.canGo(dir)) { if (g) g.type = 'ignore'; v.onEdge && v.onEdge(dir); return false; }
    this.resetZoom();
    const f = this.f = { dir, g, ready: false, released: false };
    let ok = false;
    try { ok = await v.prepare(dir); } catch (err) { console.error(err); }
    if (this.f !== f) return false;
    if (!ok) { this.f = null; if (g) g.type = 'ignore'; return false; }
    const ltr = v.dir !== 'rtl', two = !!v.two, nextMirror = !ltr;
    if (dir === 'next') { f.reverse = false; f.mirror = nextMirror; }
    else if (two) { f.reverse = false; f.mirror = !nextMirror; }
    else { f.reverse = true; f.mirror = nextMirror; }
    f.top = f.reverse ? v.back : v.front;
    f.rect = v.pageRect(f.reverse ? v.back : v.front, two ? (f.mirror ? 'left' : 'right') : 'single');
    f.effect = this.opts.effect();
    f.cy = f.rect.h; f.tp = f.reverse ? 1 : 0; f.tilt = 0;
    this.cv.classList.remove('fade'); this.cv.style.display = 'block';
    this.paint(f);
    if (f.reverse) f.top.style.zIndex = '3';
    f.ready = true;
    if (f.effect === 'none') { f.tp = f.reverse ? 0 : 1; this.finish(true); return true; }
    if (g && g.type === 'flip' && !f.released) {
      const ly = g.sy - f.rect.y;
      f.cy = ly > f.rect.h / 2 ? f.rect.h : 0;
      this.paintFromPointer();
      return true;
    }
    return this.animate(f, true, !g);
  }
  localX(f, x) { return f.mirror ? f.rect.x + f.rect.w - x : x - f.rect.x; }
  paintFromPointer() {
    const f = this.f, g = f.g, W = f.rect.w;
    const d = this.localX(f, g.sx) - this.localX(f, g.x); // ระยะที่ลากไปทาง "พลิกออก"
    f.tp = f.reverse ? 1 - clamp((-d * 1.15) / W, 0, 1) : clamp((d * 1.15) / W, 0, 1);
    f.tilt = clamp((g.y - g.sy) * 0.6, -f.rect.h * 0.5, f.rect.h * 0.5);
    this.paint(f);
  }
  release(cancelled) {
    const f = this.f;
    if (!f) return;
    if (!f.ready) { f.released = true; f.g = null; if (cancelled) { this.f = null; this.view.abort(); } return; }
    if (f.anim) return;
    const g = f.g; let vel = 0;
    if (g && g.trail.length > 1) {
      const a = g.trail[0], b = g.trail[g.trail.length - 1];
      vel = (this.localX(f, a.x) - this.localX(f, b.x)) / Math.max(1, b.t - a.t); // + = ไปทางพลิกออก
    }
    const q = f.reverse ? 1 - f.tp : f.tp;
    const v = f.reverse ? -vel : vel;
    const complete = !cancelled && (q > 0.33 || (v > 0.35 && q > 0.04)) && !(v < -0.35);
    this.animate(f, complete, false);
  }
  animate(f, complete, auto) {
    return new Promise((res) => {
      const from = f.tp, to = complete ? (f.reverse ? 0 : 1) : (f.reverse ? 1 : 0);
      const tilt0 = f.tilt, dist = Math.abs(to - from);
      const dur = f.effect === 'slide' ? 120 + 200 * dist : auto ? 520 : 170 + 300 * dist;
      const t0 = performance.now();
      const step = (now) => {
        const u = clamp((now - t0) / dur, 0, 1);
        const e = auto ? ease(u) : easeOut(u);
        f.tp = from + (to - from) * e;
        f.tilt = auto ? -Math.sin(Math.PI * Math.min(1, f.reverse ? 1 - f.tp : f.tp)) * f.rect.h * 0.16 * (f.reverse ? 0.7 : 1) : tilt0 * (1 - e);
        this.paint(f);
        if (u < 1) f.anim.raf = requestAnimationFrame(step);
        else { f.anim = null; this.finish(complete); res(complete); }
      };
      f.anim = { raf: requestAnimationFrame(step), end: () => { f.tp = to; f.tilt = 0; f.anim = null; this.finish(complete); res(complete); } };
    });
  }
  finishNow() {
    const f = this.f;
    if (!f) return;
    if (f.anim) { cancelAnimationFrame(f.anim.raf); f.anim.end(); }
    else if (f.ready) { f.tp = f.reverse ? 1 : 0; this.finish(false); }
    else { this.f = null; this.view.abort(); }
  }
  abortAll() { this.ptrs.clear(); this.g = null; if (this.f) this.finishNow(); }
  finish(complete) {
    const f = this.f, v = this.view;
    this.f = null;
    if (complete) v.commit(f.dir); else v.abort();
    f.top.style.zIndex = ''; f.top.style.clipPath = ''; f.top.style.webkitClipPath = ''; f.top.style.transform = ''; f.top.classList.remove('sliding');
    if (v.two && complete && f.effect === 'curl') {
      this.cv.classList.add('fade');
      setTimeout(() => { if (!this.f) { this.clear(); this.cv.classList.remove('fade'); this.cv.style.display = 'none'; } }, 140);
    } else { this.clear(); this.cv.style.display = 'none'; }
  }
  clear() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.cv.width, this.cv.height); }

  paint(f) {
    if (f.effect === 'slide') {
      f.top.classList.add('sliding');
      f.top.style.transform = `translate3d(${(f.mirror ? 1 : -1) * f.tp * (this.SW + 24)}px,0,0)`;
      return;
    }
    if (f.effect !== 'curl') return;
    const { rect, mirror } = f, W = rect.w, H = rect.h, cy = f.cy;
    const setClip = (v) => { f.top.style.clipPath = v; f.top.style.webkitClipPath = v; };
    this.clear();
    let P = [W - f.tp * 2 * W, cy + (f.tp > 0.999 || f.tp < 0.001 ? 0 : f.tilt)];
    // มุมกระดาษห้ามหลุดจากสันหนังสือ
    const lim = (S, r) => { const dx = P[0] - S[0], dy = P[1] - S[1], d = Math.hypot(dx, dy); if (d > r) P = [S[0] + (dx * r) / d, S[1] + (dy * r) / d]; };
    lim([0, cy], W); lim([0, H - cy], Math.hypot(W, H));
    const C = [W, cy], n = [C[0] - P[0], C[1] - P[1]], len = Math.hypot(n[0], n[1]);
    if (len < 0.5) { setClip(''); return; }
    const M = [(C[0] + P[0]) / 2, (C[1] + P[1]) / 2];
    const peeled = clipHalf([[0, 0], [W, 0], [W, H], [0, H]], M, n);
    if (peeled.length < 3) { setClip(''); return; }
    const nn = n[0] * n[0] + n[1] * n[1];
    const refl = (p) => { const k = (2 * ((p[0] - M[0]) * n[0] + (p[1] - M[1]) * n[1])) / nn; return [p[0] - k * n[0], p[1] - k * n[1]]; };
    const S = (p) => [mirror ? rect.x + W - p[0] : rect.x + p[0], rect.y + p[1]];
    const pe = peeled.map(S), fl = peeled.map(refl).map(S), Ms = S(M);
    const nh = [(mirror ? -n[0] : n[0]) / len, n[1] / len];
    const px = (p) => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`;
    setClip(`polygon(evenodd, 0px 0px, ${this.SW}px 0px, ${this.SW}px ${this.SH}px, 0px ${this.SH}px, 0px 0px, ${pe.map(px).join(', ')}, ${px(pe[0])}, 0px 0px)`);
    const c = this.ctx, k = this.k;
    c.setTransform(k, 0, 0, k, 0, 0);
    const path = (pts) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); };
    // เงาบนหน้าถัดไปที่โผล่ออกมา
    const sw = clamp(len * 0.3, 14, 90);
    c.save(); path(pe); c.clip();
    let gr = c.createLinearGradient(Ms[0], Ms[1], Ms[0] + nh[0] * sw, Ms[1] + nh[1] * sw);
    gr.addColorStop(0, 'rgba(0,0,0,0.30)'); gr.addColorStop(0.4, 'rgba(0,0,0,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr; c.fillRect(0, 0, this.SW, this.SH); c.restore();
    // ด้านหลังของกระดาษที่ม้วนกลับมา + เงาตกกระทบ
    c.save(); path(fl);
    c.shadowColor = 'rgba(0,0,0,0.38)'; c.shadowBlur = clamp(len * 0.14, 6, 34) * k; c.shadowOffsetX = -nh[0] * 5 * k; c.shadowOffsetY = 3 * k;
    c.fillStyle = this.view.paper || '#f4f0e6'; c.fill(); c.restore();
    c.save(); path(fl); c.clip();
    const fw = len / 2;
    gr = c.createLinearGradient(Ms[0], Ms[1], Ms[0] - nh[0] * fw, Ms[1] - nh[1] * fw);
    gr.addColorStop(0, 'rgba(0,0,0,0.20)'); gr.addColorStop(0.1, 'rgba(0,0,0,0.03)'); gr.addColorStop(0.28, 'rgba(255,255,255,0.20)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.02)'); gr.addColorStop(1, 'rgba(0,0,0,0.13)');
    c.fillStyle = gr; c.fillRect(0, 0, this.SW, this.SH); c.restore();
  }
}
