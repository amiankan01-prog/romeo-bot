// ==========================================================
//  Google Gemini — টেক্সট + ছবি + অডিও (ফ্রি টিয়ার)
//  কোনো লাইব্রেরি লাগে না → শুধু fetch()
// ==========================================================

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * মডেলের ক্রম — প্রথমটা প্রধান, বাকিগুলো ব্যাকআপ।
 *  - flash-lite-latest : সবচেয়ে দ্রুত, "চিন্তা" করে না → কাটা উত্তর আসার ঝুঁকি নেই
 *  - flash-latest      : একটু বেশি বুদ্ধিমান, তবে মাঝে মাঝে ব্যস্ত থাকে
 *  - gemini-3.5-flash  : নতুন প্রজন্ম (থাকলে ব্যবহার হবে)
 */
// 🔁 একটা মডেল ব্যস্ত (503) থাকলে পরেরটা ধরবে। Google-এর ফ্রি টিয়ারে
//    প্রায়ই দু-একটা মডেল ব্যস্ত থাকে — তালিকা বড় রাখলে Romeo কখনো
//    চুপ করে থাকে না। হালকা (lite) মডেল আগে, কারণ ওগুলো দ্রুত ও কম ব্যস্ত।
// ⚠️ গুরুত্বপূর্ণ: Google-এর ফ্রি কোটা **প্রতি মডেলে আলাদা**।
//    তাই একটার কোটা শেষ হলে পরেরটায় গেলে Romeo চলতেই থাকে।
//    (২০২৬-১০-০৭ তারিখে সবগুলো সরাসরি পরীক্ষা করে বাছা)
//    ক্রমটা আসল গতি মেপে সাজানো — চ্যাটে দেরি মানেই বিরক্তি।
const MODEL_CHAIN = [
  'gemini-flash-lite-latest',  // ✅ ০.৬ সেকেন্ড — সবচেয়ে দ্রুত
  'gemini-3.6-flash',          // ✅ ৫.২ সেকেন্ড
  'gemini-3.1-flash-lite',     // ✅ ৯.৫ সেকেন্ড
  'gemini-3.5-flash-lite',
  'gemini-3.7-flash',          // ⚠️ কাজ করে, কিন্তু ৩০ সেকেন্ড+ নেয়
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest'
]

// 🧠 আজ কোন মডেলের কোটা শেষ হয়ে গেছে — মনে রাখি, যাতে বারবার
//    সেই মরা দরজায় ধাক্কা দিয়ে সময় নষ্ট না হয়। রোজ রাতে নিজে থেকে মুছে যায়।
const exhausted = new Map() // model => কবে আবার চেষ্টা করা যাবে (timestamp)

const isExhausted = m => {
  const until = exhausted.get(m)
  if (!until) return false
  if (Date.now() >= until) { exhausted.delete(m); return false }
  return true
}

/** আগামীকাল সকাল পর্যন্ত এই মডেলটা বাদ (Google রোজ কোটা নতুন করে দেয়) */
const markExhausted = m => {
  const t = new Date()
  t.setHours(24, 5, 0, 0)
  exhausted.set(m, t.getTime())
}

// "থিংকিং" মডেলগুলো উত্তরের আগে ৪০০-৬০০ টোকেন চিন্তা করে →
// তাই maxOutputTokens বড় রাখতে হবে, নাহলে উত্তর মাঝখানে কেটে যায়
const MAX_TOKENS = 2048
// ⏱️ চ্যাটে ৪৫ সেকেন্ড অপেক্ষা করানো যায় না — ২০ সেকেন্ডেই হাল ছেড়ে
//    পরের চেষ্টা/মডেলে যাবো। সব মিলিয়ে তবু দ্রুত উত্তর আসে।
const TIMEOUT_MS = 20000

