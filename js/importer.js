// นำเข้าไฟล์: ตรวจชนิดจากเนื้อไฟล์จริง สร้างปก แล้วบันทึกลงเครื่อง
// แต่ละเล่มมี meta.store: 'copy' (ค่าเดิม — เก็บสำเนาไฟล์ใน IndexedDB), 'link' (จำ handle ของไฟล์/โฟลเดอร์เดิม)
// หรือ 'none' (ไม่เก็บอะไร ต้องเลือกไฟล์ใหม่ตอนเปิด) · meta.src บอกว่าไฟล์ต้นฉบับคืออะไร ใช้จับคู่ตอนเลือกใหม่
import { uid, natSort, extOf, baseName, isImageName, IMG_EXT, mimeOf, ask, confirmBox, fmtSize } from './util.js';
import { db } from './db.js';
import { loadZip, loadArchive, PdfSource, ImageSource, EpubBook, TextBook } from './sources.js';

const TXT_EXT = ['txt', 'text', 'md', 'markdown', 'log', 'html', 'htm', 'xhtml'];

async function sniff(file) {
  const hd = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const s = Array.from(hd.subarray(0, 1024), (c) => String.fromCharCode(c)).join('');
  if (s.includes('%PDF-')) return 'pdf';
  if (s.startsWith('PK\x03\x04') || s.startsWith('PK\x05\x06')) return 'zip';
  if (s.startsWith('Rar!')) return 'arc';
  if (s.startsWith('7z\xBC\xAF')) return 'arc';
  const ext = extOf(file.name);
  if ((file.type || '').startsWith('image/') || IMG_EXT.includes(ext)) return 'image';
  if (TXT_EXT.includes(ext) || (file.type || '').startsWith('text/')) return 'txt';
  if (['cbr', 'rar', 'cb7', '7z'].includes(ext)) return 'arc';
  if (['cbz', 'zip', 'epub'].includes(ext)) return 'zip';
  return null;
}

function newMeta(kind, title, size, extra = {}) {
  return { id: uid(), kind, title: title || 'ไม่มีชื่อ', author: '', size, added: Date.now(), opened: 0, progress: 0, pos: null, cover: null, bookmarks: [], highlights: [], view: {}, time: 0, ...extra };
}
function canvasCover(c) {
  const k = Math.min(1, 240 / c.width);
  const o = document.createElement('canvas');
  o.width = Math.max(1, Math.round(c.width * k)); o.height = Math.max(1, Math.round(c.height * k));
  const x = o.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, o.width, o.height); x.drawImage(c, 0, 0, o.width, o.height);
  return o.toDataURL('image/jpeg', 0.8);
}
async function blobCover(blob) {
  const s = new ImageSource(1, async () => blob);
  try { return canvasCover(await s.thumb(0, 160)); } catch { return null; } finally { s.destroy(); }
}

const fileSrc = (f) => ({ t: 'file', name: f.name, size: f.size });
const isRef = (meta) => meta.store === 'link' || meta.store === 'none';
const isImg = (f) => (f.type || '').startsWith('image/') || IMG_EXT.includes(extOf(f.name));
const dirOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

// บันทึกเล่ม: ref = ไม่เก็บสำเนา · h = handle ของไฟล์/โฟลเดอร์เดิม (ถ้าเบราว์เซอร์ให้มา) เก็บไว้เสมอเผื่อภายหลังลบสำเนา
async function store(meta, { file, pages, ref, h }) {
  meta.store = !ref ? 'copy' : h ? 'link' : 'none';
  if (h) await db.putHandle(meta.id, h);
  if (!ref && file) await db.putFile(meta.id, file);
  if (!ref && pages) for (let i = 0; i < pages.length; i++) await db.putPage(meta.id, i, pages[i]);
  await db.putBook(meta);
  return meta;
}

export async function makeAlbum(title, blobs, { src = null, ref = false, h = null, arc = false } = {}) {
  const size = blobs.reduce((a, b) => a + b.size, 0);
  const meta = newMeta('album', title, size, { n: blobs.length, src, ...(arc ? { arc } : {}) });
  meta.cover = await blobCover(blobs[0]);
  return store(meta, { pages: blobs, ref, h });
}

