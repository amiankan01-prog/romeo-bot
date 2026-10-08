// ==========================================================
//  রাউটার — কোন মেসেজে Romeo সাড়া দেবে, আর কী উত্তর দেবে
//  ফেজ ২: AI (Gemini) + স্মৃতি + ছবি/ভয়েস বোঝা
// ==========================================================
import {
  extractText, messageType, IGNORED_TYPES, senderNumber,
  senderName, rateKey, sleep, matchCommand, isGroupJid, pickFresh, bn } from './utils.js'
import { isAllowedChat, RateLimiter } from './safety.js'
import * as fun from './features/fun.js'
import { createBrain } from './ai/brain.js'
import { detectMood } from './ai/mood.js'
import { Memory } from './ai/memory.js'
import { createProfiles } from './ai/profile.js'
import { getMedia, mediaKind } from './media.js'
import { fetchSong, sendAudio, cleanup } from './features/music.js'
import { fetchLyrics, formatLyrics } from './features/lyrics.js'

/**
 * Romeo-কে ডাকা হয়েছে কিনা — শব্দের শুরুতে হতে হবে।
 * বাংলা অক্ষরের জন্য \b কাজ করে না, তাই নিজের চেক।
 *
 * WEAK শব্দ ("মামা", "mama") বাংলায় আত্মীয় বোঝায় — তাই এগুলো
 * কেবল তখনই ট্রিগার করবে যখন মেসেজটি সেই শব্দ দিয়েই শুরু হয়।
 *   "মামা একটা কাজ করবি"   → ✅ ডাকা
 *   "আমার মামা আসবে"       → ❌ ডাকা নয়
 */
const WEAK_WORDS = new Set([
  // আত্মীয়-সম্বোধন — অন্য কাউকেও বলা যায়
  'mama', 'mamu', 'mama', 'মামা', 'মামু', 'mamun',
  // আদরের ডাক — অন্য কাউকেও বলা যায়
  'janu', 'jaanu', 'jaan', 'jan', 'জানু', 'জান',
  'sona', 'shona', 'সোনা', 'babu', 'বাবু', 'baby', 'বেবি', 'bby',
  'jamai', 'জামাই', 'bondhu', 'বন্ধু', 'dost', 'দোস্ত',
  'bhai', 'ভাই', 'vai', 'bro', 'ব্রো', 'dada', 'দাদা',
  'pagla', 'পাগলা', 'pagol', 'পাগল', 'ostad', 'ওস্তাদ',
  'guru', 'গুরু', 'boss', 'বস', 'raja', 'রাজা', 'baba', 'বাবা'
])

/**
 * Romeo-র নামের সব রকম বানান ও ভুল ধরার জন্য।
 * "romeo", "rome", "romio", "romeoo", "রোমিও", "রমিও", "রোমি" — সব চলবে।
 * এটা *শক্তিশালী* নাম: বাক্যের যেকোনো জায়গায় থাকলেই Romeo-কে ডাকা হয়েছে।
 */
const ROMEO_RX =
  /(?:^|[^\u0980-\u09FFa-zA-Z0-9])(?:r+o*m+(?:e+o*|i+o*|y+o*|o+|e+)|র+ো*ম+ি*(?:ও|য়ো|য়ও)?|রোমি|রমিও|রমিয়ো)(?:[^\u0980-\u09FFa-zA-Z0-9]|$)/i

/**
 * 🧔 "মামা" / "মামু" — Romeo-র আসল ডাকনাম, তাই এটাও *শক্তিশালী*।
 *
 * কিন্তু একটা ফাঁদ আছে: "আমার মামা কাল আসবে" — এখানে সত্যিকারের
 * মামার কথা হচ্ছে, Romeo-র নয়। তাই দুটো নিয়ম:
 *
 *   ১. আগে "আমার / তোর / ওর / তার / আমাদের / my / his" থাকলে → Romeo নয়
 *   ২. ডাকার জায়গায় থাকতে হবে — বাক্যের শুরুতে, শেষে, বা কমার আগে
 *      ("মামু একটা গান দে" ✅ · "কি রে মামু" ✅ · "মামা, শোন" ✅)
 *
 * "মামু জি", "mamu ji", "মামাজি" — এগুলোও ধরা পড়বে।
 */
const MAMU_CORE = '(?:ma+mu+|ma+ma+|মামু+|মামা+|মামী|mamun)'
const MAMU_SUFFIX = '(?:\\s*(?:ji|জি|jee))?'
const W = '\\u0980-\\u09FFa-zA-Z0-9'

// বাক্যের যেকোনো জায়গায় "মামা/মামু" — তবে শব্দটা পুরো হতে হবে।
// ("মামার", "মামাকে", "মামাতো" মিলবে না — ওগুলো আত্মীয়ের কথা)
const MAMU_ANY = new RegExp('(?:^|[^' + W + '])(' + MAMU_CORE + MAMU_SUFFIX + ')(?![' + W + '])', 'i')

// ⚠️ শব্দসীমা জরুরি! আগে এটা ছাড়া ছিল, ফলে "ki khobor mamu"-তে
//    "khob-or" এর শেষাংশকে "ওর" ভেবে Romeo চুপ করে যেতো।
const POSSESSIVE = new RegExp(
  '(?:^|[^' + W + '])' +
  '(?:আমার|আমাদের|তোমার|তোর|তোদের|ওর|ওদের|তার|তাদের|এর|নিজের|' +
  'amar|amader|tomar|tor|tader|or|tar|my|our|his|her|their)' +
  '\\s*$', 'i')

function callsMamu(lowerText) {
  const t = String(lowerText).trim()
  if (!t) return false
  const m = t.match(MAMU_ANY)
  if (!m) return false

  // ঠিক আগে "আমার / তোর / ওর / তার" থাকলে সেটা সত্যিকারের মামা
  const hit = m.index + m[0].length - m[1].length
  return !POSSESSIVE.test(t.slice(0, hit))
}


export function mentionsBot(lowerText, words) {
  const isWordChar = ch => /[\u0980-\u09FFa-zA-Z0-9]/.test(ch || '')
  const trimmed = lowerText.trim()

  // নামের যেকোনো বানান/ভুল — "rome", "romio", "রমিও" সবই চলবে
  if (ROMEO_RX.test(' ' + trimmed + ' ')) return true
  // "মামা" / "মামু" — ডাকার জায়গায় থাকলে Romeo-কেই ডাকা হয়েছে
  if (callsMamu(trimmed)) return true

  return words.some(w => {
    // দুর্বল শব্দ: বাক্যের একদম শুরুতে + এর পরে আলাদা শব্দের অক্ষর নেই
    if (WEAK_WORDS.has(w)) {
      return trimmed.startsWith(w) && !isWordChar(trimmed[w.length])
    }

    let from = 0
    for (;;) {
      const i = lowerText.indexOf(w, from)
      if (i === -1) return false
      const before = i === 0 ? '' : lowerText[i - 1]
      const after = lowerText[i + w.length] || ''
      if (!isWordChar(before) && !isWordChar(after)) return true
      from = i + w.length
    }
  })
}

/**
 * 📣 ডাকটা কতটা জোরালো?
 *
 *   'strong' → "Romeo", "রোমিও", "@Romeo" — নিঃসন্দেহে তাকেই ডাকা হয়েছে
 *   'weak'   → "ভাই", "দাদা", "সোনা", "গুরু" — এগুলো দিয়ে গ্রুপের
 *              যে কাউকেই ডাকা যায়, তাই একা এগুলো দেখে ঝাঁপিয়ে পড়া চলবে না
 *   'none'   → Romeo-র কোনো নামই নেই
 *
 * ⚠️ কেন দরকার: আগে "ভাই কেমন আছিস" লিখলেই Romeo উত্তর দিয়ে দিতো —
 *    অথচ কথাটা বন্ধুকে বলা। গ্রুপে এটাই সবচেয়ে বিরক্তিকর ছিল।
 */
export function mentionStrength(lowerText, words) {
  if (ROMEO_RX.test(' ' + lowerText.trim() + ' ')) return 'strong'
  if (callsMamu(lowerText)) return 'strong'
  const hit = words.filter(w => mentionsBot(lowerText, [w]))
  if (!hit.length) return 'none'
  return hit.every(w => WEAK_WORDS.has(w)) ? 'weak' : 'strong'
}

/**
 * 🤫 কথাটা কি অন্য কাউকে বলা হচ্ছে?
 *
 * "ভাই", "দাদা", "bro", "জানু" — এগুলো দিয়ে Romeo-কেও ডাকা যায়, আবার
 * গ্রুপের অন্য সদস্যকেও ডাকা যায়। তাই এই দুর্বল নামগুলোর ক্ষেত্রে দেখি:
 *
 *   ১. মেসেজে কি অন্য কাউকে @-ট্যাগ করা হয়েছে? → Romeo চুপ থাকবে
 *   ২. মেসেজটা কি অন্য কারো মেসেজের রিপ্লাই? → Romeo চুপ থাকবে
 *
 * Romeo-র আসল নাম ("Romeo", "রোমিও") থাকলে এই নিয়ম খাটে না — তখন
 * তাকেই ডাকা হয়েছে, তাই সে সাড়া দেবে।
 */
function addressingSomeoneElse(msg, lower, cfg, isRomeoMsgId = () => false) {
  // আসল নাম থাকলে নিঃসন্দেহে Romeo-কেই ডাকা হয়েছে
  if (ROMEO_RX.test(' ' + lower.trim() + ' ')) return false

  // ⚠️ এখানে আগে "শুধু দুর্বল নাম কিনা" হিসাব করা হতো, কিন্তু "মামু"
  //    শক্ত নাম হওয়ার পর সেই হিসাবটা গুলিয়ে যাচ্ছিলো — ফলে বন্ধুর
  //    মেসেজে রিপ্লাই করে "মামা তুই কোথায়" লিখলেও Romeo ঢুকে পড়তো।
  //
  //    আসল কথা সহজ: Romeo-র নিজের নাম ("Romeo/রোমিও") না থাকলে ডাকটা
  //    সবসময়ই দ্ব্যর্থক। তখন কাউকে @ট্যাগ করা বা অন্যের মেসেজে রিপ্লাই
  //    করাটাই চূড়ান্ত প্রমাণ — কথাটা তাকেই বলা হচ্ছে, Romeo-কে নয়।

  // অন্য কাউকে @-ট্যাগ করা হয়েছে?
  const ctx = msg.message?.extendedTextMessage?.contextInfo
  const tagged = ctx?.mentionedJid || []
  const others = tagged.filter(j => !cfg.botNumber || !String(j).startsWith(cfg.botNumber))
  if (others.length > 0) return true

  // অন্য কারো মেসেজের রিপ্লাই? (Romeo-র নিজের মেসেজ হলে ঠিক আছে)
  const qid = ctx?.stanzaId
  if (qid && !isRomeoMsgId(qid)) return true

  return false
}

