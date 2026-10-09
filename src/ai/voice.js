// ==========================================================
//  🎙️ Romeo-র গলা — লেখা থেকে ভয়েস নোট
//
//  ⚠️ পরিষ্কার করে বলে রাখি: এটা দিয়ে Romeo **ভয়েস চ্যাটে ঢুকতে
//     পারবে না**। WhatsApp-এর ভয়েস চ্যাট একটা এনক্রিপ্টেড লাইভ অডিও
//     রুম — সেখানে কোনো বট ঢোকার উপায়ই নেই (লাইব্রেরিতে শুধু
//     `rejectCall` আছে, জয়েন করার কিছু নেই)।
//
//     এটা যা করে: Romeo-র উত্তরটা **ভয়েস নোট** বানিয়ে চ্যাটে পাঠায়।
//     WhatsApp পরপর ভয়েস নোট নিজে থেকেই বাজায়, তাই শুনতে প্রায়
//     ভয়েস চ্যাটের মতোই লাগে।
//
//  কেন Google-এর TTS: কোনো API key লাগে না, কোনো লাইব্রেরি লাগে না,
//  সম্পূর্ণ ফ্রি, আর বাংলা বলে। পরীক্ষায় ০.১-০.২ সেকেন্ডে উত্তর আসে।
// ==========================================================
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const exec = promisify(execFile)

// Google-এর TTS একবারে ~২০০ অক্ষরের বেশি নেয় না — তাই ভাগ করে নিই
const CHUNK = 180
const FETCH_TIMEOUT = 15000
// Romeo-র উত্তর ছোট (১৬০ অক্ষর), তাই ৬ টুকরোর বেশি কখনো লাগার কথা নয়।
// সীমাটা থাকলে কেউ `!বলো <বিশাল লেখা>` দিয়ে সার্ভার আটকাতে পারবে না।
const MAX_CHUNKS = 6

/** অস্থায়ী ফোল্ডার — Termux-এ /tmp থাকে না, তাই কয়েক জায়গা চেষ্টা */
let _root = null
function tmpRoot() {
  if (_root) return _root
  const tries = [
    process.env.TMPDIR,
    process.env.PREFIX ? process.env.PREFIX + '/tmp' : null,
    os.tmpdir(),
    path.join(process.cwd(), 'data', 'tmp')
  ].filter(Boolean)
  for (const d of tries) {
    try {
      fs.mkdirSync(d, { recursive: true })
      const p = path.join(d, `romeo-probe-${process.pid}`)
      fs.writeFileSync(p, 'x'); fs.unlinkSync(p)
      _root = d
      return d
    } catch { /* পরেরটা */ }
  }
  _root = os.tmpdir()
  return _root
}

let _ffmpeg = null
async function hasFfmpeg() {
  if (_ffmpeg !== null) return _ffmpeg
  try { await exec('ffmpeg', ['-version'], { timeout: 15000 }); _ffmpeg = true }
  catch { _ffmpeg = false }
  return _ffmpeg
}

/**
 * 🧹 বলার আগে লেখাটা পরিষ্কার করা — **সবচেয়ে জরুরি অংশ**।
 *
 * কাঁচা লেখা পড়তে দিলে Romeo আক্ষরিক অর্থে বলবে
 * "তারকা চিহ্ন দারুণ তারকা চিহ্ন, স্মাইলিং ফেস উইথ..." — হাস্যকর।
 * তাই ফরম্যাটিং আর ইমোজি আগে ছেঁটে ফেলি।
 */
