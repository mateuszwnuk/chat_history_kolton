// --- Konfiguracja Supabase ---
const SUPABASE_URL = "https://kiecgkztsycuwplpbtbs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZWNna3p0c3ljdXdwbHBidGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODc2NDAsImV4cCI6MjA3NDQ2MzY0MH0.WnzO0OqMur8eoXWB8ZjNBtHEVAK-rKPNftNATerYGsM";
const TABLE = "chatmemories";
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Stan ---
let sessions = {};          // { sid: [rows] }
let rawRows = [];           // płaska lista (do statystyk)
let seenIds = new Set();
let activeSid = null;
let autoTimer = null;
let realtimeChannel = null;
let chart = null;           // Chart.js instance
let createdAtAvailable = true;

// --- DOM ---
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
const $urlInput      = document.getElementById("url");
const $keyInput      = document.getElementById("key");
const $tableInput    = document.getElementById("table");
const $autoscrollToggle = document.getElementById("autoscrollToggle");
const $progressBar   = document.getElementById("progressBar");
const $jumpBtn       = document.getElementById("jumpToBottom");

// Nawigacja widoków
const $tabs = [...document.querySelectorAll('.tab[data-view]')];
const $historyView = document.getElementById('historyView');
const $statsView = document.getElementById('statsView');

// KPI pola
const $kpiTotal = document.getElementById('kpiTotal');
const $kpiThreads = document.getElementById('kpiThreads');
const $kpiHuman = document.getElementById('kpiHuman');
const $kpiAI = document.getElementById('kpiAI');
const $kpiAvg = document.getElementById('kpiAvg');
const $statsNote = document.getElementById('statsNote');
const $statsChartCanvas = document.getElementById('statsChart');

// --- Pasek postępu ---
let progressTimer=null;
function progressStart(){ if($progressBar){ $progressBar.classList.add('active'); if(progressTimer) clearTimeout(progressTimer); } }
function progressStop(){ if($progressBar){ progressTimer=setTimeout(()=> $progressBar.classList.remove('active'), 180); } }

// --- Audio ---
let audioCtx = null;
function ensureAudioCtx(){
  if(!audioCtx){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch{} }
  if(audioCtx && audioCtx.state==='suspended'){ audioCtx.resume().catch(()=>{}); }
}
function playDing(){
  if(!$soundToggle.checked) return;
  ensureAudioCtx(); if(!audioCtx) return;
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type='sine'; o.frequency.setValueAtTime(880, audioCtx.currentTime);
  g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+0.26);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime+0.3);
}
window.addEventListener('pointerdown', ensureAudioCtx, {once:true});

// --- Powiadomienia ---
async function ensureNotifPermission(){
  if(!$notifToggle.checked) return false;
  if(!('Notification' in window)) return false;
  if(Notification.permission==='granted') return true;
  if(Notification.permission==='denied') return false;
  const r=await Notification.requestPermission(); return r==='granted';
}
async function notifyNew(count){
  if(!$notifToggle.checked) return;
  if(!('Notification' in window)) return;
  if(Notification.permission!=='granted'){ const ok=await ensureNotifPermission(); if(!ok) return; }
  const n=new Notification('Nowe wiadomości', { body:`Pojawiło się ${count} nowych wpisów.` });
  setTimeout(()=>n.close(),4000);
}
function bumpBadge(by=1){
  const next=(parseInt($newCount.textContent||'0',10)||0)+by;
  $newCount.textContent=String(next);
  $newBadge.style.display='inline-flex';
}

// --- Wulgaryzmy ---
const BAD_WORDS = [
  "kurw","chuj","huj","kutas","pizd","pierdol","pierdziel","jeb","zajeb",
  "spierdal","wypierdal","zapierdal","odpierdol","przejeb","dojeb","ujeb",
  "wyjeb","najeb","zjeb","pojeb","skurwysyn","skurw","sukinsyn",
  "kurew","kurwis","cip","fiut","sra","gówno","gowno","dupa","ciul","pierd","suki"
];
const hasBad = (t="")=>{
  const s=t.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
  return BAD_WORDS.some(w=>s.includes(w));
};

