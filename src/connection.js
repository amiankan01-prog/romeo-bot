// ==========================================================
//  Baileys কানেকশন — পেয়ারিং কোড লগিন + অটো রিকানেক্ট
// ==========================================================
import fs from 'node:fs'
import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers, initAuthCreds } from '@whiskeysockets/baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import { sleep, isGroupJid } from './utils.js'
import { useMongoAuthState, hasMongo } from './store/mongoAuth.js'
import { isAllowedChat } from './safety.js'

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  cyan: '\u001b[36m',
  magenta: '\u001b[35m',
  gray: '\u001b[90m'
}

/**
 * 📟 বর্তমান পেয়ারিং কোড — বাইরে (ওয়েব পাতা) থেকে দেখার জন্য।
 * Render-এর লগ ফোনে পড়া কষ্ট, তাই কোডটা এখানেও রাখি:
 * ব্রাউজারে https://<তোমার-সার্ভিস>.onrender.com/pair খুললেই দেখা যাবে।
 */
export const pairState = { code: '', number: '', at: 0 }

function pairingBanner(code, number) {
  console.log('\n' + '='.repeat(46))
  console.log(`${C.bold}${C.magenta}      👑  ROMEO MAMU — WHATSAPP LINK  👑${C.reset}`)
  console.log('='.repeat(46))
  console.log(`\n${C.bold}   তোমার পেয়ারিং কোড:${C.reset}  ${C.bold}${C.yellow}${code}${C.reset}\n`)
  console.log('   (' + number + ' নাম্বারের জন্য)')
  if (process.env.PORT) {
    console.log(`\n   📱 ফোন থেকে সহজে দেখতে: সার্ভিসের ঠিকানায় ${C.bold}/pair${C.reset} লাগিয়ে খোলো`)
  }
  console.log(`\n${C.cyan}   এখন এই ধাপগুলো করো:${C.reset}`)
  console.log('   ১) ফোনে WhatsApp খোলো')
  console.log('   ২) ⋮ মেনু → Linked Devices')
  console.log('   ৩) "Link a Device" টিপো')
  console.log('   ৪) "Link with phone number instead" বেছে নাও')
  console.log('   ৫) ওপরের ৮ অঙ্কের কোডটি টাইপ করো\n')
  console.log('   ⏳ কোড ২ মিনিট পরে নতুন করে দেখাবো, দরকার হলে অপেক্ষা করো')
  console.log('='.repeat(46) + '\n')
}

/**
 * 🔁 FRESH_LOGIN=true হলে পুরোনো WhatsApp লগইন মুছে নতুন credentials দেয়।
 * নাম্বার বদলালে (যেমন সাসপেন্ডেড অ্যাকাউন্ট থেকে নতুন নাম্বারে যাওয়া)
 * পুরোনো লগইনটা ডেটাবেসে রয়ে যায় — সেটা না মুছলে নতুন পেয়ারিং কোডই আসে না।
 *
 * @param {object|null} m     MongoDB auth (useMongoAuthState-এর রিটার্ন), নাহলে null
 * @param {object} cfg        কনফিগ
 * @param {boolean} already   আগেই একবার মুছে ফেলা হয়েছে কিনা (রিস্টার্ট-চক্রে আবার না মুছতে)
 * @returns {{state:object, saveCreds:Function, wiped:boolean}}
 */
