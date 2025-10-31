// ===== Konfiguracja / pamięć ustawień =====
const DEFAULTS = {
  url:  "https://kiecgkztsycuwplpbtbs.supabase.co",
  key:  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZWNna3p0c3ljdXdwbHBidGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODc2NDAsImV4cCI6MjA3NDQ2MzY0MH0.WnzO0OqMur8eoXWB8ZjNBtHEVAK-rKPNftNATerYGsM",
  table:"chatmemories"
};
function loadConfig(){
  return {
    url:   localStorage.getItem('sbUrl')   || DEFAULTS.url,
    key:   localStorage.getItem('sbKey')   || DEFAULTS.key,
    table: localStorage.getItem('sbTable') || DEFAULTS.table
  };
}
function saveConfig({url,key,table}){
  localStorage.setItem('sbUrl', url);
  localStorage.setItem('sbKey', key);
  localStorage.setItem('sbTable', table);
}

// ===== Stan aplikacji =====
let client = null;
let cfg = loadConfig();

let sessions = {};          // { sid: [rows] }
let rawRows = [];           // płaska lista (do statystyk)
let seenIds = new Set();
let activeSid = null;
let autoTimer = null;
let realtimeChannel = null;
let chart = null;           // Chart.js instance
let createdAtAvailable = true;

// ===== DOM =====
const $sessionList   = document.getElementById("sessionList");
const $sessionSearch = document.getElementById("sessionSearch");
const $messages      = document.getElementById("messages");
const $status        = document.getElementById("statusHeader");
const $refreshHint   = document.getElementById('refreshHint');

// Navbar/global controls
const $refresh       = document.getElementById("refresh");
const $intervalSelect= document.getElementById("intervalSelect");
const $autoToggle    = document.getElementById("autoToggle");
const $realtimeToggle= document.getElementById("realtimeToggle");
const $notifToggle   = document.getElementById("notifToggle");
const $soundToggle   = document.getElementById("soundToggle");
const $autoscrollToggle = document.getElementById("autoscrollToggle");
const $testNotify    = document.getElementById("testNotify");
const $newBadge      = document.getElementById("newBadge");
const $newCount      = document.getElementById("newCount");

// History view
const $typeFilter    = document.getElementById("typeFilter");
const $search        = document.getElementById("search");
const $convFlag      = document.getElementById("convFlag");
const $activeSidEl   = document.getElementById("activeSid");
const $convCounts    = document.getElementById("convCounts");
const $lastUpdated   = document.getElementById("lastUpdated");
const $progressBar   = document.getElementById("progressBar");
const $jumpBtn       = document.getElementById("jumpToBottom");

// Settings view
const $urlInput      = document.getElementById("url");
const $keyInput      = document.getElementById("key");
const $tableInput    = document.getElementById("table");
const $applySettings = document.getElementById("applySettings");

// Tabs / views
const $tabs = [...document.querySelectorAll('.tab[data-view]')];
const $historyView = document.getElementById('historyView');
const $statsView = document.getElementById('statsView');
const $settingsView = document.getElementById('settingsView');

// KPI / chart
const $kpiTotal = document.getElementById('kpiTotal');
const $kpiThreads = document.getElementById('kpiThreads');
const $kpiHuman = document.getElementById('kpiHuman');
const $kpiAI = document.getElementById('kpiAI');
const $kpiAvg = document.getElementById('kpiAvg');
const $statsNote = document.getElementById('statsNote');
const $statsChartCanvas = document.getElementById('statsChart');
const $topKeywords = document.getElementById('topKeywords');

// Toast
const $toast = document.getElementById('toast');

// ===== Pasek postępu =====
let progressTimer=null;
function progressStart(){ if($progressBar){ $progressBar.classList.add('active'); if(progressTimer) clearTimeout(progressTimer); } }
function progressStop(){ if($progressBar){ progressTimer=setTimeout(()=> $progressBar.classList.remove('active'), 180); } }

// ===== Toast / badge =====
let toastTimer = null;
function showToast(msg, kind='ok', timeoutMs=1600){
  if(!$toast) return;
  $toast.textContent = msg;
  $toast.classList.remove('hidden','ok','warn','err','show');
  $toast.classList.add(kind);
  requestAnimationFrame(()=>{ $toast.classList.add('show'); });
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, timeoutMs);
}
function hideToast(){
  if(!$toast) return;
  $toast.classList.remove('show');
  setTimeout(()=> $toast.classList.add('hidden'), 220);
}

