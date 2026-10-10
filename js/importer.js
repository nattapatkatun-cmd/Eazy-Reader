// นำเข้าไฟล์: ตรวจชนิดจากเนื้อไฟล์จริง สร้างปก แล้วบันทึกลงเครื่อง
import { uid, natSort, extOf, baseName, isImageName, IMG_EXT, mimeOf, ask } from './util.js';
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

export async function makeAlbum(title, blobs) {
  const size = blobs.reduce((a, b) => a + b.size, 0);
  const meta = newMeta('album', title, size, { n: blobs.length });
  for (let i = 0; i < blobs.length; i++) await db.putPage(meta.id, i, blobs[i]);
  meta.cover = await blobCover(blobs[0]);
  await db.putBook(meta);
  return meta;
}

async function importOne(file) {
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
    await db.putFile(meta.id, file); await db.putBook(meta);
    return meta;
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
        await db.putFile(meta.id, file); await db.putBook(meta);
        return meta;
      } finally { book.destroy(); }
    }
    const imgs = names.filter(isImageName);
    if (!imgs.length) throw new Error('ไฟล์ ZIP นี้ไม่มีรูปภาพหรือหนังสือที่อ่านได้');
    const meta = newMeta('cbz', title, file.size, { n: imgs.length });
    const src = await ImageSource.zip(file);
    try { meta.cover = canvasCover(await src.thumb(0, 160)); } catch { /* ไม่มีปก */ } finally { src.destroy(); }
    await db.putFile(meta.id, file); await db.putBook(meta);
    return meta;
  }
  if (kind === 'arc') {
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
      return await makeAlbum(title, got.map((g) => new Blob([g.file], { type: mimeOf(g.name) })));
    } finally { try { await archive.close(); } catch { /* ปิดแล้ว */ } }
  }
  if (kind === 'txt') {
    const book = await TextBook.open(file, file.name);
    const meta = newMeta('txt', book.title || title, file.size, { name: file.name });
    await db.putFile(meta.id, file); await db.putBook(meta);
    return meta;
  }
  throw new Error('ยังไม่รองรับไฟล์ชนิดนี้');
}

export async function importFiles(fileList, onProgress = () => {}) {
  const files = [...fileList].filter((f) => f && f.size > 0 && !/^\./.test(f.name));
  const added = [], errors = [];
  const groups = new Map(), others = [];
  for (const f of files) {
    const isImg = (f.type || '').startsWith('image/') || IMG_EXT.includes(extOf(f.name));
    if (isImg) {
      const rel = f.webkitRelativePath || f._rel || '';
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
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
      added.push(await makeAlbum(title, list));
    } catch (e) { errors.push(`${dir || 'รูปภาพ'}: ${e.message || e}`); }
  }
  for (const f of others) {
    onProgress(++done, total, f.name);
    try { added.push(await importOne(f)); } catch (e) { errors.push(`${f.name}: ${e.message || e}`); }
  }
  return { added, errors };
}

// เปิดเล่มที่บันทึกไว้ → คืนตัวอ่านตามชนิด
export async function openSource(meta) {
  if (meta.kind === 'album') return ImageSource.album(meta);
  const blob = await db.file(meta.id);
  if (!blob) throw new Error('ไม่พบไฟล์ของเล่มนี้ในเครื่อง (อาจถูกเบราว์เซอร์ล้างข้อมูล) กรุณานำเข้าใหม่');
  if (meta.kind === 'pdf') return PdfSource.open(blob, meta);
  if (meta.kind === 'cbz') return ImageSource.zip(blob);
  if (meta.kind === 'epub') return EpubBook.open(blob);
  if (meta.kind === 'txt') return TextBook.open(blob, meta.name || 'a.txt');
  throw new Error('ไม่รู้จักชนิดไฟล์');
}

// อ่านไฟล์จากการลากโฟลเดอร์มาวาง (เดสก์ท็อป)
export async function filesFromDrop(dt) {
  const out = [];
  const items = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (!items.some((e) => e && e.isDirectory)) return [...dt.files];
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
