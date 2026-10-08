import fs from 'node:fs'

/**
 * .env ফাইল লোড করে process.env-এ বসায়।
 * বাইরের কোনো লাইব্রেরি লাগে না — যাতে Termux-এ ইনস্টল ঝামেলা কম হয়।
 */
export function loadEnv(file = '.env') {
  try {
    if (!fs.existsSync(file)) return
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i === -1) continue
      const key = t.slice(0, i).trim()
      let val = t.slice(i + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch {
    /* .env না থাকলে চুপচাপ এগিয়ে যাই */
  }
}

const bool = (v, d = false) =>
  v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())

// ⚠️ আগে Number('') → 0 হিসেবে ধরা হতো — মানে .env-এ COOLDOWN_MS= ফাঁকা
//    থাকলে কুলডাউন ০ হয়ে যেতো। এখন ফাঁকা মানে "ডিফল্ট" বোঝাবে।
const num = (v, d) => {
  if (v === undefined || v === null || String(v).trim() === '') return d
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : d
}

const list = v => (v || '').split(',').map(s => s.trim()).filter(Boolean)

export function buildConfig() {
  loadEnv()

  const allowedGroups = list(process.env.ALLOWED_GROUPS)

  return {
    // --- পরিচয় ---
    botName: 'Romeo',
    botFullName: 'Romeo Mamu',
    // যেকোনোটা লিখলেই Romeo সাড়া দেবে। .env-এ TRIGGER_WORDS দিয়ে বদলানো যায়।
    // (WhatsApp-এ @ দিয়ে মেনশন করলেও কাজ করবে — সেটা রাউটারে হ্যান্ডেল করা আছে)
    triggerWords: list(
      process.env.TRIGGER_WORDS ||
        'romeo,রোমিও,romeo mama,রোমিও মামা,mama,মামা,mamu,মামু,janu,জানু,jaanu,jaan,জান,sona,সোনা,shona,babu,বাবু,baby,বেবি,bondhu,বন্ধু,dost,দোস্ত,bhai,ভাই,vai,bro,দাদা,dada,pagla,পাগলা,ostad,ওস্তাদ,guru,গুরু,boss,বস,raja,রাজা'
    ),

    // --- নাম্বার (শুধু সংখ্যা, দেশের কোড সহ) ---
    botNumber: (process.env.BOT_NUMBER || '').replace(/\D/g, ''),
    ownerNumber: (process.env.OWNER_NUMBER || '').replace(/\D/g, ''),

    // --- স্কোপ: খালি থাকলে "discovery mode" (শুধু /id সাড়া দেয়) ---
    allowedGroups,
    // 🌍 true = Romeo যেই গ্রুপেই থাকবে, সবখানেই কাজ করবে —
    //    আলাদা করে গ্রুপ ID খুঁজে .env-এ বসাতে হবে না।
    //    false = শুধু allowedGroups-এ থাকা গ্রুপগুলোতেই কাজ করবে।
    allowAllGroups: bool(process.env.ALLOW_ALL_GROUPS, false),
    // --- ☁️ ক্লাউড হোস্টিং ---
    // MongoDB লিংক দিলে WhatsApp লগইন ডেটাবেসে থাকবে — সার্ভার
    // রিস্টার্ট হলেও আর পেয়ার করতে হবে না। (Render-এ এটা বাধ্যতামূলক)
    mongoUri: (process.env.MONGODB_URI || '').trim(),
    mongoDb: (process.env.MONGODB_DB || 'romeo').trim(),
    sessionId: (process.env.SESSION_ID || 'default').trim(),
    // Render ইত্যাদি ক্লাউডে একটা পোর্ট খুলে রাখতে হয়, নাহলে সার্ভার
    // ভাবে অ্যাপ চালু হয়নি আর বন্ধ করে দেয়।
    port: num(process.env.PORT, 0),

    discoveryMode: allowedGroups.length === 0 && !bool(process.env.ALLOW_ALL_GROUPS, false),

    // --- 💬 ব্যক্তিগত চ্যাট (DM) ---
    // true  = কেউ Romeo-কে (তোমার নাম্বারে) ইনবক্সে মেসেজ দিলেও সে জবাব দেবে
    //         গান/লিরিক্স/AI — সব কাজ করবে, যেমন গ্রুপে করে
    // false = শুধু গ্রুপে (আগের মতো)
    allowDm: bool(process.env.ALLOW_DM, false),
    // DM-এ কেউ মেসেজ দিলে Romeo কি সাথে সাথি জবাব দেবে?
    // true  = সব ইনকামিং মেসেজে জবাব (যেমন কেউ তোমাকে মেসেজ দিলে Romeo রিপ্লাই দেবে)
    // false = শুধু কমান্ডে (!গান, !লিরিক্স) বা "Romeo" ডাকলে জবাব
    dmAutoReply: bool(process.env.DM_AUTO_REPLY, true),

    // --- রেট লিমিট ---
    cooldownMs: num(process.env.COOLDOWN_MS, 2500),
    dailyCap: num(process.env.DAILY_CAP_PER_USER, 400),

    // --- AI (ফেজ ২) ---
    geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
    // প্রধান: flash-lite (দ্রুত, "চিন্তা" করে না → কাটা উত্তর আসে না)
    geminiModel: (process.env.GEMINI_MODEL || 'gemini-flash-lite-latest').trim(),
    groqApiKey: (process.env.GROQ_API_KEY || '').trim(), // ঐচ্ছিক ব্যাকআপ
    groqModel: (process.env.GROQ_MODEL || 'openai/gpt-oss-120b').trim(),
    aiDailyCap: num(process.env.AI_DAILY_CAP, 1000), // দিনে সর্বোচ্চ AI কল
    contextSize: num(process.env.CONTEXT_SIZE, 60), // কতটা মেসেজ মনে রাখবে

    // --- আচরণ ---
    sendReadReceipts: bool(process.env.SEND_READ_RECEIPTS, false),
    typing: bool(process.env.TYPING_INDICATOR, true),
    // শতাংশে (0-100)। 0 = শুধু ডাকলে/কমান্ডে কথা বলবে। 8 = মাঝে মাঝে নিজে থেকে।
    autoChatChance: Math.min(100, Math.max(0, num(process.env.AUTO_CHAT_CHANCE, 0))) / 100,
    // 💬 একবার কথা শুরু করলে কত মিনিট পর্যন্ত নাম ছাড়াই উত্তর দেবে
    convoTimeoutMs: Math.min(180, Math.max(1, num(process.env.CONVO_TIMEOUT_MIN, 10))) * 60 * 1000,
    // 🤫 অন্য দুজন নিজেদের মধ্যে কথা বললে Romeo ঢুকবে কিনা।
    //    false (ডিফল্ট) = শালীন — কারো আড্ডায় বাধা দেবে না
    //    true           = উদ্ধত — সব মেসেজেই জবাব দেবে
    buttIn: bool(process.env.BUTT_IN, false),
    // 🔁 এক কথায় Romeo সর্বোচ্চ কতবার নিজে থেকে উত্তর দেবে।
    //    এরপর আবার নাম দিয়ে ডাকতে হবে — মানে সে একা একা বকবে না, গ্রুপ পরিষ্কার থাকবে
    maxConvoTurns: Math.min(50, Math.max(1, num(process.env.MAX_CONVO_TURNS, 4))),
    // Romeo-এর উত্তর কতটা বড় হতে পারবে (অক্ষরে)। ছোট করতে চাইলে 150/120 দাও
    replyMaxChars: Math.min(1000, Math.max(60, num(process.env.REPLY_MAX_CHARS, 160))),
    // 🎵 গান — দিনে সর্বোচ্চ কতটা গান
    //    WhatsApp-এ কোনো প্রকাশ্য "সীমা" নেই; ঝুঁকি হলো অল্প সময়ে অনেকগুলো
    //    মিডিয়া পাঠালে স্প্যাম-শনাক্তকরণ। বন্ধুদের ২-৪টা গ্রুপে ৫০ টা/দিন
    //    নিরাপদ — চাইলে .env থেকে আরও বাড়ানো যাবে (এখন সর্বোচ্চ ৫০০)।
    songDailyCap: Math.min(500, Math.max(1, num(process.env.SONG_DAILY_CAP, 200))),
    // এক গানের সর্বোচ্চ সাইজ (MB) — এর বেশি হলে ডাউনলোড না পাঠিয়ে শুধু লিংক
    songMaxBytes: Math.min(20, Math.max(2, num(process.env.SONG_MAX_MB, 16))) * 1024 * 1024,
    // গান না এলে কী কী চেষ্টা করলো সেটা গ্রুপেই দেখাবে (খোঁজার জন্য)
    songDebug: bool(process.env.SONG_DEBUG, false),
    debug: bool(process.env.DEBUG, false),

    // --- ফাইল ---
    sessionDir: 'data/auth_session',
    dbFile: 'data/db.json'
  }
}
