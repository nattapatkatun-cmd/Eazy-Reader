# Eazy Reader — บันทึกส่งต่องาน

แอปอ่านหนังสือแบบ PWA (vanilla JS, ES modules, ไม่มีขั้นตอน build) สำหรับ GitHub Pages
ผู้ใช้หลัก: iPhone/iPad, Android, จอพับ (Galaxy Fold) · ภาษา UI: ไทย

## สถานะ

- โค้ดครบและทดสอบด้วย Chromium (Playwright) ที่ขนาดจอมือถือ 390×844, จอพับ 820×720, เดสก์ท็อป 1180×780 ผ่านทั้งหมด
- push ขึ้น `main` แล้ว (repo `nattapatkatun-cmd/Eazy-Reader`) แต่ยังต้องเปิด GitHub Pages ใน Settings เอง (proxy ของ cloud session เรียก Pages API ไม่ได้) · ยังไม่ได้ทดสอบบน iPhone Safari / Galaxy Fold เครื่องจริง
- การอ่านออกเสียงยังไม่ได้ยืนยันว่ามีเสียงออกจริง (สภาพแวดล้อมทดสอบไม่มีเสียงติดตั้ง)

## งานถัดไป: deploy

1. สร้าง repo สาธารณะชื่อ `eazy-reader` แล้ว push ทุกไฟล์ในโฟลเดอร์นี้ไว้ที่ root ของ branch `main`
2. เปิด GitHub Pages: Deploy from a branch → `main` / `(root)`
   (`gh api -X POST repos/<owner>/eazy-reader/pages -f "source[branch]=main" -f "source[path]=/"`)
3. ตรวจ `https://<owner>.github.io/eazy-reader/` ว่าโหลดได้และ service worker ลงทะเบียนสำเร็จ
4. ทุกครั้งที่แก้โค้ดแล้ว deploy ใหม่ ให้เปลี่ยน `VERSION` ใน `sw.js` (ตอนนี้ `eazy-reader-v3`)

ทุก path ในแอปเป็นแบบ relative จึงใช้ได้ทั้งที่ root โดเมนและ sub-path

## โครงสร้าง

- `index.html`, `css/app.css` — หน้าเดียว
- `js/app.js` — ชั้นหนังสือ, แถบเครื่องมือ, การตั้งค่า, sheet ต่าง ๆ (ตัวประสานงาน `app`)
- `js/importer.js` — ตรวจชนิดไฟล์จาก magic bytes แล้วนำเข้า
- `js/sources.js` — `PdfSource`, `ImageSource`, `EpubBook`, `TextBook` + ตัวโหลดไลบรารีแบบ lazy
- `js/fixedview.js` — ตัวอ่านหน้าคงที่ (PDF, รูป, CBZ) รวมการขีดเขียนบน PDF
- `js/reflowview.js` — ตัวอ่านข้อความไหล (EPUB, TXT) ใช้ iframe 2 ตัว + CSS columns
- `js/flip.js` — `Pager`: pointer events, ซูม, เอฟเฟกต์ม้วนกระดาษ (clip-path + canvas)
- `js/pdfedit.js` — วาดลายขีดเขียน, สร้าง PDF ใหม่ด้วย pdf-lib
- `js/tts.js`, `js/db.js` — อ่านออกเสียง, IndexedDB (`eazyreader` v2: stores `books`, `files`, `pages`, `handles`)
- `vendor/` — pdf.js 6.2.108 (legacy build), pdf-lib 1.17.1, zip.js, libarchive.js 2.0.2 · `fonts/` — Sarabun, Noto Serif Thai (WOFF)

## การตัดสินใจสำคัญ

- EPUB แสดงใน iframe **ไม่ใส่ sandbox** (WebKit ไม่ยิงอีเวนต์ใน iframe ที่ sandbox) แต่ล้างสคริปต์/attribute `on*` ออกก่อน และครอบด้วย CSP `default-src 'none'`
- ตำแหน่งอ่านของ EPUB/TXT เก็บเป็น `{ch, off}` (ลำดับตัวอักษรในบท) จึงคงที่เมื่อเปลี่ยนขนาดฟอนต์หรือหมุนจอ
- PDF: ลำดับ/การหมุนหน้าเก็บเป็นรายการเสมือน `meta.pdf.order = [{s, r}]` ไม่แก้ไฟล์จนกว่าจะส่งออกหรือรวมไฟล์ · ลายขีดเขียนเก็บเป็นพิกัด 0..1 ต่อหน้าต้นฉบับ `meta.pdf.annots[s]`
- CBR/RAR/7z แตกเป็นอัลบั้ม (รูปทีละหน้าใน store `pages`) ตอนนำเข้า · CBZ เก็บไฟล์เดิมและอ่านทีละรูป
- ตอนนำเข้าถามทุกครั้ง: เก็บสำเนา หรือไม่เก็บไฟล์ → `meta.store` = `copy` (เล่มเก่าไม่มีค่า = copy) / `link` / `none`
  - `link`: เก็บ FileSystemHandle ใน store `handles` (`{f}` ไฟล์เดี่ยว หรือ `{d, path}` โฟลเดอร์ราก + โฟลเดอร์ย่อย) ได้เฉพาะเบราว์เซอร์ที่มี `showOpenFilePicker`/`showDirectoryPicker` (Chrome/Edge คอม, Chrome Android 132+) · iOS ไม่มี
  - `none`: ตอนเปิดให้เลือกไฟล์ใหม่ จับคู่ด้วย `meta.src` (`{t:'file', name, size}` หรือ `{t:'imgs', dir, names, sizes}`)
  - ไฟล์ที่ได้มาแล้วในรอบนี้แคชไว้ใน `live` (importer.js) · ลิงก์ที่ไฟล์หายจะถูกลดเป็น `none` · CBR/7z แบบไม่เก็บไฟล์จะแตกใหม่ทุกครั้งที่เปิด
  - รวมไฟล์ PDF แล้วเล่มนั้นเปลี่ยนเป็น `copy` + `meta.merged` (ห้ามลบสำเนา เพราะไม่มีไฟล์ต้นฉบับในเครื่อง)
  - อัลบั้มจากการเลือกรูปทีละไฟล์ลิงก์ไม่ได้ (ต้องขอสิทธิ์ทีละไฟล์) → เป็น `none`
- `window.__eazy` เปิด `app`, `db`, `importFiles`, `openBook`, `tts` ไว้สำหรับทดสอบ

## ข้อจำกัดที่รู้อยู่

- ไม่รองรับไฟล์ติด DRM, MOBI/AZW3, EPUB fixed-layout, EPUB ตัวอักษรแนวตั้ง
- แก้ข้อความเดิมใน PDF ไม่ได้ · PDF ตั้งรหัสผ่านส่งออกไม่ได้ · ค้นหาใน PDF ไปที่หน้าแต่ไม่ไฮไลต์คำ
- iPhone เลือกทั้งโฟลเดอร์ไม่ได้ · ภาพย่อในมุมมอง "ทุกหน้า" ไม่แสดงลายขีดเขียน
