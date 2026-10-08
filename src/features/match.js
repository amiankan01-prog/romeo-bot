// ==========================================================
//  🎯 গান মেলানো — "ঠিক গানটা" বেছে নেওয়া
//
//  আগে যা 'হতো': JioSaavn যা প্রথমে দিতো, Romeo সেটাই পাঠাতো।
//  ফলে "লাজুক পাতা" চাইলে "Patar Patar Piywa" চলে আসতো! 😤
//
//  'এখন': প্রতিটা ফলাফলকে নম্বর দিই (নাম কতটা মেলে, শিল্পী মেলে কিনা,
//  এটা কি কভার/কারাওকে) — সবচেয়ে বেশি নম্বর পাওয়াটা পাঠাই।
//  আর কোনোটাই যদি যথেষ্ট না মেলে → অন্য সোর্সে খুঁজি (YouTube)।
// ==========================================================

// ──────────────────────────────────────────────
//  বাংলা → রোমান লিপি
//
//  JioSaavn/YouTube বাংলা লিপিতে ("প্রজাপতি") খুঁজে পায় না।
//  তাই আগে রোমানে বদলে নিই → "projapoti"।
// ──────────────────────────────────────────────

/** যুক্তাক্ষর ও বিশেষ জোড়া — আগে এগুলো, পরে একক অক্ষর */
const CONJUNCTS = [
  ['ক্ষ', 'kkh'], ['জ্ঞ', 'gg'], ['ঞ্চ', 'nch'], ['ঞ্জ', 'nj'],
  ['ক্ত', 'kt'], ['ক্র', 'kr'], ['ক্ল', 'kl'], ['গ্ধ', 'gdh'],
  ['ঙ্ক', 'nk'], ['ঙ্গ', 'ng'], ['চ্ছ', 'cch'], ['জ্জ', 'jj'],
  ['ট্ট', 'tt'], ['ড্ড', 'dd'], ['ণ্ট', 'nt'], ['ণ্ড', 'nd'],
  ['ত্ত', 'tt'], ['ত্থ', 'tth'], ['ত্র', 'tr'], ['দ্ধ', 'ddh'],
  ['দ্ব', 'db'], ['দ্র', 'dr'], ['ধ্ব', 'dhb'], ['ন্ত', 'nt'],
  ['ন্দ', 'nd'], ['ন্ধ', 'ndh'], ['ন্ন', 'nn'], ['প্র', 'pr'],
  ['প্ল', 'pl'], ['ব্দ', 'bd'], ['ব্ব', 'bb'], ['ব্র', 'br'],
  ['ম্প', 'mp'], ['ম্ব', 'mb'], ['ম্ম', 'mm'], ['ল্ল', 'll'],
  ['শ্চ', 'sch'], ['শ্র', 'shr'], ['ষ্ট', 'st'], ['ষ্ঠ', 'sth'],
  ['ষ্প', 'sp'], ['স্ত', 'st'], ['স্থ', 'sth'], ['স্ক', 'sk'],
  ['স্ট', 'st'], ['স্প', 'sp'], ['স্ব', 'sb'], ['স্ম', 'sm'],
  ['হ্ম', 'hm'], ['ত্ম', 'tm'], ['শ্ম', 'shm'], ['ন্স', 'ns'],
  ['্য', 'y'], ['্র', 'r'], ['্ব', 'b']
]

/** স্বাধীন স্বরবর্ণ — এদের পরে অন্তঃস্থ 'অ' বসে না */
const VOWELS = new Set(['অ','আ','ই','ঈ','উ','ঊ','ঋ','এ','ঐ','ও','ঔ'])

const LETTERS = {
  'অ': 'o', 'আ': 'a', 'ই': 'i', 'ঈ': 'i', 'উ': 'u', 'ঊ': 'u', 'ঋ': 'ri',
  'এ': 'e', 'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou',
  'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng',
  'চ': 'ch', 'ছ': 'chh', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'n',
  'ট': 't', 'ঠ': 'th', 'ড': 'd', 'ঢ': 'dh', 'ণ': 'n',
  'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n',
  'প': 'p', 'ফ': 'ph', 'ব': 'b', 'ভ': 'bh', 'ম': 'm',
  'য': 'j', 'র': 'r', 'ল': 'l', 'শ': 'sh', 'ষ': 'sh', 'স': 's', 'হ': 'h',
  'ড়': 'r', 'ঢ়': 'rh', 'য়': 'y', 'ৎ': 't', 'ং': 'ng', 'ঃ': '', 'ঁ': 'n'
}

