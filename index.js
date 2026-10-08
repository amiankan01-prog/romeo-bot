// ==========================================================
//   👑 ROMEO MAMU — WhatsApp Group Bot  (ফেজ ১)
//   Baileys + পেয়ারিং কোড লগিন | ১০০% ফ্রি | Termux-রেডি
// ==========================================================
import fs from 'node:fs'
import { buildConfig } from './config.js'
import { startBot } from './src/connection.js'
import { createRouter } from './src/router.js'
import * as db from './src/store/db.js'
import { pick } from './src/utils.js'
import { startHealthServer } from './src/health.js'
import { sweepTemp } from './src/features/music.js'

const C = { reset: '\u001b[0m', bold: '\u001b[1m', magenta: '\u001b[35m', cyan: '\u001b[36m', gray: '\u001b[90m', yellow: '\u001b[33m' }

console.log(`
${C.magenta}${C.bold}
  ____                             __  __
 |  _ \\ ___  _ __ ___   ___  ___  |  \\/  | __ _ _ __ ___  _   _
 | |_) / _ \\| '_ \` _ \\ / _ \\/ _ \\ | |\\/| |/ _\` | '_ \` _ \\| | | |
 |  _ < (_) | | | | | |  __/ (_) || |  | | (_| | | | | | | |_| |
 |_| \\_\\___/|_| |_| |_|\\___|\\___/ |_|  |_|\\__,_|_| |_| |_|\\__,_|
${C.reset}
 ${C.cyan}গ্রুপের সবচেয়ে কুল সদস্য — এখন WhatsApp-এ${C.reset}
 ${C.gray}Baileys 6.7.24 | Node ${process.version} | ফেজ ১${C.reset}
`)

async function main() {
  const cfg = buildConfig()

  // --- .env আছে তো? ---
  // ☁️ ক্লাউডে .env ফাইল থাকে না — সেটিং সরাসরি environment-এ থাকে।
  //    তাই key পাওয়া গেলে ফাইল না থাকলেও এগিয়ে যাবো।
  if (!fs.existsSync('.env') && !cfg.geminiApiKey && !cfg.mongoUri) {
    console.log(`${C.yellow}⚠️  .env ফাইল পাওয়া যায়নি!${C.reset}`)
    console.log('   এই কমান্ড চালাও:\n')
    console.log('   cp .env.example .env && nano .env\n')
    console.log('   তারপর BOT_NUMBER=91XXXXXXXXXX বসিয়ে সেভ করো।\n')
    return
  }

  if (!cfg.botNumber) {
    console.log(`${C.yellow}⚠️  .env-এ BOT_NUMBER সেট করা নেই → পেয়ারিং কোড পাবা না, QR দেখাবে।${C.reset}\n`)
  }

  db.init(cfg.dbFile)
  db.set('startedAt', Date.now())

  // 🧹 গত দফার পড়ে থাকা অস্থায়ী ফাইল ঝেড়ে ফেলি, তারপর আধঘণ্টায় একবার।
  //    না করলে Render-এর ছোট ডিস্ক ভরে গিয়ে Romeo বন্ধ হয়ে যায়।
  sweepTemp(0)
  setInterval(() => sweepTemp(), 30 * 60 * 1000).unref?.()

  const router = createRouter(cfg, db)

  // ☁️ ক্লাউডে (PORT থাকলে) একটা ছোট্ট ওয়েব-পাতা খুলি — Render-এর
  //    এটা লাগে, আর বাইরের পিং এখানেই এসে Romeo-কে জাগিয়ে রাখে।
  let connected = false
  startHealthServer(cfg.port, () => ({
    connected,
    groups: cfg.allowAllGroups ? 'all' : cfg.allowedGroups.length,
    replies: db.get('stats:replies', 0),
    songs: db.get('song:' + new Date().toDateString(), 0)
  }))

  const tips = [
    '💡 টিপস: বট বন্ধ করলে `npm start` দিয়ে আবার চালাও',
    '💡 টিপস: `termux-wake-lock` দিলে ফোন ঘুমালেও Romeo জেগে থাকবে',
    '💡 টিপস: গ্রুপে `!help` লিখলে সব কমান্ড দেখাবে',
    '💡 টিপস: লগ দেখতে: `tail -f bot.log`'
  ]

  await startBot(cfg, {
    onMessage: router.handleMessage,
    onGroupEvent: router.handleGroupEvent,
    onOpen: async () => {
      connected = true
      console.log('   ' + pick(tips) + '\n')
      if (cfg.discoveryMode) {
        console.log(`${C.yellow}   ⚠️  ALLOWED_GROUPS খালি আছে → Romeo কোনো গ্রুপে কাজ করবে না।${C.reset}`)
        console.log('   গ্রুপে Romeo-কে অ্যাড করে `/id` লিখো।\n')
      }
    }
  })
}

// ফোন/টার্মিনাল বন্ধের সময় নরম বন্ধ
process.on('SIGINT', () => {
  console.log(`\n${C.gray}Romeo বিদায় নিচ্ছে... 👋${C.reset}\n`)
  process.exit(0)
})
// 🛡️ অপ্রত্যাশিত এরর হলেও Romeo যেন মরে না যায়।
//    আগে uncaughtException ধরা হতো না — একটা ছোট্ট বাগেই পুরো
//    প্রোগ্রাম বন্ধ হয়ে যেতো আর Romeo অফলাইন হয়ে থাকতো।
process.on('unhandledRejection', err => {
  console.error('⚠️  অপ্রত্যাশিত এরর (চলতে থাকবে):', err?.message || err)
})
process.on('uncaughtException', err => {
  console.error('⚠️  গুরুতর এরর (চলতে থাকবে):', err?.message || err)
})

main().catch(err => {
  console.error('\n❌ বুট করতে ব্যর্থ:', err)
  console.error('\nসাধারণ কারণ: Node ২০+ নেই, অথবা `npm install` হয়নি।\n')
  process.exit(1)
})
