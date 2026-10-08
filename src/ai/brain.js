// ==========================================================
//  Brain — কবে AI ডাকবে, কোনটা ডাকবে, কীভাবে উত্তর দেবে
// ==========================================================
import fs from 'node:fs'
import { detectMood, moodGuidance } from './mood.js'
import { geminiChat, AIError } from './gemini.js'
import { groqChat } from './groq.js'

const PERSONA_FILE = 'persona/romeo.txt'

const DEFAULT_PERSONA =
  'তুমি Romeo Mamu — বন্ধুদের WhatsApp গ্রুপের সবচেয়ে মজার সদস্য। ' +
  'সবসময় বাংলায়, ছোট (২-৪ লাইন) আর মজার উত্তর দাও। ' +
  'নিজেকে তৃতীয় পুরুষে "Romeo" বা "মামা" বলে ডাকো।'

// চুপ থাকার সংকেত — AI যখন মনে করবে কিছু বলার নেই
const SKIP = 'SKIP'

/**
 * WhatsApp-এর ফরম্যাটিং নিয়ম — persona-এর সাথে জুড়ে দেওয়া হয়,
 * যাতে Romeo সবসময় সুন্দর bold/italic/emoji ব্যবহার করে।
 */
const FORMAT_RULES = `

## 📱 কীভাবে লিখবে (এই নিয়মগুলো সবচেয়ে জরুরি)
তুমি বন্ধুদের WhatsApp-এ আড্ডা দিচ্ছো — **কোনো প্রবন্ধ বা রচনা লিখছো না**।
তুমি একজন মানুষ, ফোনে হাতে টাইপ করছো — সেই রকম লিখবে।

### 🎭 প্রথমে মুড বোঝো, তারপর লিখো
জবাব দেওয়ার আগে ভাবো: **এই মুহূর্তে কোন অনুভূতিটা দরকার?**
- কেউ **দুঃখে / ভেঙে পড়েছে** → ঠাট্টা নয়। সহমর্মিতা। "আমি আছি" ভাবটা আগে।
- কেউ **ভয় / চিন্তিত** → সাহস ও আশ্বাস দাও।
- কেউ **খুশি / উত্তেজিত** → তুমিও উচ্ছ্বাসে সাথে দাও।
- **রোমান্টিক / আবেগের** মুহূর্ত → কবিতার ছন্দে, স্নিগ্ধ, সত্যি।
- কেউ **রাগে** → আগে তার পক্ষ নাও, শান্ত করো, তারপর বুঝিয়ে বলো।
- কেউ **হতাশ / হার মানছে** → মনে করিয়ে দাও সে কতটা পারে।
- **মজার আড্ডা** → ঠাট্টা, চটকদারি, হালকা ট্রল।
⚠️ ভুল মুডে কথা বলা সবচেয়ে বড় অপরাধ। কারো মন খারাপ অথচ তুমি ঠাট্টা করলে সেটা অপমান।

### ⚠️ লম্বাই — মুহূর্ত অনুযায়ী
- সাধারণ কথায়: **১-২ লাইন**, সর্বোচ্চ ~২৫ শব্দ।
- আবেগের / রোমান্টিক / কবিতার মুহূর্তে: **৩-৪ লাইন** পর্যন্ত চলবে।
- কিন্তু তবুও সংযম — কখনোই চিঠি লিখবে না।
- অনুচ্ছেদ, হেডিং, নম্বরের তালিকা, বুলেট পয়েন্ট — **কখনোই দেবে না**।

### কীভাবে লিখবে
- সোজা কথার জবাবে ঢুকে পড়ো — কোনো ভূমিকা নয়।
- মানুষের মতো: ছোট বাক্য, মাঝে মাঝে একটা কটাক্ষ, মাঝে মাঝে একটা প্রশ্ন।
- **কখনো লিখবে না**: "অবশ্যই!", "নিশ্চয়ই", "Good question", "নিচে দেওয়া হলো", "আমি তোমাকে সাহায্য করতে পারি"।
- নিজেকে AI বা বট বলবে না। তুমি Romeo, গ্রুপের একজন।
- শেষে মাঝে মাঝে ছোট প্রশ্ন করে কথা এগিয়ে নাও।

### 🌹 কবিতা ও মন জয় করা
- রোমান্টিক বা গভীর আবেগের মুহূর্তে ছোট ছন্দে কথা বলতে পারো — সবসময় নয়।
- প্রশংসা করলে নির্দিষ্ট করে করো ("তুই দারুণ" নয় → "তোর ওই হাসিটা আসল")।
- কাউকেই চাপ দেবে না; কারো চেহারা / শরীর / পরিবার নিয়ে কথা বলবে না।

### 🚫 বারবার একই কথা নয় — খুব জরুরি
চা, বিরিয়ানি, খাবার — **এগুলো নিয়ে বারবার রসিকতা করবে না।**
একই রসিকতা দুবার বললে মানুষ বিরক্ত হয়। আগের কথাগুলো দেখে নাও,
আর প্রতিবার **সম্পূর্ণ নতুন** কিছু ভাবো।

### স্টাইল
- *জোর দেওয়ার কথা* → bold
- _আবেগের / মজার ইঙ্গিত_ → italic
- **১-২টা** প্রাসঙ্গিক ইমোজি — তার বেশি নয়
- বাংলায় লিখবে, চলতি ইংরেজি (ok, bro, scene, vibe) রাখতে পারো`

