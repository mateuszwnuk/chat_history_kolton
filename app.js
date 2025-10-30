// ✅ Twoje dane (możesz przepiąć na ENV w Vercel; tu zostawiamy dla prostoty)
const DEFAULTS = {
  SUPABASE_URL: "https://kiecgkztsycuwplpbtbs.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZWNna3p0c3ljdXdwbHBidGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODc2NDAsImV4cCI6MjA3NDQ2MzY0MH0.WnzO0OqMur8eoXWB8ZjNBtHEVAK-rKPNftNATerYGsM",
  TABLE_NAME: "chatmemories"
};

let client=null, rawRows=[], sessionsMap={}, autoTimer=null;
let seenIds=new Set(), initialized=false;

// --- DOM refs ---
const el=id=>document.getElementById(id);
const $url=el('url'), $key=el('key'), $table=el('table');
const $status=el('status'), $sessions=el('sessions');
const $expandAll=el('expandAll'), $collapseAll=el('collapseAll');
const $search=el('search'), $typeFilter=el('typeFilter');
const $refresh=el('refresh'), $autoToggle=el('autoToggle'), $intervalSelect=el('intervalSelect');
const $notifToggle=el('notifToggle'), $soundToggle=el('soundToggle'), $testNotify=el('testNotify');
const $profanityToggle=el('profanityToggle');
const $lastUpdated=el('lastUpdated'), $newBadge=el('newBadge'), $newCount=el('newCount');

// Prefill inputs
$url.value=DEFAULTS.SUPABASE_URL;
$key.value=DEFAULTS.SUPABASE_ANON_KEY;
$table.value=DEFAULTS.TABLE_NAME;

// ---- WULGARYZMY ----
const PROFANITY_STEMS = [
  'kurw','chuj','huj','kutas','pizd','pierdol','pierdziel','jeba','zajeb',
  'spierdal','wypierdal','zapierdal','odpierdol','przejeb','dojeb','ujeb',
  'wyjeb','najeb','zjeb','pojeb','skurwysyn','skurw','sukinsyn',
  'kurew','kurwis','kurtyzan','cip','fiut','sral','srac','sram','gowno','gówno',
  'dupa','dupie','ciul','raszpla','pierd','suki'
];
function simplify(s){
  return (s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
}
function hasProfanity(text){
  if(!$profanityToggle.checked) return false;
  const t = simplify(text);
  for(const stem of PROFANITY_STEMS){
    if(t.includes(stem)) return true;
  }
  return false;
}

// ---- DŹWIĘK ----
let audioCtx=null;
function ensureAudioCtx(){
  if(!audioCtx){
    try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch{}
  }
}
function playDing(){
  if(!$soundToggle.checked) return;
  ensureAudioCtx();
  if(!audioCtx) return;
  const o=audioCtx.createOscillator();
  const g=audioCtx.createGain();
  o.type='sine';
  o.frequency.setValueAtTime(880, audioCtx.currentTime);
  g.gain.setValueAtTime(0, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+0.25);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime+0.3);
}

// ---- Systemowe powiadomienia ----
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
  const n=new Notification('Nowe wiadomości', {
    body: `Pojawiło się ${count} nowych wpisów.`,
    tag: 'chatmemories-update'
  });
  setTimeout(()=>n.close(), 4000);
}

function bumpBadge(by){
  const current=parseInt($newCount.textContent||'0',10);
  const next=current+by;
  $newCount.textContent=String(next);
  $newBadge.style.display='inline-flex';
  $newBadge.classList.remove('pulse'); void $newBadge.offsetWidth; $newBadge.classList.add('pulse');
}
function resetBadge(){ $newCount.textContent='0'; $newBadge.style.display='none'; }

