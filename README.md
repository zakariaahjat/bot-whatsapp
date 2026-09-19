# UltraPC WhatsApp Bot

A WhatsApp bot that answers customer questions using your own JSON database (products, prices, FAQ, etc.), in **English, French, Arabic, and Darija (Moroccan Arabic)** — auto-detected per message.

How it works: every incoming WhatsApp message is sent to Claude along with your full `database.json` as context. Claude answers strictly from that data, in whatever language/script the customer used.

## 1. Requirements

- Node.js 18 or newer (check with `node -v`)
- A WhatsApp number to dedicate to the bot (works with a normal number — it connects like WhatsApp Web)
- A free Gemini API key: https://aistudio.google.com/apikey

## 2. Setup

```bash
npm install
cp .env.example .env
```

Open `.env` and paste your `GEMINI_API_KEY` (see `.env.example`).

## 3. Add your data

Edit `database.json` with your real catalog / FAQ. Structure is up to you — Claude reads the whole file as context, it doesn't need a fixed schema. Keep it reasonably sized (a few hundred products/entries is fine; if it grows into the thousands, see "Scaling up" below).

## 4. Run it

```bash
npm start
```

A QR code will print in your terminal, and the same QR/status page is served at `http://localhost:3000`. On your phone: **WhatsApp > Settings > Linked Devices > Link a Device**, then scan it. Once connected, the bot will reply to any message sent to that number.

Your session is saved in `./auth_info` so you won't need to re-scan on restart — don't commit that folder to git, it's equivalent to your login. To log in again, hit the `/reset` endpoint or delete `./auth_info`.

## Deploy on Render (free)

This repo includes a `render.yaml`, so you can deploy with one click:

1. Push this repo to GitHub (already done).
2. Go to https://render.com and sign up (GitHub login).
3. In the Render dashboard: **New + → Blueprint**, select this repo.
4. When it asks for the env vars, set **`GEMINI_API_KEY`** to your key from https://aistudio.google.com/apikey (get a free one). Others have sensible defaults.
5. Deploy. Wait ~2–5 min for the build, then open the service's URL `https://<your-app>.onrender.com` — you'll see the QR code. Scan it with your phone.
6. The bot now runs 24/7. Open the same URL any time to check status or **reset** the session.

Notes:
- **Free-tier disk is not persistent** — if the service restarts or you redeploy, the WhatsApp session may be lost and you'll need to re-scan the QR (the `/reset` page helps).
- The dashboard/instance stays awake as long as WhatsApp keeps a connection alive; on the free plan Render may spin it down after long idle periods, which will disconnect and auto-reconnect the bot (it reconnects itself via `startBot()`).
- No persistent database of chat history is kept — conversation memory resets on restart, same as locally.
- Prefer a truly always-on host with a persistent session? Use an Oracle Cloud "Always Free" VM instead (see the note in the files section).

## 5. Test it

Message the connected number from another phone, in any of the four languages:
- "How much is the RTX 3060 setup?"
- "C'est combien le setup avec RTX 4060?"
- "بشحال السيتاب ديال i5؟"
- "3andkom setup fih RTX 3060?"

## Keeping it running 24/7

`npm start` only runs while your terminal is open. On a VPS, use a process manager so it survives disconnects and restarts:

```bash
npm install -g pm2
pm2 start index.js --name ultrapc-bot
pm2 save
pm2 startup   # follow the printed instructions to enable on boot
```

## Notes & limitations

- **Unofficial connection**: this uses Baileys, which connects the same way WhatsApp Web does. It's free and has no approval process, but WhatsApp can in theory flag/ban numbers that send high volumes or behave like spam. For a low/medium-volume support bot this is normally fine; for high-volume or business-critical use, consider migrating to the official WhatsApp Business API later — the answering logic in `claudeHandler.js` doesn't need to change, only `index.js`.
- **Conversation memory**: the bot remembers the last few messages per customer (set by `HISTORY_LIMIT` in `.env`) so it can handle follow-ups like "and in MAD?". This memory resets when the bot restarts — it's not saved to disk.
- **Groups are ignored**: the bot only replies in 1-on-1 chats.
- **Scaling up**: if your database gets large (thousands of items), sending the whole JSON on every message gets slow and expensive. At that point, swap `getDatabaseContext()` in `claudeHandler.js` for a search step (e.g. filter products by keyword, or use a vector search) that only sends the relevant subset to Claude. Happy to help build that when you get there.

## File overview

- `index.js` — connects to WhatsApp, serves the QR/status page, listens for messages, sends replies
- `claudeHandler.js` — builds the prompt (your database + language rules) and calls the Gemini API
- `render.yaml` — one-click Render deployment config
- `database.json` — your data, edit this freely; changes apply on the next message, no restart needed
- `.env` — your API key and settings (never commit this)
