// ==========================================================
//  🎵 গানের ইঞ্জিন — একটা সোর্স ফেল করলে আরেকটায় যাবে
//
//  সোর্স ১: JioSaavn  (সেরা — বাংলা/হিন্দি/ইংরেজি সব, YouTube-এর বট-চেক নেই)
//           → JioSaavn-এর নিজস্ব API + লোকাল DES ডিক্রিপশন (Node-তেই, কিছু ইনস্টল লাগে না)
//  সোর্স ২: JioSaavn ব্যাকআপ API (প্রথমটা বদলে গেলে)
//  সোর্স ৩: YouTube  (yt-dlp থাকলে, ২ রকম কৌশল)
//  সোর্স ৪: SoundCloud (yt-dlp)
//  সব শেষে : যা পাওয়া গেছে তার লিংক — কখনোই খালি হাতে ফেরাবে না
// ==========================================================
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { desEcbDecrypt } from './des.js'

const exec = promisify(execFile)
import { romanize, hasBengali, bestMatch, scoreMatch, MIN_SCORE } from './match.js'

const YTDLP = process.env.YTDLP_BIN || 'yt-dlp'

// ----------------------------------------------------------
//  টেম্প ফোল্ডার — ⚠️ Termux-এ /tmp থাকে না!
//  os.tmpdir() ফাঁকা /tmp দিলে fs.mkdtempSync ক্র্যাশ করতো,
//  আর Romeo "ডাউনলোড ব্যর্থ" দেখাতো — ফোনে গান না আসার আসল কারণ এটাই।
//  তাই একাধিক জায়গা চেষ্টা করে, লিখতে পারা যায় কিনা পরীক্ষা করেই বেছে নিই।
// ----------------------------------------------------------
let _tmpRoot = null
function tmpRoot() {
  if (_tmpRoot) return _tmpRoot

  const candidates = [
    process.env.TMPDIR,
    process.env.PREFIX ? process.env.PREFIX + '/tmp' : null,
    os.tmpdir(),
    '/data/data/com.termux/files/usr/tmp',
    path.join(process.cwd(), 'data', 'tmp')
  ].filter(Boolean)

  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      // সত্যিই লেখা যায়? (শুধু থাকলেই হবে না — পারমিশনও লাগে)
      const probe = path.join(dir, `romeo-probe-${process.pid}`)
      fs.writeFileSync(probe, 'x')
      fs.unlinkSync(probe)
      _tmpRoot = dir
      if (dir !== os.tmpdir()) console.error(`🎵 টেম্প ফোল্ডার: ${dir}`)
      return dir
    } catch {
      /* এই জায়গা কাজ করলো না → পরেরটা চেষ্টা */
    }
  }

  _tmpRoot = os.tmpdir()
  return _tmpRoot
}

// WhatsApp যে অডিও টাইপগুলো বুঝতে পারে
const MIME = {
  m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg',
  webm: 'audio/ogg', weba: 'audio/ogg'
}

// JioSaavn কোয়ালিটি → আনুমানিক বাইট/সেকেন্ড
const RATES = { 320: 40 * 1024, 160: 20 * 1024, 96: 12 * 1024 }

// কী কী চেষ্টা করা হলো — সমস্যা হলে Romeo নিজেই বলতে পারবে
let LOG = []
const note = msg => { LOG.push(msg); console.error('🎵 ' + msg) }

let _cryptoJs = null
/** crypto-js লোড (থাকলে) — JioSaavn লিংক ডিক্রিপ্ট করতে */
async function cryptoJs() {
  if (_cryptoJs !== null) return _cryptoJs
  try {
    _cryptoJs = (await import('crypto-js')).default
  } catch {
    _cryptoJs = false
  }
  return _cryptoJs
}

/** yt-dlp আছে কিনা */
export async function hasDownloader() {
  try {
    await exec(YTDLP, ['--version'], { timeout: 20000 })
    return true
  } catch {
    return false
  }
}