// ---- Helpers ----
function parseMessage(m){
  try{ if(!m) return {type:'unknown',content:''}; if(typeof m==='string') return JSON.parse(m); return m; }
  catch{ return {type:'unknown',content:String(m)} }
}
function groupBySession(rows){
  const map={};
  for(const r of rows){
    const sid=r.session_id??'—brak—';
    (map[sid]??=[]).push(r);
  }
  Object.keys(map).forEach(sid=>map[sid].sort((a,b)=>(a.id??0)-(b.id??0)));
  return map;
}
function render(){
  const q=$search.value.trim().toLowerCase();
  const tf=$typeFilter.value;
  $sessions.innerHTML='';
  const sids=Object.keys(sessionsMap).sort();
  let shownGroups=0, shownMsgs=0;

  for(const sid of sids){
    const rows=sessionsMap[sid].filter(r=>{
      const msg=parseMessage(r.message);
      const okType=!tf||((msg.type||'').toLowerCase()===tf);
      const text=`${sid} ${msg.content||''}`.toLowerCase();
      const okQuery=!q||text.includes(q);
      return okType&&okQuery;
    });
    if(!rows.length) continue;
    shownGroups++;

    const total=sessionsMap[sid].length;

    let sessionHasProfanity=false;
    for(const r of rows){
      const m=parseMessage(r.message);
      if(hasProfanity(m.content||'')){ sessionHasProfanity=true; break; }
    }

    const details=document.createElement('details');
    details.className='session';

    const summary=document.createElement('summary');
    summary.innerHTML=`
      <span class="chev"></span>
      ${sessionHasProfanity ? `<span class="flag" title="Wulgaryzmy w wątku">⚠️</span>` : ''}
      <span>Sesja: <span class="sid">${sid}</span></span>
      <span class="badge">wierszy: ${rows.length}/${total}</span>
    `;

    const wrap=document.createElement('div'); wrap.className='messages';
    for(const r of rows){
      shownMsgs++;
      const msg=parseMessage(r.message);
      const type=(msg.type||'unknown').toLowerCase();
      const content=(msg.content??'').toString();
      const isBad=hasProfanity(content);

      const div=document.createElement('div');
      div.className='msg'+(isBad?' bad':'');
      div.innerHTML=`
        <div class="head">
          <div class="type ${type}">${type}</div>
          <div class="id">id: ${r.id??'—'}</div>
        </div>
        <pre class="content"></pre>
      `;
      div.querySelector('pre.content').textContent=content;
      wrap.appendChild(div);
    }

    details.appendChild(summary); details.appendChild(wrap);
    $sessions.appendChild(details);
  }

  $expandAll.disabled = shownGroups===0;
  $collapseAll.disabled = shownGroups===0;
  $status.innerHTML = shownGroups ? `Poka­zano grup: <b>${shownGroups}</b>, wiadomości: <b>${shownMsgs}</b>.` : 'Brak wyników dla filtrów.';
}
async function fetchAllRows(){
  const table=$table.value.trim(); if(!table) throw new Error('Podaj nazwę tabeli.');
  const {data,error}=await client
    .from(table)
    .select('id, session_id, message')
    .order('session_id',{ascending:true})
    .order('id',{ascending:true})
    .limit(5000);
  if(error) throw error;
  return data||[];
}
function ensureClient(){
  if(client) return;
  const url=$url.value.trim(), key=$key.value.trim();
  if(!url||!key) throw new Error('Brakuje SUPABASE_URL lub SUPABASE_ANON_KEY.');
  client=window.supabase.createClient(url,key);
}
function setLastUpdated(){
  const d=new Date();
  $lastUpdated.textContent='Ostatnia aktualizacja: '+d.toLocaleTimeString();
}

async function loadAndRender(){
  try{
    $refresh.disabled=true;
    $status.innerHTML='Łączenie z Supabase…';
    ensureClient();

    $status.innerHTML='Pobieram dane…';
    const newData=await fetchAllRows();

    // 🔎 detekcja nowych ID
    let newlyFound=0;
    for(const row of newData){
      if(row && typeof row.id!=='undefined' && !seenIds.has(row.id)){
        newlyFound++;
      }
    }

    rawRows=newData;
    sessionsMap=groupBySession(rawRows);
    render();
    setLastUpdated();

    const allIds=new Set(newData.map(r=>r?.id).filter(v=>v!==undefined));
    if(!initialized){
      seenIds=allIds;
      initialized=true;
      resetBadge();
    }else{
      if(newlyFound>0){
        bumpBadge(newlyFound);
        playDing();
        showNotification(newlyFound);
      }
      seenIds=allIds;
    }

  }catch(e){
    console.error(e);
    $status.innerHTML=`<span class="danger">Błąd: ${e.message}</span>`;
  }finally{
    $refresh.disabled=false;
  }
}
function startAuto(){
  stopAuto();
  const sec=parseInt($intervalSelect.value,10)||20;
  autoTimer=setInterval(loadAndRender, sec*1000);
  $status.innerHTML=`Auto-odświeżanie aktywne (co ${sec}s)`;
}
function stopAuto(){ if(autoTimer){ clearInterval(autoTimer); autoTimer=null; } }

// --- Events ---
$search.addEventListener('input',render);
$typeFilter.addEventListener('change',render);
$refresh.addEventListener('click',()=>{ ensureAudioCtx(); loadAndRender(); });
el('expandAll').addEventListener('click',()=>{document.querySelectorAll('details.session').forEach(d=>d.open=true)});
el('collapseAll').addEventListener('click',()=>{document.querySelectorAll('details.session').forEach(d=>d.open=false)});

$autoToggle.addEventListener('change',()=> $autoToggle.checked ? startAuto() : stopAuto());
$intervalSelect.addEventListener('change',()=>{ if($autoToggle.checked) startAuto(); });

$notifToggle.addEventListener('change', async ()=>{ if($notifToggle.checked){ await ensureNotifPermission(); }});
$soundToggle.addEventListener('change', ()=>{ if($soundToggle.checked) ensureAudioCtx(); });
$profanityToggle.addEventListener('change', ()=>{ render(); });

$testNotify.addEventListener('click', async ()=>{
  ensureAudioCtx(); playDing();
  await ensureNotifPermission();
  showNotification(1);
  bumpBadge(1);
  setTimeout(()=>resetBadge(), 1200);
});

// Auto-start
window.addEventListener('load', async ()=>{
  ensureClient();
  await loadAndRender();
  if($autoToggle.checked) startAuto();
});