export async function applyFreshLogin(m, cfg, already = false) {
  const want = !!cfg.freshLogin && !already
  if (!m) {
    // ফোনে (Termux) চালালে: ফোল্ডারের সেশন মুছে ফেলি
    if (want) {
      try { fs.rmSync(cfg.sessionDir, { recursive: true, force: true }) } catch {}
      console.log(`\n${C.yellow}🔁 FRESH_LOGIN=true — ফোল্ডারের পুরোনো লগইন মুছে ফেলেছি।${C.reset}\n`)
    }
    const f = await useMultiFileAuthState(cfg.sessionDir)
    return { state: f.state, saveCreds: f.saveCreds, wiped: want }
  }
  if (want) {
    await m.clearAll().catch(() => {})
    const num = cfg.botNumber
    console.log(
      `\n${C.yellow}🔁 FRESH_LOGIN=true — পুরোনো WhatsApp লগইন মুছে ফেলেছি।${C.reset}\n` +
      `   ${num ? `এখন ${C.bold}${num}${C.reset} নাম্বারের নতুন পেয়ারিং কোড আসবে।` : 'নতুন QR/পেয়ারিং কোড আসবে।'}\n` +
      `   ⚠️ ${C.bold}লিংক হয়ে গেলে FRESH_LOGIN=false করে দিও${C.reset}, নাহলে প্রতিবার রিস্টার্টে আবার লগআউট হবে।\n`
    )
    return { state: { creds: initAuthCreds(), keys: m.state.keys }, saveCreds: m.saveCreds, wiped: true }
  }
  return { state: m.state, saveCreds: m.saveCreds, wiped: false }
}

