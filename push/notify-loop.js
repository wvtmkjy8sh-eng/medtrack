const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const vapidFile = path.join(dataDir, "vapid.json");
const stateFile = path.join(dataDir, "push-state.json");
const sentFile = path.join(dataDir, "push-sent.json");
const REALERT_MS = 3 * 60 * 1000;
const LEAD_MS = 800;
const VIBRATE = [400, 120, 400, 120, 400, 180, 800, 180, 400];

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function main() {
  const webpush = require("web-push");
  fs.mkdirSync(dataDir, { recursive: true });
  let vapid = readJson(vapidFile, null);
  if (!vapid || !vapid.publicKey || !vapid.privateKey) {
    vapid = webpush.generateVAPIDKeys();
    writeJson(vapidFile, vapid);
    console.log("VAPID keys created");
  }
  webpush.setVapidDetails("mailto:medtrack@icloud.com", vapid.publicKey, vapid.privateKey);
  console.log("MedTrack push loop ready");

  let sending = false;
  let nextTimer = null;

  const sendDue = async () => {
    if (sending) return;
    const state = readJson(stateFile, {});
    if ((state.reminderMode || "notification") === "visual") return;
    const subs = Array.isArray(state.subscriptions) ? state.subscriptions : [];
    const doses = Array.isArray(state.doses) ? state.doses : [];
    const taken = new Set(Array.isArray(state.taken) ? state.taken : []);
    if (!subs.length || !doses.length) return;
    const now = Date.now();
    const due = doses.filter((d) => {
      if (!d || taken.has(d.key)) return false;
      const at = Number(d.at) || 0;
      return at && now >= at - LEAD_MS;
    });
    if (!due.length) return;
    const sent = readJson(sentFile, {});
    const fresh = due.filter((d) => {
      const last = Number(sent[d.key]) || 0;
      return !last || now - last >= REALERT_MS;
    });
    if (!fresh.length) return;
    sending = true;
    const title = fresh.length > 1 ? `Hora de ${fresh.length} doses` : `Hora de tomar ${fresh[0].name}`;
    const body = fresh.map((d) => `${d.name}${d.dose ? " · " + d.dose : ""} · ${d.time}`).join("\n");
    const payload = JSON.stringify({
      title,
      body,
      tag: "medtrack-dose-" + Date.now(),
      vibrate: VIBRATE,
      silent: false,
      sound: "default",
      doses: fresh.map((d) => ({ id: d.id, time: d.time })),
    });
    let delivered = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, payload, {
          TTL: 60,
          urgency: "high",
          headers: { Urgency: "high" },
        });
        delivered += 1;
      } catch (err) {
        const code = err && err.statusCode;
        console.warn("push failed", code || err.message, err.body || "");
        if (code === 404 || code === 410) {
          state.subscriptions = (state.subscriptions || []).filter((s) => s.endpoint !== sub.endpoint);
          writeJson(stateFile, state);
        }
      }
    }
    if (delivered) {
      fresh.forEach((d) => { sent[d.key] = now; });
      Object.keys(sent).forEach((k) => {
        if (now - Number(sent[k] || 0) > 48 * 3600 * 1000) delete sent[k];
      });
      writeJson(sentFile, sent);
      console.log("push sent", delivered, fresh.map((d) => d.name).join(", "));
    } else {
      console.warn("push not delivered, will retry");
    }
    sending = false;
  };

  const armNext = () => {
    if (nextTimer) clearTimeout(nextTimer);
    const state = readJson(stateFile, {});
    const taken = new Set(Array.isArray(state.taken) ? state.taken : []);
    const now = Date.now();
    const next = (Array.isArray(state.doses) ? state.doses : [])
      .filter((d) => d && !taken.has(d.key))
      .map((d) => Number(d.at) || 0)
      .filter((at) => at > now - LEAD_MS)
      .sort((a, b) => a - b)[0];
    if (!next) return;
    const wait = Math.max(0, next - now - LEAD_MS);
    nextTimer = setTimeout(() => {
      sendDue().catch((err) => console.warn(err)).finally(armNext);
    }, wait);
  };

  setInterval(() => {
    sendDue().catch((err) => console.warn(err));
    armNext();
  }, 2000);
  sendDue().catch((err) => console.warn(err));
  armNext();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