// Subtle inline refresh hint (replaces the frequent "Gotowe" toast)
let refreshHintTimer = null;
function showRefreshHint(msg='Gotowe', timeoutMs=1400){
  if(!$refreshHint) return;
  $refreshHint.textContent = '✓ ' + msg;
  $refreshHint.classList.remove('hidden');
  if(refreshHintTimer) clearTimeout(refreshHintTimer);
  refreshHintTimer = setTimeout(()=>{ $refreshHint.classList.add('hidden'); }, timeoutMs);
}

// ===== Audio =====
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

// ===== Powiadomienia =====
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

// ===== Wulgaryzmy =====
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

// --- Stopwords for keyword extraction (normalized, no diacritics)
const STOP_WORDS = [
  // Polish (basic/common)
  'i','w','z','na','do','się','ze','że','to','jest','nie','si','po','dla','jak','co','ale','od','te','ten','ta','tak','albo','czy','aby','przez','ich','jego','jej','ten','oni','one','by','ma','mam','my','ty','on','ona',
  // English small words
  'the','and','for','with','that','this','from','have','has','was','are','you','your','not','but','what','when','where','who'
];

// ===== Auto-scroll =====
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
$jumpBtn?.addEventListener('click', ()=>{
  scrollToBottom(true);
  updateJumpButtonVisibility();
});

// ===== Klient Supabase =====
function buildClient(){
  client = window.supabase.createClient(cfg.url, cfg.key);
}
buildClient();

// ===== Pobieranie danych =====
async function fetchData(){
  createdAtAvailable = true;
  let data=null, error=null;
  ({data, error} = await client
    .from(cfg.table)
    .select("id, session_id, message, created_at")
    .order("session_id",{ascending:true})
    .order("id",{ascending:true}));
  if(error){
    createdAtAvailable = false;
    ({data, error} = await client
      .from(cfg.table)
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

// ===== Render lewego panelu =====
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

// ===== Render rozmowy =====
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
    $jumpBtn?.classList.add('hidden');
  }else{
    updateJumpButtonVisibility();
  }
}

// ===== Statystyki =====
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
    const days = [];
    const today = new Date(); today.setHours(0,0,0,0);
    for(let i=29;i>=0;i--){
      const d=new Date(today); d.setDate(today.getDate()-i);
      const key=d.toISOString().slice(0,10);
      days.push(key);
    }
    series = { labels: days, values: days.map(d=>counts.get(d)||0) };
  }else{
    note = "Brak kolumny created_at – wykres ograniczony.";
  }
  return { total, threads, human, ai, avg, series, note };
}

// Compute top keywords used by HUMAN messages (returns array of {word,count})
function computeTopKeywords(limit=10){
  const freq = new Map();
  for(const r of rawRows){
    const t=(r.message?.type||'').toLowerCase();
    if(t!=='human') continue;
    const raw = (r.message?.content||'').toString();
    // normalize and strip diacritics
    const s = raw.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
    // keep letters/numbers as separators
    const tokens = s.replace(/[^\p{L}\p{N}]+/gu,' ').split(/\s+/).filter(Boolean);
    for(const w of tokens){
      const w2 = w.replace(/^\W+|\W+$/g,'');
      if(!w2) continue;
      if(w2.length < 3) continue; // skip too-short tokens
      if(STOP_WORDS.includes(w2)) continue;
      freq.set(w2, (freq.get(w2)||0)+1);
    }
  }
  const arr = Array.from(freq.entries()).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([word,count])=>({word,count}));
  return arr;
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
    if(chart){ chart.destroy(); chart=null; }
    const ctx = $statsChartCanvas.getContext('2d');
    ctx.clearRect(0,0,$statsChartCanvas.width,$statsChartCanvas.height);
    return;
  }

  const data = {
    labels: series.labels,
    datasets: [{ label:'Wiadomości / dzień', data: series.values, tension:0.25, fill:true }]
  };
  const options = {
    responsive:true, maintainAspectRatio:false, animation:false,
    plugins:{ legend:{ display:false } },
    scales:{ x:{ ticks:{ maxTicksLimit:8 } }, y:{ beginAtZero:true, precision:0 } }
  };
  if(chart){ chart.data=data; chart.options=options; chart.update(); }
  else { chart=new Chart($statsChartCanvas.getContext('2d'), { type:'line', data, options }); }

  // Render top keywords
  if($topKeywords){
    const top = computeTopKeywords(10);
    if(top.length===0){
      $topKeywords.innerHTML = '<div class="muted">Brak danych</div>';
    }else{
      $topKeywords.innerHTML = top.map(k=>`<div class="keyword-item"><span class="kw">${k.word}</span><span class="kw-count">${k.count}</span></div>`).join('');
    }
  }
}