export async function startBot(cfg, handlers = {}) {
  fs.mkdirSync(cfg.sessionDir, { recursive: true })

  let sock = null
  let reconnecting = false
  let mongoAuth = null          // MongoDB-তে সেশন থাকলে এখানে
  let mongoNoticeShown = false
  let freshWiped = false        // FRESH_LOGIN একবারই খাটবে (রিস্টার্ট-চক্রে নয়)
  let retries = 0               // পরপর কতবার ব্যর্থ হলো
  let retryTimer = null

  /**
   * 🔁 কখনো হাল ছাড়ে না।
   *
   * ⚠️ আগে শুধু `setTimeout(connect, 5000)` ছিল। কিন্তু connect()
   *    নিজেই যদি ব্যর্থ হতো (নেট নেই, MongoDB নাগালের বাইরে), সেই
   *    এররটা কেউ ধরতো না — পুরো পুনঃসংযোগ-চক্র ওখানেই মরে যেতো।
   *    ফল: Romeo চিরতরে অফলাইন, আর কেউ জানতোও না কেন।
   *
   *    এখন: প্রতিটা চেষ্টা ধরা থাকে, ব্যর্থ হলে ধাপে ধাপে বেশি সময়
   *    নিয়ে (৫s → ১০s → ২০s … সর্বোচ্চ ৫ মিনিট) *অনন্তকাল* চেষ্টা
   *    চালায়। নেট ফিরলেই Romeo নিজে থেকে ফিরে আসে।
   */
  function scheduleReconnect(immediate = false) {
    if (retryTimer) return
    retries = immediate ? 0 : retries + 1

    const base = Math.min(5000 * Math.pow(2, Math.max(0, retries - 1)), 300000)
    // সব চেষ্টা একই সেকেন্ডে না পড়ার জন্য একটু এলোমেলো সময়
    const wait = immediate ? 3000 : Math.round(base * (0.8 + Math.random() * 0.4))

    console.log(
      `${C.yellow}⚠️  কানেকশন নেই — ${Math.round(wait / 1000)} সেকেন্ড পরে আবার চেষ্টা` +
      `${retries > 1 ? ` (${retries} নম্বর)` : ''}...${C.reset}`
    )

    retryTimer = setTimeout(async () => {
      retryTimer = null
      try {
        await connect()
      } catch (err) {
        console.error(`${C.red}❌ সংযোগ ব্যর্থ:${C.reset}`, err?.message || err)
        scheduleReconnect()
      }
    }, wait)
  }
  let pairTimer = null

  async function connect() {
    if (reconnecting) return
    reconnecting = true
    if (pairTimer) { clearInterval(pairTimer); pairTimer = null }

    // ☁️ ক্লাউডে (Render) ফাইল স্থায়ী নয় — সার্ভার রিস্টার্ট হলেই মুছে যায়।
    //    MONGODB_URI দেওয়া থাকলে লগইনটা ডেটাবেসে রাখি, তাই যতবারই
    //    রিস্টার্ট হোক Romeo নিজের পরিচয় মনে রাখে — আর পেয়ার করতে হয় না।
    //    লিংক না দিলে আগের মতোই ফোনের ফোল্ডারে থাকবে।
    let state, saveCreds
    if (hasMongo(cfg.mongoUri)) {
      const m = await useMongoAuthState(cfg.mongoUri, cfg.mongoDb, cfg.sessionId)
      // 🔁 নাম্বার বদলালে পুরোনো লগইন মুছে নতুন পেয়ারিং কোড আনি (applyFreshLogin)
      const r1 = await applyFreshLogin(m, cfg, freshWiped)
      state = r1.state
      saveCreds = r1.saveCreds
      if (r1.wiped) freshWiped = true
      mongoAuth = m
      if (!mongoNoticeShown) {
        mongoNoticeShown = true
        console.log(`${C.gray}   ☁️  লগইন MongoDB-তে রাখা হচ্ছে (রিস্টার্টেও টিকে থাকবে)${C.reset}`)
      }
    } else {
      const r2 = await applyFreshLogin(null, cfg, freshWiped)
      state = r2.state
      saveCreds = r2.saveCreds
      if (r2.wiped) freshWiped = true
    }

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: cfg.debug ? 'debug' : 'silent' }),
      browser: Browsers.ubuntu('Chrome'),

      // ---------- প্রাইভেসি: এই ৩ লাইন সবচেয়ে জরুরি ----------
      syncFullHistory: false, // পুরোনো মেসেজ কখনো ডাউনলোড করবে না
      markOnlineOnConnect: false, // সবসময় "online" দেখাবে না
      generateHighQualityLinkPreview: false,

      // ⚠️ আগে গ্রুপ ছাড়া সব বাদ দেওয়া হতো — তখন `/id` দিয়ে নতুন গ্রুপের
      //    আইডিই পাওয়া যেতো না। এখন সবকিছু দেখি (DM-ও), আর কোথায়
      //    কথা বলবে সেটা রাউটার/সেফটি ঠিক করবে (.env-এ ALLOW_DM দিয়ে)।
      shouldIgnoreJid: () => false
    })

    reconnecting = false

    // --- সেশন সেভ ---
    sock.ev.on('creds.update', saveCreds)

    // --- মেসেজ ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      for (const m of messages) {
        try {
          if (handlers.onMessage) await handlers.onMessage(sock, m)
        } catch (err) {
          console.error('❌ মেসেজ হ্যান্ডেল করতে সমস্যা:', err?.message || err)
        }
      }
    })

    // --- গ্রুপে কেউ ঢুকলে/বেরলে ---
    sock.ev.on('group-participants.update', async ev => {
      try {
        if (handlers.onGroupEvent) await handlers.onGroupEvent(sock, ev)
      } catch {
        /* চুপচাপ */
      }
    })

    // --- কানেকশন স্টেটাস ---
    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update

      // BOT_NUMBER থাকলে পেয়ারিং কোড-ই যথেষ্ট — QR দেখালে কনফিউশন হয়।
      // QR দেখতে চাইলে .env থেকে BOT_NUMBER লাইনটি মুছে দাও।
      if (qr && !cfg.botNumber) {
        console.log(`\n${C.yellow}📷 QR কোড:${C.reset}\n`)
        qrcode.generate(qr, { small: true })
        console.log('\nWhatsApp → Linked Devices → Link a Device → এই QR স্ক্যান করো\n')
      }

      if (connection === 'open') {
        if (pairTimer) { clearInterval(pairTimer); pairTimer = null }
        pairState.code = '' // জুড়ে গেছে — আর কোড দেখানোর দরকার নেই
        const me = sock.user?.id?.split(':')[0] || cfg.botNumber || '?'
        retries = 0 // সফল — গণনা শূন্য
        console.log(`\n${C.green}${C.bold}✅ Romeo অনলাইন!${C.reset}  (${me})`)
        const modeTxt = cfg.discoveryMode
          ? 'DISCOVERY (গ্রুপে /id লিখো)'
          : cfg.allowAllGroups
            ? '🌍 সব গ্রুপে সক্রিয়'
            : `${cfg.allowedGroups.length} টি গ্রুপে সক্রিয়`
        console.log(`${C.cyan}   মোড:${C.reset} ${modeTxt}`)
        console.log(`${C.cyan}   বন্ধ করতে:${C.reset} Ctrl+C\n`)
        if (handlers.onOpen) await handlers.onOpen(sock)
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        const loggedOut = code === DisconnectReason.loggedOut

        if (loggedOut) {
          console.log(`\n${C.red}❌ লগ আউট হয়ে গেছে — নতুন করে পেয়ার করতে হবে।${C.reset}`)
          // ⚠️ আগে সেশন মুছে ফেলা হতো — কিন্তু মাঝে মাঝে WhatsApp ভুল করেও
          //    "logged out" পাঠায় (নেট খারাপ/টাইমআউট)। তখন ভালো সেশনটাই
          //    মুছে যেতো আর QR আবার স্ক্যান করতে হতো।
          //    এখন: মুছি না — ব্যাকআপ রাখি। ভুল হলে ফিরিয়ে আনা যাবে।
          const backup = cfg.sessionDir + '.bak.' + Date.now()
          try {
            if (fs.existsSync(cfg.sessionDir)) {
              fs.renameSync(cfg.sessionDir, backup)
              console.log(`${C.gray}   (পুরোনো সেশন রাখলাম: ${backup})${C.reset}`)
            }
          } catch {}
          // ☁️ ক্লাউডে চললে থেমে যাওয়া চলবে না — সার্ভার আবার চালু করবে
          //    আর অনন্ত রিস্টার্ট-চক্রে পড়বে। তাই পুরোনো লগইন মুছে
          //    এখানেই নতুন পেয়ারিং শুরু করি, কোডটা লগে দেখা যাবে।
          if (mongoAuth) {
            console.log(`${C.gray}   পুরোনো লগইন মুছে নতুন পেয়ারিং শুরু করছি...${C.reset}`)
            await mongoAuth.clearAll().catch(() => {})
            await mongoAuth.close()
            mongoAuth = null
            scheduleReconnect(true)
            return
          }
          console.log('\n👉 এবার যা করবে:')
          console.log('   ১) `npm start` আবার চালাও')
          console.log('   ২) নতুন পেয়ারিং কোড/QR দিয়ে আবার জুড়ে নাও')
          console.log('   (ভুল করে লগ আউট হলে পুরোনো সেশনটা ওপরের .bak ফোল্ডারে আছে)\n')
          process.exit(0)
        }

        scheduleReconnect()
      }
    })

    // --- পেয়ারিং: লগিন করা না থাকলে ৮ অঙ্কের কোড দেখাই ---
    if (!sock.authState.creds.registered) {
      await sleep(3000)
      showPairingCode()
      pairTimer = setInterval(showPairingCode, 120000) // ২ মিনিটে রিফ্রেশ
    }

    return sock
  }

  async function showPairingCode() {
    if (!sock || sock.authState?.creds?.registered) {
      if (pairTimer) { clearInterval(pairTimer); pairTimer = null }
      return
    }
    if (!cfg.botNumber) {
      console.log(`\n${C.yellow}⚠️  .env-এ BOT_NUMBER নেই → পেয়ারিং কোড পাবা না, QR স্ক্যান করো।${C.reset}`)
      console.log('   `nano .env` দিয়ে BOT_NUMBER=91XXXXXXXXXX বসিয়ে আবার চালাও\n')
      return
    }
    try {
      const code = await sock.requestPairingCode(cfg.botNumber)
      // ওয়েব পাতায় (/pair) দেখানোর জন্য রেখে দিই
      pairState.code = String(code || '').toUpperCase()
      pairState.number = cfg.botNumber
      pairState.at = Date.now()
      pairingBanner(code, cfg.botNumber)
    } catch (err) {
      console.log(`\n${C.red}পেয়ারিং কোড আনতে সমস্যা:${C.reset} ${err?.message || err}`)
      console.log('👉 QR কোডের দিকে তাকাও, অথবা কিছুক্ষণ পর `npm start` চালাও\n')
    }
  }

  await connect()

  return {
    getSock: () => sock,
    isGroupJid
  }
}