/** স্বরচিহ্ন (কার) */
const VOWEL_SIGNS = {
  'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u', 'ৃ': 'ri',
  'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou', '্': ''
}

const DIGITS = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
                 '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' }

/** লেখায় বাংলা অক্ষর আছে কিনা */
export const hasBengali = s => /[\u0980-\u09FF]/.test(String(s || ''))

/**
 * বাংলা লেখাকে রোমান লিপিতে বদলায়।
 * "প্রজাপতি" → "projapoti", "লাজুক পাতা" → "lajuk pata"
 *
 * নিখুঁত নয় — নিখুঁত হওয়ার দরকারও নেই। সার্চ ইঞ্জিনে কাছাকাছি
 * বানান দিলেই গানটা পাওয়া যায়।
 */
export function romanize(text) {
  let s = String(text || '')
  if (!hasBengali(s)) return s.trim()

  // 'র্' (রেফ) — পরের ব্যঞ্জনের আগে 'r' বসে
  s = s.replace(/র্/g, '\u0002')

  // যুক্তাক্ষর আগে বদলাই — ফলাফলে অন্তঃস্থ-স্বরের চিহ্ন (\u0001) জুড়ে দিই
  for (const [a, b] of CONJUNCTS) s = s.split(a).join(b + '\u0001')

  let out = ''
  for (const ch of s) {
    if (ch === '\u0002') { out += 'r'; continue }
    if (ch === '\u0001') { out += '\u0001'; continue }

    if (VOWEL_SIGNS[ch] !== undefined) {
      out = out.replace(/\u0001$/, '')   // অন্তঃস্থ স্বর সরিয়ে আসল স্বর বসাই
      out += VOWEL_SIGNS[ch]
    } else if (LETTERS[ch] !== undefined) {
      out += LETTERS[ch]
      // ব্যঞ্জনের পরেই কেবল অন্তঃস্থ 'অ' বসতে পারে — স্বরবর্ণের পরে নয়
      if (!VOWELS.has(ch) && ch !== 'ং' && ch !== 'ঃ' && ch !== 'ঁ') out += '\u0001'
    } else if (DIGITS[ch]) {
      out = out.replace(/\u0001$/, '')
      out += DIGITS[ch]
    } else if (/[a-z]/i.test(ch)) {
      // ⚠️ যুক্তাক্ষর বদলানোর ফলে ঢোকা ল্যাটিন অক্ষর — এটা আগের ব্যঞ্জনের
      //    অন্তঃস্থ স্বর মুছে দিতো, তাই "বন্ধু" → "bndhu" হয়ে যেতো।
      //    এখন চিহ্নটা রেখেই দিই, পরে 'o' হয়ে বসবে।
      out += ch
    } else {
      // স্পেস বা যতিচিহ্ন — শব্দের শেষে অন্তঃস্থ স্বর উচ্চারিত হয় না
      out = out.replace(/\u0001$/, '')
      out += ch
    }
  }

  // বাকি চিহ্নগুলো: শব্দের শেষে বাদ, মাঝখানে 'o'
  out = out.replace(/\u0001+(?=\s|$)/g, '').replace(/\u0001/g, 'o')

  return out.replace(/\s+/g, ' ').trim()
}

// ──────────────────────────────────────────────
//  মিল মাপা
// ──────────────────────────────────────────────