export class AIError extends Error {
  constructor(kind, message) {
    super(message)
    this.kind = kind // 'KEY' | 'RATE' | 'QUOTA' | 'NET' | 'OTHER'
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function buildBody({ system, history, text, media }) {
  const contents = []

  for (const h of history || []) {
    contents.push({
      role: h.role === 'me' ? 'model' : 'user',
      parts: [{ text: h.text }]
    })
  }

  const parts = []
  if (text) parts.push({ text })
  if (media?.data) {
    parts.push({
      inline_data: {
        mime_type: media.mime,
        data: Buffer.from(media.data).toString('base64')
      }
    })
    parts.push({ text: 'ওপরের ফাইলটা দেখে বাংলায় উত্তর দাও।' })
  }

  contents.push({ role: 'user', parts })

  return {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.95,
      topP: 0.95,
      maxOutputTokens: MAX_TOKENS
    }
  }
}

export async function geminiChat({ apiKey, model, system, history, text, media, deadlineMs = 28000 }) {
  if (!apiKey) throw new AIError('KEY', 'GEMINI_API_KEY সেট করা নেই')

  // ⏱️ সব মডেল মিলিয়ে সর্বোচ্চ কতক্ষণ। ফ্রি টিয়ারে অনেকগুলো মডেল
  //    একসাথে ব্যস্ত (503) থাকতে পারে — তখন চেইন ঘুরতে ঘুরতে দু-মিনিট
  //    লেগে যেতো। চ্যাটে সেটা অর্থহীন, তাই সময় ফুরোলে থেমে যাবো আর
  //    Romeo মুড-মানানসই প্রি-রাইটেন লাইন দিয়ে দেবে (সাথে সাথি)।
  const deadline = Date.now() + deadlineMs

  const body = buildBody({ system, history, text, media })
  const all = [...new Set([model, ...MODEL_CHAIN].filter(Boolean))]
  // আজ যাদের কোটা ফুরিয়েছে তাদের পিছনে পাঠাই (একেবারে বাদ দিই না —
  // সব ফুরিয়ে গেলে অন্তত একবার চেষ্টা করে দেখা ভালো)
  const fresh = all.filter(m => !isExhausted(m))
  const models = fresh.length ? fresh : all
  let lastError = 'কোনো মডেল সাড়া দেয়নি'
  let quotaHits = 0

  for (const m of models) {
    if (Date.now() >= deadline) { lastError = 'সময় ফুরিয়ে গেলো'; break }
    const url = `${BASE}/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`

    // ৩ বার চেষ্টা — 503/500 = সাময়িক ব্যস্ততা
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (Date.now() >= deadline) { lastError = 'সময় ফুরিয়ে গেলো'; break }
      let res
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.max(3000, Math.min(TIMEOUT_MS, deadline - Date.now())))
        })
      } catch (err) {
        // ⚠️ আগে এখানে সাথে সাথে throw হতো — ফলে একটা ধীর রিকোয়েস্টেই
        //    বাকি চেষ্টা আর বিকল্প মডেলগুলো সব বাতিল হয়ে যেতো, আর
        //    ব্যবহারকারী ৪৫ সেকেন্ড পরে প্রি-রাইটেন লাইন পেতো।
        //    এখন: ধরে নিই এটা সাময়িক, পরের চেষ্টা/মডেলে এগোই।
        const net = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        lastError = `${m}: ${net ? 'সময় শেষ' : err?.message || 'নেট সমস্যা'}`
        if (attempt < 3) { await sleep(400 * attempt); continue }
        break
      }

      if (res.ok) {
        const json = await res.json().catch(() => ({}))
        const parts = (json?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought)
        const out = parts.map(p => p.text || '').join('').trim()
        if (out) return { text: out, model: m }
        lastError = `${m}: খালি উত্তর`
        break
      }

      const raw = await res.text().catch(() => '')
      let apiMsg = ''
      try {
        apiMsg = JSON.parse(raw)?.error?.message || ''
      } catch {
        apiMsg = raw.slice(0, 200)
      }

      // key ভুল → আর চেষ্টা না করেই বন্ধ
      if (res.status === 401 || res.status === 403 || /api[_ ]?key/i.test(apiMsg)) {
        throw new AIError('KEY', apiMsg || `HTTP ${res.status}`)
      }

      if (res.status === 429) {
        const daily = /quota|per day|daily/i.test(apiMsg)
        if (daily) {
          // 🔑 আসল কথা: কোটা **এই মডেলটার** শেষ হয়েছে, Romeo-র নয়।
          //    আগে এখানে পুরো চেইন থামিয়ে দেওয়া হতো — ফলে একটা মডেল
          //    ফুরোলেই Romeo সারাদিন "বিশ্রাম নিচ্ছি" বলে চুপ করে থাকতো,
          //    যদিও বাকি ৭টা মডেল দিব্যি খালি পড়ে ছিল।
          markExhausted(m)
          quotaHits++
          lastError = `${m}: আজকের কোটা শেষ`
          break            // → পরের মডেলে যাও
        }
        // ⚡ রেট-লিমিট মানে এই মডেলে এখন ভিড়। আগে এখানে ৩ বার ঘুমিয়ে
        //    অপেক্ষা করা হতো (২.৪ সেকেন্ড নষ্ট), অথচ পাশের মডেলটা খালি।
        //    প্রতিটা মডেলের লিমিট আলাদা — তাই সোজা পরেরটায় চলে যাই।
        lastError = `${m}: ব্যস্ত (429)`
        break
      }

      if (res.status === 503 || res.status === 500) {
        // ⚡ 503 = ওই মডেলটা এখন ব্যস্ত। ৩ বার ঘুরে সময় নষ্ট না করে
        //    একবার চেষ্টা করেই পরের মডেলে চলে যাই — ওটা সাধারণত খালি থাকে।
        lastError = `${m}: সাময়িক ব্যস্ত (${res.status})`
        if (attempt < 2) { await sleep(500); continue }
        break
      }

      // 404 / 400 → এই মডেল নেই → পরের মডেল
      lastError = `${m}: HTTP ${res.status} ${apiMsg.slice(0, 80)}`
      break
    }
  }

  // সত্যিই সব মডেলের কোটা ফুরিয়েছে — তখনই কেবল "কোটা শেষ" বলা ঠিক
  if (quotaHits >= models.length) throw new AIError('QUOTA', lastError)
  throw new AIError('OTHER', lastError)
}