/** ffmpeg আছে কিনা — থাকলে আসল MP3 বানানো যাবে */
let _ffmpeg = null
export async function hasFfmpeg() {
  if (_ffmpeg !== null) return _ffmpeg
  try {
    await exec('ffmpeg', ['-version'], { timeout: 20000 })
    _ffmpeg = true
  } catch {
    _ffmpeg = false
  }
  return _ffmpeg
}

/**
 * AAC (.mp4/.m4a) → আসল MP3।
 * ffmpeg না থাকলে null — তখন যা আছে তাই পাঠাবে (WhatsApp-এ চলবে)।
 */
async function toMp3(file, dir) {
  if (!(await hasFfmpeg())) return null
  const out = path.join(dir, 'song.mp3')
  try {
    await exec(
      'ffmpeg',
      // ⚡ গতি: VBR (-q:a 5 ≈ ১৩০kbps) CBR ১৯২k-এর চেয়ে ~২০% দ্রুত আর
      //    ~২৭% ছোট — ফোনের স্পিকারে পার্থক্য বোঝা যায় না, কিন্তু
      //    কনভার্সন আর আপলোড দুটোই তাড়াতাড়ি হয়।
      //    `-threads 0` = ফোনের সব কোর কাজে লাগাও।
      ['-y', '-loglevel', 'error', '-threads', '0', '-i', file,
        '-codec:a', 'libmp3lame', '-q:a', '5', '-map_metadata', '0', out],
      // ⚠️ maxBuffer ডিফল্টে ১ MB — ffmpeg সামান্য সতর্কবার্তা দিলেই
      //    "maxBuffer exceeded" দিয়ে কনভার্ট ফেল করতো → গান .mp4-ই থেকে যেতো।
      { timeout: 240000, maxBuffer: 16 * 1024 * 1024 }
    )
    if (fs.existsSync(out)) {
      const size = fs.statSync(out).size
      if (size > 8192) return { file: out, size }
    }
  } catch (err) {
    console.error('🎵 MP3 কনভার্ট ব্যর্থ:', err?.message || err)
  }
  return null
}

function run(args, ms = 120000) {
  return exec(YTDLP, args, { timeout: ms, maxBuffer: 12 * 1024 * 1024 })
}

const safeName = s =>
  String(s || 'song').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 55) || 'song'

/** সময় সীমার মধ্যে সবচেয়ে ভালো কোয়ালিটি বেছে নেওয়া */
function pickQuality(durationSec, capBytes) {
  // গান কতক্ষণের জানা না থাকলে ৩২০kbps ধরে বসতো → ফাইল বিশাল → সাইজ বেশি
  // দেখে ফেল করতো, তারপর ১৬০/৯৬ চেষ্টা করতো — অযথা সময় নষ্ট।
  // তাই অজানা হলে মাঝারি (১৬০) থেকে শুরু।
  // ⚡ আগে ৩২০kbps নামানো হতো, তারপর MP3-তে ~১৩০kbps-এ বদলানো হতো —
  //    মানে অর্ধেক ডেটা আর সময় একেবারে নষ্ট। ফোনে মোবাইল ডেটায় এটা
  //    বড় ব্যাপার, তাই ১৬০kbps থেকেই শুরু করি (শোনার পার্থক্য নেই)।
  for (const q of [160, 96]) {
    if (!durationSec) return 160
    if (durationSec * RATES[q] <= capBytes * 0.9) return q
  }
  return 96
}

// ══════════════════════════════════════════════════════════
//  সোর্স ১ + ২: JioSaavn
// ══════════════════════════════════════════════════════════