/** HTML এনটিটি (&quot; ইত্যাদি) খুলে দেয় — JioSaavn-এর টাইটেলে থাকে */
function unescapeHtml(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

/** তুলনার জন্য সরল 'রূপ': ছোট হাতের, যতিচিহ্নহীন */
export function norm(s) {
  return unescapeHtml(s)
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')          // (From "Movie") বাদ
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const tokens = s => norm(s).split(' ').filter(Boolean)

/**
 * ⚠️ এগুলো থাকলে গানটা সম্ভবত আসল নয় — কভার, কারাওকে, রিমিক্স।
 * ব্যবহারকারী নিজে চাইলে (যেমন "lofi projapoti") তখন আর শাস্তি নয়।
 */
const JUNK = [
  'karaoke', 'cover', 'instrumental', 'remix', 'lofi', 'lo fi', 'slowed',
  'reverb', 'mashup', 'ringtone', 'bgm', 'tribute', 'version', 'remake',
  'nightcore', 'sped up', 'dj', 'remastered', 'live', 'unplugged',
  'workout', 'tutorial', 'piano', 'flute', 'guitar', 'violin', '8d'
]

/**
 * দুটো শব্দ কতটা কাছাকাছি (০–১)। বানানের ছোট ভুল মেনে নেয়,
 * যাতে "projapoti" আর "projapati" এক হিসেবে গোনা হয়।
 */
function closeness(a, b) {
  if (a === b) return 1
  // 🔊 ধ্বনিতে এক হলে এক ধরি — "shey"≈"se", "bhalo"≈"valo", "khusi"≈"khushi"
  //    (এটা ছাড়া ছোট শব্দ মিলতোই না, আর আসল গান কভারের কাছে হেরে যেতো)
  const pa = phon(a), pb = phon(b)
  if (pa && pa === pb) return 1
  if (a.length < 3 || b.length < 3) return 0
  // ⚠️ আগে এখানে ০.৯ ফেরত যেতো, আর ০.৯-ই ছিল "শব্দটা টাইটেলে আছে"
  //    ধরার সীমা। ফলে "believer" চাইলে "Believe Me"-ও পুরো নম্বর পেতো
  //    (একটা উপসর্গ মিললেই!) আর অন্য গান পাশ করে যেতো।
  //    ০.৮৫ করায় উপসর্গ-মিল এখন "কাছাকাছি" গোনা হয়, "একই" নয়।
  if (a.startsWith(b) || b.startsWith(a)) return 0.85
  // Levenshtein দূরত্ব
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 2) return 0
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1, cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = cur
  }
  const dist = prev[n]
  const max = Math.max(m, n)
  return dist <= 2 ? 1 - dist / max : 0
}

/**
 * 🎯 একটা ফলাফল কতটা মেলে — ০ থেকে ১০০।
 *
 * @param {string} query     ব্যবহারকারী যা চেয়েছে
 * @param {object} item      { title, artist }
 * @returns {number}         নম্বর (বেশি = ভালো মিল)
 */
/**
 * 🔊 ধ্বনি-রূপ (phonetic key) — বাংলা রোমানায়নের বানান-ভেদ মেলাতে।
 *
 * আসল সমস্যা ছিল: "Bojhena *Shey* Bojhena" (Zubeen, ২০০৯ — আসল গান) আর
 * "Bojhena *Se* Bojhena" (২০২৩ — কভার) — ব্যবহারকারী "se" লিখলে আসলটা
 * হেরে যেতো, কারণ "shey" ≠ "se"। এখন দুটোরই ধ্বনি-রূপ "se" → সমান।
 */
export function phon(word) {
  let w = String(word || '').toLowerCase()
  if (!w) return ''
  w = w
    .replace(/[^a-z0-9]/g, '')
    .replace(/ph/g, 'f').replace(/sh/g, 's').replace(/chh/g, 'c').replace(/ch/g, 'c')
    .replace(/z/g, 'j').replace(/v/g, 'b').replace(/x/g, 'ks')
    .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a')
    .replace(/au/g, 'o').replace(/ou/g, 'o').replace(/ai/g, 'oi')
    .replace(/(.)\1+/g, '$1')      // দ্বিত্ব অক্ষর এক করা
    .replace(/[yh]+$/, '')          // শেষের y/h ফেলে দাও: "shey"→"se", "noy"→"no"
  return w
}

/** গোটা নামের ধ্বনি-রূপ — শব্দভাগ আলাদা হলেও মিলবে */
const phonKey = s => tokens(s).map(phon).join('')

/**
 * 🎬 অ্যালবামের নাম কি সিনেমার সাউন্ডট্র্যাক? → আসল গান হওয়ার জোরালো ইঙ্গিত।
 * কভার/রি-রেকর্ডিং প্রায় কখনোই "Original Motion Picture Soundtrack" হয় না।
 */
const SOUNDTRACK = /original motion picture|motion picture soundtrack|\bost\b|original soundtrack/i

/**
 * 🎯 একটা ফলাফল কতটা মেলে — ০ থেকে ১০০।
 *
 * @param {string} query   ব্যবহারকারী যা চেয়েছে
 * @param {object} item    { title, artist, album, year, idx }
 */
