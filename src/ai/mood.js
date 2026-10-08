// ==========================================================
//  🫀 মুড শনাক্তকরণ
//
//  Romeo যেন প্রতিটা মেসেজের *আবেগ* বুঝে জবাব দেয় —
//  দুঃখের সময় ঠাট্টা নয়, রোমান্সের সময় শুকনো তথ্য নয়।
//
//  এটা কোনো API কল করে না — শুধু শব্দ দেখে বোঝে, তাই
//  সাথে সাথি কাজ করে আর কোটা খরচ হয় না (০ টাকা)।
//  তারপর AI-কে বলে দেয় "এই মুডে জবাব দাও"।
// ==========================================================

/** বাংলা যুক্তাক্ষর ভাঙে না — \p{M} রাখা জরুরি */
const words = t =>
  String(t).toLowerCase().split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean)

/**
 * প্রতিটা মুডের চিহ্ন। বাংলা, বাংলিশ আর ইংরেজি — তিন রকমই ধরে,
 * কারণ বন্ধুরা তিনভাবেই লেখে।
 */
const SIGNS = {
  sad: {
    words: [
      'মন', 'খারাপ', 'কষ্ট', 'দুঃখ', 'কাঁদছি', 'কাঁদতে', 'কান্না', 'একা',
      'ভেঙে', 'হতাশ', 'নিঃসঙ্গ', 'বিষণ্ণ', 'ক্লান্ত', 'অসহায়', 'হারিয়ে',
      'mon', 'kharap', 'kosto', 'kashto', 'dukkho', 'dukho', 'kadchi',
      'eka', 'alone', 'sad', 'depressed', 'depression', 'lonely', 'hurt',
      'crying', 'cry', 'upset', 'broken', 'tired', 'hopeless', 'miss'
    ],
    phrases: ['মন খারাপ', 'ভালো লাগছে না', 'ভাল লাগছে না', 'কেউ নেই',
              'mon kharap', 'bhalo lagche na', 'valo lagche na',
              'feeling low', 'feel bad', 'no one', 'give up']
  },

  romantic: {
    words: [
      'ভালোবাসা', 'ভালোবাসি', 'ভালবাসি', 'প্রেম', 'প্রেমিক', 'প্রেমিকা',
      'crush', 'প্রিয়', 'হৃদয়', 'চুমু', 'জড়িয়ে', 'বিয়ে', 'সুন্দরী',
      'bhalobasi', 'valobasi', 'bhalobasa', 'prem', 'love', 'loved',
      'romantic', 'romance', 'heart', 'kiss', 'girlfriend', 'boyfriend',
      'gf', 'bf', 'propose', 'date', 'pyar', 'ishq', 'mohabbat'
    ],
    phrases: ['ভালোবাসি তোমাকে', 'তোমাকে ভালোবাসি', 'প্রেমে পড়েছি',
              'i love you', 'love you', 'in love', 'preme porechi']
  },

  happy: {
    words: [
      'খুশি', 'আনন্দ', 'দারুণ', 'জিতেছি', 'পাস', 'সফল', 'মজা', 'হাসি',
      'উৎসব', 'জন্মদিন', 'অসাধারণ', 'চমৎকার',
      'khushi', 'khusi', 'anondo', 'darun', 'jitechi', 'moja', 'mojaa',
      'happy', 'great', 'awesome', 'amazing', 'won', 'win', 'passed',
      'excited', 'yay', 'congrats', 'congratulations', 'party', 'mast'
    ],
    phrases: ['দারুণ খবর', 'খুব খুশি', 'পাস করেছি',
              'good news', 'so happy', 'best day']
  },

  anxious: {
    words: [
      'ভয়', 'চিন্তা', 'টেনশন', 'ভীত', 'নার্ভাস', 'পরীক্ষা', 'ইন্টারভিউ',
      'দুশ্চিন্তা', 'আতঙ্ক', 'ঘাবড়ে',
      'bhoy', 'voy', 'chinta', 'tension', 'tensed', 'nervous', 'scared',
      'afraid', 'fear', 'worried', 'worry', 'anxious', 'panic', 'exam',
      'interview', 'result', 'pressure', 'stress', 'stressed', 'dor'
    ],
    phrases: ['ভয় করছে', 'টেনশন হচ্ছে', 'চিন্তা হচ্ছে',
              'bhoy korche', 'tension hocche', 'so nervous', 'what if']
  },

  angry: {
    // ⚠️ আগে শুধু "রাগ/বিরক্ত" জাতীয় শব্দ ছিল। কিন্তু মানুষ রেগে গেলে
    //    "রাগ হচ্ছে" বলে না — **গালি দেয়** বা দোষ ধরে।
    //    "tui faltu", "baje bot", "kono kaje lagis na" — সবই neutral
    //    ধরা হচ্ছিল, তাই Romeo হাসিমুখে "হাজির!" বলে আগুনে ঘি ঢালতো।
    words: [
      'রাগ', 'বিরক্ত', 'ঘৃণা', 'অসহ্য', 'ক্ষেপে', 'মেজাজ', 'ঝগড়া',
      'rag', 'raag', 'birokto', 'biroktikor', 'ghrina', 'osojjo', 'mejaj',
      'angry', 'mad', 'furious', 'hate', 'annoyed', 'irritated', 'fed',
      'gussa', 'jhagra', 'fight',
      // 🆕 দোষারোপ ও গালি — রাগের আসল ভাষা
      'ফালতু', 'বাজে', 'জঘন্য', 'বিশ্রী', 'গাধা', 'বোকা', 'অকর্মা',
      'faltu', 'baje', 'baje', 'joghonno', 'bishri', 'gadha', 'boka',
      'useless', 'stupid', 'rubbish', 'nonsense', 'disgusting', 'pathetic',
      'worst', 'terrible', 'awful', 'shut', 'chup',
      'ভুল', 'দোষ', 'অভিযোগ', 'vul', 'bhul', 'dosh'
    ],
    phrases: ['রাগ হচ্ছে', 'বিরক্ত লাগছে', 'মেজাজ খারাপ',
              'rag hocche', 'birokto lagche', 'fed up', 'so angry',
              // 🆕 পুরো বাক্যের ছাঁচ — একক শব্দের চেয়ে নিশ্চিত
              'rege achi', 'rege gechi', 'রেগে আছি', 'রেগে গেছি',
              'kono kaje lagis na', 'kaje lage na', 'কোনো কাজে লাগিস না',
              'tui faltu', 'tui baje', 'ekta faltu', 'ekta baje',
              'তুই ফালতু', 'তুই বাজে', 'aje baje', 'আজে বাজে',
              'ki vul korli', 'কী ভুল করলি', 'ki bhul korli',
              'kotha sunchis na', 'কথা শুনছিস না', 'shuncho na']
  },

  demotivated: {
    words: [
      'পারবো', 'পারছি', 'ব্যর্থ', 'ফেল', 'হেরে', 'অক্ষম', 'অযোগ্য',
      'parbona', 'parchina', 'bertho', 'fail', 'failed', 'failure',
      'lose', 'lost', 'useless', 'worthless', 'quit', 'quitting', 'cant'
    ],
    phrases: ['পারবো না', 'আর পারছি না', 'কিছু হবে না', 'আমাকে দিয়ে হবে না',
              'parbo na', 'parchi na', 'kichu hobe na', 'i cant', "can't do",
              'give up', 'no point']
  },
miss: {
    words: [
      'মিস', 'মনে', 'স্মৃতি', 'পুরোনো', 'ফিরে', 'হারানো', 'অপেক্ষা',
      'miss', 'missing', 'memory', 'memories', 'nostalgia', 'remember',
      'purono', 'smriti', 'opekkha', 'wait', 'waiting', 'yaad', 'yaadein'
    ],
    phrases: ['মিস করছি', 'মনে পড়ছে', 'পুরোনো দিন', 'ফিরে পেতে',
              'miss korchi', 'mone porche', 'i miss', 'missing you',
              'old days', 'those days']
  },

  abhiman: {
    words: [
      'অভিমান', 'ভুলে', 'খোঁজ', 'পাত্তা', 'এড়িয়ে', 'অবহেলা', 'উপেক্ষা',
      'obhiman', 'abhiman', 'bhule', 'khoj', 'patta', 'ignore', 'ignored',
      'ignoring', 'forgot', 'forgotten', 'neglect', 'avoid', 'avoiding'
    ],
    phrases: ['ভুলে গেছিস', 'খোঁজ নিস না', 'পাত্তা দিস না', 'কথা বলিস না',
              'bhule gechis', 'khoj nis na', 'you forgot', 'dont care',
              "don't care", 'no reply', 'kotha bolis na']
  },

  grateful: {
    words: [
      'ধন্যবাদ', 'কৃতজ্ঞ', 'থ্যাংকস', 'উপকার', 'পাশে',
      'dhonnobad', 'kritaggo', 'thanks', 'thank', 'grateful', 'thankful',
      'appreciate', 'shukriya'
    ],
    phrases: ['অনেক ধন্যবাদ', 'তোর জন্য', 'পাশে ছিলি', 'thank you',
              'thanks a lot', 'tor jonno', 'pashe chili']
  }
}

