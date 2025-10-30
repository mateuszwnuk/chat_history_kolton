// ✅ Twoje dane
const DEFAULTS = {
  SUPABASE_URL: "https://kiecgkztsycuwplpbtbs.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZWNna3p0c3ljdXdwbHBidGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODc2NDAsImV4cCI6MjA3NDQ2MzY0MH0.WnzO0OqMur8eoXWB8ZjNBtHEVAK-rKPNftNATerYGsM",
  TABLE_NAME: "chatmemories"
};

let client=null, rawRows=[], sessionsMap={}, autoTimer=null, realtimeChannel=null;
let seenIds=new Set(), initialized=false, activeSid=null;

// DOM refs
const el=id=>document.getElementById(id);
const $url=el('url'), $key=el('key'), $table=el('table');

const $sessionSearch=el('sessionSearch'), $sessionList=el('sessionList');

const $status=el('status');
const $messages=el('messages'), $convFlag=el('convFlag'), $activeSid=el('activeSid'), $convCounts=el('convCounts');

const $expandAll=el('expandAll'), $collapseAll=el('collapseAll');
const $search=el('search'), $typeFilter=el('typeFilter');

const $refresh=el('refresh'), $realtimeToggle=el('realtimeToggle');
const $autoToggle=el('autoToggle'), $intervalSelect=el('intervalSelect');
const $notifToggle=el('notifToggle'), $soundToggle=el('soundToggle'), $testNotify=el('testNotify');
const $profanityToggle=el('profanityToggle');
const $lastUpdated=el('lastUpdated'), $newBadge=el('newBadge'), $newCount=el('newCount');
const $deleteThreadBtn = el('deleteThreadBtn');

// Prefill
$url.value=DEFAULTS.SUPABASE_URL;
$key.value=DEFAULTS.SUPABASE_ANON_KEY;
$table.value=DEFAULTS.TABLE_NAME;

// Profanity detection
const PROFANITY_STEMS = [
  'kurw','chuj','huj','kutas','pizd','pierdol','pierdziel','jeba','zajeb',
  'spierdal','wypierdal','zapierdal','odpierdol','przejeb','dojeb','ujeb',
  'wyjeb','najeb','zjeb','pojeb','skurwysyn','skurw','sukinsyn',
  'kurew','kurwis','kurtyzan','cip','fiut','sral','srac','sram','gowno','gówno',
  'dupa','dupie','ciul','raszpla','pierd','suki'
];
const simplify = s => (s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
const hasProfanity = text => {
  if(!$profanityToggle.checked) return false;
  const t=simplify(text); for(const stem of PROFANITY_STEMS){ if(t.includes(stem)) return true; } return false;
};

// Audio
let audioCtx=null;
function ensureAudioCtx(){ if(!audioCtx){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch{} } }
function playDing(){
  if(!$soundToggle.checked) return;
  ensureAudioCtx(); if(!audioCtx) return;
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type='sine'; o.frequency.setValueAtTime(880, audioCtx.currentTime);
  g.gain.setValueAtTime(0, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+0.25);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime+0.3);
}

// Notifications
async function ensureNotifPermission(){
  if(!$notifToggle.checked) return false;
  if(!('Notification' in window)) return false;
  if(Notification.permission==='granted') return true;
  if(Notification.permission==='denied') return false;
  const r=await Notification.requestPermission(); return r==='granted';
}
async function showNotification(count){
  if(!$notifToggle.checked) return;
  if(!('Notification' in window)) return;
  if(Notification.permission!=='granted'){ const ok=await ensureNotifPermission(); if(!ok) return; }
  const n=new Notification('Nowe wiadomości', { body:`Pojawiło się ${count} nowych wpisów.`, tag:'chatmemories-update' });
  setTimeout(()=>n.close(), 4000);
}
function bumpBadge(by){
  const current=parseInt($newCount.textContent||'0',10);
  const next=current+by; $newCount.textContent=String(next);
  $newBadge.style.display='inline-flex'; $newBadge.classList.remove('pulse'); void $newBadge.offsetWidth; $newBadge.classList.add('pulse');
}
function resetBadge(){ $newCount.textContent='0'; $newBadge.style.display='none'; }

function setLastUpdated(){ $lastUpdated.textContent='Ostatnia aktualizacja: '+new Date().toLocaleTimeString(); }

// Helpers
function parseMessage(m){
  try{ if(!m) return {type:'unknown',content:''}; if(typeof m==='string') return JSON.parse(m); return m; }
  catch{ return {type:'unknown',content:String(m)} }
}
function groupBySession(rows){
  const map={};
  for(const r of rows){
    // pomijamy rekordy oznaczone jako usunięte
    if(r.deleted_at) continue;
    const sid=r.session_id??'—brak—';
    (map[sid]??=[]).push(r);
  }
  Object.keys(map).forEach(sid=>map[sid].sort((a,b)=>(a.id??0)-(b.id??0)));
  return map;
}
function ensureClient(){
  if(client) return;
  const url=$url.value.trim(), key=$key.value.trim();
  if(!url||!key) throw new Error('Brakuje SUPABASE_URL lub SUPABASE_ANON_KEY.');
  client=window.supabase.createClient(url,key);
}

