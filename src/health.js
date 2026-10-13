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
  ${alive ? '' : `<p style="margin-top:16px"><a href="/pair" style="color:#ffd54f;
      font-size:18px;text-decoration:none;background:#111b21;padding:12px 20px;
      border-radius:12px">📟 পেয়ারিং কোড দেখো</a></p>`}
  <p style="color:#54656f;font-size:12px;margin-top:24px">
    এই পাতাটা বন্ধ কোরো না — এটাই Romeo-কে জাগিয়ে রাখে
  </p>
</div></body></html>`)
      return
    }

    // 📟 পেয়ারিং কোড — ফোনের ব্রাউজারে /pair খুললেই বড় করে দেখা যাবে।
    //    Render-এর লগ ফোনে পড়া ঝামেলা, তাই এই সহজ রাস্তা।
    if (req.url === '/pair' || req.url === '/pairing') {
      const code = String(s.pairCode || '').trim()
      const num = String(s.pairNumber || '')
      const fresh = s.pairAt ? Math.round((Date.now() - s.pairAt) / 1000) : 0
      const head = '<!doctype html><html lang="bn"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta http-equiv="refresh" content="10">'
        + '<title>Romeo — পেয়ারিং কোড</title></head>'
        + '<body style="font-family:system-ui,sans-serif;background:#0b141a;color:#e9edef;'
        + 'display:flex;align-items:center;justify-content:center;min-height:100vh;'
        + 'margin:0;text-align:center;padding:16px"><div>'

      let body
      if (s.connected) {
        body = '<div style="font-size:64px">✅</div>'
          + '<h1 style="margin:8px 0">Romeo জুড়ে গেছে!</h1>'
          + '<p style="color:#25d366;font-size:18px">এখন আর পেয়ারিং কোডের দরকার নেই।</p>'
      } else if (code) {
        body = '<div style="font-size:48px">📟</div>'
          + '<h1 style="margin:8px 0;font-size:20px">পেয়ারিং কোড</h1>'
          + '<div style="font-size:44px;letter-spacing:8px;font-weight:700;background:#111b21;'
          + 'padding:18px 24px;border-radius:14px;color:#ffd54f;margin:12px 0;user-select:all">'
          + code + '</div>'
          + '<p style="color:#8696a0;font-size:14px;margin:4px">নাম্বার: ' + num + '</p>'
          + '<p style="color:#54656f;font-size:12px">' + fresh
          + ' সেকেন্ড আগে তৈরি — ২ মিনিট পরে নিজে থেকে নতুন হবে</p>'
          + '<div style="text-align:left;max-width:340px;margin:18px auto 0;color:#8696a0;'
          + 'font-size:15px;line-height:1.7">'
          + '<b style="color:#e9edef">ধাপগুলো:</b><br>'
          + '১) ফোনে WhatsApp খোলো<br>'
          + '২) ⋮ মেনু → <b>Linked Devices</b><br>'
          + '৩) <b>Link a Device</b> টিপো<br>'
          + '৪) <b>Link with phone number instead</b> বেছে নাও<br>'
          + '৫) ওপরের কোডটা টাইপ করো</div>'
      } else {
        body = '<div style="font-size:64px">⏳</div>'
          + '<h1 style="margin:8px 0">কোড তৈরি হচ্ছে...</h1>'
          + '<p style="color:#8696a0">কয়েক সেকেন্ড পরে এই পাতাটা নিজে থেকেই রিফ্রেশ হবে।</p>'
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(head + body + '</div></body></html>')
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