/** প্রতিটা মুডে Romeo-কে কী নির্দেশ দেবো */
const GUIDANCE = {
  sad: `🫂 এই মানুষটার **মন খারাপ**। এখন:
- কোনো ঠাট্টা নয়, কোনো রসিকতা নয় — একদম না।
- আগে বুঝিয়ে দাও তুমি শুনছো, তুমি পাশে আছো।
- তাড়াহুড়ো করে "পজিটিভ থাকো" বলবে না — সেটা অপমানের মতো লাগে।
- নরম, ধীর, সত্যি কথা বলো। দরকার হলে ৩-৪ লাইন।
- শেষে আলতো করে জিজ্ঞেস করতে পারো কী হয়েছে।`,

  romantic: `🌹 এটা **রোমান্টিক / আবেগের** মুহূর্ত। এখন:
- কবিতার ছন্দে কথা বলো — স্নিগ্ধ, গভীর, মন ছুঁয়ে যাওয়া।
- একটা সুন্দর উপমা বা চিত্রকল্প ব্যবহার করো।
- ৩-৪ লাইন হলেও চলবে, যদি সুন্দর হয়।
- সস্তা বা অশ্লীল কিছু নয় — শুধু সত্যিকারের আবেগ।`,

  happy: `✨ এই মানুষটা **খুশি / উত্তেজিত**। এখন:
- তুমিও সমান উচ্ছ্বাসে সাথে দাও — ঠান্ডা জবাব দিও না।
- অভিনন্দন জানাও, আর কী হয়েছে জানতে চাও।
- প্রাণখোলা, উজ্জ্বল ভাব রাখো।`,

  anxious: `🕊️ এই মানুষটা **ভয় পাচ্ছে / চিন্তিত**। এখন:
- শান্ত করো, সাহস দাও। "আমি আছি" ভাবটা দাও।
- ভয়টাকে ছোট করে দেখাবে না — স্বীকার করে নাও, তারপর ভরসা দাও।
- ছোট একটা বাস্তব পরামর্শ দিতে পারো।`,

  angry: `🔥 এই মানুষটা **রেগে আছে** — হয়তো তোমার উপরেই। এখন:
- **পাল্টা দেবে না। এক ফোঁটাও না।** নিজেকে ডিফেন্ড করতে যাবে না।
- আগে রাগটা মেনে নাও — রাগ হওয়াটা যে স্বাভাবিক, সেটা বুঝিয়ে দাও।
- একটু দোষ নিজের ঘাড়ে নাও, সাথে হালকা হাসি মেশাও।
- শেষে ছোট্ট একটা হাত বাড়ানো — "রাগ করে থাকিস না রে"।
- ❌ "শান্ত হও" বলবে না — ওতে রাগ দ্বিগুণ হয়।
- ❌ উপদেশ দিয়ে শুরু করবে না। ❌ দুজনের ঝগড়ায় পক্ষ নেবে না।`,

  demotivated: `💪 এই মানুষটা **হাল ছেড়ে দিচ্ছে**। এখন:
- মনে করিয়ে দাও সে আগে কী কী পেরেছে।
- ফাঁপা উৎসাহ নয় — সত্যি, নির্দিষ্ট কথা বলো।
- ছোট একটা পরবর্তী পদক্ষেপ দেখিয়ে দাও, যাতে শুরু করা সহজ হয়।`,

  miss: `🌙 এই মানুষটা **কাউকে/কিছু মিস করছে**। এখন:
- স্মৃতিটাকে সম্মান করো — উড়িয়ে দিও না।
- নরম, একটু বিষণ্ণ সুরে কথা বলো। ছন্দ এখানে খুব মানায়।
- \"ভুলে যাও\" বলবে না — বরং বলো স্মৃতিটা থাকাই ভালো।`,

  abhiman: `🥺 এই মানুষটার **অভিমান হয়েছে** — রাগ নয়, অভিমান।
- আগে স্বীকার করে নাও: \"হ্যাঁ, আমারই দোষ\"।
- অজুহাত দেবে না — অজুহাতে অভিমান বাড়ে।
- আদর মিশিয়ে, একটু কাতর সুরে ফিরিয়ে আনো।
- শেষে এমন কিছু বলো যাতে সে হেসে ফেলে।`,

  grateful: `🤗 এই মানুষটা **কৃতজ্ঞতা জানাচ্ছে**।
- আনুষ্ঠানিক হয়ো না — বন্ধুর মধ্যে ধন্যবাদ চলে না।
- হালকা করে উড়িয়ে দাও, কিন্তু উষ্ণতা রেখে।
- \"তুই আছিস, এটাই যথেষ্ট\" ধরনের কিছু।`
}

