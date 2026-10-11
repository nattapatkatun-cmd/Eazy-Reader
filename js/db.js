// ที่เก็บข้อมูลในเครื่อง (IndexedDB): books = ข้อมูลเล่ม, files = ไฟล์ต้นฉบับ, pages = รูปทีละหน้าของอัลบั้ม,
// handles = ลิงก์ไปยังไฟล์/โฟลเดอร์เดิมในเครื่อง (File System Access API) ของเล่มที่ไม่เก็บสำเนา
let dbp;
function open() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('eazyreader', 2);
    r.onupgradeneeded = () => {
      const d = r.result, has = (n) => d.objectStoreNames.contains(n);
      if (!has('books')) d.createObjectStore('books', { keyPath: 'id' });
      if (!has('files')) d.createObjectStore('files');
      if (!has('pages')) d.createObjectStore('pages');
      if (!has('handles')) d.createObjectStore('handles');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    let out;
    try { out = fn(t.objectStore(store)); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = t.onabort = () => rej(t.error || new Error('บันทึกข้อมูลไม่สำเร็จ'));
  });
}
const toBlob = (v) => (!v ? null : v instanceof Blob ? v : v.buf ? new Blob([v.buf], { type: v.type || '' }) : null);
// บางเบราว์เซอร์เก็บ Blob ลง IndexedDB ไม่ได้ จึงสำรองเป็น ArrayBuffer
async function putBlob(store, key, blob) {
  try { await tx(store, 'readwrite', (s) => s.put(blob, key)); }
  catch (e) {
    if (e && e.name === 'QuotaExceededError') throw new Error('พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็ม');
    const buf = await blob.arrayBuffer();
    await tx(store, 'readwrite', (s) => s.put({ buf, type: blob.type }, key));
  }
}
export const db = {
  books: () => tx('books', 'readonly', (s) => s.getAll()),
  book: (id) => tx('books', 'readonly', (s) => s.get(id)),
  putBook: (b) => tx('books', 'readwrite', (s) => s.put(b)),
  putFile: (id, blob) => putBlob('files', id, blob),
  file: async (id) => toBlob(await tx('files', 'readonly', (s) => s.get(id))),
  putPage: (id, i, blob) => putBlob('pages', [id, i], blob),
  page: async (id, i) => toBlob(await tx('pages', 'readonly', (s) => s.get([id, i]))),
  putHandle: (id, v) => tx('handles', 'readwrite', (s) => s.put(v, id)),
  handle: (id) => tx('handles', 'readonly', (s) => s.get(id)),
  delHandle: (id) => tx('handles', 'readwrite', (s) => s.delete(id)),
  async del(id) {
    await tx('books', 'readwrite', (s) => s.delete(id));
    await this.delData(id);
    await this.delHandle(id);
  },
  // ลบเฉพาะไฟล์ที่เก็บสำเนาไว้ (ข้อมูลเล่ม ความคืบหน้า โน้ต ยังอยู่)
  async delData(id) {
    await tx('files', 'readwrite', (s) => s.delete(id));
    await this.delPages(id);
  },
  async delPages(id) {
    await tx('pages', 'readwrite', (s) => s.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
  },
};