// ===== Refresh całości =====
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
    // Show subtle inline hint instead of toast for routine refreshes
    showRefreshHint('Gotowe');
    if($autoscrollToggle?.checked && wasNear) scrollToBottom(false);
    else updateJumpButtonVisibility();
  }catch(e){
    console.error(e);
    $status.textContent='Błąd: '+e.message;
    showToast('Błąd: '+e.message,'err',2200);
  }finally{
    progressStop();
  }
}

// ===== Realtime =====
function startRealtime(){
  if(realtimeChannel) client.removeChannel(realtimeChannel);
  realtimeChannel = client
    .channel(`realtime:${cfg.table}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:cfg.table}, payload=>{
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
        if($jumpBtn && !$jumpBtn.classList.contains('hidden')){
          $jumpBtn.classList.remove('pulse'); void $jumpBtn.offsetWidth; $jumpBtn.classList.add('pulse');
        }
      }
    })
    .subscribe(status=>{
      if(status==='SUBSCRIBED'){
        $status.textContent='Realtime aktywne';
        showToast('Realtime aktywne','ok');
      }
    });
}
function stopRealtime(){
  if(realtimeChannel){
    client.removeChannel(realtimeChannel);
    realtimeChannel=null;
    $status.textContent='Realtime wyłączone';
    showToast('Realtime wyłączone','warn');
  }
}

// ===== Auto-refresh =====
function startAutoRefresh(){
  clearInterval(autoTimer);
  const sec=parseInt($intervalSelect.value,10)||10;
  autoTimer=setInterval(refreshData, sec*1000);
  $status.textContent=`Auto-odświeżanie aktywne (co ${sec}s)`;
}
function stopAutoRefresh(){ clearInterval(autoTimer); autoTimer=null; }

// ===== Ustawienia (Supabase) =====
function populateSettingsForm(){
  if($urlInput)   $urlInput.value   = cfg.url;
  if($keyInput)   $keyInput.value   = cfg.key;
  if($tableInput) $tableInput.value = cfg.table;
}
async function applySettings(){
  const newCfg = {
    url:   ($urlInput.value||'').trim(),
    key:   ($keyInput.value||'').trim(),
    table: ($tableInput.value||'').trim()
  };
  if(!newCfg.url || !newCfg.key || !newCfg.table){
    showToast('Uzupełnij URL/Key/Tabela','warn',2200);
    return;
  }
  saveConfig(newCfg);
  cfg = loadConfig();
  stopRealtime(); stopAutoRefresh();
  buildClient();
  if($autoToggle.checked) startAutoRefresh();
  await refreshData();
  showToast('Zastosowano ustawienia','ok');
}

// ===== Zdarzenia UI =====
$refresh.onclick = ()=>{ ensureAudioCtx(); refreshData(); };
$search.oninput = renderConversation;
$typeFilter.onchange = renderConversation;
$sessionSearch.oninput = renderSessions;

$testNotify.onclick = async ()=>{ ensureAudioCtx(); playDing(); await ensureNotifPermission(); notifyNew(1); showToast('Test powiadomienia','ok'); };

$realtimeToggle.onchange = e=>{
  if(e.target.checked){ stopAutoRefresh(); startRealtime(); }
  else{ stopRealtime(); }
};
$autoToggle.onchange = e=>{
  if(e.target.checked) startAutoRefresh();
  else stopAutoRefresh();
};
$intervalSelect.onchange = ()=>{ if($autoToggle.checked) startAutoRefresh(); };

$applySettings?.addEventListener('click', applySettings);

// Tabs
$tabs.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const view = btn.dataset.view;
    $tabs.forEach(b=>b.classList.toggle('active', b===btn));
    $historyView.classList.add('hidden');
    $statsView.classList.add('hidden');
    $settingsView.classList.add('hidden');
    if(view==='history') $historyView.classList.remove('hidden');
    if(view==='stats')   { $statsView.classList.remove('hidden'); renderStats(); }
    if(view==='settings'){ $settingsView.classList.remove('hidden'); populateSettingsForm(); }
  });
});

// zapamiętywanie auto-scroll
(function initAutoscrollPref(){
  const saved = localStorage.getItem('autoscroll');
  if(saved!==null) $autoscrollToggle.checked = saved==='1';
  $autoscrollToggle.addEventListener('change', ()=>{
    localStorage.setItem('autoscroll', $autoscrollToggle.checked?'1':'0');
    updateJumpButtonVisibility();
  });
})();

// ===== Start =====
window.addEventListener('load', async ()=>{
  populateSettingsForm();
  // Default interval to 60s and leave auto-refresh turned OFF by default
  $intervalSelect.value='60';
  $autoToggle.checked = false;
  // Do not start auto-refresh automatically; user can enable it via the UI
  await refreshData();
  updateJumpButtonVisibility();
});