// --- Auto-scroll helpers ---
function isNearBottom(threshold=120){
  const scrollY = window.scrollY || window.pageYOffset;
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  const docHeight = Math.max(
    document.body.scrollHeight, document.documentElement.scrollHeight,
    document.body.offsetHeight, document.documentElement.offsetHeight,
    document.body.clientHeight, document.documentElement.clientHeight
  );
  return scrollY + viewport >= docHeight - threshold;
}
function scrollToBottom(smooth=true){
  if($messages && $messages.scrollHeight > $messages.clientHeight){
    $messages.scrollTop = $messages.scrollHeight;
  }
  window.requestAnimationFrame(()=>{
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
}
function updateJumpButtonVisibility(){
  const $jumpBtn = document.getElementById("jumpToBottom");
  if(!$jumpBtn) return;
  const enabled = !$autoscrollToggle.checked;
  const near = isNearBottom();
  $jumpBtn.classList.toggle('hidden', near || !enabled);
}
let scrollTick=false;
window.addEventListener('scroll', ()=>{
  if(scrollTick) return; scrollTick=true;
  requestAnimationFrame(()=>{ updateJumpButtonVisibility(); scrollTick=false; });
});
document.getElementById('jumpToBottom')?.addEventListener('click', ()=>{
  scrollToBottom(true);
  updateJumpButtonVisibility();
});

// --- Pobieranie danych (z created_at jeśli dostępne) ---
async function fetchData(){
  createdAtAvailable = true;
  let data=null, error=null;
  // Próba z created_at
  ({data, error} = await client
    .from(TABLE)
    .select("id, session_id, message, created_at")
    .order("session_id",{ascending:true})
    .order("id",{ascending:true}));
  if(error){
    // fallback bez created_at
    createdAtAvailable = false;
    ({data, error} = await client
      .from(TABLE)
      .select("id, session_id, message")
      .order("session_id",{ascending:true})
      .order("id",{ascending:true}));
    if(error) throw error;
  }

  rawRows = data || [];

  const grouped={};
  for(const r of rawRows){
    (grouped[r.session_id]??=[]).push(r);
    seenIds.add(r.id);
  }
  sessions=grouped;
}

// --- Render lewego panelu ---
function renderSessions(){
  const q=$sessionSearch.value.trim().toLowerCase();
  $sessionList.innerHTML='';
  const sids=Object.keys(sessions).sort();
  for(const sid of sids){
    if(q && !sid.toLowerCase().includes(q)) continue;
    const msgs=sessions[sid];
    const bad = msgs.some(m=>hasBad(m.message?.content||""));
    const el=document.createElement('div');
    el.className='session-item'+(sid===activeSid?' active':'');
    el.innerHTML=`
      <span>${bad?`<span class="session-bad" title="Wulgaryzmy">⚠️</span>`:''}<span class="session-id" title="${sid}">${sid}</span></span>
      <span class="badge" title="Liczba wiadomości">${msgs.length}</span>
    `;
    el.onclick=()=>{ activeSid=sid; renderConversation(); renderSessions(); if($autoscrollToggle?.checked) scrollToBottom(false); };
    $sessionList.appendChild(el);
  }
}

// --- Render rozmowy (historia) ---
function renderConversation(){
  $messages.innerHTML='';
  if(!activeSid || !sessions[activeSid]){
    $activeSidEl.textContent='—';
    $convCounts.textContent='—';
    $convFlag.classList.add('hidden');
    $status.textContent='Wybierz sesję z listy po lewej.';
    updateJumpButtonVisibility();
    return;
  }

  const msgs=sessions[activeSid];
  $activeSidEl.textContent=activeSid;
  $convCounts.textContent=`wiadomości: ${msgs.length}`;

  const anyBad=msgs.some(m=>hasBad(m.message?.content||""));
  anyBad ? $convFlag.classList.remove('hidden') : $convFlag.classList.add('hidden');

  const q=$search.value.trim().toLowerCase();
  const tf=($typeFilter.value||'').toLowerCase();

  let shown=0;
  for(const m of msgs){
    const msg=m.message||{};
    const type=(msg.type||'unknown').toLowerCase();
    const content=(msg.content||'').toString();

    if(tf && type!==tf) continue;
    if(q && !content.toLowerCase().includes(q)) continue;

    const div=document.createElement('div');
    div.className='msg'+(hasBad(content)?' bad':'');
    div.innerHTML=`
      <div class="head">
        <div class="type ${type}">${type}</div>
        <div class="id">id: ${m.id}</div>
      </div>
      <pre class="content"></pre>
    `;
    div.querySelector('pre.content').textContent=content;
    $messages.appendChild(div);
    shown++;
  }

  $status.innerHTML = shown
    ? `Poka­zano wiadomości: <b>${shown}</b> (łącznie w wątku: ${msgs.length}).`
    : 'Brak wyników dla filtrów.';

  if($autoscrollToggle?.checked){
    if(isNearBottom()) scrollToBottom(true);
    document.getElementById('jumpToBottom')?.classList.add('hidden');
  }else{
    updateJumpButtonVisibility();
  }
}

// --- Statystyki: KPI + wykres ---
function computeStats(){
  const total = rawRows.length;
  const threads = Object.keys(sessions).length;

  let human=0, ai=0;
  for(const r of rawRows){
    const t=(r.message?.type||'').toLowerCase();
    if(t==='human') human++;
    else if(t==='ai') ai++;
  }
  const avg = threads ? (total/threads) : 0;

  // Time series (dzień po dniu, ostatnie 30 dni)
  let series = null;
  let note = "Źródło: kolumna created_at";

  if(createdAtAvailable){
    const counts = new Map();
    for(const r of rawRows){
      const dt = new Date(r.created_at);
      if (isNaN(dt)) continue;
      const key = dt.toISOString().slice(0,10); // YYYY-MM-DD
      counts.set(key, (counts.get(key)||0)+1);
    }
    // zbuduj oś czasu 30 dni wstecz
    const days = [];
    const today = new Date(); today.setHours(0,0,0,0);
    for(let i=29;i>=0;i--){
      const d=new Date(today); d.setDate(today.getDate()-i);
      const key=d.toISOString().slice(0,10);
      days.push(key);
    }
    series = {
      labels: days,
      values: days.map(d=>counts.get(d)||0)
    };
  }else{
    note = "Brak kolumny created_at – wykres ograniczony.";
  }

  return { total, threads, human, ai, avg, series, note };
}

function renderStats(){
  const { total, threads, human, ai, avg, series, note } = computeStats();

  $kpiTotal.textContent   = total.toString();
  $kpiThreads.textContent = threads.toString();
  $kpiHuman.textContent   = human.toString();
  $kpiAI.textContent      = ai.toString();
  $kpiAvg.textContent     = avg ? avg.toFixed(1) : "0.0";
  $statsNote.textContent  = note;

  if(!series){
    // brak wykresu
    if(chart){ chart.destroy(); chart=null; }
    if($statsChartCanvas){
      const ctx = $statsChartCanvas.getContext('2d');
      ctx.clearRect(0,0,$statsChartCanvas.width,$statsChartCanvas.height);
    }
    return;
  }

  // Render / update Chart.js
  const data = {
    labels: series.labels,
    datasets: [{
      label: 'Wiadomości / dzień',
      data: series.values,
      tension: 0.25,
      fill: true
    }]
  };
  const options = {
  responsive: true,
  maintainAspectRatio: false,    // <- ważne przy stałej wysokości kontenera
  animation: false,              // mniej migotania przy częstych odświeżeniach
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { maxTicksLimit: 8 } },
    y: { beginAtZero: true, precision: 0 }
  }
};
  if(chart){ chart.data = data; chart.options = options; chart.update(); }
  else { chart = new Chart($statsChartCanvas.getContext('2d'), { type: 'line', data, options }); }
}

