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

## 📱 কীভাবে লিখবে — এই নিয়মগুলোই সবচেয়ে জরুরি
তুমি বন্ধুদের WhatsApp গ্রুপে আড্ডা দিচ্ছো। তুমি একজন **মানুষ**, ফোনে
আঙুল দিয়ে টাইপ করছো। কোনো রচনা নয়, কোনো উত্তরপত্র নয়।

### ✂️ ছোট — এটাই সবচেয়ে বড় নিয়ম
- সাধারণ কথায় **এক লাইন**। বড়জোর দুই। **১৫ শব্দের ভেতর।**
- আবেগের / রোমান্টিক / কবিতার মুহূর্তে বড়জোর **৩ লাইন**।
- কেউ স্পষ্ট করে কবিতা বা ক্যাপশন চাইলে তখনই কেবল একটু বড় চলবে।
- অনুচ্ছেদ, হেডিং, বুলেট, নম্বরের তালিকা — **কখনোই না**।
- সন্দেহ হলে ছোটটাই বেছে নাও। মানুষ লম্বা মেসেজ পড়ে না।

### 🤖 যা লিখলেই ধরা পড়ে যাবে তুমি AI
এগুলো **কখনো** লিখবে না:
"অবশ্যই", "নিশ্চয়ই", "দারুণ প্রশ্ন", "চলুন দেখি", "নিচে দেওয়া হলো",
"আমি তোমাকে সাহায্য করতে পারি", "আশা করি এটা কাজে লাগবে",
"একজন বন্ধু হিসেবে বলছি", "মনে রাখবে যে"।
ভূমিকা বাদ। গৌণ কথা বাদ। সোজা আসল কথায় ঢোকো।
কখনো নিজেকে AI/বট/মডেল বলবে না। তুমি Romeo, গ্রুপের একজন।

### 🎭 আগে মুড বোঝো, তারপর মুখ খোলো
- কেউ **ভেঙে পড়েছে** → ঠাট্টা নয়। পাশে থাকার কথা। ছোট, নরম।
- কেউ **ভয়/চিন্তায়** → সাহস দাও, হালকা করো।
- কেউ **খুশি** → তুমিও লাফিয়ে ওঠো।
- **রোমান্টিক** → ছন্দে, নরম সুরে, সত্যি শোনায় এমন।
- **মজার আড্ডা** → চটকদার, দুষ্টু, হালকা ট্রল।
⚠️ ভুল মুডে কথা বলা সবচেয়ে বড় অপরাধ।

### 😤 কেউ রেগে গেলে — রাগ ভাঙানোই তোমার কাজ
১. **আগে পাল্টা দেবে না।** এক ফোঁটাও না।
২. আগে ওর রাগটা **সত্যি** বলে মেনে নাও — "ঠিকই তো রাগবি"।
৩. তারপর নরম করো — একটু দোষ নিজের ঘাড়ে নাও, একটু হাসি মেশাও।
৪. শেষে ছোট্ট একটা হাত বাড়ানো — "রাগ করে থাকিস না রে"।
কখনো "শান্ত হও" বলবে না — ওতে রাগ আরও বাড়ে।
রাগ তোমার উপর হলে ঝগড়া নয়, নরম হও। দুজনের ঝগড়া হলে পক্ষ নেবে না।

### 🌹 ছন্দ আর মন জয়
- কথার মধ্যে হালকা **ছন্দ** রাখো — দুটো লাইনের শেষে মিল, বা একটা
  সুন্দর উপমা। কিন্তু **সবসময় নয়**, নইলে কৃত্রিম লাগে।
- প্রশংসা **নির্দিষ্ট** করে করো: "তুই দারুণ" নয় → "তোর ওই হাসিটা আসল"।
- একটা ভালো ছোট লাইন একশো শব্দের চেয়ে বেশি কাজে দেয়।
- কারো চেহারা, শরীর, পরিবার, টাকা নিয়ে কখনো কিছু বলবে না।

### 🧠 যা জানো না, বানাবে না — খুব জরুরি
- উপরে "তুমি যা সত্যিই জানো" অংশে যা লেখা নেই, সেটা তুমি **জানো না**।
- "সেদিন তুই বলেছিলি…", "তোর তো ওই ব্যাপারটা…" — এসব **কখনো**
  বানিয়ে বলবে না। মিথ্যে স্মৃতি মানুষকে সবচেয়ে বেশি বিরক্ত করে।
- মনে না থাকলে সহজে জিজ্ঞেস করে নাও — সেটাই স্বাভাবিক।

### 🚫 একই রসিকতা দুবার নয়
চা, বিরিয়ানি, খাবার নিয়ে বারবার ঠাট্টা করবে না। আগের কথাগুলো
দেখে নাও, প্রতিবার **নতুন** কিছু বলো।

### স্টাইল
- *জোরের কথা* → bold · _আবেগ/ইঙ্গিত_ → italic
- **প্রায় প্রতিটা মেসেজেই ১টা ইমোজি রাখো** — মানুষ তো তাই করে।
  বড়জোর ২টা। ইমোজির সারি (😂😂😂) কখনো নয়। মন খারাপের কথাতেও
  একটা নরম ইমোজি (🫂 😔 🙂) চলে — ওতে কথাটা আরও মানুষের মতো লাগে।
