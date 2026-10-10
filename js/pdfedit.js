// แก้ไข PDF: ขีดเขียน/ข้อความบนหน้า + สร้างไฟล์ PDF ใหม่ (หมุน ลบ สลับ รวมไฟล์) ด้วย pdf-lib
import { loadPdfLib } from './sources.js';
import { extOf } from './util.js';

// พิกัดบนจอ (0..1) → พิกัดฐานของหน้า (ก่อนผู้ใช้หมุน r องศาตามเข็ม)
export function toBase(u, v, r) {
  if (r === 90) return [v, 1 - u];
  if (r === 180) return [1 - u, 1 - v];
  if (r === 270) return [1 - v, u];
  return [u, v];
}
// ตั้ง transform ให้วาดด้วยพิกัดฐาน (Wb×Hb) แล้วออกมาตรงกับหน้าที่หมุน r องศา
export function rotCtx(ctx, r, Wb, Hb) {
  if (r === 90) ctx.transform(0, 1, -1, 0, Hb, 0);
  else if (r === 180) ctx.transform(-1, 0, 0, -1, Wb, Hb);
  else if (r === 270) ctx.transform(0, -1, 1, 0, 0, Wb);
}
export function drawAnnots(ctx, list, W, H) {
  for (const a of list || []) {
    ctx.save();
    if (a.t === 'ink') {
      ctx.globalAlpha = a.a; ctx.strokeStyle = a.c; ctx.lineWidth = Math.max(0.6, a.w * W); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(a.pts[0] * W, a.pts[1] * H);
      if (a.pts.length === 2) ctx.lineTo(a.pts[0] * W + 0.01, a.pts[1] * H);
      for (let i = 2; i < a.pts.length; i += 2) ctx.lineTo(a.pts[i] * W, a.pts[i + 1] * H);
      ctx.stroke();
    } else if (a.t === 'text') {
      const fs = a.s * W;
      ctx.fillStyle = a.c; ctx.textBaseline = 'top';
      ctx.font = `${fs}px "Sarabun","Noto Sans Thai","Thonburi",system-ui,sans-serif`;
      a.text.split('\n').forEach((ln, i) => ctx.fillText(ln, a.x * W, a.y * H + i * fs * 1.4));
    }
    ctx.restore();
  }
}
// หาเส้น/ข้อความที่อยู่ใต้จุด (ใช้กับยางลบ) คืน index หรือ -1
export function hitAnnot(list, x, y, aspect) {
  for (let i = (list || []).length - 1; i >= 0; i--) {
    const a = list[i];
    if (a.t === 'ink') {
      const tol = Math.max(0.018, a.w);
      const P = a.pts, n = P.length;
      for (let k = 0; k < n; k += 2) { // ระยะจากจุดถึงแต่ละช่วงของเส้น (หน่วยตามความกว้างหน้า)
        const ax = P[k], ay = P[k + 1] / aspect, bx = k + 2 < n ? P[k + 2] : ax, by = k + 2 < n ? P[k + 3] / aspect : ay;
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, py = y / aspect;
        const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (py - ay) * dy) / L)) : 0;
        if (Math.hypot(x - ax - t * dx, py - ay - t * dy) < tol) return i;
      }
    } else {
      const lines = a.text.split('\n');
      const w = Math.max(...lines.map((l) => l.length)) * a.s * 0.62, hh = lines.length * a.s * 1.4 * aspect;
      if (x >= a.x - 0.01 && x <= a.x + w + 0.01 && y >= a.y - 0.01 && y <= a.y + hh + 0.01) return i;
    }
  }
  return -1;
}

const norm = (a) => ((a % 360) + 360) % 360;

