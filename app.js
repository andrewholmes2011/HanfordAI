// Set this to your Cloudflare Worker URL (no trailing slash).
const API = "https://chatgpt4students.andrewsarmy-cf.workers.dev";

const $ = (id) => document.getElementById(id);
const state = { token: null, username: null, role: null, busy: false };

/* ---------- API helper ---------- */
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { signOut(); throw new Error("Your session ended. Please sign in again."); }
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

/* ---------- Sign in / out ---------- */
function showApp() {
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  $("who").textContent = state.role === "teacher" ? `${state.username} (teacher)` : state.username;
  $("tab-teacher").hidden = state.role !== "teacher";
  $("teacher-hint").hidden = state.role !== "teacher";
  showTab("chat");
  loadOwnHistory();
}

function signOut() {
  sessionStorage.removeItem("session");
  Object.assign(state, { token: null, username: null, role: null });
  $("app-view").hidden = true;
  $("login-view").hidden = false;
  $("messages").innerHTML = "";
  $("password").value = "";
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("login-error");
  err.hidden = true;
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: $("username").value, password: $("password").value }),
    });
    Object.assign(state, data);
    sessionStorage.setItem("session", JSON.stringify(data));
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$("logout").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  signOut();
});

/* ---------- Tabs ---------- */
function showTab(name) {
  const chat = name === "chat";
  $("chat-panel").hidden = !chat;
  $("teacher-panel").hidden = chat;
  $("tab-chat").classList.toggle("active", chat);
  $("tab-teacher").classList.toggle("active", !chat);
  if (!chat) loadRoster();
}
$("tab-chat").addEventListener("click", () => showTab("chat"));
$("tab-teacher").addEventListener("click", () => showTab("teacher"));

/* ---------- Rendering ---------- */
function addMessage(container, role, content, ts) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = content;
  if (ts) {
    const t = document.createElement("time");
    t.textContent = new Date(ts).toLocaleString();
    div.appendChild(t);
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function loadOwnHistory() {
  const box = $("messages");
  box.innerHTML = "";
  try {
    const data = await api("/api/history");
    if (!data.messages.length) addMessage(box, "system", "Ask anything about your class. I'll help you work it out.");
    data.messages.forEach((m) => addMessage(box, m.role, m.content));
  } catch (ex) { addMessage(box, "system", ex.message); }
}

/* ---------- Chat ---------- */
const input = $("chat-input");
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("chat-form").requestSubmit(); }
});

$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.busy) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = ""; input.style.height = "auto";

  // Teacher command: ?check <student name>
  if (text.toLowerCase().startsWith("?check")) {
    if (state.role !== "teacher") {
      addMessage($("messages"), "system", "The ?check command is for teachers only.");
      return;
    }
    const name = text.slice(6).trim().replace(/\s+/g, "_");
    if (!name) { addMessage($("messages"), "system", "Add a student name, like ?check Joey_Smith"); return; }
    showTab("teacher");
    openStudent(name);
    return;
  }

  const box = $("messages");
  addMessage(box, "user", text);
  const pending = addMessage(box, "assistant", "Thinking…");
  state.busy = true; $("send").disabled = true;
  try {
    const data = await api("/api/chat", { method: "POST", body: JSON.stringify({ message: text }) });
    pending.textContent = data.reply;
  } catch (ex) {
    pending.className = "msg system";
    pending.textContent = ex.message;
  } finally {
    state.busy = false; $("send").disabled = false; input.focus();
    box.scrollTop = box.scrollHeight;
  }
});

/* ---------- Teacher view ---------- */
async function loadRoster() {
  const list = $("student-list");
  list.innerHTML = "";
  try {
    const { students } = await api("/api/students");
    if (!students.length) list.innerHTML = "<li>No student accounts yet.</li>";
    students.forEach((s) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "student"; btn.dataset.name = s.username;
      btn.textContent = s.username;
      const small = document.createElement("small");
      small.textContent = s.messageCount
        ? `${s.messageCount} messages · ${new Date(s.lastActive).toLocaleDateString()}`
        : "No chats yet";
      btn.appendChild(small);
      btn.addEventListener("click", () => openStudent(s.username));
      li.appendChild(btn);
      list.appendChild(li);
    });
  } catch (ex) { list.innerHTML = `<li class="error">${ex.message}</li>`; }
}

async function openStudent(name) {
  document.querySelectorAll(".student").forEach((b) => b.classList.toggle("active", b.dataset.name === name));
  $("viewer-title").textContent = `Chats: ${name}`;
  const box = $("viewer-messages");
  box.innerHTML = "";
  try {
    const data = await api(`/api/history?user=${encodeURIComponent(name)}`);
    if (!data.messages.length) addMessage(box, "system", "This student hasn't chatted yet.");
    data.messages.forEach((m) => addMessage(box, m.role, m.content, m.ts));
  } catch (ex) { addMessage(box, "system", ex.message); }
}

/* ---------- Resume session on reload ---------- */
try {
  const saved = JSON.parse(sessionStorage.getItem("session") || "null");
  if (saved && saved.token) { Object.assign(state, saved); showApp(); }
} catch {}
