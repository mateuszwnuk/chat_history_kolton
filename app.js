// ✅ Twoje dane (możesz później przenieść do ENV)
const DEFAULTS = {
  SUPABASE_URL: "https://kiecgkztsycuwplpbtbs.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZWNna3p0c3ljdXdwbHBidGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODc2NDAsImV4cCI6MjA3NDQ2MzY0MH0.WnzO0OqMur8eoXWB8ZjNBtHEVAK-rKPNftNATerYGsM",
  TABLE_NAME: "chatmemories"
};

let client=null, rawRows=[], sessionsMap={}, autoTimer=null, realtimeChannel=null;
let seenIds=new Set(), initialized=false;
let selectedSid=null; // AKTYWNY WĄTEK

// DOM
const el=id=>document.getElementById(id);
const $url=el('url'), $key=el('key'), $table=el('table');
const $status=el('status'), $messages=el('messages');
const $refresh=el('refresh');
const $realtimeToggle=el('realtimeToggle');
const $autoToggle=el('autoToggle'), $intervalSelect=el('intervalSelect');
const $notifToggle=el('notifToggle'), $soundToggle=el('soundToggle'), $testNotify=el('testNotify');
const $profanityToggle=el('profanityToggle');
const $lastUpdated=el('lastUpdated'), $newBadge=el('newBadge'), $newCount=el('newCount');
const $typeFilter=el('typeFilter');
const $sessionList=el('sessionList'), $searchSessions=el('searchSessions');
const $currentSid=el('currentSid'), $currentCount=el('currentCount');

// Prefill
$url.value=DEFAULTS.SUPABASE_URL;
$key.value=DEFAULTS.SUPABASE_ANON_KEY;
$table.value=DEFAULTS.TABLE_NAME;

// Profanity
const PROFANITY_STEMS = [
  'kurw','chuj','huj','kutas','pizd','pierdol','pierdziel','jeba','zajeb',
  'spierdal','wypierdal','zapierdal','odpierdol','przejeb','dojeb','ujeb',
  'wyjeb','najeb','zjeb','pojeb','skurwysyn','skurw','sukinsyn',
  'kurew','kurwis','kurtyzan','cip','fiut','sral','srac','sram','gowno','gówno',
  'dupa','dupie','ciul','raszpla','pierd','suki'
];
const simplify = s => (s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
const hasProfanity = (text) => {
  if(!$profanityToggle.checked) return false;
  const t = simplify(text);
  for(const stem of PROFANITY_STEMS) if(t.includes(stem)) return true;
  return false;
};

// Dźwięk
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

// Notyfikacje
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
  const next=current+by;
  $newCount.textContent=String(next);
  $newBadge.style.display='inline-flex';
  $newBadge.classList.remove('pulse'); void $newBadge.offsetWidth; $newBadge.classList.add('pulse');
}
function resetBadge(){ $newCount.textContent='0'; $newBadge.style.display='none'; }

// Helpers
function parseMessage(m){
  try{ if(!m) return {type:'unknown',content:''}; if(typeof m==='string') return JSON.parse(m); return m; }
  catch{ return {type:'unknown',content:String(m)} }
}
function groupBySession(rows){
  const map={};
  for(const r