// --- Refresh całości ---
async function refreshData(){
  const wasNear = isNearBottom();
  try{
    progressStart();
    $status.textContent='Ładowanie…';
    await fetchData();

    if(!activeSid){
      const first=Object.keys(sessions).sort()[0];
      if(first) activeSid=first;
    }
    renderSessions();
    renderConversation();
    renderStats();

    $lastUpdated.textContent='Ostatnia aktualizacja: '+new Date().toLocaleTimeString();
    $status.textContent='Gotowe.';
    if($autoscrollToggle?.checked && wasNear) scrollToBottom(false);
    else updateJumpButtonVisibility();
  }catch(e){
    console.error(e);
    $status.textContent='Błąd: '+e.message;
  }finally{
    progressStop();
  }
}

// --- Realtime ---
function startRealtime(){
  if(realtimeChannel) client.removeChannel(realtimeChannel);
  realtimeChannel = client
    .channel('realtime:chatmemories')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:TABLE}, payload=>{
      const row=payload.new;
      rawRows.push(row);
      (sessions[row.session_id]??=[]).push(row);

      if(activeSid===row.session_id) renderConversation();
      renderSessions();
      renderStats();

      bumpBadge(1); playDing(); notifyNew(1);

      if($autoscrollToggle?.checked){
        scrollToBottom(true);
      }else{
        updateJumpButtonVisibility();
        const btn=document.getElementById('jumpToBottom');
        if(btn && !btn.classList.contains('hidden')){
          btn.classList.remove('pulse'); void btn.offsetWidth; btn.classList.add('pulse');
        }
      }
    })
    .subscribe(status=>{
      if(status==='SUBSCRIBED') $status.textContent='Realtime aktywne';
    });
}
function stopRealtime(){
  if(realtimeChannel){
    client.removeChannel(realtimeChannel);
    realtimeChannel=null;
    $status.textContent='Realtime wyłączone';
  }
}