/** JioSaavn-এর নিজস্ব সার্চ API (থার্ড-পার্টি নয়) */
async function saavnSearch(query) {
  const u = new URL('https://www.jiosaavn.com/api.php')
  u.searchParams.set('__call', 'search.getResults')
  u.searchParams.set('q', query)
  u.searchParams.set('_format', 'json')
  u.searchParams.set('_marker', '0')
  u.searchParams.set('api_version', '4')
  u.searchParams.set('ctx', 'web6dot0')
  u.searchParams.set('n', '15')  // বেশি ফলাফল = ভালো মিল বাছার সুযোগ

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal })
    const d = await r.json()
    const list = (d.results || []).filter(s => s?.more_info?.encrypted_media_url)
    if (!list.length) return []
    return list.map(s => ({
      title: s.title || '',
      artist:
        s.more_info?.artistMap?.primary_artists?.[0]?.name ||
        s.more_info?.singers ||
        s.subtitle ||
        '',
      duration: Number(s.more_info?.duration || 0) || 0,
      enc: s.more_info.encrypted_media_url,
      page: s.perma_url ? 'https://www.jiosaavn.com' + s.perma_url : ''
    }))
  } finally {
    clearTimeout(timer)
  }
}

/** ব্যাকআপ API (প্রথমটা কাজ না করলে) */
async function saavnMirror(query) {
  const u = `https://saavnapi-nine.vercel.app/result/?query=${encodeURIComponent(query)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const r = await fetch(u, { signal: ctrl.signal })
    const d = await r.json()
    const list = Array.isArray(d) ? d : []
    return list
      .filter(s => s?.media_url)
      .map(s => ({
        title: s.song || '',
        artist: String(s.primary_artists || s.singers || '').split(',')[0] || '',
        duration: Number(s.duration || 0) || 0,
        direct: s.media_url, // এনক্রিপ্টেড নয় — সরাসরি ব্যবহার করা যাবে
        page: s.perma_url || ''
      }))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * DES দিয়ে লিংক খোলা — _96.mp4 → _320.mp4 বদলে কোয়ালিটি বাড়ানো।
 * প্রথমে নিজের লেখা বিশুদ্ধ-JS DES (কোনো লাইব্রেরি লাগে না),
 * সেটা ফেল করলে crypto-js দিয়ে চেষ্টা করবে।
 */

/**
 * গানের নামের "ইংরেজি/রোমান" রূপ বের করা।
 * "প্রজাপতি" → "Projapoti" — লিরিক্স সাইটগুলো বাংলা লিপিতে খুঁজে পায় না,
 * তাই JioSaavn-এর রোমান টাইটেল দিয়ে আবার খোঁজা হয়।
 */
export async function resolveTitle(query) {
  try {
    const items = await saavnSearch(query)
    if (items.length && items[0].title) return { title: items[0].title, artist: items[0].artist }
  } catch {
    /* চুপচাপ পরের চেষ্টা */
  }
  try {
    const m = await saavnMirror(query)
    if (m.length && m[0].title) return { title: m[0].title, artist: m[0].artist }
  } catch {
    /* কিছু না */
  }
  return null
}
async function decryptUrl(enc, quality) {
  let out = null
  try {
    out = desEcbDecrypt(enc, '38346591')
  } catch (e) {
    console.error('🎵 নিজস্ব DES ব্যর্থ:', e?.message || e)
  }

  if (!out || !out.startsWith('http')) {
    const C = await cryptoJs()
    if (C) {
      try {
        out = C.DES.decrypt(enc, C.enc.Utf8.parse('38346591'), {
          mode: C.mode.ECB,
          padding: C.pad.Pkcs7
        }).toString(C.enc.Utf8)
      } catch {
        out = null
      }
    }
  }

  if (!out || !out.startsWith('http')) { note('লিংক ডিক্রিপ্ট করা যায়নি'); return null }
  return out.replace(/_96\.(mp4|m4a)/, `_${quality}.$1`)
}

/** JioSaavn থেকে গান — দুটো রাস্তা চেষ্টা করে */
async function fromSaavn(query, cap) {
  let fallback = null // ডাউনলোড না হলেও অন্তত লিংকটা থাকবে

  // 🔤 বাংলা লিপিতে JioSaavn কিছুই খুঁজে পায় না — আগে রোমানে বদলে নিই
  const q = hasBengali(query) ? romanize(query) : query
  if (q !== query) note(`বাংলা → রোমান: "${q}"`)

  // --- রাস্তা ১: নিজস্ব API + লোকাল ডিক্রিপশন ---
  let items = []
  try {
    items = await saavnSearch(q)
    note(`JioSaavn সার্চ: ${items.length}টা ফলাফল`)
  } catch (e) {
    note(`JioSaavn সার্চ ব্যর্থ: ${e?.message || e}`)
  }

  // 🎯 এখানেই আসল বদল: আগে তালিকার প্রথমটাই নেওয়া হতো (তাই ভুল গান
  //    আসতো)। এখন প্রতিটার সাথে চাওয়া নামের মিল মেপে সাজাই।
  const best = bestMatch(query, items)
  if (!best) {
    if (items.length) {
      // 🤔 কড়া মিল পাইনি। ভুল গান *পাঠাবো* না — কিন্তু একদম খালি হাতেও
      //    ফেরাবো না। সবচেয়ে কাছেরটা "এটা কি?" বলে রেখে দিই; সব সোর্স
      //    ফেল করলে Romeo এটাই জিজ্ঞেস করবে।
      const ranked = items
        .map(it => ({ it, sc: scoreMatch(query, it) }))
        .sort((x, y) => y.sc - x.sc)
      const top = ranked[0]
      note(`❌ JioSaavn-এ পাকা মিল নেই (সেরা: "${top.it.title}" — ${top.sc}/100)`)
      if (top.sc >= 20 && top.it.page) {
        fallback = {
          title: top.it.title, artist: top.it.artist,
          url: top.it.page, source: 'JioSaavn', maybe: true
        }
      }
    }
  } else {
    note(`🎯 মিল: "${best.item.title}" — ${best.item.artist} (${best.score}/100)`)
    // সবচেয়ে ভালো মিল থেকে শুরু করে নিচের দিকে নামবো
    const ordered = best.ranked.filter(r => r.score >= MIN_SCORE).slice(0, 3).map(r => r.item)

    for (const it of ordered) {
      if (!fallback && it.page) {
        fallback = { title: it.title, artist: it.artist, url: it.page, source: 'JioSaavn' }
      }
      const qual = pickQuality(it.duration, cap)
      for (const quality of [...new Set([qual, 160, 96])].filter(v => v <= qual)) {
        const url = await decryptUrl(it.enc, quality)
        if (!url) continue
        const got = await grab(url, cap, { title: it.title, artist: it.artist, page: it.page, source: 'JioSaavn' })
        if (got) return got
      }
    }
  }

  // --- রাস্তা ২: ব্যাকআপ API (এখানেও মিল যাচাই করি) ---
  try {
    const mirror = await saavnMirror(q)
    const mBest = bestMatch(query, mirror)
    if (mBest) {
      note(`🎯 ব্যাকআপে মিল: "${mBest.item.title}" (${mBest.score}/100)`)
      for (const mm of mBest.ranked.filter(r => r.score >= MIN_SCORE).slice(0, 3).map(r => r.item)) {
        if (!fallback && (mm.page || mm.direct)) {
          fallback = { title: mm.title, artist: mm.artist, url: mm.page || mm.direct, source: 'JioSaavn (ব্যাকআপ)' }
        }
        const got = await grab(mm.direct, cap, { title: mm.title, artist: mm.artist, page: mm.page, source: 'JioSaavn (ব্যাকআপ)' })
        if (got) return got
      }
    } else if (mirror.length) {
      note('❌ ব্যাকআপেও মিল পেলাম না')
    }
  } catch (e) {
    note(`JioSaavn ব্যাকআপ ব্যর্থ: ${e?.message || e}`)
  }

  return fallback
}

/** সরাসরি লিংক থেকে অডিও নামানো (একবার ব্যর্থ হলে আবার চেষ্টা) */
async function grab(url, cap, meta, attempt = 0) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 180000) // ধীর নেটেও সময় পাবে
  let dir = null
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)

    const len = Number(r.headers.get('content-length') || 0)
    if (len && len > cap) { note(`সাইজ বেশি (${(len / 1048576).toFixed(1)}MB) — কম কোয়ালিটি চেষ্টা`); return null }

    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 4096) throw new Error('ফাইল খুব ছোট')
    if (buf.length > cap) return null

    dir = fs.mkdtempSync(path.join(tmpRoot(), 'romeo-song-'))
    const ext = (url.split('?')[0].split('.').pop() || 'm4a').toLowerCase()
    const file = path.join(dir, `song.${ext}`)
    fs.writeFileSync(file, buf)

    // 🎵 আসল MP3 বানানোর চেষ্টা (ffmpeg থাকলে)
    const mp3 = await toMp3(file, dir)
    if (mp3 && mp3.size <= cap) {
      return {
        title: meta.title, artist: meta.artist, url: meta.page || url,
        source: meta.source, file: mp3.file, ext: 'mp3', size: mp3.size, dir
      }
    }

    return {
      title: meta.title, artist: meta.artist, url: meta.page || url,
      source: meta.source, file, ext, size: buf.length, dir
    }
  } catch (e) {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
    note(`ডাউনলোড ব্যর্থ (চেষ্টা ${attempt + 1}): ${e?.message || e}`)
    if (attempt < 1) {
      await new Promise(r => setTimeout(r, 1500))
      return grab(url, cap, meta, attempt + 1) // একবার আবার চেষ্টা
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ══════════════════════════════════════════════════════════
//  সোর্স ৩ + ৪: yt-dlp (YouTube / SoundCloud)
// ══════════════════════════════════════════════════════════

async function ytSearch(query, prefix) {
  try {
    const { stdout } = await run(
      ['--no-playlist', '--flat-playlist', '--dump-single-json', `${prefix}${query}`],
      60000
    )
    const info = JSON.parse(String(stdout || '{}'))
    const entries = Array.isArray(info.entries) && info.entries.length ? info.entries : [info]

    // 🎯 আগে সবসময় প্রথম ফলাফলটাই নেওয়া হতো — তাই কভার/রিঅ্যাকশন
    //    ভিডিও চলে আসতো। এখন নামের মিল মেপে সেরাটা বাছি।
    const cands = entries
      .map(e => {
        const id = e.id || ''
        let url = e.webpage_url || e.url || ''
        if (id.length === 11 && !/^https?:/.test(url)) url = `https://www.youtube.com/watch?v=${id}`
        return { title: e.title || '', artist: e.uploader || e.channel || '', url, duration: Number(e.duration || 0) }
      })
      .filter(c => c.url && !c.url.startsWith('ytsearch') && !c.url.startsWith('scsearch'))
      // ১০ সেকেন্ডের কম বা ২০ মিনিটের বেশি = গান নয় (ক্লিপ বা ঘণ্টাখানেকের মিক্স)
      .filter(c => !c.duration || (c.duration >= 10 && c.duration <= 1200))

    if (!cands.length) return null

    // মিল যথেষ্ট হলে সেরাটা, নাহলে প্রথমটা (YouTube-এর নিজের র‍্যাংকিং ভালো)
    const best = bestMatch(query, cands, 35)
    return best ? best.item : cands[0]
  } catch {
    return null
  }
}

