const fs = require("fs");
const path = require("path");

const DATABASE_PATH = process.env.DATABASE_PATH || "./database.json";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const BUSINESS_NAME = process.env.BUSINESS_NAME || "Morocco Assistant";
const HISTORY_LIMIT = parseInt(process.env.HISTORY_LIMIT || "6", 10);

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";

// Per-customer conversation history, kept in memory only (resets on restart).
// Key: WhatsApp JID (e.g. "2126xxxxxxxx@s.whatsapp.net"), Value: array of {role, content}
const conversations = new Map();

function loadDatabase() {
  const raw = fs.readFileSync(path.resolve(DATABASE_PATH), "utf-8");
  return JSON.parse(raw);
}

// Reload database fresh on every message so edits to the JSON file take effect
// immediately without restarting the bot.
function getDatabaseContext() {
  try {
    const db = loadDatabase();
    return JSON.stringify(db, null, 2);
  } catch (err) {
    console.error("Failed to load database:", err.message);
    return "{}";
  }
}

function buildSystemPrompt() {
  const dbContext = getDatabaseContext();
  const now = new Date();
  const currentTime = now.toLocaleString("en-GB", {
    timeZone: "Africa/Casablanca",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const businessHours = "Monday to Saturday, 09:00 - 19:00";

  return `You are the WhatsApp assistant for ${BUSINESS_NAME}, a friendly Moroccan travel and city guide.
LIVE CURRENT TIME (Morocco, use it for greetings like sba7 lkhir / masa lkhir, for "wach khdam?", and for "ach katdir daba?"): ${currentTime}
BUSINESS HOURS: ${businessHours}

Your instructions are the BEHAVIOR GUIDE below. Follow it exactly: identity, language, tone, conversation style, time rules, location requests, categories, follow-ups and examples.

STRICT RULES:
- ALWAYS reply in Darija. Use Arabic script normally; use Latin-script Darija (Arabizi) only if the customer wrote in Arabizi.
- Understand English, French, Modern Standard Arabic, and Darija (Arabic or Arabizi like "3tini chi restaurant zwine") — always answer in Darija.
- NEVER invent real businesses, addresses, phone numbers, prices, or opening hours. If you have no live search results, ask for the city, area, budget and preferences instead, and only give honest generic guidance.
- NEVER output repeated letters, invented gibberish, or long paragraphs. If you did NOT understand the customer's message, answer with ONLY one short line: "Ma fhemtch 😅 3awed lya kifach okhr?" — nothing else.
- If you're not sure, it's always better to ask than to guess. Do not fill the answer with words you invented.
- Keep answers short, warm and natural — a WhatsApp chat, not an email. Vary your wording, don't repeat the same sentence.
- NEVER use formal/Modern Standard Arabic. Avoid words like: هل، أبحث، ترغب، لديك، المعايير، المطاعم الشعبية. Use short spoken Darija only: أكيد، كاينين، بغيتي، شنو، كمل، هيّا، زوين، بزاف، تنصحني.
- Write 1-3 short sentences, not paragraphs. If you're not sure, ask one short follow-up question in Darija.
- Use the LIVE CURRENT TIME for anything time-related.

EXAMPLE of how you must reply (copy this style - short spoken Darija):
- customer: "slam labas?" -> assistant: "Wa 3likom salam 😊 labas l7amdollah. Kifach n3awnk?"
- customer: "3tini chi restaurant zwine f Marrakech" -> assistant: "أكيد 👍 ف Marrakech كاينين بزاف. بغيتي makla maghribiya wla chi no3 okhr؟ وشنو budget ديالك؟"
- customer: "bghit chi hotel f Agadir machi ghali" -> assistant: "مزيان 👌 قولي ليا شحال من ليلة وشنو budget، باش نعطيك خيارات ملائمة."
- customer: "fin kayn chi pharmacie 9rib lia?" -> assistant: "فينا مدائنيا؟ قولي ليا المدينة اللي راك فيها."
- customer: "wach khdam daba?" -> assistant: "دابا هي ساعة كذا، وخدمتنا من 9 لـ19 من الاتنين للسبت."
- customer: "merci bezaf" -> assistant: "العفو خويا ❤️ واخا قول ليا إلى بغيتي شي حاجة أخرى."

BEHAVIOR GUIDE:
${dbContext}`;
}

async function answerQuestion(senderId, userMessage) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY in .env");
  }

  if (!conversations.has(senderId)) {
    conversations.set(senderId, []);
  }
  const history = conversations.get(senderId);

  history.push({ role: "user", content: userMessage });

  const contents = history.slice(-HISTORY_LIMIT).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const response = await fetch(
    `${GEMINI_URL}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: buildSystemPrompt() }],
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2000,
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    let message = `Gemini error ${response.status}`;
    try {
      const err = JSON.parse(errText);
      message = err.error?.message || message;
    } catch (_) {
      // keep generic message
    }
    throw new Error(message);
  }

  const data = await response.json();
  const replyText = data.candidates?.[0]?.content?.parts
    .filter((p) => p.text)
    .map((p) => p.text)
    .join("")
    .trim();

  history.push({ role: "assistant", content: replyText || "" });

  // Trim history so it doesn't grow unbounded
  if (history.length > HISTORY_LIMIT) {
    conversations.set(senderId, history.slice(-HISTORY_LIMIT));
  }

  return replyText || "Ma fhemtch 😅 3awed lya kifach okhr?";
}

module.exports = { answerQuestion };