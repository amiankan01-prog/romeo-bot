// ==========================================================
//  🧠 Romeo-র আসল স্মৃতি — কে কেমন, কার কী পছন্দ, কী হয়েছিল
//
//  আগে Romeo-র স্মৃতি ছিল শুধু র‍্যামে, আর মাত্র শেষ ৩০টা মেসেজ।
//  ফলে দুটো সমস্যা হতো:
//    ১. সার্ভার রিস্টার্ট = সব ভুলে যাওয়া। পরদিন কাউকে চিনতো না।
//    ২. কিছু মনে না থাকায় সে **বানিয়ে বলতো** — "সেদিন তো তুই বলেছিলি…"
//       অথচ কেউ কিছু বলেনি। এটাই সবচেয়ে বিরক্তিকর ছিল।
//
//  এখন প্রতিজনের জন্য অল্প কিছু **পাকা তথ্য** MongoDB-তে জমা থাকে,
//  আর সেটাই প্রতিবার Romeo-র সামনে রাখা হয়। যা লেখা নেই, সেটা সে
//  জানে না — আর না জানলে বানাবে না (প্রম্পটে কড়া নিষেধ আছে)।
// ==========================================================
import fs from 'node:fs'
import path from 'node:path'

const MAX_FACTS = 10          // একজনের সর্বোচ্চ কতগুলো কথা মনে রাখবে
const MAX_PEOPLE = 400        // মোট কতজনকে মনে রাখবে (র‍্যাম বাঁচাতে)
const MAX_FACT_LEN = 110      // একটা তথ্য কত বড় হতে পারে
const SAVE_DEBOUNCE = 4000    // লেখালেখি জমিয়ে একবারে সেভ

const keyOf = (chat, user) => `${chat}|${user}`

/** এক লাইনকে ছোট, পরিষ্কার তথ্যে বদলায় */
function tidy(line) {
  let t = String(line || '')
    .replace(/^[\s\-–—•*·.)\]\d\u09E6-\u09EF]+/u, '')  // বুলেট/নম্বর ছাঁটো (বাংলা সংখ্যাসহ)
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length > MAX_FACT_LEN) t = t.slice(0, MAX_FACT_LEN).trim()
  return t
}

