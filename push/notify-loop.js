const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const vapidFile = path.join(dataDir, "vapid.json");
const stateFile = path.join(dataDir, "push-state.json");
const sentFile = path.join(dataDir, "push-sent.json");
const REALERT_MS = 60 * 1000;
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
  const testFile = path.join(dataDir, "push-test.json");

  const uniqueSubs = (subs) => {
    const seen = new Set();
    return (Array.isArray(subs) ? subs : []).filter((s) => {
      if (!s || !s.endpoint || seen.has(s.endpoint)) return false;
      seen.add(s.endpoint);
      return true;
    });
  };

  const sendToSubs = async (subs, payload) => {
    let delivered = 0;
    const state = readJson(stateFile, {});
    for (const sub of uniqueSubs(subs)) {
      try {
        await webpush.sendNotification(sub, payload, {
          TTL: 300,
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
    return delivered;
  };

  const sendTest = async () => {
    if (!fs.existsSync(testFile)) return;
    const extra = readJson(testFile, {});
    try { fs.unlinkSync(testFile); } catch (_) {}
    const state = readJson(stateFile, {});
    const subs = Array.isArray(state.subscriptions) ? state.subscriptions : [];
    if (!subs.length) {
      console.warn("test push skipped: no subscription");
      return;
    }
    const delivered = await sendToSubs(subs, JSON.stringify({
      title: extra.title || "Alertas ativados",
      body: extra.body || "O MedTrack consegue te chamar com a tela desligada.",
      tag: "medtrack-test",
      vibrate: VIBRATE,
      silent: false,
      sound: "default",
    }));
    console.log("test push", delivered);
  };

  const sendDue = async () => {
    if (sending) return;
    const state = readJson(stateFile, {});
    if ((state.reminderMode || "notification") === "visual") return;
    const subs = uniqueSubs(state.subscriptions);
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
    const lastWave = Number(sent._wave) || 0;
    if (lastWave && now - lastWave < REALERT_MS) return;
    sending = true;
    try{
    const title = due.length > 1 ? `Hora de ${due.length} doses` : `Hora de tomar ${due[0].name}`;
    const body = due.map((d) => `${d.name}${d.dose ? " · " + d.dose : ""} · ${d.time}`).join("\n");
    const payload = JSON.stringify({
      title,
      body,
      tag: "medtrack-dose",
      vibrate: VIBRATE,
      silent: false,
      sound: "default",
      doses: due.map((d) => ({ id: d.id, time: d.time })),
    });
    let delivered = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, payload, {
          TTL: 300,
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
      sent._wave = now;
      due.forEach((d) => { sent[d.key] = now; });
      Object.keys(sent).forEach((k) => {
        if (k === "_wave") return;
        if (now - Number(sent[k] || 0) > 48 * 3600 * 1000) delete sent[k];
      });
      writeJson(sentFile, sent);
      console.log("push sent", delivered, due.map((d) => d.name).join(", "));
    } else {
      console.warn("push not delivered, will retry");
    }
    } finally {
      sending = false;
    }
  };

  const armNext = () => {
    if (nextTimer) clearTimeout(nextTimer);
    const state = readJson(stateFile, {});
    const taken = new Set(Array.isArray(state.taken) ? state.taken : []);
    const now = Date.now();
    const open = (Array.isArray(state.doses) ? state.doses : []).filter((d) => d && !taken.has(d.key));
    const dueNow = open.filter((d) => (Number(d.at) || 0) <= now + LEAD_MS);
    const next = open.map((d) => Number(d.at) || 0).filter((at) => at > now - LEAD_MS).sort((a, b) => a - b)[0];
    const lastWave = Number(readJson(sentFile, {})._wave) || 0;
    let wait = null;
    if (dueNow.length) wait = lastWave ? Math.max(0, lastWave + REALERT_MS - now) : 0;
    else if (next) wait = Math.max(0, next - now - LEAD_MS);
    if (wait == null) return;
    nextTimer = setTimeout(() => {
      sendDue().catch((err) => console.warn(err)).finally(armNext);
    }, wait);
  };

  setInterval(() => {
    sendTest().catch((err) => console.warn(err));
    sendDue().catch((err) => console.warn(err));
    armNext();
  }, 2000);
  sendTest().catch((err) => console.warn(err));
  sendDue().catch((err) => console.warn(err));
  armNext();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
