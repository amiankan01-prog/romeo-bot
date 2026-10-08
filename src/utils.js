// ছোট ছোট হেল্পার ফাংশন

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export const pick = arr => arr[Math.floor(Math.random() * arr.length)]

/**
 * 🔁 পুনরাবৃত্তি-রোধী বাছাই।
 *
 * সাধারণ `pick()` একই লাইন পরপর দুবার তুলে আনতে পারে — তখন Romeo-কে
 * রোবটের মতো লাগে ("আবার সেই চায়ের কথা!")। এটা মনে রাখে কোন লাইনগুলো
 * সদ্য বলা হয়েছে, আর সেগুলো এড়িয়ে যায়।
 *
 * প্রতিটি তালিকার জন্য আলাদা স্মৃতি — তালিকার অর্ধেক (সর্বোচ্চ ৮টা)
 * লাইন মনে রাখে, তারপর পুরোনোগুলো ছেড়ে দেয়।
 */
const recent = new Map()

export function pickFresh(arr, key = 'default') {
  if (!Array.isArray(arr) || arr.length === 0) return undefined
  if (arr.length === 1) return arr[0]

  let seen = recent.get(key)
  if (!seen) { seen = []; recent.set(key, seen) }

  // তালিকার অর্ধেক পর্যন্ত মনে রাখবো — পুরোটা নয়, নাহলে কিছুই বাকি থাকে না
  const memory = Math.min(8, Math.max(1, Math.floor(arr.length / 2)))

  const fresh = arr.filter(x => !seen.includes(x))
  const choice = fresh.length ? pick(fresh) : pick(arr)

  seen.push(choice)
  while (seen.length > memory) seen.shift()
  return choice
}

/** পরীক্ষার জন্য — স্মৃতি মুছে দেয় */
export function resetPickMemory() { recent.clear() }

export const isGroupJid = jid => typeof jid === 'string' && jid.endsWith('@g.us')

/** মেসেজ থেকে লেখা বের করে — টেক্সট, ক্যাপশন, বাটন-রিপ্লাই সব */
export function extractText(m) {
  const msg = m?.message
  if (!msg) return ''
  const text =
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.buttonsResponseMessage?.selectedDisplayText ||
    msg.listResponseMessage?.title ||
    msg.templateButtonReplyMessage?.selectedId ||
    ''
  return String(text).trim()
}

/** মেসেজের ধরন — reaction / protocol ইত্যাদি বাদ দিতে */
export function messageType(m) {
  return Object.keys(m?.message || {})[0] || 'unknown'
}

export const IGNORED_TYPES = new Set([
  'protocolMessage',
  'reactionMessage',
  'senderKeyDistributionMessage',
  'pollUpdateMessage',
  'keepInChatMessage',
  'messageHistoryBundle'
])

/** কে পাঠালো — গ্রুপে participant, না থাকলে remoteJid */
export const senderJid = m => m.key?.participant || m.key?.remoteJid || ''

/** কে পাঠালো (শুধু সংখ্যা) */
export const senderNumber = m => (senderJid(m) || '').split('@')[0].split(':')[0]

/** ইংরেজি অঙ্ক → বাংলা অঙ্ক (30 → ৩০) */
export const bn = n => String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[+d])

/** পাঠানোর সময়ের WhatsApp প্রোফাইল নাম */
export const senderName = m => m.pushName || 'বন্ধু'

/** রেট লিমিটারের কী — গ্রুপ + ইউজার, যাতে আলাদা গ্রুপে আলাদা লিমিট */
export const rateKey = m => `${m.key.remoteJid}:${senderNumber(m)}`

export function formatUptime(ms) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h} ঘণ্টা ${m} মিনিট` : `${m} মিনিট ${s % 60} সেকেন্ড`
}

/** command ম্যাচ করে — "!Help", "/help", " HELP " সব চলবে */
export function matchCommand(text, names) {
  const t = String(text).trim().toLowerCase()
  return names.some(n => t === n || t === `!${n}` || t === `/${n}` || t.startsWith(`!${n} `) || t.startsWith(`/${n} `))
}