/** নাম বাদ দিলে কিছু থাকে কিনা → থাকলে AI দরকার */
function hasSubstance(text, words) {
  let rest = text
  for (const w of words) {
    rest = rest.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
  }
  rest = rest.replace(/[@,!?।.:\-\s]/g, '')
  return rest.length >= 2
}

const quotedId = m => m?.message?.extendedTextMessage?.contextInfo?.stanzaId

/**
 * "থামো / ok / ধন্যবাদ" — এগুলো দিয়ে বোঝাবে কথা শেষ।
 * (ভুল বুঝবে না বলে শর্ত: মেসেজটি খুব ছোট হতে হবে, ১২ অক্ষরের কম)
 */
// (হ্যাঁ/না এখানে নেই — ওগুলো কথার উত্তর, বিদায় নয়)
const EXIT_WORDS = new Set([
  'ok', 'okay', 'ঠিকআছে', 'থিকআছে', 'আচ্ছা', 'থাক', 'ছেড়েদে',
  'thanks', 'thankyou', 'ধন্যবাদ', 'থামো', 'থাম', 'চুপ', 'চুপথাক', 'stop',
  'বিরক্তকরোনা', 'bye', 'বিদায়', 'শেষ', 'done', 'এইটুকুই'
])

// এক গ্রুপে সর্বোচ্চ ৩ জনের সাথে একসাথে কথা (বেশি হলে সবচেয়ে পুরোনোটা বন্ধ)
const MAX_CONVO_PER_CHAT = 3

/** মিডিয়ার বাংলা নাম */
const MEDIA_LABEL = {
  image: 'ছবি',
  sticker: 'স্টিকার',
  video: 'ভিডিও',
  voice: 'ভয়েস নোট',
  audio: 'অডিও',
  document: 'ফাইল'
}

// 🎴 "Romeo তোমার intro দাও" / "কে তুমি" → নিজের পরিচয় চাইছে
const INTRO_ASK = [
  'intro', 'ইন্ট্রো', 'পরিচয়', 'পরিচয়',
  'কে তুমি', 'তুমি কে', 'তুই কে', 'কে তুই',
  'who are you', 'who r u', 'about you', 'yourself',
  'নিজের কথা বলো', 'তোমার কথা বলো', 'তোর কথা বল', 'তোমার সম্পর্কে বলো'
]
const isIntroRequest = t => {
  const s = String(t).toLowerCase()
  return INTRO_ASK.some(w => s.includes(w))
}

// 🎵 গান চাইছে কিনা — বাংলা / ইংলিশ / হিংলিশ / হিন্দি, যেকোনো ভাষায়
//
// ⚠️ আগে substring দিয়ে মেলানো হতো — তখন 'de'/'do'/'kar' এর মতো ছোট শব্দ
//    "delete"/"dog"/"karma"-তেও মিলে যেত। তাই এখন **শব্দ শব্দ করে** মেলানো হয়।
const SONG_WORDS = new Set([
  // বাংলা
  'গান', 'গানটা', 'গানটি', 'গানের', 'গানগুলো', 'গীত', 'গীতি', 'সুর', 'বাজনা', 'অডিও',
  // ইংরেজি
  'song', 'songs', 'music', 'audio', 'track', 'mp3', 'soundtrack', 'tune', 'jam',
  // হিংলিশ (রোমান)
  'gana', 'gaana', 'gaane', 'gane', 'gan', 'geet', 'git', 'songta', 'ganata', 'gaanaa',
  // হিন্দি (দেবনাগরী)
  'गाना', 'गाने', 'गीत', 'सॉन्ग', 'म्यूजिक', 'संगीत', 'गानाे',
  // বানানভেদ — "gaan", "gaana" আগে ধরা পড়তো না
  'gaan', 'gaaner', 'ganer', 'gann', 'গানখানা', 'geeti', 'সংগীত', 'সঙ্গীত', 'sangeet', 'sangit'
  // ⚠️ 'number'/'nambar' এখান থেকে সরানো হলো — "তোর number দে" লিখলে
  //    Romeo গান পাঠিয়ে দিতো! ফোন নম্বর আর গানের নম্বর এক নয়।
])

const SONG_VERBS = new Set([
  // বাংলা
  'দাও', 'দে', 'দিন', 'দিবি', 'দিতে', 'দিবে', 'দিকে', 'দিবা', 'চাই', 'লাগবে',
  'পাঠাও', 'পাঠা', 'পাঠান', 'পাঠিয়ে', 'শোনা', 'শোনাও', 'শুনা', 'শুনাই', 'শুনিয়ে',
  'খুঁজে', 'খুঁজ', 'খোঁজো', 'আনো', 'আন', 'দেখ', 'দেখাও', 'পাবো', 'পেতে', 'পাই',
  'বাজা', 'বাজাও', 'চালা', 'চালাও', 'লাগা', 'লাগাও', 'ডাউনলোড',
  // ইংরেজি
  'play', 'plays', 'send', 'give', 'want', 'need', 'find', 'get', 'share', 'drop',
  'put', 'download', 'stream', 'search', 'blow', 'roll',
  // হিংলিশ / হিন্দি
  'bajao', 'baja', 'bajana', 'chalao', 'chala', 'lagao', 'lagaa', 'lagado', 'laga',
  'sunao', 'suna', 'sunna', 'suno', 'sunane', 'bhej', 'bhejo', 'bhejdo', 'bhejna',
  'dena', 'dedo', 'de', 'do', 'chahiye', 'chaiye', 'lana', 'lao', 'dhundo', 'dhundho',
  'khojo', 'khoj', 'nikalo', 'nikal', 'karo', 'kar', 'pathao', 'pathan', 'plz', 'please',
  // হিন্দি (দেবনাগরী) — ⚠️ রোমানাইজড 'do' দিয়ে 'दो' মেলে না, তাই আলাদা করে দিতে হয়
  'दो', 'दे', 'दीजिए', 'दें', 'देना', 'देदो',
  'भेजो', 'भेज', 'भेजें', 'भेजना', 'भेज दो',
  'बजाओ', 'बजा', 'बजाना', 'चलाओ', 'चला', 'लगाओ', 'लगा', 'लगाना',
  'सुनाओ', 'सुना', 'सुनना', 'सुनो', 'चाहिए', 'लाओ', 'लाना',
  'ढूंढो', 'ढूंढ', 'खोजो', 'खोज', 'डालो', 'डाल', 'करो', 'करें'
])

/**
 * কিছু ক্রিয়াপদ আসলে শুধু গানের ক্ষেত্রেই ব্যবহার হয় —
 * "play projapoti" / "gaana bajao" তে "গান" শব্দটা নাও থাকতে পারে,
 * তখন এই ক্রিয়াপদই বোঝায় যে গান চাইছে।
 */
const MUSIC_ONLY_VERBS = new Set([
  'play', 'plays', 'bajao', 'bajana', 'lagao', 'sunao', 'chalao',
  'बजाओ', 'सुनाओ', 'लगाओ', 'चलाओ', 'बजाना'
])

/**
 * মেসেজকে শব্দে ভাঙা — বাংলা/হিন্দি/ইংরেজি সব ঠিকমতো।
 *
 * ⚠️ \p{M} (combining mark) অবশ্যই রাখতে হবে!
 *    বাংলা "গান" আসলে গ + া + ন — এই "া" (মাত্রা) আর "ি ী ু ূ ে ৈ ো ৌ ্"
 *    সব \p{M}। শুধু \p{L} রাখলে "গান" ভেঙে "গ"+"ন" হয়ে যায়,
 *    আর "গান"/"দাও" আর কখনোই মেলে না — বাংলা/হিন্দি একেবারে বন্ধ হয়ে যেতো।
 */
const toWords = t =>
  String(t).toLowerCase().split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean)

// 🚫 গান নিয়ে কথা বলা আর গান চাওয়া এক জিনিস নয়।
//    "ও ভালো গান করে", "গানটা কে গেয়েছে?", "কাল গান শুনলাম" — এগুলোতে
//    আগে Romeo গান পাঠিয়ে দিতো, যেটা সবচেয়ে বিরক্তিকর ছিল।
const SONG_TALK = [
  /গান\s*(গাই|গাইতে|গাও|গায়|করে|করিস|কর)/,          // গান গাওয়া নিয়ে কথা
  /(gaan|gaana|gan|song)\s*(gai|gaite|gao|gay|kore|koris)/i,
  /(কে|কার|কোন)\s*(গান|গানটা|গেয়েছে|গাইছে)/,         // কে গেয়েছে
  /গান(টা|টি)?\s*(কে|কার|কী|কি|কেমন|দারুন|ভালো|সুন্দর|খারাপ)/,
  /(ke|kar|kon)\s*(gaan|gaana|gaiche|geyeche)/i,
  /(গান|gaan|gaana|song|music)\s*\w*\s*(শুনলাম|শুনেছি|শুনছিলাম|শুনি|ভালো\s*লাগে|পছন্দ)/,
  /(shunlam|shunechi|shunchilam|bhalo\s*lage|pochondo)/i,
  /(গান|song|music)\s*(বন্ধ|অফ|থামা|off|bondho)/i,    // বন্ধ করতে বলা
  /(নাম|naam|name)\s*(টা|ta)?\s*(কি|ki|বল|bol)/i,     // নাম জানতে চাওয়া
  /(গানের|gaaner|ganer)\s*(প্রোগ্রাম|অনুষ্ঠান|program|function|club|দল)/i
]
const isSongTalk = t => SONG_TALK.some(re => re.test(String(t)))