/** দুটো তথ্য কি আসলে একই কথা? (হুবহু নয়, কাছাকাছি হলেও) */
function sameFact(a, b) {
  const n = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const x = n(a), y = n(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

export function createProfiles(cfg, db) {
  const useMongo = typeof cfg.mongoUri === 'string' && /^mongodb(\+srv)?:\/\//.test(cfg.mongoUri)
  const file = path.join('data', 'profiles.json')

  /** key -> { name, facts: string[], seen: number, at: number } */
  let people = new Map()
  let col = null
  let client = null
  let dirty = new Set()
  let timer = null
  let ready = false

  // ---------------- লোড ----------------
  async function init() {
    if (ready) return
    ready = true
    if (useMongo) {
      try {
        const { MongoClient } = await import('mongodb')
        client = new MongoClient(cfg.mongoUri, {
          serverSelectionTimeoutMS: 15000,
          maxPoolSize: 3
        })
        await client.connect()
        col = client.db(cfg.mongoDb || 'romeo').collection('profiles')
        await col.createIndex({ key: 1 }, { unique: true }).catch(() => {})
        const rows = await col.find({}).limit(MAX_PEOPLE).toArray()
        for (const r of rows) {
          people.set(r.key, { name: r.name || '', facts: r.facts || [], seen: r.seen || 0, at: r.at || 0 })
        }
        console.error(`🧠 স্মৃতি: MongoDB থেকে ${rows.length} জনকে মনে আছে`)
        return
      } catch (e) {
        console.error('⚠️  স্মৃতি MongoDB-তে বসেনি, ফাইলেই রাখবো:', e?.message || e)
        col = null
      }
    }
    // ফাইল-ব্যাকআপ (Termux / Mongo ছাড়া)
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
        for (const [k, v] of Object.entries(raw)) people.set(k, v)
        console.error(`🧠 স্মৃতি: ফাইল থেকে ${people.size} জনকে মনে আছে`)
      }
    } catch { /* নষ্ট ফাইল — নতুন করে শুরু */ }
  }

  // ---------------- সেভ ----------------
  function scheduleSave(key) {
    if (key) dirty.add(key)
    if (timer) return
    timer = setTimeout(() => { timer = null; flush().catch(() => {}) }, SAVE_DEBOUNCE)
  }

  async function flush() {
    const keys = [...dirty]
    dirty.clear()
    if (!keys.length) return

    if (col) {
      try {
        const ops = keys.filter(k => people.has(k)).map(k => {
          const p = people.get(k)
          return {
            updateOne: {
              filter: { key: k },
              update: { $set: { key: k, name: p.name, facts: p.facts, seen: p.seen, at: p.at } },
              upsert: true
            }
          }
        })
        const gone = keys.filter(k => !people.has(k)).map(k => ({ deleteOne: { filter: { key: k } } }))
        const all = [...ops, ...gone]
        if (all.length) await col.bulkWrite(all, { ordered: false })
        return
      } catch (e) {
        console.error('⚠️  স্মৃতি সেভ হয়নি:', e?.message || e)
      }
    }

    try {
      fs.mkdirSync('data', { recursive: true })
      fs.writeFileSync(file, JSON.stringify(Object.fromEntries(people), null, 0))
    } catch { /* লেখা গেলো না — পরের বার */ }
  }

  // ---------------- র‍্যাম ছাঁটাই ----------------
  function trim() {
    if (people.size <= MAX_PEOPLE) return
    const sorted = [...people.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0))
    while (people.size > MAX_PEOPLE) {
      const [k] = sorted.shift()
      people.delete(k)
      dirty.add(k)
    }
  }

  // ---------------- বাইরের কাজ ----------------

  /** কাউকে দেখলাম — নাম আর গোনা হালনাগাদ */
  function touch(chat, user, name) {
    if (!user) return null
    const k = keyOf(chat, user)
    let p = people.get(k)
    if (!p) { p = { name: '', facts: [], seen: 0, at: 0 }; people.set(k, p) }
    if (name && name !== p.name) { p.name = name; scheduleSave(k) }
    p.seen++
    p.at = Date.now()
    trim()
    return p
  }

  const get = (chat, user) => people.get(keyOf(chat, user)) || null

  /** এই মানুষটার সাথে কতবার কথা হয়েছে */
  const seenCount = (chat, user) => get(chat, user)?.seen || 0

  /** নতুন কিছু জানলাম — জমা করো (একই কথা দুবার নয়) */
  function learn(chat, user, lines = []) {
    if (!user || !lines.length) return 0
    const k = keyOf(chat, user)
    let p = people.get(k)
    if (!p) { p = { name: '', facts: [], seen: 0, at: Date.now() }; people.set(k, p) }

    let added = 0
    for (const raw of lines) {
      const t = tidy(raw)
      if (t.length < 4) continue
      if (p.facts.some(f => sameFact(f, t))) continue
      p.facts.push(t)
      added++
    }
    // নতুনগুলোই বেশি দামি — পুরোনো ছেঁটে ফেলি
    if (p.facts.length > MAX_FACTS) p.facts = p.facts.slice(-MAX_FACTS)
    if (added) { p.at = Date.now(); scheduleSave(k) }
    return added
  }

  /** একজনকে ভুলে যাও */
  function forget(chat, user) {
    const k = keyOf(chat, user)
    const had = people.delete(k)
    if (had) scheduleSave(k)
    return had
  }

  /** গোটা চ্যাটের সবাইকে ভুলে যাও */
  function forgetChat(chat) {
    let n = 0
    for (const k of [...people.keys()]) {
      if (k.startsWith(chat + '|')) { people.delete(k); dirty.add(k); n++ }
    }
    if (n) scheduleSave()
    return n
  }

  /**
   * 📋 প্রম্পটে বসানোর মতো ছোট্ট নোট — "এদের সম্পর্কে যা জানি"।
   * কিছু জানা না থাকলে ফাঁকা স্ট্রিং, যাতে Romeo বুঝতে পারে সে নতুন।
   */
  function brief(chat, users = []) {
    const parts = []
    for (const u of users) {
      const p = get(chat, u)
      if (!p || !p.facts.length) continue
      const who = p.name || 'একজন'
      parts.push(`• ${who}: ${p.facts.join('; ')}`)
    }
    if (!parts.length) return ''
    return (
      '\n\n## 🧠 এদের সম্পর্কে তুমি যা সত্যিই জানো\n' +
      parts.join('\n') +
      '\n⚠️ এর বাইরে কারো সম্পর্কে কিছু "মনে আছে" বলে দাবি করবে না।'
    )
  }

  async function close() {
    await flush().catch(() => {})
    if (client) await client.close().catch(() => {})
  }

  return {
    init, touch, get, seenCount, learn, forget, forgetChat, brief, flush, close,
    get size() { return people.size }
  }
}