/** YouTube মাঝেমধ্যে "তুমি বট নাও তা নিশ্চিত করো" বলে বন্ধ করে দেয় — তাই ২ কৌশল */
async function ytDownload(url, outPath) {
  const strategies = [
    ['--extractor-args', 'youtube:player_client=android_vr,ios,mweb,web'],
    []
  ]
  for (const extra of strategies) {
    try {
      await run(
        ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '--no-playlist', '--no-check-certificate',
          '--no-warnings', '--no-part', ...extra, '-o', outPath, url],
        90000
      )
      return true
    } catch {
      /* পরের কৌশল চেষ্টা করবো */
    }
  }
  return false
}

/** yt-dlp দিয়ে YouTube → SoundCloud */
async function fromYtDlp(query, cap) {
  if (!(await hasDownloader())) return null

  // 🔤 বাংলা লিপিও চলে, তবে রোমান বানানে ফলাফল বেশি ভালো আসে
  const q = hasBengali(query) ? romanize(query) : query

  let linkOnly = null
  // ytsearch5 = ৫টা ফলাফল এনে মিল দেখে বাছবো (আগে ছিল ytsearch1)
  for (const [prefix, label] of [['ytsearch5:', 'YouTube'], ['scsearch5:', 'SoundCloud']]) {
    const found = await ytSearch(q, prefix)
    if (!found) continue
    if (!linkOnly) linkOnly = { title: found.title, artist: found.artist || '', url: found.url, source: label }

    let dir = null
    const drop = () => { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} } }
    try {
      dir = fs.mkdtempSync(path.join(tmpRoot(), 'romeo-song-'))
      const ok = await ytDownload(found.url, path.join(dir, 'song.%(ext)s'))
      if (!ok) { drop(); continue }

      const files = fs.readdirSync(dir).filter(f => !f.endsWith('.part') && !f.endsWith('.ytdl'))
      if (!files.length) { drop(); continue }

      const file = path.join(dir, files[0])
      const size = fs.statSync(file).size
      if (size > cap || size < 1024) { drop(); continue }

      // 🎵 আসল MP3 বানানোর চেষ্টা
      const mp3 = await toMp3(file, dir)
      if (mp3 && mp3.size <= cap) {
        return { title: found.title, artist: found.artist || '', url: found.url, source: label, file: mp3.file, ext: 'mp3', size: mp3.size, dir }
      }
      return {
        title: found.title, artist: found.artist || '', url: found.url, source: label,
        file, ext: path.extname(files[0]).slice(1).toLowerCase(), size, dir
      }
    } catch (e) {
      console.error(`🎵 ${label} ব্যর্থ:`, e?.message || e)
      drop()
    }
  }
  return linkOnly
}

