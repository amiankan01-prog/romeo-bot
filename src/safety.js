// সেফটি: কোন চ্যাটে কাজ করবে + কে কতবার ডাকতে পারবে
import { isGroupJid } from './utils.js'

/**
 * বট কি এই চ্যাটে সাড়া দিতে পারবে?
 *  - discovery mode  → সবখানে (গ্রুপ ID এখনো সেট হয়নি)
 *  - allowAllGroups  → যেকোনো *গ্রুপে* (ব্যক্তিগত চ্যাটে নয়)
 *  - নাহলে           → শুধু allowedGroups-এ থাকা গ্রুপে
 */
export function isAllowedChat(jid, cfg) {
  if (cfg.discoveryMode) return true
  if (isGroupJid(jid)) {
    // গ্রুপ: সবগুলোতে, নাহলে শুধু তালিকাভুক্ত
    return cfg.allowAllGroups ? true : cfg.allowedGroups.includes(jid)
  }
  // ব্যক্তিগত চ্যাট (1-to-1) — ALLOW_DM=true হলেই
  return !!cfg.allowDm
}

/**
 * রেট লিমিটার — AI কোটা + গ্রুপের শান্তি দুটোই রক্ষা করে।
 *  - এক ইউজার cooldownMs এর মধ্যে দুবার ডাকতে পারবে না
 *  - এক ইউজার দিনে সর্বোচ্চ dailyCap বার
 *  - মধ্যরাতে কাউন্টার রিসেট
 */
export class RateLimiter {
  constructor(cooldownMs = 4000, dailyCap = 60) {
    this.cooldownMs = cooldownMs
    this.dailyCap = dailyCap
    this.map = new Map()
    this.today = new Date().toDateString()
  }

  _resetIfNewDay() {
    const today = new Date().toDateString()
    if (today !== this.today) {
      this.map.clear()
      this.today = today
    }
  }

  /** @param cooldownOverride কথা চলার সময় কম কুলডাউন ব্যবহার করতে */
  check(key, cooldownOverride) {
    this._resetIfNewDay()
    const now = Date.now()
    const rec = this.map.get(key) || { last: 0, count: 0 }
    const cooldown = cooldownOverride ?? this.cooldownMs

    if (rec.count >= this.dailyCap) {
      return { ok: false, reason: 'daily' }
    }
    if (now - rec.last < cooldown) {
      return { ok: false, reason: 'cooldown', waitMs: cooldown - (now - rec.last) }
    }

    rec.last = now
    rec.count += 1
    this.map.set(key, rec)
    return { ok: true, remaining: this.dailyCap - rec.count }
  }
}
