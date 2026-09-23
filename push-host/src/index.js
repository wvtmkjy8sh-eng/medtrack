import { buildPushPayload } from "@block65/webcrypto-web-push";

const REALERT_MS = 60 * 1000;
const LEAD_MS = 800;
const VIBRATE = [400, 120, 400, 120, 400, 180, 800, 180, 400];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Accept",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function emptyState() {
  return {
    updatedAt: new Date().toISOString(),
    updatedAtMs: 0,
    subscriptions: [],
    doses: [],
    taken: [],
    meds: [],
    history: [],
    settings: {},
    reminderMode: "notification",
    sent: {},
  };
}

async function readState(env) {
  const raw = await env.STATE.get("app");
  if (!raw) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch (_) {
    return emptyState();
  }
}

async function writeState(env, state) {
  await env.STATE.put("app", JSON.stringify(state));
}

function vapidFrom(env) {
  return {
    subject: env.VAPID_SUBJECT || "mailto:medtrack@icloud.com",
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
}

function uniqueSubs(subs) {
  const seen = new Set();
  return (Array.isArray(subs) ? subs : []).filter((sub) => {
    if (!sub || !sub.endpoint || !sub.keys || seen.has(sub.endpoint)) return false;
    seen.add(sub.endpoint);
    return true;
  });
}

async function deliver(env, subs, payloadObj) {
  const vapid = vapidFrom(env);
  const kept = [];
  let delivered = 0;
  for (const sub of uniqueSubs(subs)) {
    try {
      const request = await buildPushPayload(
        {
          data: JSON.stringify(payloadObj),
          options: { ttl: 300, urgency: "high" },
        },
        {
          endpoint: sub.endpoint,
          expirationTime: sub.expirationTime || null,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        },
        vapid
      );
      const res = await fetch(sub.endpoint, request);
      if (res.status === 404 || res.status === 410) continue;
      if (res.ok) delivered += 1;
      kept.push(sub);
    } catch (_) {
      kept.push(sub);
    }
  }
  return { delivered, kept };
}

async function sendDue(env) {
  const state = await readState(env);
  if ((state.reminderMode || "notification") === "visual") return;
  const subs = uniqueSubs(state.subscriptions);
  const taken = new Set(Array.isArray(state.taken) ? state.taken : []);
  const now = Date.now();
  const due = (Array.isArray(state.doses) ? state.doses : []).filter((dose) => {
    if (!dose || taken.has(dose.key)) return false;
    const at = Number(dose.at) || 0;
    return at && now >= at - LEAD_MS;
  });
  if (!subs.length || !due.length) return;
  const sent = state.sent && typeof state.sent === "object" ? state.sent : {};
  const lastWave = Number(sent._wave) || 0;
  if (lastWave && now - lastWave < REALERT_MS) return;
  const title = due.length > 1 ? `Hora de ${due.length} doses` : `Hora de tomar ${due[0].name}`;
  const body = due.map((dose) => `${dose.name}${dose.dose ? " · " + dose.dose : ""} · ${dose.time}`).join("\n");
  const result = await deliver(env, subs, {
    title,
    body,
    tag: "medtrack-dose",
    vibrate: VIBRATE,
    silent: false,
    doses: due.map((dose) => ({ id: dose.id, time: dose.time })),
  });
  state.subscriptions = result.kept;
  if (result.delivered) {
    sent._wave = now;
    due.forEach((dose) => { sent[dose.key] = now; });
    Object.keys(sent).forEach((key) => {
      if (key !== "_wave" && now - Number(sent[key] || 0) > 48 * 3600 * 1000) delete sent[key];
    });
    state.sent = sent;
  }
  await writeState(env, state);
}

async function sendTest(env, extra) {
  const state = await readState(env);
  const result = await deliver(env, state.subscriptions, {
    title: (extra && extra.title) || "Alertas ativados",
    body: (extra && extra.body) || "O MedTrack consegue te chamar com a tela desligada.",
    tag: "medtrack-test",
    vibrate: VIBRATE,
    silent: false,
  });
  state.subscriptions = result.kept;
  await writeState(env, state);
  return result.delivered;
}

function applyIncoming(current, incoming) {
  let subs = Array.isArray(current.subscriptions) ? current.subscriptions : [];
  if (incoming.subscription && incoming.subscription.endpoint) {
    if (incoming.replaceSubscriptions) subs = [incoming.subscription];
    else {
      subs = subs.filter((sub) => (sub && sub.endpoint) !== incoming.subscription.endpoint);
      subs.push(incoming.subscription);
    }
  }
  if (Array.isArray(incoming.subscriptions)) subs = incoming.subscriptions;
  return {
    updatedAt: new Date().toISOString(),
    updatedAtMs: Number(incoming.updatedAtMs) || Date.now(),
    subscriptions: subs,
    doses: Array.isArray(incoming.doses) ? incoming.doses : (current.doses || []),
    taken: Array.isArray(incoming.taken) ? incoming.taken : (current.taken || []),
    meds: Array.isArray(incoming.meds) ? incoming.meds : (current.meds || []),
    history: Array.isArray(incoming.history) ? incoming.history : (current.history || []),
    settings: incoming.settings && typeof incoming.settings === "object" ? incoming.settings : (current.settings || {}),
    reminderMode: incoming.reminderMode || current.reminderMode || "notification",
    sent: current.sent || {},
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return json({ publicKey: "", ok: false }, 500);
    const url = new URL(request.url);
    if (url.searchParams.has("vapid")) return json({ publicKey: env.VAPID_PUBLIC_KEY });
    if (request.method === "GET") {
      const state = await readState(env);
      delete state.sent;
      return json(state);
    }
    if (request.method !== "POST") return json({ ok: false }, 405);
    let incoming = null;
    try { incoming = await request.json(); } catch (_) { incoming = null; }
    if (!incoming || typeof incoming !== "object") return json({ ok: false }, 400);
    const current = await readState(env);
    const next = applyIncoming(current, incoming);
    await writeState(env, next);
    if (incoming.test || incoming.urgent) {
      const extra = incoming.urgent && typeof incoming.urgent === "object" ? incoming.urgent : null;
      ctx.waitUntil(sendTest(env, extra));
    }
    ctx.waitUntil(sendDue(env));
    return json({ ok: true, subscriptions: uniqueSubs(next.subscriptions).length, test: !!incoming.test });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDue(env));
  },
};
