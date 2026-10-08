// ==========================================================
//  🔍 গানের সমস্যা খোঁজার স্ক্রিপ্ট
//  ব্যবহার:  node songdiag.mjs "গানের নাম"
//
//  এই স্ক্রিপ্ট Romeo যেই রাস্তা দিয়ে গান আনে, ঠিক সেই রাস্তা
//  ধাপে ধাপে চেষ্টা করে — কোথায় আটকাচ্ছে সেটাই বলে দেবে।
// ==========================================================
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const exec = promisify(execFile)
const query = process.argv.slice(2).join(' ') || 'প্রজাপতি'
const line = '─'.repeat(56)
const ok = n => `✅ ${n}`
const no = n => `❌ ${n}`
let problems = 0

console.log(`\n🔍 গান: "${query}"`)
console.log(line)

// ① Node
console.log(`① Node.js        : ${ok(process.version)}`)

// ② টেম্প ফোল্ডার — ⚠️ Termux-এ /tmp থাকে না, এখানে ফেল করলে গান আসবেই না
let tmpOk = false
{
  const cands = [
    process.env.TMPDIR,
    process.env.PREFIX ? process.env.PREFIX + '/tmp' : null,
    os.tmpdir(),
    '/data/data/com.termux/files/usr/tmp',
    path.join(process.cwd(), 'data', 'tmp')
  ].filter(Boolean)
  let used = ''
  for (const dir of cands) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const probe = path.join(dir, `romeo-probe-${process.pid}`)
      fs.writeFileSync(probe, 'x')
      fs.unlinkSync(probe)
      used = dir
      tmpOk = true
      break
    } catch {
      /* পরেরটা */
    }
  }
  if (tmpOk) console.log(`② টেম্প ফোল্ডার  : ${ok(used)}`)
  else {
    problems++
    console.log(`② টেম্প ফোল্ডার  : ${no('কোথাও লেখা যাচ্ছে না! গান আসবেই না।')}`)
    console.log(`     চেষ্টা করেছি: ${cands.join(', ')}`)
  }
}

// ③ JioSaavn সার্চ
let items = []
try {
  const u = new URL('https://www.jiosaavn.com/api.php')
  u.searchParams.set('__call', 'search.getResults')
  u.searchParams.set('q', query)
  u.searchParams.set('_format', 'json')
  u.searchParams.set('_marker', '0')
  u.searchParams.set('api_version', '4')
  u.searchParams.set('ctx', 'web6dot0')
  u.searchParams.set('n', '5')
  const ctrl = new AbortController()
  const tm = setTimeout(() => ctrl.abort(), 25000)
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal })
  clearTimeout(tm)
  const d = await r.json()
  items = (d.results || []).filter(s => s?.more_info?.encrypted_media_url)
  if (items.length) {
    console.log(`③ JioSaavn সার্চ: ${ok(`${items.length}টা ফলাফল`)}`)
    items.slice(0, 3).forEach((s, i) => {
      console.log(`     ${i + 1}. ${s.title} — ${s.more_info?.artistMap?.primary_artists?.[0]?.name || '?'} (${s.more_info?.duration || '?'}সে.)`)
    })
  } else {
    problems++
    console.log(`③ JioSaavn সার্চ: ${no('কিছু পাওয়া যায়নি (নেট বা নাম ভুল)')}`)
  }
} catch (e) {
  problems++
  console.log(`③ JioSaavn সার্চ: ${no(e?.message || e)}`)
}

// ④ ডিক্রিপ্ট — নিজের DES (কোনো লাইব্রেরি লাগে না) + crypto-js ব্যাকআপ
let url = null
if (items.length) {
  const enc = items[0].more_info.encrypted_media_url
  try {
    const { desEcbDecrypt } = await import('./src/features/des.js')
    const out = desEcbDecrypt(enc, '38346591')
    if (out && out.startsWith('http')) {
      url = out.replace(/_96\.(mp4|m4a)/, '_160.$1')
      console.log(`④ ডিক্রিপ্ট      : ${ok('নিজস্ব DES-এ সফল')}`)
      console.log(`     ${url.slice(0, 72)}`)
    } else console.log(`④ ডিক্রিপ্ট      : ${no('নিজস্ব DES ফাঁকি')}`)
  } catch (e) {
    console.log(`④ ডিক্রিপ্ট      : ${no('নিজস্ব DES: ' + (e?.message || e))}`)
  }

  if (!url) {
    try {
      const C = (await import('crypto-js')).default
      const out = C.DES.decrypt(enc, C.enc.Utf8.parse('38346591'), {
        mode: C.mode.ECB, padding: C.pad.Pkcs7
      }).toString(C.enc.Utf8)
      if (out && out.startsWith('http')) {
        url = out.replace(/_96\.(mp4|m4a)/, '_160.$1')
        console.log(`④ ডিক্রিপ্ট      : ${ok('crypto-js দিয়ে সফল')}`)
      } else console.log(`④ ডিক্রিপ্ট      : ${no('crypto-js-ও ফাঁকি')}`)
    } catch {
      console.log(`④ ডিক্রিপ্ট      : ${no('crypto-js নেই → সমাধান: npm install')}`)
    }
  }
  if (!url) problems++
} else {
  console.log(`④ ডিক্রিপ্ট      : ⏭️  স্কিপ`)
}

