// Supabase config
const SUPABASE_URL = "https://kiecgkztsycuwplpbtbs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZWNna3p0c3ljdXdwbHBidGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODc2NDAsImV4cCI6MjA3NDQ2MzY0MH0.WnzO0OqMur8eoXWB8ZjNBtHEVAK-rKPNftNATerYGsM";
const TABLE = "chatmemories";

// Initialize
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let sessions = {}, seenIds = new Set(), activeSid = null;
let autoTimer = null, realtimeChannel = null;

// Elements
const $sessionList = document.getElementById("sessionList");
const $sessionSearch = document.getElementById("sessionSearch");
const $messages = document.getElementById("messages");
const $status = document.getElementById("status");
const $refresh = document.getElementById("refresh");
const $intervalSelect = document.getElementById("intervalSelect");
const $autoToggle = document.getElementById("autoToggle");
const $realtimeToggle = document.getElementById("realtimeToggle");
const $notifToggle = document.getElementById("notifToggle");
const $soundToggle = document.getElementById("soundToggle");
const $testNotify = document.getElementById("testNotify");
const $typeFilter = document.getElementById("typeFilter");
const $search = document.getElementById("search");
const $convFlag = document.getElementById("convFlag");
const $activeSid = document.getElementById("activeSid");
const $convCounts = document.getElementById("convCounts");
const $lastUpdated = document.getElementById("lastUpdated");
const $newBadge = document.getElementById("newBadge");
const $newCount = document.getElementById("newCount");

// Profanity check
const BAD_WORDS = ["kurw", "chuj", "huj", "pizd", "jeb", "spierdal", "pierdol", "zajeb", "sra", "gówno", "dupa", "fiut", "suki"];
const hasBad = text => BAD_WORDS.some(b => text.toLowerCase().includes(b));

// Fetch messages
async function fetchData() {
  const { data, error } = await client.from(TABLE).select("*").order("session_id").order("id");
  if (error) throw error;
  const grouped = {};
  for (const r of data) {
    (grouped[r.session_id] ||= []).push(r);
    seenIds.add(r.id);
  }
  sessions = grouped;
}

// Render session list
function renderSessions() {
  const q = $sessionSearch.value.toLowerCase();
  $sessionList.innerHTML = "";
  for (const [sid, msgs] of Object.entries(sessions)) {
    if (q && !sid.toLowerCase().includes(q)) continue;
    const item = document.createElement("div");
    item.className = "session-item" + (sid === activeSid ? " active" : "");
    const bad = msgs.some(m => hasBad(m.message?.content || ""));
    item.innerHTML = `${bad ? "<span class='session-bad'>⚠️</span>" : ""}<span class="session-id">${sid}</span><span class="badge">${msgs.length}</span>`;
    item.onclick = () => { activeSid = sid; renderConversation(); renderSessions(); };
    $sessionList.appendChild(item);
  }
}

// Render conversation
function renderConversation() {
  $messages.innerHTML = "";
  if (!activeSid || !sessions[activeSid]) {
    $activeSid.textContent = "—";
    $convCounts.textContent = "—";
    $convFlag.classList.add("hidden");
    $status.textContent = "Wybierz sesję z listy.";
    return;
  }
  const msgs = sessions[activeSid];
  $activeSid.textContent = activeSid;
  $convCounts.textContent = `wiadomości: ${msgs.length}`;
  const hasBadWords = msgs.some(m => hasBad(m.message?.content || ""));
  hasBadWords ? $convFlag.classList.remove("hidden") : $convFlag.classList.add("hidden");

  const q = $search.value.toLowerCase();
  const typeF = $typeFilter.value.toLowerCase();

  for (const m of msgs) {
    const msg = m.message || {};
    const type = msg.type || "unknown";
    const content = msg.content || "";
    if (typeF && type !== typeF) continue;
    if (q && !content.toLowerCase().includes(q)) continue;
    const div = document.createElement("div");
    div.className = "msg";
    div.innerHTML = `
      <div class="head">
        <div class="type ${type}">${type}</div>
        <div class="id">id: ${m.id}</div>
      </div>
      <pre class="content">${content}</pre>`;
    $messages.appendChild(div);
  }
}

// Auto refresh
async function refreshData() {
  try {
    $status.textContent = "Ładowanie…";
    await fetchData();
    renderSessions();
    renderConversation();
    $lastUpdated.textContent = "Ostatnia aktualizacja: " + new Date().toLocaleTimeString();
    $status.textContent = "Gotowe.";
  } catch (e) {
    $status.textContent = "Błąd: " + e.message;
  }
}

// Realtime
function startRealtime() {
  if (realtimeChannel) client.removeChannel(realtimeChannel);
  realtimeChannel = client.channel("realtime:chatmemories").on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: TABLE },
    payload => {
      const row = payload.new;
      if (!sessions[row.session_id]) sessions[row.session_id] = [];
      sessions[row.session_id].push(row);
      renderSessions();
      if (activeSid === row.session_id) renderConversation();
      newMessageAlert();
    }
  ).subscribe();
}

// Notifications
function newMessageAlert() {
  const count = parseInt($newCount.textContent) + 1;
  $newCount.textContent = count;
  $newBadge.style.display = "inline-flex";
  if ($soundToggle.checked) new AudioContext().createOscillator().start();
  if ($notifToggle.checked && Notification.permission === "granted") {
    new Notification("Nowa wiadomość", { body: `Nowe wpisy: ${count}` });
  }
}

// Events
$refresh.onclick = refreshData;
$search.oninput = renderConversation;
$typeFilter.onchange = renderConversation;
$sessionSearch.oninput = renderSessions;
$testNotify.onclick = () => {
  Notification.requestPermission().then(() => {
    new Notification("Test powiadomienia", { body: "Działa!" });
  });
};
$realtimeToggle.onchange = e => e.target.checked ? startRealtime() : client.removeChannel(realtimeChannel);
$autoToggle.onchange = e => {
  if (e.target.checked) {
    const sec = parseInt($intervalSelect.value) || 60;
    autoTimer = setInterval(refreshData, sec * 1000);
  } else {
    clearInterval(autoTimer);
  }
};
$intervalSelect.onchange = () => {
  clearInterval(autoTimer);
  if ($autoToggle.checked) {
    const sec = parseInt($intervalSelect.value) || 60;
    autoTimer = setInterval(refreshData, sec * 1000);
  }
};

// Start
window.addEventListener("load", async () => {
  await refreshData();
  if ($autoToggle.checked) {
    const sec = parseInt($intervalSelect.value) || 60;
    autoTimer = setInterval(refreshData, sec * 1000);
  }
});
