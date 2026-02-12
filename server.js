const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const webpush = require("web-push");
const { WebSocketServer } = require("ws");
const Database = require("better-sqlite3");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const DATA_DIR = path.join(__dirname, "data");

if (!API_KEY) {
  console.error("API_KEY environment variable is required");
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadVapidKeys() {
  const vapidPath = path.join(DATA_DIR, "vapid.json");

  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  const envSubject = process.env.VAPID_SUBJECT;

  if (envPublic && envPrivate && envSubject) {
    return {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject: envSubject,
    };
  }

  if (fs.existsSync(vapidPath)) {
    const stored = JSON.parse(fs.readFileSync(vapidPath, "utf-8"));
    if (envSubject) stored.subject = envSubject;
    return stored;
  }

  const keys = webpush.generateVAPIDKeys();
  const vapid = {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: envSubject || "mailto:oncall@localhost",
  };
  fs.writeFileSync(vapidPath, JSON.stringify(vapid, null, 2));
  console.log("Generated new VAPID keys, saved to data/vapid.json");
  return vapid;
}

const vapid = loadVapidKeys();
webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
console.log(`VAPID public key: ${vapid.publicKey}`);

const db = new Database(path.join(DATA_DIR, "oncall.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT UNIQUE NOT NULL,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now')),
    type TEXT NOT NULL CHECK (type IN ('notification', 'response')),
    parentId TEXT,
    FOREIGN KEY (parentId) REFERENCES messages(id)
  );
`);

const stmts = {
  insertSub: db.prepare(
    "INSERT OR REPLACE INTO subscriptions (endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?)"
  ),
  deleteSub: db.prepare("DELETE FROM subscriptions WHERE endpoint = ?"),
  getAllSubs: db.prepare("SELECT * FROM subscriptions ORDER BY createdAt DESC"),
  getSubCount: db.prepare("SELECT COUNT(*) as count FROM subscriptions"),
  insertMessage: db.prepare(
    "INSERT INTO messages (id, title, body, type, parentId) VALUES (?, ?, ?, ?, ?)"
  ),
  getMessages: db.prepare(
    "SELECT * FROM messages ORDER BY sentAt DESC LIMIT 100"
  ),
};

const app = express();
app.use(express.json());

function checkAuth(req, res, next) {
  const header = req.headers.authorization;
  const query = req.query.key;
  const key = header?.startsWith("Bearer ") ? header.slice(7) : query;
  if (key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.use("/api", checkAuth);
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/vapid-public-key", (_req, res) => {
  res.json({ publicKey: vapid.publicKey });
});

app.post("/api/subscribe", (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: "Invalid subscription" });
  }
  stmts.insertSub.run(endpoint, keys.p256dh, keys.auth);
  broadcastWs({ type: "subscription", count: getSubCount() });
  res.json({ ok: true });
});

app.delete("/api/subscribe", (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: "Missing endpoint" });
  }
  stmts.deleteSub.run(endpoint);
  broadcastWs({ type: "subscription", count: getSubCount() });
  res.json({ ok: true });
});

app.get("/api/subscriptions", (_req, res) => {
  const subs = stmts.getAllSubs.all();
  res.json({ subscriptions: subs, count: subs.length });
});

app.post("/api/notify", async (req, res) => {
  const { title, body, url, tag } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: "title and body required" });
  }

  const messageId = uuidv4();
  stmts.insertMessage.run(messageId, title, body, "notification", null);

  const subs = stmts.getAllSubs.all();
  const payload = JSON.stringify({ title, body, url, tag, messageId });
  const results = await sendToAll(subs, payload);

  broadcastWs({ type: "notification", messageId, title, body });
  res.json({ messageId, results });
});

app.get("/api/messages", (_req, res) => {
  const messages = stmts.getMessages.all();
  res.json({ messages });
});

app.post("/api/respond", (req, res) => {
  let { messageId, text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "text required" });
  }

  if (!messageId) {
    const latest = db.prepare("SELECT id FROM messages WHERE type = 'notification' ORDER BY sentAt DESC LIMIT 1").get();
    messageId = latest ? latest.id : null;
  }

  const responseId = uuidv4();
  stmts.insertMessage.run(responseId, "Response", text, "response", messageId);
  broadcastWs({ type: "response", responseId, messageId, text });
  res.json({ ok: true, responseId });
});

async function sendToAll(subs, payload) {
  const results = { sent: 0, failed: 0, removed: 0, errors: [] };

  await Promise.all(
    subs.map(async (sub) => {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
      };
      try {
        await webpush.sendNotification(pushSub, payload);
        results.sent++;
      } catch (err) {
        results.failed++;
        results.errors.push({
          status: err.statusCode,
          body: err.body,
          endpoint: sub.endpoint.slice(0, 60) + "...",
        });
        if (err.statusCode === 404 || err.statusCode === 410) {
          stmts.deleteSub.run(sub.endpoint);
          results.removed++;
        }
      }
    })
  );

  return results;
}

function getSubCount() {
  return stmts.getSubCount.get().count;
}

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/ws" });

function broadcastWs(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  if (url.searchParams.get("key") !== API_KEY) {
    ws.close(4401, "Unauthorized");
    return;
  }
  ws.send(JSON.stringify({ type: "init", count: getSubCount() }));

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "notify" && msg.title && msg.body) {
      const messageId = uuidv4();
      stmts.insertMessage.run(messageId, msg.title, msg.body, "notification", null);

      const subs = stmts.getAllSubs.all();
      const payload = JSON.stringify({
        title: msg.title,
        body: msg.body,
        messageId,
      });
      const results = await sendToAll(subs, payload);

      broadcastWs({ type: "notification", messageId, title: msg.title, body: msg.body, results });
    }
  });
});

server.listen(PORT, () => {
  console.log(`oncall server running on http://localhost:${PORT}`);
});