// แตกไฟล์ CBR/RAR/7z → รูปเรียงตามชื่อ
async function extractArc(file) {
  const Archive = await loadArchive();
  const archive = await Archive.open(file);
  try {
    if (await archive.hasEncryptedData()) {
      const pw = await ask('ไฟล์นี้ตั้งรหัสผ่านไว้', { placeholder: 'รหัสผ่าน' });
      if (pw == null) throw new Error('ยกเลิกการเปิดไฟล์ที่มีรหัสผ่าน');
      await archive.usePassword(pw);
    }
    await archive.extractFiles();
    const got = (await archive.getFilesArray()).filter((e) => e && e.file && e.file instanceof Blob && isImageName(e.file.name)).map((e) => ({ name: (e.path || '') + e.file.name, file: e.file }));
    if (!got.length) throw new Error('ไฟล์บีบอัดนี้ไม่มีรูปภาพ');
    got.sort((a, b) => natSort(a.name, b.name));
    return got.map((g) => new Blob([g.file], { type: mimeOf(g.name) }));
  } finally { try { await archive.close(); } catch { /* ปิดแล้ว */ } }
}

async function importOne(file, ref) {
  const h = file._h ? { f: file._h } : null;
  const keep = (meta) => { meta.src = fileSrc(file); return store(meta, { file, ref, h }); };
  const kind = await sniff(file);
  const title = baseName(file.name);
  if (kind === 'pdf') {
    const meta = newMeta('pdf', title, file.size);
    const src = await PdfSource.open(file, meta);
    try {
      meta.n = src.count;
      try { const md = await src.doc.getMetadata(); if (md.info && md.info.Author && !/^anonymous$/i.test(md.info.Author)) meta.author = String(md.info.Author); } catch { /* ไม่มีข้อมูล */ }
      try { meta.cover = canvasCover(await src.thumb(0, 160)); } catch { /* ไม่มีปก */ }
    } finally { src.destroy(); }
    return keep(meta);
  }
  if (kind === 'zip') {
    const zip = await loadZip();
    const reader = new zip.ZipReader(new zip.BlobReader(file));
    let names;
    try { names = (await reader.getEntries()).filter((e) => !e.directory).map((e) => e.filename); } finally { await reader.close(); }
    if (names.includes('META-INF/container.xml')) {
      const book = await EpubBook.open(file);
      try {
        const meta = newMeta('epub', book.title || title, file.size, { author: book.author || '' });
        const cb = await book.coverBlob();
        if (cb) meta.cover = await blobCover(cb);
        return keep(meta);
      } finally { book.destroy(); }
    }
    const imgs = names.filter(isImageName);
    if (!imgs.length) throw new Error('ไฟล์ ZIP นี้ไม่มีรูปภาพหรือหนังสือที่อ่านได้');
    const meta = newMeta('cbz', title, file.size, { n: imgs.length });
    const src = await ImageSource.zip(file);
    try { meta.cover = canvasCover(await src.thumb(0, 160)); } catch { /* ไม่มีปก */ } finally { src.destroy(); }
    return keep(meta);
  }
  if (kind === 'arc') {
    // เก็บสำเนา = เก็บรูปที่แตกแล้วทีละหน้า · ไม่เก็บ = แตกใหม่ทุกครั้งที่เปิด
    const blobs = await extractArc(file);
    return makeAlbum(title, blobs, { src: fileSrc(file), ref, h, arc: true });
  }
  if (kind === 'txt') {
    const book = await TextBook.open(file, file.name);
    const meta = newMeta('txt', book.title || title, file.size, { name: file.name });
    return keep(meta);
  }
  throw new Error('ยังไม่รองรับไฟล์ชนิดนี้');
}