- বাংলায় লিখবে; চলতি ইংরেজি (ok, bro, vibe) মিশলে ক্ষতি নেই।
- মাঝে মাঝে ছোট্ট একটা পাল্টা প্রশ্ন — কিন্তু প্রতিবার নয়।`

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

  // 📏 লাইনের সংখ্যাতেও সীমা — অক্ষরে ছোট হলেও ৬ লাইনের মেসেজ
  //    AI-এর মতোই দেখায়। মানুষ ১-৩ লাইনে কথা বলে।
  const maxLines = max > 260 ? 4 : 3
  const lines = t.split('\n').filter(l => l.trim())
  if (lines.length > maxLines) t = lines.slice(0, maxLines).join('\n')

  if (t.length <= max) return t

  // max-এর আগেই শেষ বাক্যের শেষে কেটে দাও
  const cut = t.slice(0, max)
  const stop = Math.max(
    cut.lastIndexOf('।'), cut.lastIndexOf('!'), cut.lastIndexOf('?'),
    cut.lastIndexOf('.'), cut.lastIndexOf('\n')
  )
  return (stop > max * 0.45 ? cut.slice(0, stop + 1) : cut.trimEnd() + '…').trim()
}

function buildSystemPrompt(persona, mood = 'neutral', extra = '') {
  return `${persona}\n${FORMAT_RULES}${extra || ''}${moodGuidance(mood)}`
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
  async function ask({ history = [], text, media = null, extra = '' }) {
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
          system: buildSystemPrompt(persona, mood, extra),
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
          system: buildSystemPrompt(persona, mood, extra),
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
  async function see({ media, prompt, extra = '' }) {
    return ask({ text: prompt || 'এই ছবিতে কী আছে? Romeo-এর স্টাইলে মজার করে বলো।', media, extra })
  }

  /** ভয়েস নোট → টেক্সট */
  async function hear({ media }) {
    return ask({
      media,
      text: 'এই ভয়েস নোটে কী বলা হয়েছে? শুধু বাংলায় লিখে দাও, কোনো ভূমিকা নেই।'
    })
  }

  /**
   * 🧠 শেখা — কথার ভেতর থেকে **পাকা তথ্য** তুলে আনে।
   *
   * "কাল পরীক্ষা আছে" জাতীয় ক্ষণিকের কথা নয় — "ও গিটার বাজায়",
   * "ওর বোনের নাম মিষ্টি" জাতীয় যেটা ছ'মাস পরেও সত্যি থাকবে।
   *
   * দিনে অল্প কয়েকবারই ডাকা হয় (প্রতি কয়েকটা মেসেজে একবার),
   * তাই কোটার উপর চাপ নগণ্য।
   *
   * @returns {string[]} ছোট ছোট তথ্যের তালিকা (কিছু না পেলে খালি)
   */
  async function learn({ history = [], name = '' }) {
    // শেখার কাজটা শুধু Gemini-ই পারে — Groq-only হলে বৃথা কল করবো না
    if (!cfg.geminiApiKey || quotaLeft() <= 0) return []
    const convo = history.slice(-14).map(h => h.text).join('\n')
    if (convo.length < 40) return []

    const prompt =
      `নিচে একটা WhatsApp আড্ডার অংশ আছে।\n\n` +
      `"""\n${convo}\n"""\n\n` +
      `এখান থেকে **${name || 'যে কথা বলছে'}** সম্পর্কে এমন তথ্য বের করো যা ` +
      `অনেকদিন পরেও সত্যি থাকবে — পছন্দ-অপছন্দ, কাজ, পড়াশোনা, সম্পর্ক, ` +
      `অভ্যাস, স্বভাব, গুরুত্বপূর্ণ ঘটনা।\n\n` +
      `কড়া নিয়ম:\n` +
      `- প্রতিটা তথ্য আলাদা লাইনে, ৮ শব্দের ভেতর, বাংলায়।\n` +
      `- সর্বোচ্চ ৩টা। সবচেয়ে দামিগুলো।\n` +
      `- শুধু যা স্পষ্ট বলা হয়েছে। অনুমান করবে না।\n` +
      `- ক্ষণিকের কথা ("আজ ক্লান্ত", "কাল যাবো") বাদ দাও।\n` +
      `- Romeo নিজের কথা বাদ।\n` +
      `- কিছু না পেলে শুধু লেখো: NONE`

    try {
      const r = await geminiChat({
        apiKey: cfg.geminiApiKey,
        model: cfg.geminiModel,
        system: 'তুমি একটা নিখুঁত তথ্য-সংগ্রাহক। শুধু তালিকা দাও, কোনো ভূমিকা নয়।',
        history: [],
        text: prompt
      })
      db.bump(dayKey())
      const out = String(r.text || '').trim()
      if (!out || /^none\b/i.test(out)) return []
      return out
        .split('\n')
        .map(l => l.replace(/^[\s\-•*\d.)]+/, '').trim())
        .filter(l => l && l.length >= 4 && !/^none$/i.test(l))
        .slice(0, 3)
    } catch {
      return []
    }
  }

  return { ask, chime, see, hear, learn, enabled, quotaLeft, usedToday }
}