// UI: lista sesji (lewa kolumna)
function renderSessionList(){
  const q = ($sessionSearch.value||'').toLowerCase().trim();
  const sids = Object.keys(sessionsMap).sort();
  $sessionList.innerHTML = '';

  for(const sid of sids){
    const rows = sessionsMap[sid];
    if(!rows || rows.length===0) continue; // ukryj wątki bez żywych wiadomości
    if(q && !sid.toLowerCase().includes(q)) continue;

    // Czy sesja ma wulgaryzmy?
    let sessBad=false;
    for(const r of rows){
      const msg=parseMessage(r.message);
      if(hasProfanity(msg.content||'')){ sessBad=true; break; }
    }

    const item=document.createElement('div');
    item.className='session-item'+(sid===activeSid?' active':'');
    item.dataset.sid=sid;
    item.innerHTML=`
      ${sessBad ? `<span class="session-bad" title="Wulgaryzmy">⚠️</span>` : ''}
      <span class="session-id" title="${sid}">${sid}</span>
      <span class="session-meta">
        <span class="badge" title="Liczba wiadomości">${rows.length}</span>
        <button class="session-del" title="Oznacz wątek jako usunięty">🗑</button>
      </span>
    `;
    // klik na nazwę – ustaw aktywny
    item.addEventListener('click', (e)=>{
      // ignoruj klik na koszu
      if(e.target && e.target.classList.contains('session-del')) return;
      setActiveSession(sid);
    });
    // obsługa kosza
    item.querySelector('.session-del').addEventListener('click', async (e)=>{
      e.stopPropagation();
      await softDeleteThread(sid);
    });

    $sessionList.appendChild(item);
  }
}

// UI: prawa kolumna — wiadomości aktywnej sesji
function renderConversation(){
  $messages.innerHTML='';
  $expandAll.disabled = true; // w tym layoucie nie używamy <details>
  $collapseAll.disabled = true;

  if(!activeSid || !sessionsMap[activeSid]){
    $activeSid.textContent='—';
    $convFlag.classList.add('hidden');
    $convCounts.textContent='—';
    $status.textContent='Wybierz wątek z listy po lewej.';
    $deleteThreadBtn.disabled = true;
    return;
  }

  const rows = sessionsMap[activeSid] || [];
  $activeSid.textContent = activeSid;
  $convCounts.textContent = `wiadomości: ${rows.length}`;
  $deleteThreadBtn.disabled = rows.length === 0;

  // Flaga wulgaryzmów
  let sessBad=false;
  for(const r of rows){ const m=parseMessage(r.message); if(hasProfanity(m.content||'')){ sessBad=true; break; } }
  if(sessBad) $convFlag.classList.remove('hidden'); else $convFlag.classList.add('hidden');

  // Filtry prawej kolumny
  const q = ($search.value||'').toLowerCase().trim();
  const tf = ($typeFilter.value||'').toLowerCase();

  let shown=0;
  for(const r of rows){
    const msg=parseMessage(r.message);
    const type=(msg.type||'unknown').toLowerCase();
    const content=(msg.content??'').toString();

    const matchesType = !tf || type===tf;
    const matchesQuery = !q || content.toLowerCase().includes(q);
    if(!matchesType || !matchesQuery) continue;

    const bad = hasProfanity(content);
    const div=document.createElement('div');
    div.className='msg'+(bad?' bad':'');
    div.innerHTML=`
      <div class="head">
        <div class="type ${type}">${type}</div>
        <div class="id">id: ${r.id??'—'}</div>
      </div>
      <pre class="content"></pre>
    `;
    div.querySelector('pre.content').textContent = content;
    $messages.appendChild(div);
    shown++;
  }

  $status.innerHTML = shown ? `Poka­zano wiadomości: <b>${shown}</b> (łącznie w wątku: ${rows.length}).` : 'Brak wyników dla filtrów.';
}

// Ustaw aktywną sesję
function setActiveSession(sid){
  activeSid = sid;
  document.querySelectorAll('.session-item').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.sid===sid);
  });
  renderConversation();
}

// Pobierz wszystkie (ignorując soft-deleted)
async function fetchAllRows(){
  const table=$table.value.trim(); if(!table) throw new Error('Podaj nazwę tabeli.');
  const {data,error}=await client
    .from(table)
    .select('id, session_id, message, deleted_at')
    .is('deleted_at', null) // bierzemy tylko nieusunięte
    .order('session_id',{ascending:true})
    .order('id',{ascending:true})
    .limit(5000);
  if(error) throw error;
  return data||[];
}