// ══════════════════════════════════════════════════════════
//  মূল ফাংশন — সব সোর্স একের পর এক চেষ্টা করবে
// ══════════════════════════════════════════════════════════

export async function fetchSong(query, maxBytes) {
  const cap = maxBytes || 15 * 1024 * 1024
  LOG = [] // নতুন খোঁজা শুরু
  let link = null

  // ১) JioSaavn — সবচেয়ে নির্ভরযোগ্য, কোনো ইনস্টল লাগে না
  try {
    const s = await fromSaavn(query, cap)
    if (s) {
      note(`${s.source}: ${s.file ? '✅ অডিও পেলাম' : '🔗 শুধু লিংক'}`)
      if (s.file) return { ...s, log: [...LOG] }
      link = s
    }
  } catch (e) {
    note(`JioSaavn সমস্যা: ${e?.message || e}`)
  }

  // ২) yt-dlp (YouTube → SoundCloud) — থাকলে
  try {
    const y = await fromYtDlp(query, cap)
    if (y) {
      note(`${y.source}: ${y.file ? '✅ অডিও পেলাম' : '🔗 শুধু লিংক'}`)
      if (y.file) return { ...y, log: [...LOG] }
      if (!link) link = y
    }
  } catch (e) {
    note(`yt-dlp সমস্যা: ${e?.message || e}`)
  }

  // ৩) ফাইল পাইনি — তবে লিংক দিই (কখনো খালি হাতে না)
  if (link) return { ...link, log: [...LOG], fail: 'nodownload' }
  return { fail: 'nothing', log: [...LOG] }
}

/** অডিও পাঠানো */
export async function sendAudio(sock, jid, song) {
  if (!song?.file) return false
  try {
    const buf = fs.readFileSync(song.file)
    await sock.sendMessage(jid, {
      audio: buf,
      mimetype: MIME[song.ext] || 'audio/mp4',
      ptt: false, // ভয়েস নোট নয় — গান
      fileName: `${safeName(song.title)}.${song.ext || 'm4a'}`
    })
    return true
  } catch (err) {
    console.error('🎵 অডিও পাঠাতে সমস্যা:', err?.message || err)
    return false
  }
}

/** টেম্প ফাইল মুছে ফেলা */
export function cleanup(song) {
  if (!song?.dir) return
  try {
    fs.rmSync(song.dir, { recursive: true, force: true })
  } catch {
    /* কিছু না */
  }
}
