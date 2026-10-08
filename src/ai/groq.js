// ==========================================================
//  Groq — ব্যাকআপ brain (ঐচ্ছিক, কিন্তু খুব কাজের)।
//  Gemini ব্যস্ত বা কোটা শেষ হলে এটা চেষ্টা করবে।
//  GROQ_API_KEY না থাকলে এই মডিউল নীরবে বন্ধ থাকে।
//
//  ⚠️ কেন এটা এত জরুরি: Google-এর ফ্রি টিয়ার মাঝে মাঝে ভিড়ে ঠাসা
//     থাকে (HTTP 503)। তখন Romeo-র সব মডেল একসাথে ব্যর্থ হয় আর সে
//     প্রি-রাইটেন লাইনে নেমে আসে। Groq-এর সার্ভার আলাদা আর অনেক
//     দ্রুত — তাই একটা ফ্রি Groq key থাকলে Romeo প্রায় কখনোই চুপ হয় না।
// ==========================================================

const URL = 'https://api.groq.com/openai/v1/chat/completions'

// 🔴 ২০২৬-০৮-১৬ তারিখে Groq ফ্রি টিয়ার থেকে llama-3.3-70b-versatile
//    আর llama-3.1-8b-instant **সরিয়ে দিয়েছে**। আমাদের ডিফল্ট ছিল ঠিক
//    সেই মডেলটাই — অর্থাৎ ব্যাকআপ ইঞ্জিনটা নীরবে অকেজো হয়ে পড়ে ছিল।
//    নিচের মডেলগুলো ২০২৬-১০ পর্যন্ত ফ্রি টিয়ারে সচল।
const MODEL_CHAIN = [
  'openai/gpt-oss-120b',   // ৩০/মিনিট · ১০০০/দিন · ~৫০০ টোকেন/সেকেন্ড
  'openai/gpt-oss-20b',    // ৩০/মিনিট · ১০০০/দিন · ~১০০০ টোকেন/সেকেন্ড (সবচেয়ে দ্রুত)
  'qwen/qwen3-32b',        // ৬০/মিনিট · ১০০০/দিন
  'meta-llama/llama-4-scout-17b-16e-instruct'
]

const DEFAULT_MODEL = MODEL_CHAIN[0]
const TIMEOUT_MS = 8000

/** এই মডেলটা এখন ব্যস্ত/শেষ — অল্প সময়ের জন্য সরিয়ে রাখি */
const busy = new Map()
const isBusy = m => {
  const until = busy.get(m)
  if (!until) return false
  if (Date.now() >= until) { busy.delete(m); return false }
  return true
}

export async function groqChat({ apiKey, model, system, history, text }) {
  if (!apiKey) throw new Error('GROQ_API_KEY নেই')

  const messages = [{ role: 'system', content: system }]
  for (const h of history || []) {
    messages.push({ role: h.role === 'me' ? 'assistant' : 'user', content: h.text })
  }
  messages.push({ role: 'user', content: text })

  // চাওয়া মডেল আগে, তারপর বাকিগুলো। ব্যস্তগুলো পিছনে।
  const all = [...new Set([model, ...MODEL_CHAIN].filter(Boolean))]
  const fresh = all.filter(m => !isBusy(m))
  const models = fresh.length ? fresh : all

  let lastError = 'Groq সাড়া দেয়নি'

  for (const m of models) {
    let res
    try {
      res = await fetch(URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: m,
          messages,
          temperature: 0.9,
          max_tokens: 500
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch (err) {
      // সময় শেষ বা নেট সমস্যা → এই মডেল সরিয়ে পরেরটায়
      busy.set(m, Date.now() + 60 * 1000)
      lastError = `${m}: ${err?.name === 'TimeoutError' ? 'সময় শেষ' : err?.message || 'নেট সমস্যা'}`
      continue
    }

    if (res.ok) {
      const json = await res.json().catch(() => ({}))
      const out = json?.choices?.[0]?.message?.content?.trim()
      if (out) return { text: out, model: m }
      lastError = `${m}: খালি উত্তর`
      continue
    }

    const detail = (await res.text().catch(() => '')).slice(0, 150)

    // key ভুল → আর চেষ্টা করে লাভ নেই
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Groq key সমস্যা (HTTP ${res.status}) — ${detail}`)
    }

    // 429 = কোটা/ভিড় · 404 = মডেল আর নেই · 5xx = সার্ভার ব্যস্ত
    //   → সবক্ষেত্রেই এই মডেলটা সরিয়ে পরেরটায় যাই
    busy.set(m, Date.now() + (res.status === 404 ? 6 * 60 * 60 * 1000 : 90 * 1000))
    lastError = `${m}: HTTP ${res.status} — ${detail}`
  }

  throw new Error(lastError)
}

export { MODEL_CHAIN as GROQ_MODELS, DEFAULT_MODEL }