/**
 * মেসেজের মুড বের করে।
 * @returns {{mood: string, score: number}} — কিছু না পেলে mood='neutral'
 */
export function detectMood(text) {
  const t = String(text || '').toLowerCase()
  if (!t.trim()) return { mood: 'neutral', score: 0 }

  const ws = new Set(words(t))
  let best = 'neutral'
  let bestScore = 0

  for (const [mood, sign] of Object.entries(SIGNS)) {
    let score = 0
    for (const w of sign.words) if (ws.has(w)) score += 1
    // আস্ত বাক্যাংশ মিললে সেটা অনেক জোরালো প্রমাণ
    for (const ph of sign.phrases) if (t.includes(ph)) score += 3
    if (score > bestScore) { bestScore = score; best = mood }
  }

  // অন্তত একটা স্পষ্ট চিহ্ন না পেলে নিরপেক্ষ ধরে নেবো —
  // নাহলে সাধারণ কথাতেও Romeo নাটকীয় হয়ে যাবে
  return bestScore >= 1 ? { mood: best, score: bestScore } : { mood: 'neutral', score: 0 }
}

/** AI-এর প্রম্পটে জুড়ে দেওয়ার জন্য নির্দেশ। নিরপেক্ষ হলে কিছুই নয়। */
export function moodGuidance(mood) {
  return GUIDANCE[mood] ? `\n\n## 🎭 এই মুহূর্তের মুড\n${GUIDANCE[mood]}` : ''
}

export const MOODS = Object.keys(SIGNS)
