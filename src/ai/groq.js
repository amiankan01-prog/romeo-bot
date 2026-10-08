// ==========================================================
//  Groq — ব্যাকআপ brain (ঐচ্ছিক)।
//  Gemini কাজ না করলে এটা চেষ্টা করবে।
//  GROQ_API_KEY না থাকলে এই মডিউল নীরবে বন্ধ থাকে।
// ==========================================================

const URL = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'

export async function groqChat({ apiKey, model, system, history, text }) {
  if (!apiKey) throw new Error('GROQ_API_KEY নেই')

  const messages = [{ role: 'system', content: system }]
  for (const h of history || []) {
    messages.push({ role: h.role === 'me' ? 'assistant' : 'user', content: h.text })
  }
  messages.push({ role: 'user', content: text })

  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      temperature: 0.9,
      max_tokens: 500
    })
  })

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 150)
    throw new Error(`Groq HTTP ${res.status} — ${detail}`)
  }

  const json = await res.json()
  const out = json?.choices?.[0]?.message?.content?.trim()
  if (!out) throw new Error('Groq খালি উত্তর দিয়েছে')
  return { text: out, model: model || DEFAULT_MODEL }
}
