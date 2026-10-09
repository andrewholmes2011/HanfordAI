// Cloudflare Worker: login, AI chat, and teacher-visible history.
// Bindings needed: AI (Workers AI), CHATS (KV namespace)
// Secret needed:   ACCOUNTS  -> JSON like {"Joey_Smith":"ABC#123","TEACHER_JoJo_Siwa":"your-passcode"}
// Optional var:    ALLOWED_ORIGIN -> e.g. https://andrewholmes2011.github.io

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const SESSION_TTL = 60 * 60 * 12; // 12 hours
const MAX_MESSAGE = 2000;
const MAX_STORED = 300;           // messages kept per student
const CONTEXT_MESSAGES = 20;      // messages sent to the model

const STUDENT_PROMPT = `You are a patient tutor for students in any class.
Your job is to help the student learn, not to do the work for them.
- Explain concepts step by step and ask guiding questions.
- Do not hand over finished homework answers, full essays, or complete code solutions for assignments.
- If the student is stuck, give a hint, a worked example on a similar problem, or the next step only.
- Keep answers clear and friendly, and match the student's level.`;

const TEACHER_PROMPT = `You are a helpful assistant for a teacher. Answer directly and completely,
including full solutions, answer keys, and sample code when asked.`;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      const url = new URL(request.url);
      const route = `${request.method} ${url.pathname}`;

      if (route === "POST /api/login") return json(await login(request, env), cors);

      const user = await authenticate(request, env);
      if (!user) return json({ error: "Please sign in again." }, cors, 401);

      switch (route) {
        case "POST /api/chat":
          return json(await chat(request, env, user), cors);
        case "GET /api/history":
          return json(await history(url, env, user), cors, 200);
        case "GET /api/students":
          requireTeacher(user);
          return json({ students: await listStudents(env) }, cors);
        case "POST /api/logout":
          await env.CHATS.delete(`session:${user.token}`);
          return json({ ok: true }, cors);
        default:
          return json({ error: "Not found" }, cors, 404);
      }
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, cors, err.status);
      console.error(err);
      return json({ error: "Something went wrong on the server." }, cors, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(data, cors, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function getAccounts(env) {
  try { return JSON.parse(env.ACCOUNTS || "{}"); }
  catch { throw new HttpError(500, "ACCOUNTS secret is not valid JSON."); }
}

const isTeacher = (name) => name.startsWith("TEACHER_");

function requireTeacher(user) {
  if (user.role !== "teacher") throw new HttpError(403, "Teachers only.");
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function login(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const failKey = `fail:${ip}`;
  const fails = parseInt((await env.CHATS.get(failKey)) || "0", 10);
  if (fails >= 10) throw new HttpError(429, "Too many failed attempts. Try again in 15 minutes.");

  const { username = "", password = "" } = await request.json().catch(() => ({}));
  const name = String(username).trim();
  const accounts = getAccounts(env);
  const expected = Object.prototype.hasOwnProperty.call(accounts, name) ? accounts[name] : null;

  if (expected === null || !(await safeEqual(String(password), String(expected)))) {
    await env.CHATS.put(failKey, String(fails + 1), { expirationTtl: 900 });
    throw new HttpError(401, "Wrong username or password.");
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  const role = isTeacher(name) ? "teacher" : "student";
  await env.CHATS.put(`session:${token}`, JSON.stringify({ username: name, role }), {
    expirationTtl: SESSION_TTL,
  });
  return { token, username: name, role };
}

async function authenticate(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const raw = await env.CHATS.get(`session:${token}`);
  if (!raw) return null;
  return { ...JSON.parse(raw), token };
}

async function loadHistory(env, username) {
  const raw = await env.CHATS.get(`history:${username}`);
  return raw ? JSON.parse(raw) : [];
}

async function chat(request, env, user) {
  const { message = "" } = await request.json().catch(() => ({}));
  const text = String(message).trim();
  if (!text) throw new HttpError(400, "Type a message first.");
  if (text.length > MAX_MESSAGE) throw new HttpError(400, `Messages can be up to ${MAX_MESSAGE} characters.`);

  const history = await loadHistory(env, user.username);
  const recent = history.slice(-CONTEXT_MESSAGES).map(({ role, content }) => ({ role, content }));

  const messages = [
    { role: "system", content: user.role === "teacher" ? TEACHER_PROMPT : STUDENT_PROMPT },
    ...recent,
    { role: "user", content: text },
  ];

  const result = await env.AI.run(MODEL, { messages });
  const reply = (result.response || "").trim() || "I couldn't come up with an answer. Try rephrasing.";

  const now = Date.now();
  history.push({ role: "user", content: text, ts: now });
  history.push({ role: "assistant", content: reply, ts: Date.now() });
  await env.CHATS.put(`history:${user.username}`, JSON.stringify(history.slice(-MAX_STORED)));

  return { reply };
}

async function history(url, env, user) {
  const target = url.searchParams.get("user");
  if (target && target !== user.username) {
    requireTeacher(user);
    const accounts = getAccounts(env);
    if (!Object.prototype.hasOwnProperty.call(accounts, target)) {
      throw new HttpError(404, `No student named "${target}".`);
    }
    return { username: target, messages: await loadHistory(env, target) };
  }
  return { username: user.username, messages: await loadHistory(env, user.username) };
}

async function listStudents(env) {
  const names = Object.keys(getAccounts(env)).filter((n) => !isTeacher(n)).sort();
  return Promise.all(names.map(async (name) => {
    const msgs = await loadHistory(env, name);
    const last = msgs.length ? msgs[msgs.length - 1].ts : null;
    return { username: name, messageCount: msgs.length, lastActive: last };
  }));
}
