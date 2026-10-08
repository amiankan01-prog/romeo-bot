// ==========================================================
//  Romeo-এর স্মৃতি — গ্রুপের শেষ কয়েকটা মেসেজ মনে রাখে
//  ⚠️ শুধু র‍্যামে (RAM) থাকে — ডিস্কে কিছু সেভ হয় না
// ==========================================================

export class Memory {
  constructor({ max = 30, ttlMs = 3 * 60 * 60 * 1000 } = {}) {
    this.max = max
    this.ttlMs = ttlMs
    this.store = new Map() // chatId -> { items: [], touched: ts }
  }

  /** গ্রুপের কথা মনে রাখা */
  add(chatId, { name, text, fromMe = false }) {
    if (!text) return
    let entry = this.store.get(chatId)
    if (!entry) {
      entry = { items: [], touched: Date.now() }
      this.store.set(chatId, entry)
    }
    entry.touched = Date.now()
    entry.items.push({
      role: fromMe ? 'me' : 'user',
      text: fromMe ? `Romeo: ${text}` : `${name || 'বন্ধু'}: ${text}`
    })
    if (entry.items.length > this.max) entry.items.shift()

    this._cleanup()
  }

  /** Romeo নিজে কী উত্তর দিলো, সেটাও মনে রাখা */
  addOwn(chatId, text) {
    this.add(chatId, { name: 'Romeo', text, fromMe: true })
  }

  /** কনটেক্সট হিসেবে পাঠাবার জন্য আগের কথাগুলো */
  get(chatId) {
    const entry = this.store.get(chatId)
    return entry ? [...entry.items] : []
  }

  clear(chatId) {
    this.store.delete(chatId)
  }

  /** পুরোনো গ্রুপের ডেটা র‍্যাম থেকে মুছে ফেলা */
  _cleanup() {
    const now = Date.now()
    for (const [id, entry] of this.store) {
      if (now - entry.touched > this.ttlMs) this.store.delete(id)
    }
  }
}