// ⑤ ডাউনলোড
if (url) {
  const t0 = Date.now()
  try {
    const ctrl = new AbortController()
    const tm = setTimeout(() => ctrl.abort(), 120000)
    const r = await fetch(url, { signal: ctrl.signal })
    clearTimeout(tm)
    if (!r.ok) {
      problems++
      console.log(`⑤ ডাউনলোড       : ${no(`HTTP ${r.status}`)}`)
    } else {
      const buf = Buffer.from(await r.arrayBuffer())
      console.log(`⑤ ডাউনলোড       : ${ok(`${(buf.length / 1048576).toFixed(1)} MB (${((Date.now() - t0) / 1000).toFixed(1)}সে.)`)}`)
      console.log(`     টাইপ: ${r.headers.get('content-type')}`)
    }
  } catch (e) {
    problems++
    console.log(`⑤ ডাউনলোড       : ${no(e?.message || e)}`)
  }
} else {
  console.log(`⑤ ডাউনলোড       : ⏭️  স্কিপ`)
}

// ⑥ ffmpeg
let ff = false
try {
  await exec('ffmpeg', ['-version'], { timeout: 15000 })
  ff = true
  console.log(`⑥ ffmpeg        : ${ok('আছে → গান আসল MP3 হবে')}`)
} catch {
  console.log(`⑥ ffmpeg        : ⚠️  নেই → গান .mp4 (AAC) আসবে, তবুও চলবে`)
  console.log(`     ইনস্টল করতে: pkg install ffmpeg -y`)
}

// ⑦ yt-dlp
try {
  await exec('yt-dlp', ['--version'], { timeout: 15000 })
  console.log(`⑦ yt-dlp        : ${ok('আছে → YouTube ব্যাকআপ চালু')}`)
} catch {
  console.log(`⑦ yt-dlp        : ⚠️  নেই (ঐচ্ছিক — JioSaavn দিয়েই চলবে)`)
}

// ⑧ আসল রাস্তা — music.js-এর fetchSong() চালিয়েই দেখি
console.log(line)
console.log('⑧ আসল টেস্ট — Romeo যেভাবে গান আনে, সেভাবেই:')
try {
  const { fetchSong } = await import('./src/features/music.js')
  const t0 = Date.now()
  const song = await fetchSong(query, 15 * 1024 * 1024)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)

  ;(song?.log || []).forEach(l => console.log(`     • ${l}`))

  if (song?.file) {
    console.log(`     ${ok(`${secs}সে.-এ পেলাম: ${path.basename(song.file)}`)}`)
    console.log(`     ${(song.size / 1048576).toFixed(1)} MB · ${song.ext} · ${song.title}${song.artist ? ' — ' + song.artist : ''}`)
    // পরিষ্কার
    try { fs.rmSync(path.dirname(song.file), { recursive: true, force: true }) } catch {}
  } else if (song?.fail === 'nodownload') {
    problems++
    console.log(`     ⚠️  গান পাওয়া গেছে কিন্তু ডাউনলোড হয়নি → শুধু লিংক পাঠাবে`)
  } else {
    problems++
    console.log(`     ${no('কোথাও পাওয়া যায়নি')}`)
  }
} catch (e) {
  problems++
  console.log(`     ${no('fetchSong ক্র্যাশ: ' + (e?.message || e))}`)
  console.log(`     স্ট্যাক: ${(e?.stack || '').split('\n').slice(1, 4).join('\n')}`)
}

console.log(line)
if (problems === 0) {
  console.log('🎉 সব ঠিক আছে — Romeo-র গান কাজ করার কথা!')
  console.log('   তবুও না এলে গ্রুপে Romeo-র জবাবের স্ক্রিনশট পাঠাও।')
} else {
  console.log(`⚠️  ${problems}টা জায়গায় সমস্যা — ওপরের ❌ গুলো দেখো`)
}
console.log('📋 এই আউটপুটটা কপি করে আমাকে পাঠাও\n')