const isSongRequest = t => {
  const words = toWords(t)
  const hasSong = words.some(w => SONG_WORDS.has(w))
  const hasVerb = words.some(w => SONG_VERBS.has(w))

  // 🛑 সবার আগে: এটা কি গান *নিয়ে কথা*, নাকি গান *চাওয়া*?
  if (isSongTalk(t)) return false

  if (hasSong && hasVerb) return true
  // "Romeo গান?" / "ek gaana?" — ছোট, সরাসরি অনুরোধ
  // ⚠️ শর্ত কড়া করা হলো: আগে "Romeo গান গাইতে পারিস?" (৪ শব্দ) ধরে
  //    Romeo "Gaite Parisianne" নামের উদ্ভট গান পাঠিয়ে দিতো।
  //    এখন প্রশ্নটা সত্যিই ছোট আর গান-কেন্দ্রিক হতে হবে।
  if (hasSong && /[?？]/.test(String(t)) && words.length <= 3) return true
  // "play projapoti" / "bajao lajuk pata" — "গান" শব্দ নেই, কিন্তু
  // ক্রিয়াপদটা শুধু গানের ক্ষেত্রেই ব্যবহার হয় + গানের নাম বাকি আছে
  if (!hasSong && words.some(w => MUSIC_ONLY_VERBS.has(w)) && songQuery(t).length >= 2) {
    return true
  }
  return false
}

// 📝 গানের কথা (লিরিক্স) — যেকোনো ভাষায়
const LYRIC_WORDS = new Set([
  'lyrics', 'lyric', 'lyrix', 'lyricsx',
  'লিরিক্স', 'লিরিক', 'লিরিক্সটা', 'লিরিকটা',
  'কথাগুলো', 'কথাগুলা', 'গানেরকথা',
  'बोल', 'lyricss'
])

// "গানের কথা" / "gaane ke bol" / "song ke bol" — দুটো শব্দ মিলে বোঝায়
const LYRIC_PHRASES = [
  /গানের\s*(কথা|লেখা|লিরিক্স?)/,
  /লিরিক্স?\s*(দাও|দে|চাই|পাঠাও|দিন)/,
  /(gaana|gaane|gan|geet|song|music)\s*(ke|ka|ki|er|r)?\s*(bol|lyrics?|kotha)/i,
  /(bol|lyrics?)\s*(do|de|bhejo|bhej|chahiye|sunao|dikhao|dho)/i,
  /কথা\s*(দাও|দে|চাই|পাঠাও)\s*গান/i
]

const isLyricRequest = t => {
  const s = String(t)
  if (toWords(s).some(w => LYRIC_WORDS.has(w))) return true
  return LYRIC_PHRASES.some(re => re.test(s))
}

// 🎂 কেউ Romeo-এর বয়স জিজ্ঞেস করলে — Romeo-এর ফেভারিট ডায়লগ
const AGE_PATTERNS = [
  /বয়স|বয়স|boyosh|boish/,
  /how\s*old/i, /\bage\b/i, /umra|umr/i
]
const AGE_ASK = t => {
  const s = String(t).toLowerCase()
  if (!AGE_PATTERNS.some(re => re.test(s))) return false
  // নিজের বয়স বললে (যেমন "আমার বয়স ২০") ধরবো না — প্রশ্ন হলেই জবাব
  return /[?？]/.test(s) || /কত|কতো|koto|kitna|kitne|কি|কী|what|tell|bol|বল|জানি|জানতে/i.test(s)
}

/**
 * ফালতু শব্দ — এগুলো বাদ দিলে যা থাকে সেটাই আসল গানের নাম।
 * "Romeo একটা গান দাও লাজুক পাতা" → "লাজুক পাতা"
 */
const STOP_WORDS = new Set([
  // Romeo-এর নাম
  'romeo', 'রোমিও', 'mama', 'মামা', 'mam u', 'bot', 'বট',
  // গান সংক্রান্ত
  'গান', 'গানের', 'গানটা', 'গানটি', 'song', 'songs', 'music', 'audio', 'gan',
  'lyrics', 'lyric', 'লিরিক্স', 'লিরিক', 'কথা', 'কথাগুলো', 'কথাটা',
  // নির্দেশ
  'দাও', 'দে', 'দিন', 'দিবি', 'দিতে', 'দিবে', 'দিকে', 'চাই', 'লাগবে', 'পাঠাও',
  'পাঠা', 'pathao', 'pathan', 'download', 'ডাউনলোড', 'শোনা', 'শোনাও', 'শুনা',
  'শুনাই', 'play', 'baja', 'বাজা', 'খুঁজে', 'খুঁজ', 'আনো', 'আন', 'দেখ', 'দেখাও',
  'send', 'পাবো', 'পেতে', 'পাই', 'দিবা',
  // অন্যান্য ফালতু
  'একটা', 'একটি', 'একটু', 'এক', 'টা', 'টি', 'please', 'pls', 'এই', 'ওই', 'সেই',
  'আমাকে', 'আমার', 'তোমার', 'তোর', 'তুমি', 'তুই', 'আমি', 'কে', 'কি', 'আর', 'ও',
  // "আরেকটা গানের কথা দাও bondhu" → যেন শুধু "bondhu" থাকে
  'আগে', 'তাড়াতাড়ি', 'দয়া', 'করে', 'করো', 'কর', 'বলো', 'বল', 'দেখি', 'যাও', 'নাও',
  // ইংরেজি / হিংলিশ
  'the', 'a', 'an', 'of', 'by', 'from', 'with', 'for', 'me', 'us', 'to',
  'ek', 'ekta', 'ekti', 'kuch', 'kuchh', 'koi', 'thoda', 'wala', 'wali', 'aur',
  'mujhe', 'mujhko', 'humko', 'hamko', 'tum', 'tumhe', 'aap', 'mere', 'mera',
  'karke', 'ke', 'ka', 'ki', 'se', 'mein', 'par', 'pe', 'hi',
  'bhi', 'abhi', 'ab', 'jaldi', 'phir', 'phirse', 'ekbar',
  // 🇮🇳 দেবনাগরী — "एक गाना दो projapoti" ঠিকমতো কাটতে
  'एक', 'गाना', 'गाने', 'गीत', 'दो', 'दे', 'देदो', 'सुनाओ', 'सुना',
  'भेजो', 'भेज', 'चाहिए', 'बजाओ', 'मुझे', 'मेरे', 'जरा', 'थोड़ा',
  'कोई', 'कुछ', 'का', 'की', 'के', 'को', 'से', 'और', 'भी', 'अभी'
])

/**
 * মেসেজ থেকে গানের নাম বের করা — শব্দ শব্দ করে ছাঁকা।
 * "Romeo ek gaana bhejo projapoti" → "projapoti"
 * "Romeo একটা গান দাও লাজুক পাতা"  → "লাজুক পাতা"
 */
/**
 * 📛 সম্বোধনের ডাকনাম।
 *
 * ⚠️ এগুলো সরাসরি STOP_WORDS-এ রাখা যায় না — কারণ "বন্ধু", "রাজা",
 *    "সোনা" আবার গানের নামেও থাকে ("Bondhu Chol", "Sona Bondhu")!
 *    তাই শুধু *শুরুর* ডাকটুকু বাদ দেবো, মাঝখানেরটা গানের নাম ধরে নেবো।
 */
const NICK_WORDS = new Set([
  'rome', 'romio', 'romeoo', 'রমিও', 'রোমি', 'mamu', 'মামু',
  'janu', 'jaanu', 'jaan', 'জানু', 'জান', 'sona', 'shona', 'সোনা',
  'babu', 'বাবু', 'baby', 'বেবি', 'bondhu', 'বন্ধু', 'dost', 'দোস্ত',
  'bhai', 'ভাই', 'vai', 'bro', 'ব্রো', 'dada', 'দাদা',
  'pagla', 'পাগলা', 'ostad', 'ওস্তাদ', 'guru', 'গুরু',
  'boss', 'বস', 'raja', 'রাজা'
])

/**
 * 🎵 গানের কমান্ডের সব রূপ।
 * `/play` যোগ করা হলো — অন্য বটগুলো এটাই ব্যবহার করে, তাই
 * বন্ধুদের অভ্যাস বদলাতে হবে না।
 */
const SONG_CMDS = [
  'গান', 'gan', 'gaan', 'gaana', 'song', 'music', 'গানটা',
  'play', 'p', 'sing', 'বাজা', 'baja', 'শোনা', 'sona'
]

function songQuery(text) {
  const words = toWords(text)
  const FILLER = new Set([
    'একটা', 'একটি', 'একটু', 'এক', 'ek', 'ekta', 'ekti', 'please', 'pls',
    'প্লিজ', 'plz', 'দয়া', 'করে', 'তাড়াতাড়ি', 'jaldi', 'abhi', 'now',
    'না', 'to', 'তো', 're', 'রে', 'ta', 'টা',
    // 🎭 মুড / গুণবাচক শব্দ — গানের *নাম* নয়, কিন্তু সার্চে দিলে
    //    ফলাফল পুরো ভুল হয়ে যায়। ("bojhena se bojhena sad" দিলে
    //    JioSaavn একটা ওড়িয়া ভজন ফেরত দিতো! 😤)
    'sad', 'স্যাড', 'দুঃখের', 'দুখের', 'কষ্টের', 'happy', 'খুশির',
    'romantic', 'রোমান্টিক', 'love', 'ভালোবাসার', 'প্রেমের',
    'slow', 'fast', 'new', 'নতুন', 'old', 'পুরোনো', 'পুরনো',
    'full', 'original', 'আসল', 'অরিজিনাল', 'version', 'ভার্সন',
    'audio', 'video', 'hd', 'mp3', 'quality', 'best', 'সেরা',
    'bangla', 'বাংলা', 'hindi', 'হিন্দি', 'english', 'ইংরেজি'
  ])
  const cmdWord = w => SONG_WORDS.has(w) || SONG_VERBS.has(w)
  const junk = w => STOP_WORDS.has(w) || cmdWord(w) || NICK_WORDS.has(w) || FILLER.has(w)

  // 🎯 মানুষ লেখে: "<ডাক> <আদেশ> <গানের নাম>"
  //    তাই *শেষ* আদেশ-শব্দের (গান/দাও/play…) পরে যা আছে — সেটাই নাম।
  //
  //    আগে সব জায়গা থেকে পরিচিত শব্দ ছেঁকে ফেলা হতো, আর তাতে গানের
  //    নামই ধ্বংস হয়ে যেতো:
  //      "Tum Hi Ho"   → tum, hi সবই stop-word → থাকতো শুধু "ho" 😱
  //      "Bondhu Chol" → bondhu ডাকনাম ভেবে বাদ → "chol"
  let last = -1
  for (let i = 0; i < words.length; i++) if (cmdWord(words[i])) last = i

  if (last >= 0 && last + 1 < words.length) {
    // ✅ আদেশের পরের অংশটাই গানের নাম — এখানে আর ছাঁকনি চালাবো না,
    //    নাহলে "Bondhu Chol" বা "Tum Hi Ho"-এর মতো নাম কেটে যাবে।
    //    শুধু দুই প্রান্তের ভরাট শব্দ ("প্লিজ", "একটু") ফেলে দিই।
    const t = words.slice(last + 1)
    let a = 0
    while (a < t.length && FILLER.has(t[a])) a++
    let b = t.length
    while (b > a && FILLER.has(t[b - 1])) b--
    const kept = t.slice(a, b)
    // মাঝখানে পড়ে থাকা মুড-শব্দও ফেলি — তবে সব ফেলে দিলে নাম থাকবে না,
    // তাই অন্তত একটা শব্দ বাঁচিয়ে রাখি ("Sad Song" নামের গান যেন না হারায়)
    const lean = kept.filter(w => !FILLER.has(w))
    return (lean.length ? lean : kept).join(' ').trim()
  }

  // আদেশের পরে কিছু নেই (যেমন "projapoti গান দাও") — তখন দুই
  // প্রান্ত থেকে পরিচিত শব্দ কেটে মাঝটুকু নিই
  let a = 0
  while (a < words.length && junk(words[a])) a++
  let b = words.length
  while (b > a && junk(words[b - 1])) b--

  return words.slice(a, b).join(' ').trim()
}