// mode: 'copy' = เก็บสำเนาไว้ในแอป, 'ref' = ไม่เก็บไฟล์ (ลิงก์ไปไฟล์เดิมถ้าทำได้ ไม่งั้นเลือกใหม่ตอนเปิด)
export async function importFiles(fileList, { mode = 'copy', onProgress = () => {} } = {}) {
  const ref = mode === 'ref';
  const files = [...fileList].filter((f) => f && f.size > 0 && !/^\./.test(f.name));
  const added = [], errors = [];
  const groups = new Map(), others = [];
  for (const f of files) {
    if (isImg(f)) {
      const dir = dirOf(f.webkitRelativePath || f._rel || '');
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(f);
    } else others.push(f);
  }
  const total = groups.size + others.length;
  let done = 0;
  for (const [dir, list] of groups) {
    onProgress(++done, total, dir || 'รูปภาพ');
    try {
      list.sort((a, b) => natSort(a.name, b.name));
      const d = new Date();
      const title = dir ? dir.split('/').slice(-2).join(' / ') : list.length === 1 ? baseName(list[0].name) : `รูปภาพ ${list.length} รูป (${d.getDate()}/${d.getMonth() + 1})`;
      // ลิงก์ได้เฉพาะอัลบั้มที่มาจากโฟลเดอร์ (ขออนุญาตครั้งเดียวทั้งโฟลเดอร์) — รูปที่เลือกทีละไฟล์ต้องเลือกใหม่ตอนเปิด
      const root = list[0]._root && list.every((f) => f._root === list[0]._root) ? list[0]._root : null;
      const h = root ? { d: root, path: dir.split('/').slice(1).join('/') } : null;
      const src = { t: 'imgs', dir, names: list.map((f) => f.name), sizes: list.map((f) => f.size) };
      const m = await makeAlbum(title, list, { src, ref, h });
      if (ref) live.set(m.id, list); // เพิ่งเลือกมา เปิดได้ทันทีโดยไม่ต้องเลือกซ้ำ
      added.push(m);
    } catch (e) { errors.push(`${dir || 'รูปภาพ'}: ${e.message || e}`); }
  }
  for (const f of others) {
    onProgress(++done, total, f.name);
    try { const m = await importOne(f, ref); if (ref) live.set(m.id, f); added.push(m); } catch (e) { errors.push(`${f.name}: ${e.message || e}`); }
  }
  return { added, errors };
}

// เปิดเล่มที่บันทึกไว้ → คืนตัวอ่านตามชนิด
// pick(meta, retry, match) = UI ให้ผู้ใช้เลือกไฟล์ใหม่ (เล่มที่ไม่เก็บสำเนา) → { files } | { got } | null (ยกเลิก)
// match(files) จับคู่ไฟล์ที่เลือก (อาจถามยืนยัน) → File | File[] | null
export async function openSource(meta, pick) {
  if (isRef(meta)) {
    const got = await resolveRef(meta, pick);
    if (meta.kind === 'album') {
      const list = meta.arc ? await extractArc(got) : got;
      return new ImageSource(list.length, async (i) => {
        if (!list[i]) throw new Error('ไม่พบรูปหน้านี้ในไฟล์ที่เลือก');
        return list[i];
      });
    }
    return openBlob(meta, got);
  }
  if (meta.kind === 'album') return ImageSource.album(meta);
  const blob = await db.file(meta.id);
  if (!blob) throw new Error('ไม่พบไฟล์ของเล่มนี้ในเครื่อง (อาจถูกเบราว์เซอร์ล้างข้อมูล) กรุณานำเข้าใหม่');
  return openBlob(meta, blob);
}
function openBlob(meta, blob) {
  if (meta.kind === 'pdf') return PdfSource.open(blob, meta);
  if (meta.kind === 'cbz') return ImageSource.zip(blob);
  if (meta.kind === 'epub') return EpubBook.open(blob);
  if (meta.kind === 'txt') return TextBook.open(blob, meta.name || 'a.txt');
  throw new Error('ไม่รู้จักชนิดไฟล์');
}

// ไฟล์ต้นฉบับของเล่ม (ใช้ตอนแก้ไข/ส่งออก PDF)
export async function bookFile(meta, pick) {
  if (isRef(meta)) return resolveRef(meta, pick);
  return db.file(meta.id);
}

/* ---------- เล่มที่ไม่เก็บสำเนา ---------- */
const live = new Map(); // id → File | File[] ที่ได้มาแล้วในรอบนี้ ไม่ต้องถามซ้ำจนกว่าจะรีโหลดหน้า
export const forget = (id) => live.delete(id);
export const forgetAll = () => live.clear();
const aborted = () => Object.assign(new Error('ยกเลิกแล้ว'), { name: 'AbortError' });

