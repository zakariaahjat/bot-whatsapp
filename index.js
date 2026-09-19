require("dotenv").config();

const http = require("http");
const fs = require("fs");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const QRCode = require("qrcode");

const { answerQuestion } = require("./claudeHandler");

const logger = pino({ level: "silent" }); // set to "info" or "debug" to see Baileys' own logs

// Latest state, shared with the status page served over HTTP.
const status = { qr: null, connected: false, loggedOut: false };

function resetSession() {
  fs.rmSync("./auth_info", { recursive: true, force: true });
  console.log("Session deleted. Exiting so the bot restarts and prints a fresh QR.");
  process.exit(0);
}

function startStatusServer() {
  const server = http.createServer(async (req, res) => {
    const url = (req.url || "/").split("?")[0];

    if (url === "/reset") {
      resetSession();
      res.end("Reset.");
      return;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    let body;
    if (!status.qr && !status.connected) {
      body = "<h1>Starting...</h1><p>The bot is booting, refresh in a few seconds to see the QR code.</p>";
    } else if (status.connected) {
      body = `<h1>✅ Bot connected to WhatsApp</h1><p>It is running 24/7. To re-login, <a href="/reset">reset the session</a>.</p>`;
    } else if (status.loggedOut) {
      body = `<h1>⚠️ Logged out</h1><p>The WhatsApp session was removed remotely. <a href="/reset">Reset the session</a> to print a new QR code.</p>`;
    } else {
      const qrImage = await QRCode.toDataURL(status.qr, { width: 600, margin: 2 });
      body = `<h1>Scan this QR code</h1>
        <p>In WhatsApp on your phone: <b>Settings &gt; Linked Devices &gt; Link a Device</b>, then scan.</p>
        <img src="${qrImage}" alt="QR code" />
        <p><a href="/reset">Reset session</a> (only if the QR is expired or you were logged out)</p>`;
    }

    res.end(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>WhatsApp Bot</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:2rem}img{max-width:90%;height:auto}form{display:inline}</style></head><body>${body}</body></html>`);
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Status page running on http://localhost:${port}`));
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false, // we handle QR display ourselves below
    auth: state,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      status.qr = qr;
      status.connected = false;
      status.loggedOut = false;
      console.log("\nScan this QR code with WhatsApp (Linked Devices > Link a Device):\n");
      QRCode.toString(qr, { type: "terminal", small: true }).then((str) => console.log(str));
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      status.connected = false;
      status.loggedOut = !shouldReconnect;
      console.log("Connection closed.", shouldReconnect ? "Reconnecting..." : "Logged out, delete ./auth_info to log in again.");
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      status.connected = true;
      status.loggedOut = false;
      console.log("✅ Connected to WhatsApp.");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const senderId = msg.key.remoteJid;
        if (!senderId || senderId.endsWith("@g.us")) continue; // skip group chats

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          "";

        if (!text.trim()) continue; // ignore non-text messages (images, stickers, etc.)

        console.log(`📩 ${senderId}: ${text}`);

        await sock.sendPresenceUpdate("composing", senderId);

        const reply = await answerQuestion(senderId, text);

        await sock.sendMessage(senderId, { text: reply });
        console.log(`📤 ${senderId}: ${reply}`);
      } catch (err) {
        console.error("Error handling message:", err);
        try {
          await sock.sendMessage(msg.key.remoteJid, {
            text: "Sorry, something went wrong on our end. Please try again in a moment. / Désolé, une erreur est survenue. Veuillez réessayer.",
          });
        } catch (_) {
          // ignore secondary failure
        }
      }
    }
  });
}

startStatusServer();
startBot().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
