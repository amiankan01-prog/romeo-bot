// ==========================================================
//  🩺 স্বাস্থ্য-সার্ভার — শুধু ক্লাউডে চালালে দরকার
//
//  কেন?
//  ────
//  Render-এর মতো ফ্রি হোস্টিং দুটো জিনিস চায়:
//
//  ১) অ্যাপটা একটা পোর্ট খুলে রাখবে — নাহলে ওরা ভাবে চালু হয়নি
//     আর ১৫ মিনিট পরে বন্ধ করে দেয়।
//
//  ২) মাঝে মাঝে কেউ ওই পোর্টে ঢুঁ মারবে — একেবারে নীরব থাকলে
//     ফ্রি সার্ভার ঘুমিয়ে পড়ে। তাই বাইরে থেকে প্রতি ১০ মিনিটে
//     একটা পিং পাঠালে Romeo সারাক্ষণ জেগে থাকে।
//
//  ফোনে (Termux) চালালে PORT থাকে না — তখন এটা নিজে থেকেই
//  নিষ্ক্রিয় থাকে, কিছুই করে না।
// ==========================================================

import http from 'node:http'

const started = Date.now()

/** কতক্ষণ ধরে চলছে — বাংলায় */
function uptimeText() {
  const sec = Math.floor((Date.now() - started) / 1000)
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const parts = []
  if (d) parts.push(`${d} দিন`)
  if (h) parts.push(`${h} ঘণ্টা`)
  parts.push(`${m} মিনিট`)
  return parts.join(' ')
}

/**
 * @param {number} port            ০ হলে কিছুই করবে না (ফোনে চালানোর সময়)
 * @param {() => object} getStatus Romeo-র বর্তমান অবস্থা
 */
export function startHealthServer(port, getStatus = () => ({})) {
  if (!port) return null

  const server = http.createServer((req, res) => {
    const s = getStatus() || {}

    // ছোট্ট একটা পেজ — ব্রাউজারে খুললে দেখা যাবে Romeo বেঁচে আছে কিনা
    if (req.url === '/' || req.url === '/health' || req.url === '/ping') {
      const alive = !!s.connected
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html lang="bn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Romeo Mamu</title></head>
<body style="font-family:system-ui,sans-serif;background:#0b141a;color:#e9edef;
             display:flex;align-items:center;justify-content:center;
             min-height:100vh;margin:0;text-align:center">
<div>
  <div style="font-size:64px">${alive ? '👑' : '😴'}</div>
  <h1 style="margin:8px 0">Romeo Mamu</h1>
  <p style="font-size:20px;color:${alive ? '#25d366' : '#f5a623'};margin:4px">
    ${alive ? '✅ অনলাইন আছি' : '⏳ জুড়ে নিচ্ছি...'}
  </p>
  <p style="color:#8696a0;font-size:14px">চলছে ${uptimeText()} ধরে</p>
  <p style="color:#54656f;font-size:12px;margin-top:24px">
    এই পাতাটা বন্ধ কোরো না — এটাই Romeo-কে জাগিয়ে রাখে
  </p>
</div></body></html>`)
      return
    }

    // পিং পরিষেবার জন্য হালকা JSON
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      connected: !!s.connected,
      uptimeSec: Math.floor((Date.now() - started) / 1000),
      ...s
    }))
  })

  server.on('error', err => {
    console.error('⚠️  স্বাস্থ্য-সার্ভার সমস্যা:', err?.message || err)
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(`   🩺 স্বাস্থ্য-সার্ভার চালু — পোর্ট ${port}`)
  })

  return server
}