async function resolveRef(meta, pick) {
  if (live.has(meta.id)) return live.get(meta.id);
  const rec = meta.store === 'link' ? await db.handle(meta.id).catch(() => null) : null;
  let got = null, gone = false;
  // ลองเปิดจากไฟล์เดิมทันที (ถ้ายังอยู่ในจังหวะที่ผู้ใช้เพิ่งแตะ เบราว์เซอร์จะถามสิทธิ์ได้เลย)
  if (rec) got = await fromHandle(meta, rec, false).catch((e) => { gone = e && e.name === 'NotFoundError'; return null; });
  // ไฟล์เดิมถูกย้าย/ลบ → เลิกใช้ลิงก์ ครั้งหน้าจะให้เลือกไฟล์แทน
  if (gone) { meta.store = 'none'; await db.delHandle(meta.id).catch(() => {}); await db.putBook(meta).catch(() => {}); }
  while (!got) {
    const ans = pick ? await pick(meta, rec && !gone ? () => fromHandle(meta, rec, true) : null, (files) => matchFiles(meta, files)) : null;
    if (!ans) throw aborted();
    got = ans.got || (ans.files ? await matchFiles(meta, ans.files) : null);
  }
  live.set(meta.id, got);
  return got;
}

async function fromHandle(meta, rec, interactive) {
  const h = rec.f || rec.d;
  if (!h || !h.queryPermission) return null;
  let st = await h.queryPermission({ mode: 'read' });
  if (st !== 'granted') {
    try { st = await h.requestPermission({ mode: 'read' }); } catch (e) { if (interactive) throw e; return null; }
  }
  if (st !== 'granted') { if (interactive) throw new Error('ไม่ได้รับอนุญาตให้อ่านไฟล์'); return null; }
  if (rec.f) return rec.f.getFile();
  let d = rec.d;
  for (const part of (rec.path || '').split('/').filter(Boolean)) d = await d.getDirectoryHandle(part);
  const out = await Promise.all(meta.src.names.map((n) => d.getFileHandle(n).then((fh) => fh.getFile()).catch(() => null)));
  if (!out.some(Boolean)) throw Object.assign(new Error('ไม่พบรูปในโฟลเดอร์เดิม'), { name: 'NotFoundError' });
  return out;
}

// จับคู่ไฟล์ที่ผู้ใช้เลือกใหม่กับเล่มเดิม: ไฟล์เดี่ยวดูชื่อ+ขนาด · อัลบั้มดูชื่อรูปในโฟลเดอร์ที่ตรงที่สุด
async function matchFiles(meta, files) {
  files = [...(files || [])].filter((f) => f && f.size > 0);
  if (!files.length) return null;
  const src = meta.src;
  if (src.t === 'file') {
    const f = files.find((x) => x.name === src.name && x.size === src.size) || files.find((x) => x.name === src.name) || files[0];
    if ((f.name !== src.name || f.size !== src.size) && !await confirmBox('ไฟล์ไม่ตรงกับที่นำเข้าไว้',
      `เล่มนี้นำเข้าจาก "${src.name}" (${fmtSize(src.size)}) แต่ไฟล์ที่เลือกคือ "${f.name}" (${fmtSize(f.size)}) — หน้าที่อ่านค้างไว้และโน้ตอาจไม่ตรง`, 'เปิดไฟล์นี้')) return null;
    meta.src = fileSrc(f);
    return f;
  }
  const want = new Set(src.names);
  const groups = new Map();
  for (const f of files.filter(isImg)) {
    const d = dirOf(f.webkitRelativePath || f._rel || '');
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(f);
  }
  const last = src.dir ? src.dir.split('/').pop() : '';
  const score = ([d, l]) => l.filter((f) => want.has(f.name)).length * 2 + (last && d.split('/').pop() === last ? 1 : 0);
  const best = [...groups].sort((a, b) => score(b) - score(a))[0];
  if (!best) return null;
  const by = new Map(best[1].map((f) => [f.name, f]));
  let out = src.names.map((n) => by.get(n) || null);
  // ไม่มีชื่อไหนตรงเลย (เช่น iPhone ตั้งชื่อรูปใหม่ตอนเลือกจากคลังภาพ) → ใช้ลำดับตามชื่อแทน
  if (!out.some(Boolean)) {
    const imgs = best[1].slice().sort((a, b) => natSort(a.name, b.name));
    out = src.names.map((_, i) => imgs[i] || null);
  }
  const hit = out.filter(Boolean).length;
  if (hit < src.names.length && !await confirmBox('พบรูปไม่ครบ', `พบ ${hit} จาก ${src.names.length} รูป — หน้าที่ขาดจะแสดงไม่ได้`, 'เปิดต่อ')) return null;
  return out;
}