export function scoreMatch(query, item) {
  const qRaw = hasBengali(query) ? romanize(query) : query
  const q = tokens(qRaw)
  const t = tokens(item?.title || '')
  const a = tokens(item?.artist || '')
  if (!q.length || !t.length) return 0

  let score = 0

  // ── ১. নামের শব্দগুলো কি টাইটেলে আছে? (সবচেয়ে জরুরি) ──
  //    শিল্পীর নামও গোনায় ধরি, কারণ অনেকে "projapoti anupam" লেখে
  const pool = [...t, ...a]
  let hit = 0
  for (const qw of q) {
    const best = Math.max(0, ...pool.map(pw => closeness(qw, pw)))
    hit += best
  }
  score += (hit / q.length) * 55

  // ── ২. চাওয়া সব শব্দই টাইটেলে থাকলে বড় বোনাস ──
  const inTitle = q.filter(qw => t.some(tw => closeness(qw, tw) >= 0.9)).length
  if (inTitle === q.length) score += 20

  // ── ৩. হুবহু এক নাম হলে সর্বোচ্চ বোনাস ──
  if (norm(qRaw) === norm(item.title)) score += 15

  // ── ৩খ. ধ্বনিতে হুবহু এক হলেও পুরো বোনাস ──
  //    বানান আলাদা হলেও ("Shey" বনাম "Se") যেন আসল গানটা পিছিয়ে না পড়ে।
  const qKey = phonKey(qRaw)
  if (qKey && qKey === phonKey(item.title)) score += 32
  else if (qKey && phonKey(item.title).includes(qKey) && qKey.length >= 6) score += 14

  // ── ৩গ. 🚧 চাওয়া একটা শব্দও টাইটেলে না মিললে — এটা অন্য গান ──
  //    সিলিং ১০০ → ১৩০ করার পর সব নম্বর বেড়ে গিয়েছিল, ফলে ৪৫-এর
  //    সীমাটা আলগা হয়ে পড়েছিল: "believer" চাইলে "Believe Me" ৭৬ পেয়ে
  //    পাশ করে যাচ্ছিল! বানানের মিল থাকলেই গান এক নয়।
  if (inTitle === 0) score -= 25

  // ── ৪. টাইটেলে অনেক বাড়তি শব্দ = সম্ভবত অন্য গান ──
  const extra = Math.max(0, t.length - inTitle)
  score -= Math.min(12, extra * 3)

  // ── ৫. কভার / কারাওকে / রিমিক্স — ব্যবহারকারী না চাইলে শাস্তি ──
  // ⚠️ norm() বন্ধনীর ভেতরের লেখা ফেলে দেয় — কিন্তু "(Karaoke)",
  //    "(Cover)" তো ওখানেই লেখা থাকে! তাই এখানে কাঁচা লেখাটাই দেখি।
  const raw = x => unescapeHtml(x || '').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ')
  const titleLow = raw(item.title) + ' ' + raw(item.artist) + ' ' + raw(item.album)
  const qLow = raw(qRaw)
  let junkHits = 0
  for (const j of JUNK) if (titleLow.includes(j) && !qLow.includes(j)) junkHits++
  score -= Math.min(36, junkHits * 18)

  // ── ৬. শিল্পীর নাম চাওয়ায় থাকলে বোনাস ──
  if (a.length) {
    const artistHit = a.some(aw => q.some(qw => closeness(qw, aw) >= 0.9))
    if (artistHit) score += 12
  }

  // ── ৭. 🎬 সিনেমার সাউন্ডট্র্যাক = আসল গান হওয়ার ইঙ্গিত ──
  if (SOUNDTRACK.test(item.album || '')) score += 10

  // ── ৮. 📊 সোর্সের নিজের র‍্যাঙ্ক — JioSaavn/YouTube জনপ্রিয়তা বোঝে ──
  //    আগে এটা একেবারে উপেক্ষা করা হতো, তাই অখ্যাত কভার উপরে উঠে যেতো।
  if (Number.isFinite(item.idx)) score += Math.max(0, 9 - item.idx * 1.5)

  return Math.max(0, Math.min(130, Math.round(score)))
}

