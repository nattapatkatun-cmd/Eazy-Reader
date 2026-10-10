// ตัวเปิดไฟล์แต่ละรูปแบบ: PDF, รูปภาพ/CBZ/อัลบั้ม, EPUB, TXT/HTML
import { loadScript, natSort, isImageName, mimeOf, esc, extOf, ask } from './util.js';
import { db } from './db.js';

const V = new URL('../vendor/', import.meta.url).href;

let zipP;
export function loadZip() {
  return zipP || (zipP = loadScript(V + 'zip.min.js').then(() => { window.zip.configure({ useWebWorkers: false }); return window.zip; }));
}
let pdfP;
export function loadPdfjs() {
  return pdfP || (pdfP = import(V + 'pdfjs/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = V + 'pdfjs/pdf.worker.min.mjs'; return m; }));
}
let pdfLibP;
export function loadPdfLib() { return pdfLibP || (pdfLibP = loadScript(V + 'pdf-lib.min.js').then(() => window.PDFLib)); }
let arcP;
export function loadArchive() {
  return arcP || (arcP = import(V + 'libarchive/libarchive.js').then((m) => { m.Archive.init({ workerUrl: V + 'libarchive/worker-bundle.js' }); return m.Archive; }));
}

/* ---------- PDF ---------- */
const MOBILE = matchMedia('(pointer: coarse)').matches;
const PX_BUDGET = MOBILE ? 5.5e6 : 12e6;

export class PdfSource {
  kind = 'pdf';
  static async open(blob, meta) {
    const pdfjs = await loadPdfjs();
    const s = new PdfSource();
    const task = pdfjs.getDocument({
      data: await blob.arrayBuffer(), cMapUrl: V + 'pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: V + 'pdfjs/standard_fonts/', wasmUrl: V + 'pdfjs/wasm/', iccUrl: V + 'pdfjs/iccs/', isEvalSupported: false,
    });
    task.onPassword = (cb) => {
      ask('ไฟล์ PDF นี้ตั้งรหัสผ่านไว้', { placeholder: 'รหัสผ่าน' }).then((pw) => { if (pw == null) task.destroy(); else cb(pw); });
    };
    s.doc = await task.promise;
    s.task = task;
    meta.pdf = meta.pdf || {};
    if (!meta.pdf.order || !meta.pdf.order.length || meta.pdf.order.some((o) => o.s >= s.doc.numPages)) {
      meta.pdf.order = Array.from({ length: s.doc.numPages }, (_, i) => ({ s: i, r: 0 }));
    }
    meta.pdf.annots = meta.pdf.annots || {};
    s.meta = meta;
    s.cache = new Map();
    return s;
  }
  get order() { return this.meta.pdf.order; }
  get count() { return this.order.length; }
  async page(i) {
    const o = this.order[i];
    const p = await this.doc.getPage(o.s + 1);
    return { p, rot: (p.rotate + o.r) % 360, o };
  }
  async size(i) {
    const { p, rot } = await this.page(i);
    const v = p.getViewport({ scale: 1, rotation: rot });
    return { w: v.width, h: v.height };
  }
  async render(i, boxW, boxH, q = 1) {
    const o = this.order[i];
    const key = `${o.s}/${o.r}/${Math.round(boxW)}x${Math.round(boxH)}/${q.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); return hit; }
    const pr = (async () => {
      const { p, rot } = await this.page(i);
      const v1 = p.getViewport({ scale: 1, rotation: rot });
      const fit = Math.min(boxW / v1.width, boxH / v1.height);
      let scale = fit * Math.min(window.devicePixelRatio || 1, 3) * q;
      const px = v1.width * v1.height * scale * scale;
      if (px > PX_BUDGET) scale *= Math.sqrt(PX_BUDGET / px);
      const vp = p.getViewport({ scale, rotation: rot });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
      c._w = v1.width; c._h = v1.height; c._src = o.s;
      await p.render({ canvas: c, viewport: vp, background: '#ffffff' }).promise;
      return c;
    })();
    this.cache.set(key, pr);
    pr.catch(() => this.cache.delete(key));
    this.trim();
    return pr;
  }
  trim() {
    const max = MOBILE ? 7 : 12;
    for (const [k, pr] of this.cache) {
      if (this.cache.size <= max) break;
      this.cache.delete(k);
      pr.then((c) => { if (!c.isConnected) { c.width = 0; c.height = 0; } }).catch(() => {});
    }
  }
  invalidate() { this.cache.clear(); }
  async thumb(i, w) {
    const { p, rot } = await this.page(i);
    const v1 = p.getViewport({ scale: 1, rotation: rot });
    const vp = p.getViewport({ scale: (w * 1.5) / v1.width, rotation: rot });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await p.render({ canvas: c, viewport: vp, background: '#ffffff' }).promise;
    return c;
  }
  async text(i) {
    const { p } = await this.page(i);
    const tc = await p.getTextContent();
    let out = '';
    for (const it of tc.items) { if (it.str != null) out += it.str + (it.hasEOL ? '\n' : ''); }
    return out;
  }
  async outline() {
    let ol; try { ol = await this.doc.getOutline(); } catch { ol = null; }
    if (!ol) return [];
    const out = [];
    const walk = async (items, depth) => {
      for (const it of items) {
        if (out.length > 400) return;
        let page = -1;
        try {
          const dest = typeof it.dest === 'string' ? await this.doc.getDestination(it.dest) : it.dest;
          if (dest && dest[0] != null) {
            const src = typeof dest[0] === 'number' ? dest[0] : await this.doc.getPageIndex(dest[0]);
            page = this.order.findIndex((o) => o.s === src);
          }
        } catch { /* ข้ามรายการที่ชี้หน้าไม่ได้ */ }
        if (page >= 0) out.push({ label: it.title || '', depth, page });
        if (it.items && it.items.length) await walk(it.items, depth + 1);
      }
    };
    await walk(ol, 0);
    return out;
  }
  destroy() { this.invalidate(); try { this.task.destroy(); } catch { /* ปิดแล้ว */ } }
}

/* ---------- รูปภาพ (อัลบั้ม / CBZ) ---------- */
export class ImageSource {
  kind = 'img';
  constructor(count, getBlob) { this.count = count; this.getBlob = getBlob; this.urls = new Map(); this.cur = 0; }
  static album(meta) { return new ImageSource(meta.n, (i) => db.page(meta.id, i)); }
  static async zip(blob) {
    const zip = await loadZip();
    const reader = new zip.ZipReader(new zip.BlobReader(blob));
    const entries = (await reader.getEntries()).filter((e) => !e.directory && isImageName(e.filename))
      .sort((a, b) => natSort(a.filename, b.filename));
    const s = new ImageSource(entries.length, (i) => entries[i].getData(new zip.BlobWriter(mimeOf(entries[i].filename))));
    s.reader = reader;
    return s;
  }
  async url(i) {
    let u = this.urls.get(i);
    if (u) return u;
    u = (async () => { const b = await this.getBlob(i); if (!b) throw new Error('ไม่พบรูป'); return URL.createObjectURL(b); })();
    this.urls.set(i, u);
    if (this.urls.size > 28) {
      for (const [k, p] of this.urls) {
        if (this.urls.size <= 20) break;
        if (Math.abs(k - this.cur) > 6) { this.urls.delete(k); p.then((x) => URL.revokeObjectURL(x)).catch(() => {}); }
      }
    }
    return u;
  }
  async render(i) {
    this.cur = i;
    const img = new Image();
    img.draggable = false; img.decoding = 'async';
    try {
      img.src = await this.url(i);
      await (img.decode ? img.decode().catch(() => new Promise((r) => { if (img.complete) r(); else { img.onload = r; img.onerror = r; } })) : new Promise((r) => { img.onload = r; img.onerror = r; }));
    } catch { /* แสดงกล่องแจ้งด้านล่าง */ }
    if (!img.naturalWidth) {
      const d = document.createElement('div');
      d.className = 'pg-err'; d.textContent = 'เปิดรูปนี้ไม่ได้'; d._w = 3; d._h = 4;
      return d;
    }
    img._w = img.naturalWidth; img._h = img.naturalHeight;
    return img;
  }
  async size(i) { const el = await this.render(i); return { w: el._w, h: el._h }; }
  async thumb(i, w) {
    const blob = await this.getBlob(i);
    const c = document.createElement('canvas');
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch { bmp = null; }
    if (!bmp) {
      const u = URL.createObjectURL(blob);
      try { bmp = new Image(); bmp.src = u; await bmp.decode(); bmp.width = bmp.naturalWidth; bmp.height = bmp.naturalHeight; }
      finally { setTimeout(() => URL.revokeObjectURL(u), 5000); }
    }
    const k = (w * 1.5) / bmp.width;
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    return c;
  }
  destroy() {
    for (const p of this.urls.values()) p.then((x) => URL.revokeObjectURL(x)).catch(() => {});
    this.urls.clear();
    try { this.reader && this.reader.close(); } catch { /* ปิดแล้ว */ }
  }
}

/* ---------- ตัวช่วยของหนังสือแบบข้อความ ---------- */
export function sanitize(root) {
  root.querySelectorAll('script,iframe,object,embed,base,meta,form,audio,video,noscript,template,applet,frame,frameset').forEach((e) => e.remove());
  for (const el of root.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'srcset' || n === 'srcdoc' || ((n === 'href' || n === 'src' || n.endsWith(':href') || n === 'action') && /^\s*(javascript|vbscript):/i.test(a.value))) el.removeAttribute(a.name);
    }
  }
}
function toHtml(nodes) {
  const d = document.implementation.createHTMLDocument('');
  for (const n of nodes) d.body.appendChild(d.importNode(n, true));
  return d.body.innerHTML;
}
function resolvePath(base, rel) {
  try {
    const u = new URL(rel, 'http://bl.invalid/' + base.split('/').map(encodeURIComponent).join('/'));
    if (u.host !== 'bl.invalid') return { external: rel };
    return { path: decodeURIComponent(u.pathname.slice(1)), frag: decodeURIComponent(u.hash.slice(1)) };
  } catch { return { path: rel, frag: '' }; }
}
const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const kids = (node, name) => [...node.children].filter((c) => c.localName === name);

/* ---------- EPUB ---------- */
export class EpubBook {
  kind = 'epub';
  static async open(blob) {
    const zip = await loadZip();
    const b = new EpubBook();
    b.zip = zip;
    b.reader = new zip.ZipReader(new zip.BlobReader(blob));
    b.entries = new Map(); b.lower = new Map();
    for (const e of await b.reader.getEntries()) { if (!e.directory) { b.entries.set(e.filename, e); b.lower.set(e.filename.toLowerCase(), e); } }
    b.urls = new Map(); b.cssCache = new Map(); b.chCache = new Map(); b.txtCache = new Map();
    const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const cont = xml(await b.readText('META-INF/container.xml'));
    const rootfile = tags(cont, 'rootfile')[0];
    if (!rootfile) throw new Error('ไฟล์ EPUB ไม่สมบูรณ์ (ไม่พบ rootfile)');
    b.opfPath = rootfile.getAttribute('full-path');
    const opf = xml(await b.readText(b.opfPath));
    const first = (n) => { const e = tags(opf, n)[0]; return e ? e.textContent.trim() : ''; };
    b.title = first('title'); b.author = first('creator'); b.lang = first('language');
    b.manifest = new Map(); b.byPath = new Map();
    for (const it of tags(opf, 'item')) {
      const m = { id: it.getAttribute('id'), path: resolvePath(b.opfPath, it.getAttribute('href') || '').path, type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' };
      b.manifest.set(m.id, m); b.byPath.set(m.path, m);
    }
    b.spine = [];
    for (const ir of tags(opf, 'itemref')) {
      const m = b.manifest.get(ir.getAttribute('idref'));
      if (m && b.find(m.path) && /html|xml/i.test(m.type || 'html')) b.spine.push(m);
    }
    if (!b.spine.length) throw new Error('ไฟล์ EPUB นี้ไม่มีเนื้อหาที่อ่านได้');
    b.count = b.spine.length;
    b.spineIdx = new Map(b.spine.map((m, i) => [m.path, i]));
    b.weights = b.spine.map((m) => Math.max(1, b.find(m.path).uncompressedSize || 1));
    // ปก
    let cov = [...b.manifest.values()].find((m) => /\bcover-image\b/.test(m.props));
    if (!cov) { const mc = tags(opf, 'meta').find((m) => m.getAttribute('name') === 'cover'); if (mc) cov = b.manifest.get(mc.getAttribute('content')); }
    if (!cov) cov = [...b.manifest.values()].find((m) => /^image\//.test(m.type) && /cover/i.test(m.id + m.path));
    b.coverPath = cov && /^image\//.test(cov.type || mimeOf(cov.path)) ? cov.path : null;
    // สารบัญ
    b.toc = [];
    try {
      const nav = [...b.manifest.values()].find((m) => /\bnav\b/.test(m.props));
      const spineEl = tags(opf, 'spine')[0];
      const ncx = b.manifest.get(spineEl && spineEl.getAttribute('toc')) || [...b.manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
      if (nav) await b.readNav(nav.path);
      if (!b.toc.length && ncx) await b.readNcx(ncx.path);
    } catch { /* ไม่มีสารบัญ ใช้รายชื่อบทแทน */ }
    if (!b.toc.length) b.toc = b.spine.map((m, i) => ({ label: 'ส่วนที่ ' + (i + 1), depth: 0, ch: i, frag: '' }));
    return b;
  }
  find(path) { return this.entries.get(path) || this.lower.get((path || '').toLowerCase()); }
  async readText(path) {
    const e = this.find(path);
    if (!e) throw new Error('ไม่พบไฟล์ในหนังสือ: ' + path);
    return e.getData(new this.zip.TextWriter());
  }
  async url(path) {
    if (this.urls.has(path)) return this.urls.get(path);
    const e = this.find(path);
    const p = e ? e.getData(new this.zip.BlobWriter((this.byPath.get(path) || {}).type || mimeOf(path))).then((b) => URL.createObjectURL(b)).catch(() => '') : Promise.resolve('');
    this.urls.set(path, p);
    return p;
  }
  tocTarget(base, href) {
    const r = resolvePath(base, href || '');
    if (r.external) return null;
    const ch = this.spineIdx.get(r.path);
    return ch == null ? null : { ch, frag: r.frag };
  }
  async readNav(path) {
    const doc = new DOMParser().parseFromString(await this.readText(path), 'application/xhtml+xml');
    const navs = tags(doc, 'nav');
    const nav = navs.find((n) => /\btoc\b/.test(n.getAttribute('epub:type') || n.getAttribute('type') || '')) || navs[0];
    if (!nav) return;
    const walk = (ol, depth) => {
      for (const li of kids(ol, 'li')) {
        const a = kids(li, 'a')[0] || kids(li, 'span')[0];
        if (a) {
          const t = a.getAttribute('href') ? this.tocTarget(path, a.getAttribute('href')) : null;
          const label = a.textContent.replace(/\s+/g, ' ').trim();
          if (t && label) this.toc.push({ label, depth, ...t });
        }
        for (const sub of kids(li, 'ol')) walk(sub, depth + 1);
      }
    };
    for (const ol of kids(nav, 'ol')) walk(ol, 0);
  }
  async readNcx(path) {
    const doc = new DOMParser().parseFromString(await this.readText(path), 'application/xml');
    const map = tags(doc, 'navMap')[0];
    if (!map) return;
    const walk = (node, depth) => {
      for (const np of kids(node, 'navPoint')) {
        const lab = tags(np, 'text')[0]; const c = kids(np, 'content')[0];
        const t = c ? this.tocTarget(path, c.getAttribute('src')) : null;
        if (t && lab) this.toc.push({ label: lab.textContent.replace(/\s+/g, ' ').trim(), depth, ...t });
        walk(np, depth + 1);
      }
    };
    walk(map, 0);
  }
  async rewriteCss(text, base) {
    text = text.replace(/@import[^;]+;/gi, '').replace(/@charset[^;]+;/gi, '').replace(/<\/style/gi, '<\\/style');
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const refs = new Map();
    for (const m of text.matchAll(re)) {
      if (/^(data:|blob:)/i.test(m[2]) || refs.has(m[2])) continue;
      const r = resolvePath(base, m[2]);
      refs.set(m[2], r.external ? '' : await this.url(r.path));
    }
    return text.replace(re, (all, q, ref) => (refs.has(ref) ? `url("${refs.get(ref)}")` : all));
  }
  css(path) {
    if (!this.cssCache.has(path)) this.cssCache.set(path, this.readText(path).then((t) => this.rewriteCss(t, path)).catch(() => ''));
    return this.cssCache.get(path);
  }
  async getChapter(i) {
    if (this.chCache.has(i)) return this.chCache.get(i);
    const path = this.spine[i].path;
    const src = await this.readText(path);
    let doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
    let body = doc.querySelector('parsererror') ? null : tags(doc, 'body')[0];
    if (!body) { doc = new DOMParser().parseFromString(src, 'text/html'); body = doc.body; }
    const cssParts = [];
    for (const l of tags(doc, 'link')) {
      if (/stylesheet/i.test(l.getAttribute('rel') || '') && l.getAttribute('href')) {
        const r = resolvePath(path, l.getAttribute('href'));
        if (!r.external) cssParts.push(await this.css(r.path));
      }
      l.remove();
    }
    for (const s of tags(doc, 'style')) { cssParts.push(await this.rewriteCss(s.textContent || '', path)); s.remove(); }
    sanitize(doc.documentElement);
    for (const img of tags(body, 'img')) {
      const r = resolvePath(path, img.getAttribute('src') || '');
      const u = r.external ? '' : await this.url(r.path);
      if (u) img.setAttribute('src', u); else img.removeAttribute('src');
    }
    const XL = 'http://www.w3.org/1999/xlink';
    for (const im of tags(body, 'image')) {
      const ref = im.getAttributeNS(XL, 'href') || im.getAttribute('href') || im.getAttribute('xlink:href') || '';
      const r = resolvePath(path, ref);
      const u = r.external ? '' : await this.url(r.path);
      im.removeAttributeNS(XL, 'href'); im.removeAttribute('xlink:href');
      if (u) im.setAttribute('href', u);
    }
    const out = { html: toHtml([...body.childNodes]), css: cssParts.join('\n'), cls: body.getAttribute('class') || '', path };
    this.chCache.set(i, out);
    if (this.chCache.size > 8) this.chCache.delete(this.chCache.keys().next().value);
    return out;
  }
  async text(i) {
    if (!this.txtCache.has(i)) {
      const { html } = await this.getChapter(i);
      this.txtCache.set(i, new DOMParser().parseFromString(html, 'text/html').body.textContent);
    }
    return this.txtCache.get(i);
  }
  resolve(ch, href) {
    const r = resolvePath(this.spine[ch].path, href);
    if (r.external) return { external: r.external };
    const t = this.spineIdx.get(r.path);
    return t == null ? null : { ch: t, frag: r.frag };
  }
  async coverBlob() {
    if (this.coverPath && this.find(this.coverPath)) return this.find(this.coverPath).getData(new this.zip.BlobWriter(mimeOf(this.coverPath)));
    // สำรอง: รูปแรกของบทแรก
    try {
      const src = await this.readText(this.spine[0].path);
      const m = /<(?:img|image)[^>]+(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(src);
      if (m) { const r = resolvePath(this.spine[0].path, m[1]); const e = !r.external && this.find(r.path); if (e) return e.getData(new this.zip.BlobWriter(mimeOf(r.path))); }
    } catch { /* ไม่มีปก */ }
    return null;
  }
  destroy() {
    for (const p of this.urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
    this.urls.clear();
    try { this.reader.close(); } catch { /* ปิดแล้ว */ }
  }
}

/* ---------- TXT / MD / HTML ---------- */
export function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
  catch { try { return new TextDecoder('windows-874').decode(u8); } catch { return new TextDecoder('utf-8').decode(u8); } }
}
const HEAD_RE = /^\s{0,8}(บทที่\s*[0-9๐-๙]+|ตอนที่\s*[0-9๐-๙]+|บทนำ|บทส่งท้าย|ปฐมบท|chapter\s+[0-9ivxlc]+|part\s+[0-9ivxlc]+|prologue|epilogue|第\s*[0-9０-９一二三四五六七八九十百千]+\s*[章回話话節节卷])/i;

export class TextBook {
  kind = 'txt';
  static async open(blob, name) {
    const b = new TextBook();
    const raw = decodeText(await blob.arrayBuffer());
    b.chapters = []; b.toc = [];
    if (['html', 'htm', 'xhtml'].includes(extOf(name))) {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      sanitize(doc.documentElement);
      doc.querySelectorAll('style,link,img:not([src^="data:"])').forEach((e) => e.remove());
      b.title = (doc.title || '').trim();
      b.chapters.push({ html: doc.body.innerHTML });
      b.toc.push({ label: b.title || 'เนื้อหา', depth: 0, ch: 0, frag: '' });
    } else {
      const text = raw.replace(/\r\n?/g, '\n');
      const blank = /\n[ \t]*\n/.test(text);
      const paras = (blank ? text.split(/\n[ \t]*\n+/) : text.split('\n')).map((p) => p.trim()).filter(Boolean);
      let cur = [], size = 0, n = 0;
      const flush = (label) => {
        if (cur.length) { b.chapters.push({ html: cur.join('') }); }
        cur = []; size = 0;
        if (label != null) b.toc.push({ label, depth: 0, ch: b.chapters.length, frag: '' });
      };
      for (const p of paras) {
        const firstLine = p.split('\n')[0];
        const isHead = firstLine.length < 60 && HEAD_RE.test(firstLine);
        if (isHead && (size > 400 || !cur.length)) { flush(firstLine.trim()); cur.push(`<h2>${esc(firstLine.trim())}</h2>`); const rest = p.split('\n').slice(1).join('\n').trim(); if (rest) cur.push(`<p>${esc(rest).replace(/\n/g, '<br>')}</p>`); size += p.length; continue; }
        if (size > 24000) { n++; flush(null); }
        cur.push(`<p>${esc(p).replace(/\n/g, '<br>')}</p>`); size += p.length;
      }
      flush(null);
      if (!b.chapters.length) b.chapters.push({ html: '<p>(ไฟล์ว่าง)</p>' });
      b.toc = b.toc.filter((t) => t.ch < b.chapters.length);
      if (!b.toc.length) b.toc = b.chapters.map((_, i) => ({ label: 'ส่วนที่ ' + (i + 1), depth: 0, ch: i, frag: '' }));
    }
    b.count = b.chapters.length;
    b.weights = b.chapters.map((c) => Math.max(1, c.html.length));
    b.txt = new Map();
    return b;
  }
  async getChapter(i) { return { html: this.chapters[i].html, css: '', cls: '' }; }
  async text(i) {
    if (!this.txt.has(i)) this.txt.set(i, new DOMParser().parseFromString(this.chapters[i].html, 'text/html').body.textContent);
    return this.txt.get(i);
  }
  resolve(ch, href) { return /^[a-z][a-z0-9+.-]*:/i.test(href) ? { external: href } : null; }
  destroy() {}
}
