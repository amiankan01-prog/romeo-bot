// ==========================================================
//  📝 গানের লিরিক্স (কথা) — LRCLIB থেকে (ফ্রি, কোনো key লাগে না)
// ==========================================================
import { resolveTitle } from './music.js'

const UA = 'RomeoMamuBot/1.0 (WhatsApp group bot)'

/** lrclib-এ খোঁজা (নেট খারাপ হলে একবার আবার চেষ্টা করবে) */
async function searchLrclib(q, attempt = 0) {
  if (!q) return null
  try {
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 35000)
    let list
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      list = await r.json()
    } finally {
      clearTimeout(timer)
    }
    if (!Array.isArray(list) || !list.length) return null

    // সবচেয়ে লম্বাটা নিই (সাধারণত আসল লিরিক্স), খুব ছোটগুলো বাদ
    const withText = list.filter(s => (s.plainLyrics || s.syncedLyrics || '').length > 80)
    const best = withText[0] || list[0]
    const raw = best.plainLyrics || best.syncedLyrics || ''
    if (!raw) return null

    return { title: best.trackName || q, artist: best.artistName || '', lyrics: clean(raw) }
  } catch (err) {
    console.error('📝 lrclib খোঁজা ব্যর্থ:', err?.message || err)
    if (attempt < 1) {
      await new Promise(r => setTimeout(r, 1500))
      return searchLrclib(q, attempt + 1)
    }
    return null
  }
}

/**
 * গানের কথা খোঁজা।
 * প্রথমে সরাসরি → না পেলে JioSaavn থেকে রোমান টাইটেল এনে আবার খোঁজে
 * (কারণ "প্রজাপতি" দিয়ে সরাসরি পাওয়া যায় না, "Projapoti" দিয়ে যায়)।
 */
export async function fetchLyrics(query) {
  const q = String(query || '').trim()
  if (!q) return null

  let found = await searchLrclib(q)
  if (found) return found

  // "আরেকটা bondhu"-তে ফালতু বাংলা শব্দ মিশে থাকলে শুধু ইংরেজি অংশ দিয়ে চেষ্টা
  const latin = q.split(/\s+/).filter(w => /[a-zA-Z0-9]/.test(w)).join(' ').trim()
  if (latin && latin !== q) {
    found = await searchLrclib(latin)
    if (found) return found
  }

  const info = await resolveTitle(q)
  if (info?.title) {
    found = await searchLrclib(info.title)
    if (found) return found
    if (info.artist) found = await searchLrclib(`${info.title} ${info.artist}`)
    if (found) return found
  }
  return null
}

/** পরিষ্কার করা — খালি লাইন গুছিয়ে, টাইম-স্ট্যাম্প সরিয়ে */
function clean(text) {
  return String(text)
    .replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '') // [00:12.34] টাইম স্ট্যাম্প
    .replace(/\[\d{2}:\d{2}\]/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

/** WhatsApp-এ পাঠানোর উপযোগী করে ছাঁটা */
export function formatLyrics(song, max = 2800) {
  if (!song?.lyrics) return null
  const head = `📝 *${song.title}*${song.artist ? `\n_${song.artist}_` : ''}\n\n`
  let body = song.lyrics
  if (head.length + body.length > max) {
    body = body.slice(0, max - head.length)
    const stop = body.lastIndexOf('\n')
    if (stop > max * 0.5) body = body.slice(0, stop)
    body += '\n\n_…বাকিটা বাকি (অনেক লম্বা)_ 😅'
  }
  return head + body
}