/**
 * তালিকা থেকে সবচেয়ে ভালো মিলটা বেছে নেয়।
 *
 * ⚖️ সমান-সমান হলে (১০ নম্বরের মধ্যে) **সবচেয়ে পুরোনোটা** জেতে —
 *    কারণ একই নামের গানে আসলটাই আগে বেরোয়, কভার পরে আসে।
 *
 * @param {number} min  এর নিচে নম্বর হলে "পেলাম না" ধরে নেবো
 * @returns {{item, score, ranked}|null}
 */
export function bestMatch(query, items, min = 45) {
  if (!Array.isArray(items) || !items.length) return null
  const ranked = items
    .map((item, idx) => ({
      item,
      score: scoreMatch(query, Number.isFinite(item.idx) ? item : { ...item, idx })
    }))
    .sort((x, y) => y.score - x.score)

  const top = ranked[0]
  if (!top || top.score < min) return null

  // কাছাকাছি নম্বরের মধ্যে সবচেয়ে পুরোনো প্রকাশ = আসল গান
  const close = ranked.filter(r => top.score - r.score <= 10)
  let pick = top
  if (close.length > 1) {
    const dated = close.filter(r => Number(r.item.year) > 1900)
    if (dated.length) {
      pick = dated.reduce((best, r) =>
        Number(r.item.year) < Number(best.item.year) ? r : best
      )
    }
  }
  return { ...pick, ranked }
}

/**
 * 🕵️ নকল-শনাক্তকারী — "এটা কি আসল গান, নাকি কারও তুলে দেওয়া কপি?"
 *
 * আসল সমস্যা: JioSaavn-এ অনেক বিদেশি/জনপ্রিয় গানের **আসলটা থাকেই না**
 * (লাইসেন্স নেই), অথচ অখ্যাত শিল্পীদের হুবহু-নামের কপি ভর্তি থাকে।
 * যেমন "shape of you" খুঁজলে Ed Sheeran নেই, বদলে Nxsser / Boostereo /
 * LexMorris — সবাই একই নামে, সবারই অ্যালবামের নাম গানের নামেই।
 *
 * সেই ফাঁদটা চিনলে Romeo JioSaavn ছেড়ে YouTube-এ গিয়ে আসলটা আনবে।
 *
 * @returns {boolean} true = সন্দেহজনক, অন্য সোর্সে খোঁজা উচিত
 */
export function knockoffRisk(query, pick, items = []) {
  if (!pick) return false

  // সিনেমার সাউন্ডট্র্যাক = আসল, সন্দেহ নেই
  if (SOUNDTRACK.test(pick.album || '')) return false

  // ব্যবহারকারী নিজেই শিল্পীর নাম লিখেছে আর সেটা মিলেছে → যা চেয়েছে তাই পেয়েছে
  const q = tokens(hasBengali(query) ? romanize(query) : query)
  const a = tokens(pick.artist || '')
  if (a.length && a.some(aw => q.some(qw => closeness(qw, aw) >= 0.9))) return false

  // একই নামে অনেক *আলাদা* শিল্পীর রেকর্ড = কপির বাজার
  // (সিনেমার গান উপরেই ছাড় পেয়ে গেছে, তাই এখানে ভুল সন্দেহ হলেও
  //  ক্ষতি নেই — Romeo শুধু YouTube-এও একবার দেখে নেবে, তারপর
  //  যেটা ভালো সেটাই পাঠাবে।)
  const titleKey = phonKey(pick.title)
  const sameName = items.filter(it => phonKey(it.title) === titleKey)
  const artists = new Set(sameName.map(it => norm(it.artist)).filter(Boolean))
  if (sameName.length < 3 || artists.size < 3) return false

  // ⚠️ এখানে "সবচেয়ে পুরোনোটাই আসল" ধরে ছাড় দেওয়ার চেষ্টা করা হয়েছিল,
  //    কিন্তু সেটা উল্টো ফল দেয়: আসল গানটা JioSaavn-এ **একেবারেই না
  //    থাকলে** (Imagine Dragons, Ed Sheeran…) তখন কভারগুলোর মধ্যে
  //    সবচেয়ে পুরোনোটাও কভারই — আর সে ছাড় পেয়ে পার পেয়ে যেতো।
  //    তাই সন্দেহ থাকলে YouTube-এ একবার দেখে নেওয়াই ভালো। কয়েক সেকেন্ড
  //    বেশি লাগে, কিন্তু ভুল গান যায় না।
  return true
}

export const MIN_SCORE = 45
