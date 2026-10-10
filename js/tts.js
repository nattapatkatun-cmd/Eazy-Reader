// อ่านออกเสียงด้วยเสียงของเครื่อง (Web Speech API) — เลือกเสียงตามภาษาของข้อความอัตโนมัติ
import { toast } from './util.js';

function langOf(t) {
  if (/[฀-๿]/.test(t)) return 'th-TH';
  if (/[぀-ヿ]/.test(t)) return 'ja-JP';
  if (/[가-힯]/.test(t)) return 'ko-KR';
  if (/[一-鿿]/.test(t)) return 'zh-CN';
  return 'en-US';
}
// ตัดข้อความเป็นท่อนสั้น ๆ พร้อมตำแหน่ง เพื่อไฮไลต์ตามและกันเสียงถูกตัดกลางคัน
export function splitChunks(text, max = 200) {
  const out = [];
  let parts = [];
  if (window.Intl && Intl.Segmenter) {
    for (const s of new Intl.Segmenter(langOf(text.slice(0, 400)).slice(0, 2), { granularity: 'sentence' }).segment(text)) parts.push([s.index, s.index + s.segment.length]);
  } else {
    const re = /[^.!?。！？\n]+[.!?。！？\n]*/g; let m;
    while ((m = re.exec(text))) parts.push([m.index, m.index + m[0].length]);
  }
  const pieces = [];
  for (const [s, e] of parts) { // ท่อนยาวเกิน ตัดที่ช่องว่าง
    let a = s;
    while (e - a > max) {
      let cut = text.lastIndexOf(' ', a + max);
      if (cut <= a + 40) cut = a + max;
      pieces.push([a, cut]); a = cut;
    }
    pieces.push([a, e]);
  }
  let cur = null;
  for (const [s, e] of pieces) { // รวมท่อนสั้น ๆ เข้าด้วยกัน
    if (!text.slice(s, e).trim()) continue;
    if (cur && e - cur[0] <= max) cur[1] = e; else { cur = [s, e]; out.push(cur); }
  }
  return out.map(([s, e]) => ({ s, e, text: text.slice(s, e).replace(/\s+/g, ' ').trim() })).filter((c) => c.text);
}

export class Speaker {
  constructor(app) { this.app = app; this.on = false; this.paused = false; this.tok = 0; }
  get ok() { return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window; }
  voiceFor(lang) {
    const vs = speechSynthesis.getVoices();
    const p = lang.slice(0, 2);
    return vs.find((v) => v.lang.replace('_', '-') === lang && v.localService) || vs.find((v) => v.lang.replace('_', '-') === lang) || vs.find((v) => v.lang.slice(0, 2) === p) || null;
  }
  say(text) {
    return new Promise((res) => {
      const u = new SpeechSynthesisUtterance(text);
      const lang = langOf(text), v = this.voiceFor(lang);
      u.lang = lang; if (v) u.voice = v;
      u.rate = this.app.S.ttsRate || 1;
      let done = false;
      const fin = (r) => { if (!done) { done = true; clearInterval(tick); res(r); } };
      u.onend = () => fin('end'); u.onerror = (e) => fin(e.error === 'interrupted' || e.error === 'canceled' ? 'cut' : 'error');
      // กันกรณีที่เบราว์เซอร์ไม่ส่งสัญญาณจบ
      const t0 = Date.now();
      const tick = setInterval(() => { if (Date.now() - t0 > 3000 && !speechSynthesis.speaking && !speechSynthesis.pending) fin('end'); }, 500);
      this.u = u;
      speechSynthesis.speak(u);
    });
  }
  async start() {
    if (!this.ok) { toast('เบราว์เซอร์นี้ไม่รองรับการอ่านออกเสียง'); return; }
    this.stop(true);
    const tok = ++this.tok;
    this.on = true; this.paused = false; this.app.ttsChanged();
    let empty = 0, errs = 0;
    while (this.on && tok === this.tok) {
      const v = this.app.view;
      if (!v) break;
      const t = await v.ttsText();
      if (!t) { toast('ไฟล์ชนิดนี้ไม่มีข้อความให้อ่านออกเสียง'); break; }
      const chunks = splitChunks(t.text);
      empty = chunks.length ? 0 : empty + 1;
      if (empty >= 3) { toast('ไม่พบข้อความในหน้าเหล่านี้ (อาจเป็นไฟล์สแกน)'); break; }
      for (let i = 0; i < chunks.length && this.on && tok === this.tok;) {
        if (this.paused) { await new Promise((r) => (this.wake = r)); continue; }
        const c = chunks[i];
        v.ttsMark(t.base + c.s, t.base + c.e);
        const r = await this.say(c.text);
        if (tok !== this.tok || !this.on) return;
        if (this.paused) continue; // พูดท่อนเดิมใหม่เมื่อเล่นต่อ
        if (r === 'error' && ++errs > 2) { toast('อ่านออกเสียงไม่สำเร็จ (ตรวจว่าเครื่องมีเสียงภาษานี้)'); this.stop(); return; }
        i++;
      }
      if (!this.on || tok !== this.tok) return;
      if (!(await v.ttsAdvance())) break;
    }
    if (tok === this.tok) this.stop();
  }
  pause() { if (!this.on) return; this.paused = !this.paused; if (this.paused) speechSynthesis.cancel(); else if (this.wake) { this.wake(); this.wake = null; } this.app.ttsChanged(); }
  stop(silent) {
    this.tok++; this.on = false; this.paused = false;
    if (this.wake) { this.wake(); this.wake = null; }
    if (this.ok) speechSynthesis.cancel();
    if (this.app.view) this.app.view.ttsMark(null);
    if (!silent) this.app.ttsChanged();
  }
  once(text) { if (!this.ok) { toast('เบราว์เซอร์นี้ไม่รองรับการอ่านออกเสียง'); return; } this.stop(); const c = splitChunks(text); (async () => { const tok = ++this.tok; for (const x of c) { if (tok !== this.tok) return; await this.say(x.text); } })(); }
}
