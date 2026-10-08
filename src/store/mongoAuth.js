// ==========================================================
//  ☁️ MongoDB-তে WhatsApp লগইন সংরক্ষণ
//
//  কেন দরকার?
//  ──────────
//  ক্লাউড সার্ভারে (Render) ফাইল স্থায়ী হয় না — সার্ভার রিস্টার্ট
//  হলেই সব মুছে যায়। লগইন ফাইলে রাখলে প্রতিবার নতুন করে পেয়ার
//  করতে হতো, যেটা অসম্ভব ঝামেলা।
//
//  তাই লগইনটা MongoDB-তে রাখি — সার্ভার যতবারই রিস্টার্ট হোক,
//  Romeo নিজের পরিচয় মনে রাখবে আর সাথে সাথি ফিরে আসবে।
//
//  MongoDB Atlas-এর ফ্রি প্ল্যান (M0) চিরকাল ফ্রি, কার্ড লাগে না।
// ==========================================================

import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys'
import { MongoClient } from 'mongodb'

/**
 * কী-নাম নিরাপদ করা।
 * Baileys-এর কী-তে ডট (.) থাকে, আর MongoDB-র ফিল্ড-নামে ডট
 * আলাদা অর্থ বহন করে — তাই বদলে দিই।
 */
const safeKey = s => String(s).replace(/\./g, '__dot__').replace(/\$/g, '__dol__')

/**
 * Baileys-এর auth state, কিন্তু MongoDB-তে।
 *
 * @param {string} uri         MongoDB সংযোগ লিংক
 * @param {string} dbName      ডেটাবেসের নাম
 * @param {string} sessionId   একাধিক বট চালালে আলাদা রাখার জন্য
 */
export async function useMongoAuthState(uri, dbName = 'romeo', sessionId = 'default') {
  const client = new MongoClient(uri, {
    // ফোনের/সার্ভারের নেট ধীর হলেও যেন হাল না ছাড়ে
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    maxPoolSize: 5
  })

  await client.connect()
  const col = client.db(dbName).collection('auth_' + sessionId)
  await col.createIndex({ _id: 1 }).catch(() => {})

  /** একটা রেকর্ড পড়া */
  const readData = async id => {
    try {
      const doc = await col.findOne({ _id: safeKey(id) })
      if (!doc?.value) return null
      return JSON.parse(doc.value, BufferJSON.reviver)
    } catch (err) {
      console.error('⚠️  সেশন পড়তে সমস্যা:', err?.message || err)
      return null
    }
  }

  /** একটা রেকর্ড লেখা */
  const writeData = async (id, value) => {
    try {
      await col.updateOne(
        { _id: safeKey(id) },
        { $set: { value: JSON.stringify(value, BufferJSON.replacer), at: new Date() } },
        { upsert: true }
      )
    } catch (err) {
      console.error('⚠️  সেশন লিখতে সমস্যা:', err?.message || err)
    }
  }

  const removeData = async id => {
    try {
      await col.deleteOne({ _id: safeKey(id) })
    } catch {
      /* কিছু না */
    }
  }

  // লগইন তথ্য — আগের থাকলে সেটা, নাহলে নতুন
  const creds = (await readData('creds')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        /** একসাথে অনেকগুলো কী পড়া */
        get: async (type, ids) => {
          const out = {}
          await Promise.all(
            ids.map(async id => {
              let value = await readData(`${type}-${id}`)
              // app-state-sync-key আলাদা করে প্যাক করা থাকে
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              if (value) out[id] = value
            })
          )
          return out
        },

        /** একসাথে অনেকগুলো কী লেখা/মোছা */
        set: async data => {
          const jobs = []
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id]
              const key = `${type}-${id}`
              jobs.push(value ? writeData(key, value) : removeData(key))
            }
          }
          await Promise.all(jobs)
        }
      }
    },

    /** লগইন তথ্য বদলালে সংরক্ষণ করো */
    saveCreds: () => writeData('creds', creds),

    /** লগআউট হলে সব মুছে ফেলা */
    clearAll: async () => {
      try {
        await col.deleteMany({})
      } catch {
        /* কিছু না */
      }
    },

    close: () => client.close().catch(() => {})
  }
}

/** MongoDB লিংক দেওয়া আছে কিনা */
export const hasMongo = uri => typeof uri === 'string' && /^mongodb(\+srv)?:\/\//.test(uri.trim())
