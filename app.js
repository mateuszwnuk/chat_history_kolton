// --- Konfiguracja Supabase (Twoje dane) ---
const SUPABASE_URL = "https://kiecgkztsycuwplpbtbs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZWNna3p0c3ljdXdwbHBidGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODc2NDAsImV4cCI6MjA3NDQ2MzY0MH0.WnzO0OqMur8eoXWB8ZjNBtHEVAK-rKPNftNATerYGsM";
const TABLE = "chatmemories";

// --- Inicjalizacja klienta Supabase ---
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Stan aplikacji ---
let sessions = {};          // { session_id: [wiadomości] }
let seenIds = new Set();    // do badge "Nowe"
let activeSid = null;
let autoTimer = null;
let realtimeChannel = null;

// --- Elementy DOM ---
const $sessionList   = document.getElementById("sessionList");
const $sessionSearch = document.getElementById("sessionSearch");
const $messages      = document.getElementById("messages");
const $status        = document.getElementById("status");

const $refresh       = document.getElementById("refresh");
const $intervalSelect= document.getElementById("intervalSelect");
const $autoToggle    = document.getElementById("autoToggle");
const $realtimeToggle= document.getElementById("realtimeToggle");
const $notifToggle   = document.getElementById("notifToggle");
const $soundToggle   = document.getElementById("soundToggle");
const $testNotify    = document.getElementById("testNotify");
const $typeFilter    = document.getElementById("typeFilter");
const $search        = document.getElementById("search");
const $convFlag      = document.getElementById("convFlag");
const $activeSidEl   = document.getElementById("activeSid");
const $convCounts    = document.getElementById("convCounts");
const $lastUpdated   = document.getElementById("lastUpdated");
const $newBadge      = document.getElementById("newBadge");
const $newCount      = document.getElementById("newCount");

// Pola konfiguracyjne (żeby były uzupełnione w UI)
const $urlInput   = document.getElementById("url");
const $keyInput   = document.getElementById("key");
const $tableInput = document.getElementById("table");

// --- Audio (naprawione) ---
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch {}
  }
  // Wymuś resume po pierwszym kliknięciu (wymogi przeglądarek)
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(()=>{});
  }
}
function playDing() {
  if (!$soundToggle.checked) return;
  ensureAudioCtx();
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);

  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.3);
}

// Wzbudź AudioContext przy pierwszym geście użytkownika
window.addEventListener("pointerdown", ensureAudioCtx, { once: true });

// --- Notyfikacje ---
async function ensureNotifPermission() {
  if (!$notifToggle.checked) return false;
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const r = await Notification.requestPermission();
  return r === "granted";
}
async function notifyNew(count) {
  if (!$notifToggle.checked) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") {
    const ok = await ensureNotifPermission();
    if (!ok) return;
  }
  const n = new Notification("Nowe wiadomości", { body: `Pojawiło się ${count} nowych wpisów.` });
  setTimeout(() => n.close(), 4000);
}
function bumpBadge(by = 1) {
  const next = (parseInt($newCount.textContent || "0", 10) || 0) + by;
  $newCount.textContent = String(next);
  $newBadge.style.display = "inline-flex";
}

// --- Wulgaryzmy (prosty detektor) ---
const BAD_WORDS = [
  "kurw","chuj","huj","kutas","pizd","pierdol","pierdziel","jeb","zajeb",
  "spierdal","wypierdal","zapierdal","odpierdol","przejeb","dojeb","ujeb",
  "wyjeb","najeb","zjeb","pojeb","skurwysyn","skurw","sukinsyn",
  "kurew","kurwis","cip","fiut","sra","gówno","gowno","dupa","ciul","pierd","suki"
];
const hasBad = (t="") => {
  const s = t.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return BAD_WORDS.some(w => s.includes(w));
};