async function rasterAnnots(list, bw, bh, R0) {
  const k = Math.min(3, 2600 / Math.max(bw, bh));
  const c = document.createElement('canvas');
  c.width = Math.round(bw * k); c.height = Math.round(bh * k);
  const ctx = c.getContext('2d');
  const sw = R0 === 90 || R0 === 270;
  const Wd = sw ? c.height : c.width, Hd = sw ? c.width : c.height; // ขนาดหน้าตามที่แสดง (รวมการหมุนเดิมของไฟล์)
  if (R0 === 90) ctx.transform(0, -1, 1, 0, 0, Wd);
  else if (R0 === 180) ctx.transform(-1, 0, 0, -1, Wd, Hd);
  else if (R0 === 270) ctx.transform(0, 1, -1, 0, Hd, 0);
  drawAnnots(ctx, list, Wd, Hd);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function imageBytes(file) {
  const ext = extOf(file.name), buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xd8) return { jpg: buf };
  if (buf[0] === 0x89 && buf[1] === 0x50) return { png: buf };
  // ชนิดอื่น (webp/gif/…​) แปลงเป็น JPEG ผ่าน canvas
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
  void ext;
  return { jpg: new Uint8Array(await blob.arrayBuffer()) };
}

// สร้าง PDF ใหม่ตามลำดับ/การหมุนปัจจุบัน
//  flatten=true  → ฝังลายขีดเขียนลงในหน้าและหมุนหน้าจริง (สำหรับส่งออก)
//  flatten=false → คงลายขีดเขียนให้แก้ต่อได้ (สำหรับรวมไฟล์เข้าเล่มในแอป)
export async function rebuildPdf(meta, blob, { flatten = false, extra = [] } = {}) {
  const { PDFDocument, degrees } = await loadPdfLib();
  let src;
  try { src = await PDFDocument.load(await blob.arrayBuffer()); }
  catch (e) { throw new Error(/encrypt/i.test(String(e && e.message)) ? 'ไฟล์ PDF ที่ตั้งรหัสผ่านไว้ยังส่งออก/แก้ไขไม่ได้' : 'อ่านโครงสร้าง PDF นี้เพื่อแก้ไขไม่ได้'); }
  const out = await PDFDocument.create();
  const order = meta.pdf.order, annots = meta.pdf.annots || {};
  const pages = await out.copyPages(src, order.map((o) => o.s));
  const newOrder = [], newAnnots = {};
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i], o = order[i], list = annots[o.s];
    const R0 = norm(p.getRotation().angle);
    if (flatten) {
      if (list && list.length) {
        const box = p.getCropBox();
        const img = await out.embedPng(await rasterAnnots(list, box.width, box.height, R0));
        p.drawImage(img, { x: box.x, y: box.y, width: box.width, height: box.height });
      }
      p.setRotation(degrees(norm(R0 + o.r)));
      newOrder.push({ s: i, r: 0 });
    } else {
      newOrder.push({ s: i, r: o.r });
      if (list && list.length) newAnnots[i] = list;
    }
    out.addPage(p);
  }
  for (const f of extra) {
    const head = new Uint8Array(await f.slice(0, 1024).arrayBuffer());
    const isPdf = String.fromCharCode(...head).includes('%PDF-');
    if (isPdf) {
      let d;
      try { d = await PDFDocument.load(await f.arrayBuffer()); } catch { throw new Error(`รวมไฟล์ ${f.name} ไม่ได้ (อาจตั้งรหัสผ่านไว้)`); }
      for (const p of await out.copyPages(d, d.getPageIndices())) { out.addPage(p); newOrder.push({ s: newOrder.length, r: 0 }); }
    } else {
      const b = await imageBytes(f);
      const img = b.jpg ? await out.embedJpg(b.jpg) : await out.embedPng(b.png);
      const w = 595, hh = (img.height / img.width) * w;
      out.addPage([w, hh]).drawImage(img, { x: 0, y: 0, width: w, height: hh });
      newOrder.push({ s: newOrder.length, r: 0 });
    }
  }
  try { out.setTitle(meta.title || ''); } catch { /* ชื่อมีอักขระที่ใส่ไม่ได้ */ }
  const bytes = await out.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), order: newOrder, annots: newAnnots };
}