export function speakable(text) {
  let t = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')                    // কোড ব্লক
    .replace(/[*_~`]/g, '')                             // *bold* _italic_ ইত্যাদি
    .replace(/https?:\/\/\S+/g, ' ')                    // লিংক পড়ে লাভ নেই
    .replace(/@\d{6,}/g, ' ')                           // মেনশনের নম্বর
    .replace(/\p{Extended_Pictographic}/gu, ' ')        // ইমোজি
    .replace(/[\u200B-\u200D\uFEFF]/g, '')              // অদৃশ্য অক্ষর
    .replace(/\s+/g, ' ')
    .trim()
  return t
}

/** লম্বা লেখাকে বাক্যের শেষে ভেঙে ছোট টুকরো করা */
function split(text) {
  const out = []
  let rest = text
  while (rest.length && out.length < MAX_CHUNKS) {
    if (rest.length <= CHUNK) { out.push(rest); break }
    const win = rest.slice(0, CHUNK)
    // আগে দাঁড়ি/প্রশ্নচিহ্ন, না পেলে স্পেস — মাঝ-শব্দে কাটবো না
    let cut = Math.max(
      win.lastIndexOf('।'), win.lastIndexOf('?'), win.lastIndexOf('!'),
      win.lastIndexOf('.'), win.lastIndexOf(',')
    )
    if (cut < CHUNK * 0.4) cut = win.lastIndexOf(' ')
    if (cut <= 0) cut = CHUNK - 1
    out.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  return out.filter(Boolean)
}

/** একটা টুকরো → mp3 বাফার */
async function fetchChunk(text, lang) {
  const u = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`
  const r = await fetch(u, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://translate.google.com/' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT)
  })
  if (!r.ok) throw new Error(`TTS HTTP ${r.status}`)
  const b = Buffer.from(await r.arrayBuffer())
  if (b.length < 512) throw new Error('TTS খালি অডিও দিলো')
  return b
}

/**
 * 🎙️ লেখা → WhatsApp ভয়েস নোট।
 *
 * @param {string} text  যা বলতে হবে
 * @param {object} opt   { lang = 'bn' }
 * @returns {Promise<{file:string, dir:string, ext:string, size:number, seconds:number}|null>}
 *          null মানে বানানো গেলো না — তখন কলার টেক্সটেই পাঠাবে।
 */
export async function speak(text, { lang = 'bn' } = {}) {
  const clean = speakable(text)
  if (clean.length < 2) return null

  const parts = split(clean)
  if (!parts.length) return null

  let dir = null
  try {
    dir = fs.mkdtempSync(path.join(tmpRoot(), 'romeo-voice-'))

    // টুকরোগুলো **একসাথে** আনি — পরপর আনলে দ্বিগুণ-তিনগুণ সময় লাগতো
    const bufs = await Promise.all(parts.map(p => fetchChunk(p, lang)))

    const files = bufs.map((b, i) => {
      const f = path.join(dir, `p${i}.mp3`)
      fs.writeFileSync(f, b)
      return f
    })

    // ffmpeg না থাকলেও (যেমন Termux-এ) যেন পুরো কথাটা যায়।
    // ⚠️ আগে এখানে শুধু **প্রথম টুকরোটা** পাঠানো হতো — মানে লম্বা উত্তরের
    //    বাকি অংশ চুপচাপ হারিয়ে যেতো, আর Romeo-র কথা মাঝপথে কেটে যেতো।
    //    MP3 ফ্রেমগুলো পরপর জুড়ে দিলেই সব প্লেয়ার টানা বাজায়।
    if (!(await hasFfmpeg())) {
      const joined = path.join(dir, 'voice.mp3')
      fs.writeFileSync(joined, Buffer.concat(bufs))
      return { file: joined, dir, ext: 'mp3', size: fs.statSync(joined).size, seconds: 0 }
    }

    // জোড়া লাগিয়ে WhatsApp-এর ভয়েস-নোট ফরম্যাটে (opus) বদলাই
    const list = path.join(dir, 'list.txt')
    fs.writeFileSync(list, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))
    const out = path.join(dir, 'voice.ogg')
    await exec('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', list,
      '-c:a', 'libopus', '-b:a', '48k', '-ar', '48000', '-ac', '1',
      out
    ], { timeout: 45000 })

    const size = fs.statSync(out).size
    if (size < 512) throw new Error('ভয়েস ফাইল খালি')
    return { file: out, dir, ext: 'ogg', size, seconds: 0 }
  } catch (e) {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
    console.error('🎙️ ভয়েস বানাতে সমস্যা:', e?.message || e)
    return null
  }
}

/** ভয়েস নোট পাঠানো (ptt = WhatsApp-এ ভয়েস মেসেজ হিসেবে দেখাবে) */
export async function sendVoice(sock, jid, v, quoted) {
  if (!v?.file) return null
  try {
    const buf = fs.readFileSync(v.file)
    // ⚠️ পাঠানো মেসেজটা **ফেরত দিতে হবে** — নাহলে রাউটার জানতেই পারে না
    //    যে Romeo কথা বলেছে, আর পরের কথায় সে চুপ হয়ে যায়।
    return await sock.sendMessage(jid, {
      audio: buf,
      mimetype: v.ext === 'ogg' ? 'audio/ogg; codecs=opus' : 'audio/mpeg',
      ptt: true // 🎙️ এটাই ভয়েস নোট বানায় — পরপর থাকলে নিজে থেকেই বাজে
    }, quoted ? { quoted } : undefined) || true
  } catch (e) {
    console.error('🎙️ ভয়েস পাঠাতে সমস্যা:', e?.message || e)
    return null
  }
}

/** অস্থায়ী ফাইল মুছে ফেলা */
export function dropVoice(v) {
  if (!v?.dir) return
  try { fs.rmSync(v.dir, { recursive: true, force: true }) } catch {}
}