// ลบสำเนาที่เก็บไว้ แต่เก็บข้อมูลเล่ม/ความคืบหน้า/โน้ตไว้ → คืนขนาดที่ได้พื้นที่คืน
export function canDropCopy(meta) {
  if (isRef(meta) || meta.merged) return false;
  return !!meta.src || ['pdf', 'epub', 'txt', 'cbz'].includes(meta.kind);
}
export async function dropCopy(meta) {
  if (!meta.src) meta.src = { t: 'file', name: meta.name || meta.title, size: meta.size }; // เล่มที่นำเข้าก่อนมีระบบนี้
  const rec = await db.handle(meta.id).catch(() => null);
  meta.store = rec ? 'link' : 'none';
  await db.putBook(meta);
  await db.delData(meta.id);
}
// เล่มที่ไม่เก็บสำเนา → เก็บสำเนาไว้ในแอป (อ่านออฟไลน์ได้)
export async function keepCopy(meta, pick) {
  const got = await resolveRef(meta, pick);
  if (meta.kind === 'album') {
    const list = meta.arc ? await extractArc(got) : got;
    if (list.some((b) => !b)) throw new Error('รูปไม่ครบ จึงเก็บสำเนาไม่ได้');
    for (let i = 0; i < list.length; i++) await db.putPage(meta.id, i, list[i]);
    meta.n = list.length;
  } else await db.putFile(meta.id, got);
  meta.store = 'copy';
  await db.putBook(meta);
  forget(meta.id);
}

/* ---------- เลือกไฟล์ด้วย File System Access API (Chrome/Edge คอม, Chrome Android 132+) ---------- */
export const canPickFiles = typeof window.showOpenFilePicker === 'function';
export const canPickDir = typeof window.showDirectoryPicker === 'function';
export async function pickFiles() {
  const hs = await window.showOpenFilePicker({ multiple: true });
  return Promise.all(hs.map(async (h) => { const f = await h.getFile(); f._h = h; return f; }));
}
export async function pickFolder() { return walkDir(await window.showDirectoryPicker()); }
async function walkDir(root) {
  const out = [];
  const walk = async (d, path) => {
    for await (const h of d.values()) {
      if (h.kind === 'file') { const f = await h.getFile(); f._rel = path + f.name; f._root = root; out.push(f); }
      else await walk(h, path + h.name + '/');
    }
  };
  await walk(root, root.name + '/');
  return out;
}

// อ่านไฟล์จากการลากโฟลเดอร์มาวาง (เดสก์ท็อป)
export async function filesFromDrop(dt) {
  // ทุกอย่างจาก dt ต้องอ่านทันทีระหว่างอีเวนต์ drop ก่อน await ครั้งแรก
  const raw = [...(dt.items || [])].filter((i) => i.kind === 'file');
  const plain = [...dt.files];
  const items = raw.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  // Chrome: ได้ handle มาด้วย จึงลิงก์ไปไฟล์/โฟลเดอร์เดิมได้
  if (raw.length && raw[0].getAsFileSystemHandle) {
    const hp = raw.map((i) => i.getAsFileSystemHandle());
    try {
      const out = [];
      for (const h of await Promise.all(hp)) {
        if (!h) continue;
        if (h.kind === 'directory') out.push(...await walkDir(h));
        else { const f = await h.getFile(); f._h = h; out.push(f); }
      }
      return out;
    } catch { /* ใช้วิธีเดิมด้านล่าง */ }
  }
  const out = [];
  if (!items.some((e) => e && e.isDirectory)) return plain;
  const walk = async (entry, path) => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      f._rel = path + f.name; out.push(f);
    } else if (entry.isDirectory) {
      const rd = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => rd.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, path + entry.name + '/');
      }
    }
  };
  for (const e of items) if (e) await walk(e, '');
  return out;
}