// --- Pobieranie danych ---
async function fetchData() {
  const { data, error } = await client
    .from(TABLE)
    .select("id, session_id, message")
    .order("session_id", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;

  const grouped = {};
  for (const r of data || []) {
    (grouped[r.session_id] ||= []).push(r);
    seenIds.add(r.id);
  }
  sessions = grouped;
}

// --- Render listy wątków ---
function renderSessions() {
  const q = $sessionSearch.value.trim().toLowerCase();
  $sessionList.innerHTML = "";

  const sids = Object.keys(sessions).sort();
  for (const sid of sids) {
    if (q && !sid.toLowerCase().includes(q)) continue;
    const msgs = sessions[sid];
    const bad = msgs.some(m => hasBad(m.message?.content || ""));

    const item = document.createElement("div");
    item.className = "session-item" + (sid === activeSid ? " active" : "");
    item.innerHTML = `
      <span>${bad ? "<span class='session-bad' title='Wulgaryzmy'>⚠️</span>" : ""}<span class="session-id" title="${sid}">${sid}</span></span>
      <span class="badge" title="Liczba wiadomości">${msgs.length}</span>
    `;
    item.onclick = () => { activeSid = sid; renderConversation(); renderSessions(); };
    $sessionList.appendChild(item);
  }
}

// --- Render rozmowy ---
function renderConversation() {
  $messages.innerHTML = "";

  if (!activeSid || !sessions[activeSid]) {
    $activeSidEl.textContent = "—";
    $convCounts.textContent = "—";
    $convFlag.classList.add("hidden");
    $status.textContent = "Wybierz sesję z listy po lewej.";
    return;
  }

  const msgs = sessions[activeSid];
  $activeSidEl.textContent = activeSid;
  $convCounts.textContent = `wiadomości: ${msgs.length}`;

  const anyBad = msgs.some(m => hasBad(m.message?.content || ""));
  anyBad ? $convFlag.classList.remove("hidden") : $convFlag.classList.add("hidden");

  const q = $search.value.trim().toLowerCase();
  const typeF = $typeFilter.value.trim().toLowerCase();

  let shown = 0;
  for (const m of msgs) {
    const msg = m.message || {};
    const type = (msg.type || "unknown").toLowerCase();
    const content = (msg.content || "").toString();

    if (typeF && type !== typeF) continue;
    if (q && !content.toLowerCase().includes(q)) continue;

    const div = document.createElement("div");
    div.className = "msg" + (hasBad(content) ? " bad" : "");
    div.innerHTML = `
      <div class="head">
        <div class="type ${type}">${type}</div>
        <div class="id">id: ${m.id}</div>
      </div>
      <pre class="content"></pre>
    `;
    div.querySelector("pre.content").textContent = content;
    $messages.appendChild(div);
    shown++;
  }

  $status.innerHTML = shown
    ? `Poka­zano wiadomości: <b>${shown}</b> (łącznie w wątku: ${msgs.length}).`
    : "Brak wyników dla filtrów.";
}

// --- Odświeżenie danych + render ---
async function refreshData() {
  try {
    $status.textContent = "Ładowanie…";
    await fetchData();
    // ustaw aktywny wątek jeśli brak
    if (!activeSid) {
      const first = Object.keys(sessions).sort()[0];
      if (first) activeSid = first;
    }
    renderSessions();
    renderConversation();
    $lastUpdated.textContent = "Ostatnia aktualizacja: " + new Date().toLocaleTimeString();
    $status.textContent = "Gotowe.";
  } catch (e) {
    console.error(e);
    $status.textContent = "Błąd: " + e.message;
  }
}

// --- Realtime (INSERT) ---
function startRealtime() {
  if (realtimeChannel) client.removeChannel(realtimeChannel);
  realtimeChannel = client
    .channel("realtime:chatmemories")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: TABLE },
      payload => {
        const row = payload.new;
        (sessions[row.session_id] ||= []).push(row);

        // UI aktualizacja
        if (activeSid === row.session_id) renderConversation();
        renderSessions();

        // sygnał
        bumpBadge(1);
        playDing();
        notifyNew(1);
      }
    )
    .subscribe(status => {
      if (status === "SUBSCRIBED") $status.textContent = "Realtime aktywne";
    });
}
function stopRealtime() {
  if (realtimeChannel) {
    client.removeChannel(realtimeChannel);
    realtimeChannel = null;
    $status.textContent = "Realtime wyłączone";
  }
}

// --- Auto-odświeżanie (domyślnie 10 s) ---
function startAutoRefresh() {
  clearInterval(autoTimer);
  const sec = parseInt($intervalSelect.value, 10) || 10;
  autoTimer = setInterval(refreshData, sec * 1000);
  $status.textContent = `Auto-odświeżanie aktywne (co ${sec}s)`;
}
function stopAutoRefresh() {
  clearInterval(autoTimer);
  autoTimer = null;
}

// --- Zdarzenia UI ---
$refresh.onclick = () => { ensureAudioCtx(); refreshData(); };
$search.oninput = renderConversation;
$typeFilter.onchange = renderConversation;
$sessionSearch.oninput = renderSessions;

$testNotify.onclick = async () => {
  ensureAudioCtx();
  playDing();
  await ensureNotifPermission();
  notifyNew(1);
};

$realtimeToggle.onchange = (e) => {
  if (e.target.checked) { stopAutoRefresh(); startRealtime(); }
  else { stopRealtime(); }
};

$autoToggle.onchange = (e) => {
  if (e.target.checked) startAutoRefresh();
  else stopAutoRefresh();
};

$intervalSelect.onchange = () => {
  if ($autoToggle.checked) startAutoRefresh();
};

// --- Start aplikacji ---
window.addEventListener("load", async () => {
  // 1) Uzupełnij pola w UI, żeby nie były puste
  if ($urlInput)   $urlInput.value   = SUPABASE_URL;
  if ($keyInput)   $keyInput.value   = SUPABASE_KEY;
  if ($tableInput) $tableInput.value = TABLE;

  // 2) Domyślnie ustaw auto-refresh na 10 s (i uruchom, jeśli włączony)
  if ($intervalSelect) $intervalSelect.value = "10";
  if ($autoToggle && $autoToggle.checked) startAutoRefresh();

  // 3) Załaduj dane
  await refreshData();
});