/** প্রশ্ন কিনা — "তুই কী বলিস?" / "কাল যাবি?" → Romeo-র জন্যই হতে পারে */
const isQuestion = t =>
  /[?？]/.test(t) ||
  /(^|[\s,।])(কী|কি|কেন|কখন|কোথায়|কোথা|কে|কেমন|কত|কিরে|কিসের|কার|কাদের|কেমনে)([\s,?？।]|$)/.test(t)
// কথা চলার সময় কুলডাউন কম — দ্রুত কথায় Romeo চুপ থাকবে না
const CONVO_COOLDOWN_MS = 1500

function isExitWord(text) {
  if (!text || text.length > 12) return false
  const clean = text.toLowerCase().replace(/[\s,!.?।~*_\-'"'"]/g, '')
  return EXIT_WORDS.has(clean)
}

export function createRouter(cfg, db) {
  const limiter = new RateLimiter(cfg.cooldownMs, cfg.dailyCap)
  const memory = new Memory({ max: cfg.contextSize })
  const brain = createBrain(cfg, db)
  // 🧠 স্থায়ী স্মৃতি — কে কেমন, MongoDB-তে জমা থাকে
  const profiles = createProfiles(cfg, db)
  profiles.init().catch(e => console.error('⚠️  স্মৃতি চালু হয়নি:', e?.message || e))
  // কার সাথে কতগুলো কথা হলো — প্রতি কয়েকটায় একবার নতুন তথ্য শিখি
  const sinceLearn = new Map()

  const sentIds = new Set()
  const sentQueue = []

  // মিডিয়া সাময়িকভাবে মনে রাখা — "!দেখো" দিয়ে রিপ্লাই দিলে কাজ লাগে
  const mediaCache = new Map()
  const lastChime = new Map()

  // 💬 কথা চলছে কার সাথে → "chat:user" => কবে পর্যন্ত চলবে
  const conversations = new Map()
  const convoKey = (jid, user) => `${jid}:${user}`
  const inConversation = (jid, user) => (conversations.get(convoKey(jid, user)) || 0) > Date.now()
  const stopConversation = (jid, user) => {
    conversations.delete(convoKey(jid, user))
    convoTurns.delete(convoKey(jid, user))
  }

  // 🤫 বিরক্ত না করার জন্য — গ্রুপে কে কী করছে সেটা মনে রাখা
  const convoTurns = new Map()  // "chat:user" => Romeo কতবার নিজে থেকে উত্তর দিলো
  const lastSpeaker = new Map() // chat => শেষবার কে কথা বলেছে ('ME' = Romeo নিজে)
  const nameBook = new Map()    // "chat:user" => WhatsApp-এ দেখানো নাম

  /**
   * নতুন কথা শুরু — টার্ন ০ থেকে।
   *
   * ⚠️ আগে এখানে `if (!brain.enabled()) return` ছিল — মানে AI key খারাপ
   *    বা কোটা শেষ হলে Romeo কথাই মনে রাখতো না। তখন "Romeo একটা গান দাও"
   *    কাজ করলেও পরের "আরেকটা দে"-তে সে চুপ থাকতো।
   *    কথা মনে রাখা AI-এর কাজ নয় — তাই সব সময়ই ট্র্যাক করবো।
   */
  function startConversation(jid, user) {
    // 🧹 Romeo ফোনে মাসের পর মাস চলবে — তাই মেয়াদ শেষ হওয়া কথোপকথনগুলো
    //    মেমোরি থেকে মুছে ফেলি, নাহলে ম্যাপটা ধীরে ধীরে বাড়তে থাকবে।
    const now = Date.now()
    for (const [k, until] of conversations) {
      if (until <= now) {
        conversations.delete(k)
        convoTurns.delete(k)
      }
    }

    const k = convoKey(jid, user)
    conversations.set(k, now + cfg.convoTimeoutMs)
    convoTurns.set(k, 0)

    // এক গ্রুপে অনেকগুলো কথা একসাথে চললে সবচেয়ে পুরোনোটা বন্ধ
    const keys = [...conversations.keys()].filter(x => x.startsWith(jid + ':'))
    if (keys.length > MAX_CONVO_PER_CHAT) {
      const oldest = keys.sort((a, b) => conversations.get(a) - conversations.get(b))[0]
      conversations.delete(oldest)
      convoTurns.delete(oldest)
    }
  }

  /** কথা চালু আছে — টাইমার রিফ্রেশ + টার্ন বাড়াও */
  function touchConversation(jid, user) {
    const k = convoKey(jid, user)
    conversations.set(k, Date.now() + cfg.convoTimeoutMs)
    convoTurns.set(k, (convoTurns.get(k) || 0) + 1)
  }

  /**
   * ছবি/স্টিকারের প্রম্পট — শুধু "এই ছবিতে কী আছে" নয়।
   * গ্রুপে আগে কী কথা হচ্ছিলো সেটাও দেওয়া হয়, যাতে Romeo বুঝতে পারে
   * ছবিটা কেন পাঠানো হয়েছে, কথার সাথে এর সম্পর্ক কী।
   */
  function mediaPrompt(jid, name, what, caption, seen) {
    const recent = memory.get(jid).slice(-6).map(m => m.text).join('\n')
    const lastLine = memory.get(jid).slice(-2).map(m => m.text).join(' / ') // সবচেয়ে সাম্প্রতিক কথা
    const who = name || 'বন্ধু'
    return [
      recent ? `গ্রুপে এখন এই কথা চলছে:\n${recent}` : '',
      seen
        ? caption
          ? `${who} এই ${what} পাঠিয়ে লিখেছে: "${caption}"`
          : `${who} কোনো লেখা ছাড়াই এই ${what}টা পাঠিয়েছে।`
        : caption
          ? `${who} একটা ${what} পাঠিয়েছে (আমি খুলতে পারিনি), লিখেছে: "${caption}"`
          : `${who} একটা ${what} পাঠিয়েছে (আমি খুলতে পারিনি)।`,
      seen
        ? `ওপরের কথার সাথে এই ${what}-এর সম্পর্ক বুঝে উত্তর দাও। ${what}টা আসলে কিসের — সেটাও এক লাইনে বলো। উত্তর খুব ছোট হবে, ১-২ লাইন।`
        : `গুরুত্বপূর্ণ: ${what}টা তুমি দেখতে পাওনি — কিন্তু সে কথা কাউকে জানাবে না। ` +
          `শেষ যে কথাটা হচ্ছিলো — "${lastLine}" — সেটাকেই ধরে কথা এগিয়ে নিয়ে যাও, ` +
          `যেন মনে হয় তুমি ${what}টা দেখেছো আর সেটারই জবাব দিচ্ছো। খুব ছোট, ১-২ লাইন।`
    ]
      .filter(Boolean)
      .join('\n')
  }

  /**
   * এই মেসেজটা সত্যিই Romeo-র জন্য, নাকি অন্য কারো?
   * যেমন "সুমিত, তুই কী বলিস?" → সুমিত-এর জন্য, Romeo-র জন্য না
   */
  /**
   * 👥 গ্রুপের সব সদস্যের নাম আগেভাগে জেনে রাখা।
   *
   * আগে nameBook-এ কেবল **যারা একবার কথা বলেছে** তাদের নাম থাকতো।
   * ফলে "সুমিত শোন না" লিখলে — সুমিত এখনো কিছু না বললে — Romeo
   * বুঝতেই পারতো না যে ডাকটা তার নয়, আর ঢুকে পড়তো।
   *
   * এখন WhatsApp থেকে গ্রুপের সদস্য-তালিকা এনে রাখি (ঘণ্টায় একবার)।
   * পেছনে চলে, তাই কোনো মেসেজ দেরি হয় না।
   */
  const rosterAt = new Map() // jid -> কখন শেষবার আনা হয়েছে
  const ROSTER_TTL = 60 * 60 * 1000
  function refreshRoster(sock, jid) {
    if (!jid.endsWith('@g.us') || typeof sock?.groupMetadata !== 'function') return
    const last = rosterAt.get(jid) || 0
    if (Date.now() - last < ROSTER_TTL) return
    rosterAt.set(jid, Date.now())
    ;(async () => {
      try {
        const meta = await sock.groupMetadata(jid)
        let n = 0
        for (const p of meta?.participants || []) {
          const num = String(p.id || '').replace(/\D/g, '')
          const nm = (p.notify || p.name || '').trim()
          if (num && nm && nm.length >= 3 && num !== cfg.botNumber) {
            nameBook.set(`${jid}:${num}`, nm)
            n++
          }
        }
        if (n) console.error(`👥 গ্রুপের ${n} জনের নাম জেনে রাখলাম`)
      } catch { /* নাম না পেলেও আগের মতোই চলবে */ }
    })()
  }

  function addressedToOther(text, jid, user) {
    const t = text.trim()
    for (const [key, name] of nameBook) {
      if (!key.startsWith(jid + ':')) continue
      const who = key.slice(jid.length + 1)
      if (who === user || who === cfg.botNumber || name.length < 3) continue
      const n = name.toLowerCase()
      if (!t.toLowerCase().startsWith(n)) continue
      const next = t[name.length] ?? ' '
      if (/[\s,!?।:,.~]/.test(next)) return true // নামের ঠিক পরে স্পেস/চিহ্ন → অন্যকে ডাকছে
    }
    return false
  }

  // বার্তা একবারই দেখাবে — বারবার স্প্যাম করবে না
  let quotaNoticeShown = false
  let keyNoticeShown = false
  let lastNoticeAt = 0
  /** সমস্যার বার্তা ২ মিনিটে একবারের বেশি দেখাবে না */
  const canNotice = () => {
    const now = Date.now()
    if (now - lastNoticeAt < 2 * 60 * 1000) return false
    lastNoticeAt = now
    return true
  }
  const convoCooldown = Math.min(cfg.cooldownMs, CONVO_COOLDOWN_MS)
  // কমান্ডে কুলডাউন প্রায় নেই — "!গান" লিখে অপেক্ষা করতে হবে না
  const CMD_COOLDOWN_MS = 1200
  /** কোন গ্রুপে এই মুহূর্তে গান নামছে */
  const songBusy = new Set()

  function markSent(id) {
    if (!id) return
    sentIds.add(id)
    sentQueue.push(id)
    if (sentQueue.length > 300) sentIds.delete(sentQueue.shift())
  }

  function cacheMedia(chatId, m) {
    if (!mediaKind(m)) return
    if (!mediaCache.has(chatId)) mediaCache.set(chatId, new Map())
    const bucket = mediaCache.get(chatId)
    bucket.set(m.key.id, m)
    if (bucket.size > 10) bucket.delete(bucket.keys().next().value)
  }

  /**
   * WhatsApp-এর ফরম্যাটিং ঠিক করে দেওয়া।
   * WhatsApp-এ bold = *একটা তারকা*, কিন্তু অনেক জায়গা (AI, প্রি-রাইটেন লাইন)
   * ভুল করে **দুটো তারকা** দেয় — তখন আক্ষরিক তারকা দেখায়।
   * তাই পাঠানোর আগে শেষবারের মতো সব ঠিক করে নিই।
   */
  function normalize(t) {
    if (!t) return t
    return String(t)
      .replace(/\*\*(.+?)\*\*/g, '*$1*') // **বোল্ড** → *বোল্ড*
      .replace(/(^|[^_])__([^_]+)__(?=[^_]|$)/g, '$1_$2_') // __ইটালিক__ → _ইটালিক_
      .trim()
  }

  async function reply(sock, msg, text, opts = {}) {
    const jid = msg.key.remoteJid
    text = normalize(text) // ⚠️ সব মেসেজের জন্য সেফটি-নেট
    if (!text) return
    try {
      // quick = "খুঁজছি..." জাতীয় বার্তা, এগুলোতে টাইপিং-এর ভান করে
      // সময় নষ্ট করবো না — সাথে সাথি চলে যাবে
      if (cfg.typing && !opts.quick) {
        await sock.sendPresenceUpdate('composing', jid).catch(() => {})
        await sleep(Math.min(1500, 350 + text.length * 12))
      }
      const sent = await sock.sendMessage(jid, { text }, { quoted: msg })
      markSent(sent?.key?.id)
      lastSpeaker.set(jid, 'ME') // Romeo-ই এখন শেষ কথা বললো
      db.bump('stats:replies')
      memory.addOwn(jid, text)
      if (cfg.typing) await sock.sendPresenceUpdate('paused', jid).catch(() => {})
      return sent
    } catch (err) {
      console.error('❌ পাঠাতে সমস্যা:', err?.message || err)
    }
  }

  const isOwner = m => m.key.fromMe || (!!cfg.ownerNumber && senderNumber(m) === cfg.ownerNumber)

  /**
   * AI কল।
   * @returns {Promise<string|null>} null = চুপ থাকবে (স্প্যাম নয়, এরর নয়)
   */
  /**
   * 🧠 মাঝে মাঝে আড্ডা থেকে পাকা তথ্য তুলে স্মৃতিতে রাখি।
   *
   * প্রতি মেসেজে করলে কোটা ফুরিয়ে যেতো, তাই প্রতি LEARN_EVERY-তে একবার।
   * পেছনে (await ছাড়া) চলে — তাই উত্তর দিতে একটুও দেরি হয় না।
   */
  // কোটা এখন অনেক বড় (দিনে ~১০০০), তাই আরও ঘন ঘন শিখতে পারি
  const LEARN_EVERY = 4
  function maybeLearn(jid, user, pushName) {
    if (!user || !brain.enabled()) return
    const k = `${jid}:${user}`
    // 🧹 গোনার খাতাটা অসীম বাড়তে দেবো না (দীর্ঘদিন চললে র‍্যাম খেতো)
    if (sinceLearn.size > 2000) sinceLearn.clear()
    const n = (sinceLearn.get(k) || 0) + 1
    if (n < LEARN_EVERY) { sinceLearn.set(k, n); return }
    sinceLearn.set(k, 0)

    // কোটার শেষ দিকে শেখা বন্ধ — কথা বলাটাই বেশি জরুরি
    if (brain.quotaLeft() < 25) return

    ;(async () => {
      try {
        const name = pushName || profiles.get(jid, user)?.name || ''
        const facts = await brain.learn({ history: memory.get(jid), name })
        if (facts.length) {
          const added = profiles.learn(jid, user, facts)
          if (added) console.error(`🧠 ${name || user}: ${added}টা নতুন কথা মনে রাখলাম`)
        }
      } catch { /* শেখা না হলেও আড্ডা চলবে */ }
    })()
  }

  async function aiReply(sock, msg, prompt, opts = {}) {
    const jid = msg.key.remoteJid
    // 🧠 এই মানুষটা সম্পর্কে যা সত্যিই জানি, সেটা Romeo-র সামনে রাখি।
    //    কিছু না জানলে ফাঁকা যায় — তখন সে বানিয়ে বলার বদলে জিজ্ঞেস করবে।
    const who = senderNumber(msg)
    const extra = profiles.brief(jid, [who])
    const r = opts.media
      ? await brain.see({ media: opts.media, prompt, extra })
      : await brain.ask({ history: memory.get(jid), text: prompt, extra })

    if (r.ok) {
      // 🧠 প্রতি ৬টা কথায় একবার নতুন কিছু শিখে রাখি।
      //    পেছনে চলে — উত্তর পাঠাতে এক মুহূর্তও দেরি হয় না।
      maybeLearn(jid, who, msg.pushName)
      return r.text
    }

    const owner = isOwner(msg)

    if (r.reason === 'nokey' || r.reason === 'key') {
      console.error('⚠️  AI কাজ করছে না:', r.reason, r.detail || '')
      if (owner && !keyNoticeShown && canNotice()) {
        keyNoticeShown = true
        return '_Romeo-এর AI key-এ সমস্যা — .env-এ GEMINI_API_KEY ঠিক করে বসাও_ 🤖'
      }
      return null // বারবার এলোমেলো লাইন পাঠাবে না
    }

    if (r.reason === 'quota') {
      if (!quotaNoticeShown && canNotice()) {
        quotaNoticeShown = true
        return '_মামা আজ অনেক কথা বলেছে, একটু বিশ্রাম নিচ্ছে_ 😴 কালকে আবার!'
      }
      // 🫂 কোটা ফুরোলেও কেউ দুঃখে/ভয়ে/রাগে থাকলে চুপ করে থাকা নিষ্ঠুর।
      //    তাই আবেগের মুহূর্তে অন্তত ঠিক সুরের একটা লাইন যাক।
      //    সাধারণ গল্পে চুপই থাকবে — নাহলে সারাদিন "হুম, বল" বলে বিরক্ত করবে।
      return moodFallback(prompt, false)
    }

    if (r.reason === 'net') {
      console.error('⚠️  নেট সমস্যা:', r.detail || '')
      return moodFallback(prompt)
    }

    console.error('⚠️  AI ব্যর্থ:', r.detail || r.reason)
    return moodFallback(prompt)
  }

  /**
   * 🫀 AI সাড়া না দিলে অন্তত *ঠিক অনুভূতিতে* উত্তর দাও।
   *
   * আগে এখানে `null` ফেরত যেতো — মানে Romeo একদম চুপ, অথবা পরে
   * "হাজির! কী নিয়ে আড্ডা?" জাতীয় বেমানান লাইন। কেউ "মন খারাপ"
   * লিখলে সেটা রীতিমতো অপমান।
   *
   * এখন: মুড বুঝে মানানসই একটা লাইন — সাথে সাথি, কোনো খরচ ছাড়া।
   * মুড নিরপেক্ষ হলে তবুও চুপ থাকবো (ফালতু বকবক নয়)।
   */
  /**
   * AI সাড়া না দিলে অন্তত *ঠিক অনুভূতিতে* কিছু একটা বলো।
   *
   * ⚠️ আগে নিরপেক্ষ মুডে `null` যেতো — মানে Romeo পুরো চুপ। Google-এর
   *    সার্ভারে ভিড় থাকলে (৫০৩) আড্ডার মাঝখানে সে হঠাৎ উধাও হয়ে যেতো,
   *    আর সবাই ভাবতো বট বন্ধ হয়ে গেছে। এখন ছোট্ট একটা স্বাভাবিক কথা
   *    বলে কথাটা জিইয়ে রাখে।
   *
   * @param {boolean} engaged  কেউ কি সরাসরি Romeo-র সাথেই কথা বলছে?
   */
  function moodFallback(text, engaged = true) {
    const { mood } = detectMood(text)
    if (mood !== 'neutral') return fun.moodLine(mood)
    return engaged ? pickFresh(fun.BUSY_LINES, 'busy') : null
  }

  /** AI দিয়ে উত্তর — null এলে কিছু পাঠাবে না */
  async function aiSay(sock, msg, prompt, opts = {}) {
    const out = await aiReply(sock, msg, prompt, opts)
    if (out == null) return
    return reply(sock, msg, out)
  }

  /**
   * 🎵 গান খুঁজে পাঠানো।
   * প্রথমে অডিও ফাইল ডাউনলোডের চেষ্টা → না পারলে YouTube লিংক + গানের নাম।
   */
  async function handleSong(sock, msg, query) {
    const jid = msg.key.remoteJid
    const today = 'song:' + new Date().toDateString()

    // 🚦 একই গ্রুপে একসাথে দুটো গান নামালে ফোনের র‍্যাম-নেট দুটোই আটকে
    //    যায়, আর দুটোই ধীর হয়। তাই একটার কাজ চলতে থাকলে জানিয়ে দিই।
    if (songBusy.has(jid)) {
      return reply(sock, msg, `_আগের গানটা এখনো আনছি — শেষ হলেই এটা করবো_ 🎧`, { quick: true })
    }

    // নাম্বার বাঁচাতে দৈনিক সীমা
    if ((db.get(today, 0) || 0) >= cfg.songDailyCap) {
      return reply(sock, msg, '_মামা আজ অনেক গান শুনিয়ে দিয়েছে — কালকে আবার_ 🎵')
    }
    if (!query || query.length < 2) {
      return reply(sock, msg, '_কোন গানটা চাও?_ যেমন — `!গান লাজুক পাতা` 🎵')
    }

    // ⚡ সাথে সাথি জানাই যে খুঁজতে শুরু করেছি। `quick` = টাইপিং
    //    অ্যানিমেশনের দেরি নেই, নাহলে এই বার্তাটাই ১.৫ সেকেন্ড পরে যেতো।
    await reply(sock, msg, `🔎 _"${query}" খুঁজছি..._ ⏳`, { quick: true })

    songBusy.add(jid)
    let song
    try {
      song = await fetchSong(query, cfg.songMaxBytes)
    } catch (err) {
      console.error('🎵 গান আনতে সমস্যা:', err?.message || err)
      songBusy.delete(jid)
      return reply(sock, msg, '_গান আনতে গিয়ে একটা গোলমাল হলো — আরেকবার চেষ্টা করো_ 🙏')
    } finally {
      songBusy.delete(jid)
    }

    // 🔍 ডিবাগ মোড চালু থাকলে কোথায় আটকাচ্ছে সেটা গ্রুপেই দেখাবে
    if (cfg.songDebug && song?.log?.length) {
      await reply(sock, msg, '🔍 *কী কী চেষ্টা করলাম:*\n' + song.log.map(l => `• ${l}`).join('\n'))
    }

    if (!song || song.fail === 'nothing') {
      // ⚠️ ব্যর্থ হলে দৈনিক কোটা খরচ করি না — আগে করতো, ফলে কয়েকবার
      //    ফেল করলেই "আজ অনেক গান শুনিয়েছি" বলে বন্ধ হয়ে যেতো।
      return reply(
        sock,
        msg,
        `_"${query}" — এই গানটা খুঁজে পেলাম না_ 😕\n` +
          `_একটু অন্যভাবে লেখো — শিল্পীর নাম দিলে আরও ভালো_\n` +
          `_যেমন:_ \`!গান ${query} anupam roy\``
      )
    }
    db.bump(today)

    if (song.file) {
      const sent = await sendAudio(sock, jid, song)
      cleanup(song) // ফোনের জায়গা বাঁচাতে টেম্প ফাইল মুছে ফেলো
      if (sent) {
        // অডিওর নিচে এক লাইনে গানের নাম + শিল্পী (প্রফেশনাল লুক)
        const who = song.artist ? ` — _${song.artist}_` : ''
        return reply(sock, msg, `🎵 *${song.title}*${who} ✅`)
      }
    }

    const who = song.artist ? `\n_${song.artist}_` : ''

    // 🤔 নামটা হুবহু মেলেনি — ভুল গান চাপিয়ে না দিয়ে জিজ্ঞেস করি
    if (song.maybe) {
      return reply(
        sock,
        msg,
        `_"${query}" হুবহু পেলাম না_ 😕\n\n` +
          `এটা কি? 👇\n🎵 *${song.title}*${who}\n${song.url}\n\n` +
          `_হ্যাঁ হলে পুরো নামটা লিখে আবার চাও_`
      )
    }

    return reply(
      sock,
      msg,
      `🎵 *${song.title}*${who}\n${song.url}\n` +
        `_ফাইল ডাউনলোড করতে পারলাম না — লিংকটা নিয়ে নাও_ 🙏\n` +
        `_কেন পারলাম না:_ ${whyFailed(song.log)}`
    )
  }

  /** কেন ডাউনলোড হয়নি — সহজ করে বলা */
  function whyFailed(log) {
    const all = (log || []).join(' | ')
    if (/সাইজ বেশি/.test(all)) return 'ফাইলটা অনেক বড়'
    if (/ডাউনলোড ব্যর্থ/.test(all)) return 'নেটের সমস্যা'
    if (/ডিক্রিপ্ট/.test(all)) return 'লিংক খুলতে পারিনি'
    if (/yt-dlp/.test(all)) return 'YouTube ব্লক করেছে'
    return 'জানা নেই'
  }

  /** 📝 গানের লিরিক্স */
  async function handleLyrics(sock, msg, query) {
    if (!query || query.length < 2) {
      return reply(sock, msg, '_কোন গানের লিরিক্স চাও?_ যেমন — `!লিরিক্স প্রজাপতি` 📝')
    }
    await reply(sock, msg, `_📝 "${query}"-এর কথা খুঁজছি..._ ⏳`)
    const song = await fetchLyrics(query)
    if (!song) {
      return reply(
        sock,
        msg,
        `_"${query}" — এই গানের লিরিক্স পেলাম না_ 😕\n_ইংরেজিতে বা অন্য নাম দিয়ে চেষ্টা করো?_`
      )
    }
    const out = formatLyrics(song)
    if (!out) {
      return reply(sock, msg, `_\"${query}\" — লিরিক্স পাওয়া গেলো কিন্তু খালি_ 😕`)
    }
    return reply(sock, msg, out)
  }

  async function handleMessage(sock, msg) {
    // ---------- ১. বেসিক ফিল্টার ----------
    if (!msg?.message) return
    const jid = msg.key.remoteJid
    // 💬 ব্যক্তিগত চ্যাট (1-to-1) — আগে একেবারেই বাদ দেওয়া হতো
    const isDm = !isGroupJid(jid)
    if (msg.key.fromMe && sentIds.has(msg.key.id)) return

    // ⚠️ DM-এ তুমি নিজে ফোন থেকে যা লিখছো (fromMe) — সেখানে Romeo জবাব দেবে না,
    //    নাহলে সে উল্টো অন্য জনকে মেসেজ পাঠিয়ে দেবে! শুধু কমান্ড (!গান) আর
    //    "Romeo" ডাকলে কাজ করবে — মানে তুমি নিজেই Romeo-কে নিয়ন্ত্রণ করছো।
    if (isDm && msg.key.fromMe) {
      const t = extractText(msg).trim().toLowerCase()
      const isCmdDm = t.startsWith('!') || t.startsWith('/')
      const callsDm = cfg.triggerWords.some(w => t.includes(w))
      if (!isCmdDm && !callsDm) return
    }

    // পুরোনো মেসেজ পুনরায় প্রসেস করবো না (রিকানেক্টের পর পুরোনো মেসেজ আসে)।
    // ⚠️ ৬০ সেকেন্ড ছিল — কিন্তু ফোনের ঘড়ি এগিয়ে থাকলে বা Termux ঘুমিয়ে
    //    থাকলে সব মেসেজ "পুরোনো" ধরা পড়তো আর Romeo চুপ থাকতো।
    //    তাই ৫ মিনিট, আর টাইমস্ট্যাম্প না থাকলে বাদ দিচ্ছি না।
    const ts = Number(msg.messageTimestamp || 0)
    if (ts > 0) {
      const ageSec = Date.now() / 1000 - ts
      if (ageSec > 300) return
    }

    if (IGNORED_TYPES.has(messageType(msg))) return

    const text = extractText(msg)
    const name = senderName(msg)
    const lower = text.toLowerCase()
    const kind = mediaKind(msg)

    // ---------- ২. অনুমোদিত গ্রুপ? ----------
    // ⚠️ `/id` আগে থেকেই চেক করি — নাহলে নতুন গ্রুপে Romeo-কে ঢুকানোর
    //    উপায় থাকে না (কোন গ্রুপে আছি সেটা জানতেই হলে `/id` লাগবে)।
    //    অনুমোদিত নয় → শুধু /id-এর জবাব, আর কিছু নয়।
    if (!isAllowedChat(jid, cfg)) {
      if (matchCommand(text, ['id'])) {
        await reply(sock, msg, fun.newGroupText(jid))
      }
      return
    }

    db.bump('stats:messages')
    if (kind) cacheMedia(jid, msg)

    // স্মৃতিতে রাখি (ছবি/ভয়েস হলে বর্ণনা দিয়ে)
    // 🧠 কে কথা বলছে — চিনে রাখি (নাম + কতবার দেখা হলো)
    profiles.touch(jid, senderNumber(msg), msg.pushName || name)
    if (text) memory.add(jid, { name, text })
    else if (kind) memory.add(jid, { name, text: `[একটা ${kind === 'voice' ? 'ভয়েস নোট' : 'ছবি'} পাঠালো]` })

    // ---------- ৩. Discovery mode ----------
    if (cfg.discoveryMode) {
      if (matchCommand(text, ['id'])) await reply(sock, msg, fun.discoveryText(jid, cfg))
      return
    }

    const isCmd = text.startsWith('!') || text.startsWith('/')

    // ---------- ৪. মিডিয়া কমান্ড (AI) ----------
    if (matchCommand(text, ['দেখো', 'দেখ', 'dekho', 'see', 'look'])) {
      const caption = text.replace(/^[!/]\S+\s*/, '').trim()
      const target =
        kind === 'image' || kind === 'video' || kind === 'sticker'
          ? msg
          : mediaCache.get(jid)?.get(quotedId(msg))
      if (!target) return reply(sock, msg, '_কোন ছবি পেলাম না। ছবির সাথে ক্যাপশনে `!দেখো` লিখো, অথবা ছবিতে রিপ্লাই দিয়ে `!দেখো` লিখো_ 🖼️')
      if (!brain.enabled()) return reply(sock, msg, '_ছবি দেখতে হলে Romeo-এর AI চালু করতে হবে (GEMINI_API_KEY)_ 🤖')
      const media = await getMedia(target, sock)
      if (!media) return reply(sock, msg, '_ছবিটা পড়তে পারছি না_ 😕')
      if (media.tooBig) return reply(sock, msg, `_${media.label}টা অনেক বড়, Romeo পারবে না_ 😅`)
      const seen = await aiReply(
        sock,
        msg,
        mediaPrompt(jid, name, media.label, caption, true), // কথার প্রসঙ্গ সহ
        { media }
      )
      return reply(sock, msg, seen || '_এইবার ছবিটা বুঝতে পারলাম না_ 😕')
    }

    if (matchCommand(text, ['শুনি', 'শোনা', 'transcribe', 'text'])) {
      const target = kind === 'voice' || kind === 'audio' ? msg : mediaCache.get(jid)?.get(quotedId(msg))
      if (!target) return reply(sock, msg, '_কোন ভয়েস নোট পেলাম না। ভয়েসে রিপ্লাই দিয়ে `!শুনি` লিখো_ 🎤')
      if (!brain.enabled()) return reply(sock, msg, '_ভয়েস শুনতে হলে Romeo-এর AI চালু করতে হবে (GEMINI_API_KEY)_ 🤖')
      const media = await getMedia(target, sock)
      if (!media) return reply(sock, msg, '_ভয়েস নোটটা পড়তে পারছি না_ 😕')
      if (media.tooBig) return reply(sock, msg, '_ভয়েস নোটটা অনেক লম্বা_ 😅')
      const out = await brain.hear({ media })
      return reply(
        sock,
        msg,
        out.ok ? `🎤 *ভয়েস নোট:*\n${out.text}` : '_ভয়েসটা বুঝতে পারিনি_ 😕'
      )
    }

    // ---------- ৫. টেক্সট কমান্ড ----------
    // 💬 কথা চলছে কিনা — একবার ডাকলেই Romeo বুঝে নেবে, বারবার ডাকতে হবে না
    const user = senderNumber(msg)
    const qid = quotedId(msg)
    const replyingToRomeo = !!qid && sentIds.has(qid) // Romeo-র মেসেজে রিপ্লাই
    const convoActive = inConversation(jid, user)
    const inConvo = convoActive || replyingToRomeo

    // 🤫 বিরক্ত না করা — এই মেসেজটা আসলে কার জন্য?
    const prevSpeaker = lastSpeaker.get(jid) // এই মেসেজের আগে কে কথা বলেছিলো

    // ---- ডাকটা Romeo-র জন্য কিনা ----
    const strength = mentionStrength(lower, cfg.triggerWords)
    const taggedBot = !!cfg.botNumber && text.includes('@' + cfg.botNumber)

    // দুর্বল নাম (ভাই/দাদা/সোনা/গুরু...) একাই যথেষ্ট নয়।
    // Romeo সাড়া দেবে শুধু তখনই, যখন সে স্পষ্টতই কথার সঙ্গী:
    //   • তার সাথে কথা চলছে, বা
    //   • তার মেসেজে রিপ্লাই করা হয়েছে, বা
    //   • এই চ্যাটে ঠিক আগের কথাটা সে-ই বলেছিলো, বা
    //   • ব্যক্তিগত ইনবক্স (সেখানে তো সে-ই একমাত্র শ্রোতা)
    //
    // ব্যতিক্রম: ডাকটা দুর্বল হলেও যদি সাথে স্পষ্ট ফরমায়েশ থাকে —
    // "মামু একটা গান দে", "গুরু লিরিক্স দাও", "ভাই intro দে" — তবে
    // বোঝাই যায় কাজটা Romeo-কেই বলা, কারণ বন্ধুকে কেউ এভাবে বলে না।
    const clearOrder =
      isSongRequest(text) || isLyricRequest(text) || isIntroRequest(text)

    // ⚠️ "Romeo এইমাত্র কথা বলেছে" — এটাকে যথেষ্ট প্রমাণ ধরা হয়নি।
    //    ধরলে এরকম হতো: Romeo একবার বলল → কেউ "ভাই..." লিখল → Romeo
    //    আবার বলল → আরেকজন "দাদা..." লিখল → Romeo আবার... অর্থাৎ
    //    একবার মুখ খুললেই সে পুরো আড্ডা দখল করে নিতো।
    //    Romeo-কে কিছু বলতে চাইলে তার মেসেজে রিপ্লাই করো, বা নাম ধরে ডাকো।
    const weakIsForRomeo =
      convoActive || replyingToRomeo || isDm || clearOrder

    const nameHit =
      strength === 'strong' ||
      (strength === 'weak' && weakIsForRomeo)

    const mentioned =
      taggedBot ||
      (nameHit && !addressingSomeoneElse(msg, lower, cfg, id => sentIds.has(id))) ||
      // 💬 ব্যক্তিগত চ্যাটে অন্য জনের মেসেজটা সরাসরি Romeo-র জন্যই —
      //    সেখানে কাউকে "Romeo" বলে ডাকার দরকার নেই (1-to-1 তো!)
      (isDm && cfg.dmAutoReply && !msg.key.fromMe)

    lastSpeaker.set(jid, user)
    if (msg.pushName && user) nameBook.set(`${jid}:${user}`, msg.pushName)
    refreshRoster(sock, jid) // গ্রুপের বাকিদের নামও জেনে রাখি (ঘণ্টায় একবার)

    // অন্য কাউকে উদ্দেশ্য করে কথা বলছে? → Romeo চুপ থাকবে (আড্ডায় বাধা দেবে না)
    const quotingOther = !!qid && !sentIds.has(qid)
    const mentioningOther = /@\d{6,}/.test(text) && !text.includes('@' + cfg.botNumber)
    const talkingToOther =
      quotingOther || mentioningOther || addressedToOther(text, jid, user)

    // গ্রুপে অন্য কেউ শেষ কথা বলেছে → এই মেসেজটা ওরই জবাব, Romeo-র জন্য না
    const otherSpokeLast =
      !!prevSpeaker && prevSpeaker !== user && prevSpeaker !== 'ME'

    // "থামো / ok / ধন্যবাদ" → কথা শেষ
    if (inConvo && isExitWord(text)) {
      stopConversation(jid, user)
      return reply(sock, msg, pickFresh(fun.GOODBYES, 'bye'))
    }

    if (!isCmd && !mentioned && !inConvo) {
      // নিজে থেকে কথা বলবে? (AUTO_CHAT_CHANCE অনুযায়ী)
      await maybeChime(sock, msg, text)
      return
    }

    if (!isOwner(msg)) {
      // ⚠️ এখানেই "মাঝে মাঝে গান দিচ্ছে না"-এর আসল কারণ ছিল:
      //    ৪ সেকেন্ডের কুলডাউনে পড়লে Romeo একদম চুপ হয়ে যেতো (মাত্র ২৫%
      //    সময় কিছু বলতো)। ব্যবহারকারী বুঝতেই পারতো না কী হলো।
      //
      //    এখন: কমান্ড (!গান, !লিরিক্স) প্রায় সাথে সাথি চলবে, আর
      //    আটকালেও Romeo সবসময় জানিয়ে দেবে — কখনো নীরবে গিলে ফেলবে না।
      // ⚠️ CMD_COOLDOWN_MS সরাসরি বসালে ব্যবহারকারীর COOLDOWN_MS=0 সেটিং
      //    উপেক্ষা হতো। তাই কনফিগের চেয়ে কখনো *বেশি* অপেক্ষা করাবো না।
      const cool = isCmd
        ? Math.min(cfg.cooldownMs, CMD_COOLDOWN_MS)
        : (inConvo ? convoCooldown : undefined)
      const gate = limiter.check(rateKey(msg), cool)
      if (!gate.ok) {
        if (gate.reason === 'daily') {
          // আগে এটায় একদম নীরব থাকতো — সারাদিন কেন চুপ, কেউ জানতো না
          await reply(sock, msg, '_আজ তোর সাথে অনেক কথা হলো রে! কালকে আবার_ 😌')
        } else if (isCmd) {
          // কমান্ড কখনো নীরবে ফেলে দেবো না
          const sec = Math.ceil((gate.waitMs || 0) / 1000)
          await reply(sock, msg, `_আগেরটা এখনো করছি — ${bn(sec)} সেকেন্ড দাও_ ⏳`)
        } else if (Math.random() < 0.25) {
          await reply(sock, msg, '_একটু ধীরে ডাকো রে, Romeo-এরও তো শ্বাস নেওয়ার সময় দরকার_ 😮‍💨')
        }
        return
      }
    }

    if (cfg.sendReadReceipts) await sock.readMessages([msg.key]).catch(() => {})

    if (matchCommand(text, ['id'])) {
      return reply(sock, msg, `🆔 এই গ্রুপের ID:\n\`${jid}\``)
    }

    if (matchCommand(text, ['help', 'সাহায্য', 'commands'])) {
      return reply(sock, msg, fun.helpText(cfg))
    }

    if (matchCommand(text, ['ping', 'hello', 'hi'])) {
      return reply(sock, msg, pickFresh(fun.PING_LINES, 'ping'))
    }

    // AI roast (AI না থাকলে প্রি-রাইটেন)
    if (matchCommand(text, ['roast', 'রোস্ট', 'ট্রল'])) {
      const rest = text.replace(/^[!/]\S+\s*/, '').trim()
      const target = rest.replace(/@\d+/g, '').trim() || 'এই গ্রুপের সবাই'
      if (brain.enabled()) {
        const ai = await aiReply(sock, msg, `${target}-কে Romeo-এর স্টাইলে এক-দুই লাইনে হালকা ট্রল করো। কোনো গালি বা আঘাত নেই।`)
        if (ai) return reply(sock, msg, ai)
      }
      return reply(sock, msg, pickFresh(fun.ROASTS, 'roast')(target)) // AI ফেল করলে প্রি-রাইটেন
    }

    if (matchCommand(text, ['খাবো', 'biriyani', 'biryani', 'food', 'khabo'])) {
      return reply(sock, msg, pickFresh(fun.FOOD_DECISIONS, 'food'))
    }

    if (matchCommand(text, ['ভাগ্য', 'fortune', 'bhaggo'])) {
      return reply(sock, msg, `🔮 *${name}* — আজকের ভবিষ্যদ্বাণী:\n\n${pickFresh(fun.FORTUNES, 'fortune')}`)
    }

    if (matchCommand(text, ['dice', 'ছক্কা', 'chokka'])) {
      return reply(sock, msg, fun.diceLine(name))
    }

    if (matchCommand(text, SONG_CMDS)) {
      return handleSong(sock, msg, songQuery(text))
    }

    if (matchCommand(text, ['ai', 'জিজ্ঞাসা', 'ask'])) {
      const q = text.replace(/^[!/]\S+\s*/, '').trim()
      if (!q) return reply(sock, msg, '_কী জানতে চাও? যেমন: `!ai আজকে বৃষ্টি হবে?`_ 🤔')
      const out = await aiReply(sock, msg, q)
      if (out) return reply(sock, msg, out)
      if (canNotice()) return reply(sock, msg, '_এইবার Romeo-এর মাথা কাজ করছে না_ 🤕 একটু পরে আবার চেষ্টা করো।')
      return
    }

    if (matchCommand(text, ['status', 'stats'])) {
      if (!isOwner(msg)) return reply(sock, msg, '_এটা শুধু Romeo-এর মালিক দেখতে পাবে_ 😌')
      const up = Date.now() - db.get('startedAt', Date.now())
      return reply(
        sock,
        msg,
        `📊 *Romeo-এর হাল*\n` +
          `┣ আপটাইম: ${Math.floor(up / 3600000)} ঘণ্টা ${Math.floor((up % 3600000) / 60000)} মিনিট\n` +
          `┣ দেখা মেসেজ: ${db.get('stats:messages', 0)}\n` +
          `┣ দেওয়া উত্তর: ${db.get('stats:replies', 0)}\n` +
          `┣ AI: ${brain.enabled() ? 'চালু' : 'বন্ধ (key নেই)'}\n` +
          `┣ আজকের AI কল: ${brain.usedToday()} / ${cfg.aiDailyCap}\n` +
          `┗ মোড: ${cfg.discoveryMode ? 'DISCOVERY' : cfg.allowAllGroups ? '🌍 সব গ্রুপে' : `${cfg.allowedGroups.length}টি গ্রুপে`}`
      )
    }

    if (matchCommand(text, ['ভুলে যা', 'forget'])) {
      memory.clear(jid)
      const n = profiles.forgetChat(jid) // স্থায়ী স্মৃতিও মুছে যাক
      sinceLearn.clear()
      return reply(sock, msg, n
        ? `_ঠিক আছে, সব ভুলে গেলাম_ 🧹`
        : '_ঠিক আছে, সব ভুলে গেলাম_ 🧹')
    }

    // ---------- ৫.২ নিজের পরিচয় ("Romeo তোমার intro দাও") ----------
    const introCmd = isCmd && matchCommand(text, ['intro', 'ইন্ট্রো', 'পরিচয়', 'পরিচয়', 'porichoy'])
    const introAsk = (mentioned || inConvo) && !talkingToOther && isIntroRequest(text)
    if (introCmd || introAsk) {
      if (mentioned) startConversation(jid, user)
      else if (convoActive) touchConversation(jid, user)
      return reply(sock, msg, fun.INTRO) // তৈরি পরিচয় — কোনো AI খরচ নেই
    }

    // ---------- ৫.২২ 🎂 বয়স জিজ্ঞেস করলে — Romeo-এর ফেভারিট ডায়লগ ----------
    // "Romeo তোর বয়স কত?" → সাথে সাথি, AI ছাড়াই
    const ageAsk = (mentioned || inConvo) && !isCmd && !talkingToOther && AGE_ASK(text)
    if (ageAsk) {
      if (mentioned) startConversation(jid, user)
      else if (convoActive) touchConversation(jid, user)
      return reply(sock, msg, pickFresh(fun.AGE_LINES, 'age'))
    }

    // ---------- ৫.২৫ লিরিক্স ("Romeo এই গানের lyrics দাও") ----------
    // ⚠️ গানের আগে চেক করি — কারণ "গানের লিরিক্স দাও"-তে "গান" শব্দটাও আছে
    const lyricCmd = isCmd && matchCommand(text, ['লিরিক্স', 'লিরিক', 'lyrics', 'lyric', 'গানের কথা'])
    const lyricAsk = (mentioned || inConvo) && !talkingToOther && !isCmd && isLyricRequest(text)
    if (lyricCmd || lyricAsk) {
      if (mentioned) startConversation(jid, user)
      return handleLyrics(sock, msg, songQuery(text))
    }

    // ---------- ৫.৩ গান ("Romeo একটা গান দাও") ----------
    const songCmd = isCmd && matchCommand(text, SONG_CMDS)
    const songAsk = (mentioned || inConvo) && !talkingToOther && !isCmd && isSongRequest(text)
    if (songCmd || songAsk) {
      if (mentioned) startConversation(jid, user)
      return handleSong(sock, msg, songQuery(text))
    }

    // ---------- ৫.৫ কথার মাঝখানে ছবি/স্টিকার/ভিডিও পাঠালে ----------
    // আগে Romeo একেবারেই চুপ থাকতো — এবার সে ছবিটা দেখবে আর
    // আগের কথার সাথে মিলিয়ে বুঝবে ছবিটা কেন পাঠানো হয়েছে।
    if (kind && !isCmd) {
      const forMe =
        mentioned ||
        replyingToRomeo ||
        (convoActive && !talkingToOther &&
          (cfg.buttIn || isDm || prevSpeaker === 'ME'))

      if (forMe && brain.enabled() && brain.quotaLeft() > 0) {
        const media = await getMedia(msg, sock)
        const what = media?.tooBig ? MEDIA_LABEL[kind] : (media?.label || MEDIA_LABEL[kind])

        // প্রথমে ছবিটা দেখার চেষ্টা — না পারলে শুধু কথার প্রসঙ্গ দিয়েই জবাব
        let out = null
        if (media && !media.tooBig) {
          out = await aiReply(sock, msg, mediaPrompt(jid, name, what, text, true), { media })
        }
        if (!out) out = await aiReply(sock, msg, mediaPrompt(jid, name, what, text, false))

        if (out) {
          if (mentioned) startConversation(jid, user)
          else touchConversation(jid, user)
          return reply(sock, msg, out)
        }
      }
      return
    }

    // ---------- ৬. Romeo-কে ডাকা → কথা শুরু ----------
    if (mentioned) {
      startConversation(jid, user) // এখন থেকে নাম ছাড়াই উত্তর দেবে
      const clean = text.replace(/@\d+/g, '').trim()
      if (brain.enabled() && hasSubstance(text, cfg.triggerWords)) {
        const out = await aiReply(sock, msg, clean)
        if (out) return reply(sock, msg, out)
      }
      // ⚠️ AI না থাকলে/ব্যর্থ হলে আগে সবসময় "হাজির! কী খবর?" যেতো —
      //    কেউ "মন খারাপ" লিখলেও! এখন আগে মুড দেখি।
      const feel = fun.moodLine(detectMood(clean).mood)
      return reply(sock, msg, feel || pickFresh(fun.WAKE_LINES, 'wake'))
    }

    // ---------- ৬.৫ কথা চলছে → নাম ছাড়াই উত্তর ----------
    if (inConvo) {
      // অন্য কাউকে রিপ্লাই/মেনশন/নাম ধরে লিখলে Romeo চুপ — আড্ডায় বাধা দেবে না
      if (talkingToOther) return
      // AI বন্ধ বা কোটা শেষ → কথা চালিয়ে যেতে পারবে না, চুপই ভালো
      if (!brain.enabled() || brain.quotaLeft() <= 0) return

      // 🤫 ======= আড্ডায় বাধা না দেওয়ার মূল নিয়ম =======
      //
      //    আগের নিয়মে দুটো বড় ফাঁক ছিল, আর সে দুটো দিয়েই Romeo
      //    সবার কথার মাঝখানে ঢুকে পড়তো:
      //
      //    ফাঁক ১ — `isQuestion(text)` ছাড়পত্র দিতো। কিন্তু গ্রুপে
      //      বেশিরভাগ প্রশ্নই একে অপরকে করা হয় ("তুই কাল আসবি?")।
      //      Romeo-র সাথে কথা চালু থাকায় সে ওটাকে নিজের প্রশ্ন ভেবে
      //      জবাব দিয়ে দিতো।
      //
      //    ফাঁক ২ — `otherSpokeLast` কেবল *অন্য কেউ* শেষ কথা বললে
      //      আটকাতো। কিন্তু যে নিজেই Romeo-র সাথে কথা বলেছিল, সে-ই
      //      যখন বন্ধুর দিকে ফিরে কথা বলতো, তখন prevSpeaker === user
      //      হওয়ায় বাধা উঠে যেতো আর Romeo ঢুকে পড়তো।
      //
      //    এখনকার নিয়ম সহজ আর মানুষের মতো: **নাম ধরে না ডাকলে বা
      //    রিপ্লাই না করলে, Romeo তখনই কথা চালাবে যখন ঠিক আগের
      //    কথাটা সে-ই বলেছিল** — অর্থাৎ সত্যিকারের পাল্টাপাল্টি চলছে।
      //    মাঝে অন্য কেউ একটা কথাও বললেই আড্ডাটা আর তার নয়, সে চুপ।
      const romeoSpokeLast = prevSpeaker === 'ME'
      if (!isDm && !cfg.buttIn && !replyingToRomeo && !romeoSpokeLast) return

      // 🔁 যথেষ্ট হয়েছে — Romeo একা একা বকবে না। এবার নাম দিয়ে ডাকতে হবে
      if (!replyingToRomeo && (convoTurns.get(convoKey(jid, user)) || 0) >= cfg.maxConvoTurns) return

      if (replyingToRomeo && convoActive) convoTurns.set(convoKey(jid, user), 0) // সরাসরি ডাকলে ০ থেকে
      touchConversation(jid, user) // টাইমার নতুন করে + টার্ন বাড়লো
      await aiSay(sock, msg, text)
      return
    }

    // ---------- ৭. অচেনা কমান্ড ----------
    if (isCmd) {
      return reply(
        sock,
        msg,
        `_\`${text.split(/\s+/)[0]}\` — Romeo এই কমান্ডটা চেনে না।_ 🤷‍♂️\n\`!help\` লিখে সব কমান্ড দেখে নাও।`
      )
    }
  }

  /** নিজে থেকে মাঝে মাঝে মন্তব্য */
  async function maybeChime(sock, msg, text) {
    if (!text || !brain.enabled() || cfg.autoChatChance <= 0) return
    if (Math.random() >= cfg.autoChatChance) return

    const jid = msg.key.remoteJid
    const now = Date.now()
    if (now - (lastChime.get(jid) || 0) < 3 * 60 * 1000) return // ৩ মিনিটে একবার

    const line = await brain.chime({ history: memory.get(jid), text })
    if (!line) return
    lastChime.set(jid, now)
    await reply(sock, msg, line)
  }

  /** গ্রুপে কেউ জয়েন করলে — স্বাগতম */
  async function handleGroupEvent(sock, ev) {
    if (cfg.discoveryMode) return
    if (!isAllowedChat(ev.id, cfg)) return
    if (ev.action !== 'add') return

    const me = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null
    const people = ev.participants.filter(p => p !== me && p !== sock.user?.id)
    if (!people.length) return

    const who = people.map(p => '@' + p.split('@')[0]).join(' ')
    try {
      const sent = await sock.sendMessage(ev.id, { text: pickFresh(fun.WELCOMES, 'welcome').replace('${who}', who), mentions: people })
      markSent(sent?.key?.id)
    } catch {
      /* অনুমতি না থাকলে চুপ */
    }
  }

  return { handleMessage, handleGroupEvent, reply, markSent, brain, memory }
}
