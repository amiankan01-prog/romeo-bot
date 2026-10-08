// সিম্পল JSON ডেটাবেস — কোনো native ডিপেন্ডেন্সি নেই (Termux-এ ঝামেলাহীন)
//
// ⚠️ ফোনে Termux হঠাৎ বন্ধ হলে db.json অর্ধেক লেখা থাকতে পারে।
//    তখন JSON.parse ক্র্যাশ করতো → Romeo স্টার্টই হতো না।
//    এখন নষ্ট ফাইল ধরেই ব্যাকআপ নিয়ে নতুন করে শুরু করবে।
import fs from 'node:fs'
import path from 'node:path'

let file = 'data/db.json'
let cache = null

export function init(dbFile) {
  file = dbFile
  try {
    const dir = path.dirname(file)
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* ডিরেক্টরি বানানো না গেলেও চলবে — নিচে guard আছে */
  }

  cache = load()
  return cache
}

/** ডিস্ক থেকে পড়া — নষ্ট হলে ব্যাকআপ নিয়ে ফাঁকা শুরু */
function load() {
  try {
    if (!fs.existsSync(file)) return {}
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw || !raw.trim()) return {}
    const parsed = JSON.parse(raw)
    // অ্যারে বা null হলে বিশ্বাসযোগ্য নয়
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('ভুল গঠন')
    return parsed
  } catch (err) {
    console.error('⚠️  db.json পড়া যায়নি (নষ্ট বা অর্ধেক লেখা):', err?.message || err)
    try {
      // নষ্ট ফাইলটা ফেলে না দিয়ে পাশে সরিয়ে রাখি — দরকার হলে দেখা যাবে
      if (fs.existsSync(file)) {
        fs.renameSync(file, file + '.corrupt.' + Date.now())
        console.error('   ↳ নষ্ট ফাইলটা .corrupt হিসেবে সরিয়ে নতুন শুরু করলাম')
      }
    } catch {
      /* কিছু না */
    }
    return {}
  }
}

export const all = () => cache || {}

/** init() কল না হলেও যেন ক্র্যাশ না করে */
const safe = () => {
  if (!cache) cache = {}
  return cache
}

export function get(key, def = null) {
  const c = safe()
  return key in c ? c[key] : def
}

export function set(key, value) {
  const c = safe()
  c[key] = value
  save()
  return value
}

export function bump(key, by = 1) {
  const c = safe()
  const v = (Number(c[key]) || 0) + by
  c[key] = v
  save()
  return v
}

// প্রতি সেকেন্ডে একবারের বেশি ডিস্কে না লিখে — ব্যাটারি/SD কার্ড বাঁচে
let saveTimer = null
export function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const dir = path.dirname(file)
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      // আগে টেম্প ফাইলে লিখে তারপর বদলি — মাঝখানে বন্ধ হলেও db.json নষ্ট হবে না
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(cache || {}, null, 2))
      fs.renameSync(tmp, file)
    } catch {
      /* ডিস্ক এরর এড়িয়ে চলি */
    }
  }, 1000)
}
