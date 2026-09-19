require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

const { answerQuestion } = require("./claudeHandler");

const logger = pino({ level: "silent" }); // set to "info" or "debug" to see Baileys' own logs

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
      console.log("\nScan this QR code with WhatsApp (Linked Devices > Link a Device):\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("Connection closed.", shouldReconnect ? "Reconnecting..." : "Logged out, delete ./auth_info to log in again.");
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
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

startBot().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
