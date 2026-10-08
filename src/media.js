// ==========================================================
//  ছবি / ভয়েস নোট ডাউনলোড — AI-এর কাছে পাঠানোর জন্য
// ==========================================================
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import pino from 'pino'
import { messageType } from './utils.js'

const silentLogger = pino({ level: 'silent' })

const MAX_BYTES = 8 * 1024 * 1024 // ৮ MB-এর বেশি নেব না

export function mediaKind(m) {
  const t = messageType(m)
  if (t === 'imageMessage') return 'image'
  if (t === 'audioMessage') return m.message.audioMessage?.ptt ? 'voice' : 'audio'
  if (t === 'videoMessage') return 'video'
  if (t === 'stickerMessage') return 'sticker'
  if (t === 'documentMessage') return 'document'
  return null
}

/** WhatsApp-এর মাইম টাইপ পরিষ্কার করা (Gemini "audio/ogg; codecs=opus" পছন্দ করে না) */
function cleanMime(raw, kind) {
  if (!raw) {
    return kind === 'voice' || kind === 'audio' ? 'audio/ogg' : 'image/jpeg'
  }
  return String(raw).split(';')[0].trim()
}

const LABEL = {
  image: 'ছবি',
  voice: 'ভয়েস নোট',
  audio: 'অডিও',
  video: 'ভিডিও',
  sticker: 'স্টিকার',
  document: 'ফাইল'
}

/**
 * মেসেজ থেকে মিডিয়া নিয়ে আসে।
 * @returns {Promise<{kind, mime, data:Buffer}|null>}
 */
export async function getMedia(m, sock) {
  const kind = mediaKind(m)
  if (!kind) return null

  const node = m.message[messageType(m)]
  const mime = cleanMime(node?.mimetype, kind)

  try {
    const data = await downloadMediaMessage(
      m,
      'buffer',
      {},
      { logger: silentLogger, reuploadRequest: sock?.updateMediaMessage }
    )
    if (!data || !data.length) return null
    if (data.length > MAX_BYTES) return { tooBig: true, kind, label: LABEL[kind] }
    return { kind, mime, data, label: LABEL[kind] }
  } catch (err) {
    console.error('❌ মিডিয়া ডাউনলোড ব্যর্থ:', err?.message || err)
    return null
  }
}