// --- Auto-refresh ---
function startAutoRefresh(){
  clearInterval(autoTimer);
  const sec=parseInt($intervalSelect.value,10)||10;
  autoTimer=setInterval(refreshData, sec*1000);
  $status.textContent=`Auto-odświeżanie aktywne (co ${sec}s)`;
}
function stopAutoRefresh(){ clearInterval(autoTimer); autoTimer=null; }

// --- Zdarzenia UI ---
document.querySelectorAll('.tab[data-view]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const view = btn.dataset.view;
    document.querySelectorAll('.tab[data-view]').forEach(b=>b.classList.toggle('active', b===btn));
    if(view==='stats'){
      $historyView.classList.add('hidden');
      $statsView.classList.remove('hidden');
      renderStats();
    }else{
      $statsView.classList.add('hidden');
      $historyView.classList.remove('hidden');
    }
  });
});

$refresh.onclick = ()=>{ ensureAudioCtx(); refreshData(); };
$search.oninput = renderConversation;
$typeFilter.onchange = renderConversation;
$sessionSearch.oninput = renderSessions;

$testNotify.onclick = async ()=>{ ensureAudioCtx(); playDing(); await ensureNotifPermission(); notifyNew(1); };

$realtimeToggle.onchange = e=>{
  if(e.target.checked){ stopAutoRefresh(); startRealtime(); }
  else{ stopRealtime(); }
};
$autoToggle.onchange = e=>{
  if(e.target.checked) startAutoRefresh();
  else stopAutoRefresh();
};
$intervalSelect.onchange = ()=>{ if($autoToggle.checked) startAutoRefresh(); };

// zapamiętywanie auto-scroll
(function initAutoscrollPref(){
  const saved = localStorage.getItem('autoscroll');
  const $autoscrollToggle = document.getElementById("autoscrollToggle");
  if(saved!==null && $autoscrollToggle) $autoscrollToggle.checked = saved==='1';
  $autoscrollToggle?.addEventListener('change', ()=>{
    localStorage.setItem('autoscroll', $autoscrollToggle.checked?'1':'0');
    updateJumpButtonVisibility();
  });
})();

// --- Start ---
window.addEventListener('load', async ()=>{
  // uzupełnij pola połączenia (dla czytelności w UI)
  document.getElementById("url").value   = SUPABASE_URL;
  document.getElementById("key").value   = SUPABASE_KEY;
  document.getElementById("table").value = TABLE;

  // domyślnie 10s i auto-refresh ON
  $intervalSelect.value='10';
  if($autoToggle.checked) startAutoRefresh();

  await refreshData();
  updateJumpButtonVisibility();
});