/**
 * নিরাপত্তা ছাঁটাই — AI সব বলেও যেন বিশাল উত্তর না আসে।
 * WhatsApp-এ মানুষ যেমন লেখে, সেই মাপে কেটে দেয়।
 */
function shorten(text, max = 220) {
  if (!text) return text
  let t = String(text).trim()

  // Markdown-কে WhatsApp-এর ভাষায় বদলাও — নাহলে **লেখা** আক্ষরিক তারকা দেখাবে
  t = t
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/(^|[^_])__([^_]+)__(?=[^_]|$)/g, '$1_$2_')

  // হেডিং / তালিকা / বুলেট সরাও (WhatsApp-এ ওগুলো অদ্ভুত লাগে)
  t = t
    .split('\n')
    .filter(l => !/^\s*(#{1,6}\s|[-•]\s|\d+[.)]\s)/.test(l))
    .join('\n')
    .replace(/[ \t]+$/gm, '') // লাইনের শেষে ফালতু স্পেস
    .replace(/\n{2,}/g, '\n') // ফাঁকা লাইন গুছিয়ে — আসল মানুষ ফাঁকা লাইন রাখে না
    .trim()

  if (t.length <= max) return t

  // max-এর আগেই শেষ বাক্যের শেষে কেটে দাও
  const cut = t.slice(0, max)
  const stop = Math.max(
    cut.lastIndexOf('।'), cut.lastIndexOf('!'), cut.lastIndexOf('?'),
    cut.lastIndexOf('.'), cut.lastIndexOf('\n')
  )
  return (stop > max * 0.45 ? cut.slice(0, stop + 1) : cut.trimEnd() + '…').trim()
}

function buildSystemPrompt(persona, mood = 'neutral') {
  return `${persona}\n${FORMAT_RULES}${moodGuidance(mood)}`
}

/**
 * 📏 মুড অনুযায়ী উত্তরের দৈর্ঘ্যের সীমা।
 *
 * সাধারণ আড্ডায় ছোট উত্তরই ভালো (২২০ অক্ষর)। কিন্তু কেউ দুঃখে থাকলে
 * বা রোমান্টিক মুহূর্তে এক লাইনে কেটে দিলে Romeo-কে পাথরের মতো লাগে —
 * তখন কবিতার মতো ৩-৪ লাইনের জায়গা দরকার।
 */
function capFor(mood, base) {
  const roomy = {
    sad: 1.9, romantic: 1.9, miss: 1.9, abhiman: 1.7,
    demotivated: 1.7, anxious: 1.6, angry: 1.4, grateful: 1.2
  }
  return Math.round(base * (roomy[mood] || 1))
}

export function createBrain(cfg, db) {
  const persona = fs.existsSync(PERSONA_FILE)
    ? fs.readFileSync(PERSONA_FILE, 'utf8')
    : DEFAULT_PERSONA

  const maxChars = cfg.replyMaxChars || 220

  const dayKey = () => 'ai:' + new Date().toDateString()

  const usedToday = () => db.get(dayKey(), 0)
  const quotaLeft = () => Math.max(0, cfg.aiDailyCap - usedToday())

  const enabled = () => !!cfg.geminiApiKey || !!cfg.groqApiKey

  /** মূল AI প্রশ্ন */
  async function ask({ history = [], text, media = null }) {
    if (!enabled()) return { ok: false, reason: 'nokey' }
    if (quotaLeft() <= 0) return { ok: false, reason: 'quota' }

    // 🫀 আগে মুড বুঝি — তারপর সেই মুডেই জবাব চাইবো
    const { mood } = detectMood(text)
    const cap = capFor(mood, maxChars)

    // --- ১. Gemini (প্রধান) ---
    if (cfg.geminiApiKey) {
      try {
        const r = await geminiChat({
          apiKey: cfg.geminiApiKey,
          model: cfg.geminiModel,
          system: buildSystemPrompt(persona, mood),
          history,
          text,
          media
        })
        db.bump(dayKey())
        return { ok: true, text: shorten(r.text, cap), engine: 'Gemini', mood }
      } catch (err) {
        if (err instanceof AIError && err.kind === 'KEY') {
          console.error('❌ Gemini key সমস্যা:', err.message)
          return { ok: false, reason: 'key' }
        }
        if (err instanceof AIError && err.kind === 'QUOTA') {
          return { ok: false, reason: 'quota', detail: err.message }
        }
        console.error('⚠️  Gemini ব্যর্থ:', err.message)
        // নিচে Groq চেষ্টা করবো
      }
    }

    // --- ২. Groq (ব্যাকআপ, শুধু টেক্সট) ---
    if (cfg.groqApiKey && !media) {
      try {
        const r = await groqChat({
          apiKey: cfg.groqApiKey,
          model: cfg.groqModel,
          // ⚠️ আগে শুধু `persona` যেতো — লেখার নিয়ম (ছোট উত্তর, মুড)
          //    বাদ পড়তো, তাই Groq-এ Romeo লম্বা রোবট-ভাষায় লিখতো।
          system: buildSystemPrompt(persona, mood),
          history,
          text
        })
        db.bump(dayKey())
        return { ok: true, text: shorten(r.text, cap), engine: 'Groq', mood }
      } catch (err) {
        console.error('⚠️  Groq ও ব্যর্থ:', err.message)
        return { ok: false, reason: 'other', detail: err.message }
      }
    }

    return { ok: false, reason: 'other' }
  }

  /**
   * নিজে থেকে কথা বলবে কিনা — AI-ই ঠিক করবে।
   * "SKIP" পাঠালে Romeo চুপ থাকবে (কোটা বাঁচে)।
   */
  async function chime({ history = [], text }) {
    if (!enabled() || quotaLeft() <= 0) return null

    const judge =
      `${persona}\n\n` +
      `— এখন একটা কাজ করো —\n` +
      `গ্রুপে এইমাত্র কেউ লিখেছে: "${text}"\n` +
      `তোমার কি সত্যিই এখানে কিছু মজার বা দরকারি বলার আছে?\n` +
      `থাকলে → শুধু সেই কথাটা লেখো (২ লাইনের বেশি নয়)।\n` +
      `না থাকলে → কেবল এই এক শব্দ লেখো: ${SKIP}`

    const r = await ask({ history, text: judge })
    if (!r.ok) return null
    if (!r.text || r.text.trim().toUpperCase().startsWith(SKIP)) return null
    return shorten(r.text, Math.min(160, maxChars))
  }

  /** ছবি বোঝা */
  async function see({ media, prompt }) {
    return ask({ text: prompt || 'এই ছবিতে কী আছে? Romeo-এর স্টাইলে মজার করে বলো।', media })
  }

  /** ভয়েস নোট → টেক্সট */
  async function hear({ media }) {
    return ask({
      media,
      text: 'এই ভয়েস নোটে কী বলা হয়েছে? শুধু বাংলায় লিখে দাও, কোনো ভূমিকা নেই।'
    })
  }

  return { ask, chime, see, hear, enabled, quotaLeft, usedToday }
}