// Odśwież całość (start / ręcznie / polling)
async function loadAndRender(){
  try{
    $refresh.disabled=true;
    $status.textContent='Pobieram dane…';
    const newData=await fetchAllRows();

    // detekcja nowych
    let newlyFound=0;
    for(const row of newData){ if(row && row.id!==undefined && !seenIds.has(row.id)) newlyFound++; }

    rawRows=newData; sessionsMap=groupBySession(rawRows);
    renderSessionList();
    if(!activeSid){
      const firstSid = Object.keys(sessionsMap).sort()[0];
      if(firstSid) activeSid=firstSid;
    }
    renderConversation();
    setLastUpdated();

    const allIds=new Set(newData.map(r=>r?.id).filter(v=>v!==undefined));
    if(!initialized){ seenIds=allIds; initialized=true; resetBadge(); }
    else{
      if(newlyFound>0){ bumpBadge(newlyFound); playDing(); showNotification(newlyFound); }
      seenIds=allIds;
    }
  }catch(e){
    console.error(e);
    $status.innerHTML=`<span class="danger">Błąd: ${e.message}</span>`;
  }finally{
    $refresh.disabled=false;
  }
}

// SOFT DELETE całego wątku (oznacz wszystkie rekordy sesji)
async function softDeleteThread(sid){
  if(!sid) return;
  const table = $table.value.trim();
  const confirmMsg = `Oznaczyć wątek "${sid}" jako usunięty?\nUstawimy deleted_at na wszystkich rekordach tej sesji.`;
  if(!window.confirm(confirmMsg)) return;

  try{
    $status.textContent = 'Oznaczam wątek jako usunięty…';
    const nowIso = new Date().toISOString();

    const { error } = await client
      .from(table)
      .update({ deleted_at: nowIso })
      .eq('session_id', sid);

    if(error) throw error;

    // Lokalnie wytnij z mapy i widoku
    delete sessionsMap[sid];
    if(activeSid === sid){
      activeSid = Object.keys(sessionsMap).sort()[0] || null;
    }
    renderSessionList();
    renderConversation();
    $status.textContent = 'Wątek oznaczony jako usunięty.';
  }catch(e){
    console.error(e);
    $status.innerHTML = `<span class="danger">Błąd soft-delete: ${e.message}</span>`;
  }
}

// Realtime (domyślnie OFF, bo mamy auto-refresh 60s)
function unsubscribeRealtime(){
  if(realtimeChannel){ client.removeChannel(realtimeChannel); realtimeChannel=null; }
}
function subscribeRealtime(){
  unsubscribeRealtime();
  const table=$table.value.trim();
  realtimeChannel = client
    .channel('realtime-chatmemories')
    .on('postgres_changes', { event:'INSERT', schema:'public', table }, payload=>{
      const row = payload.new;
      if(row.deleted_at) return; // ignoruj jeśli już soft-deleted
      const sid=row.session_id ?? '—brak—';
      if(!sessionsMap[sid]) sessionsMap[sid]=[];
      sessionsMap[sid].push(row);
      sessionsMap[sid].sort((a,b)=>(a.id??0)-(b.id??0));

      renderSessionList();
      if(activeSid===sid) renderConversation();

      setLastUpdated();
      if(initialized && !seenIds.has(row.id)){
        bumpBadge(1); playDing(); showNotification(1);
        seenIds.add(row.id);
      }
    })
    .subscribe(status=>{
      if(status==='SUBSCRIBED') $status.textContent='Realtime aktywne';
    });
}

// Polling
function startAuto(){ stopAuto(); const sec=parseInt($intervalSelect.value,10)||60; autoTimer=setInterval(loadAndRender, sec*1000); $status.textContent=`Auto-odświeżanie aktywne (co ${sec}s)`; }
function stopAuto(){ if(autoTimer){ clearInterval(autoTimer); autoTimer=null; } }

// Events
$sessionSearch.addEventListener('input', ()=> renderSessionList());
$search.addEventListener('input', ()=> renderConversation());
$typeFilter.addEventListener('change', ()=> renderConversation());
$profanityToggle.addEventListener('change', ()=> { renderSessionList(); renderConversation(); });

$refresh.addEventListener('click', ()=>{ ensureAudioCtx(); loadAndRender(); });
$testNotify.addEventListener('click', async ()=>{
  ensureAudioCtx(); playDing(); await ensureNotifPermission(); showNotification(1); bumpBadge(1); setTimeout(()=>resetBadge(), 1200);
});
$deleteThreadBtn.addEventListener('click', async ()=>{
  if(activeSid) await softDeleteThread(activeSid);
});

$realtimeToggle.addEventListener('change', ()=>{
  if($realtimeToggle.checked){ stopAuto(); subscribeRealtime(); $status.textContent='Realtime aktywne'; }
  else{ unsubscribeRealtime(); $status.textContent='Realtime wyłączone'; }
});
$autoToggle.addEventListener('change', ()=> $autoToggle.checked ? startAuto() : stopAuto());
$intervalSelect.addEventListener('change', ()=>{ if($autoToggle.checked) startAuto(); });

// Start – domyślnie: polling ON (60s), realtime OFF
window.addEventListener('load', async ()=>{
  try{
    ensureClient();
    await loadAndRender();
    initialized = true;
    if($autoToggle.checked) startAuto();
    // $realtimeToggle.checked = false (domyślnie)
  }catch(e){
    console.error(e);
    $status.innerHTML=`<span class="danger">Błąd: ${e.message}</span>`;
  }
});
