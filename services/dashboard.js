/**
 * LegalAuto — Онлайн-дашборд (HTTP на Railway).
 *
 * Эдо в реальном времени видит: ИИ-сотрудники (heartbeat), публикации и ролики,
 * подписчики каналов, лиды, задачи/провалы, CRM документов, лента событий.
 * Обновляется сам каждые 30 сек.
 *
 * Доступ: https://<railway-домен>/?key=<DASHBOARD_KEY или ADMIN_CHAT_ID>
 */
import http from 'http';
import { getState, getSection } from './stateService.js';
import { sourceSummary } from './missionEngine.js';
import { listOrders, docsAlerts, docsTotals, orderMargin } from './docsCrm.js';

const KEY = process.env.DASHBOARD_KEY || process.env.ADMIN_CHAT_ID || 'legalauto';
const GAS = process.env.APPS_SCRIPT_API_URL;

const EMP = {
  autoads: 'Разведчик (каналы партнёров)',
  autopost: 'Публикатор запчастей',
  jarvis: 'Джарвис (мозг)',
  mission: 'Mission Engine',
  video: 'Видеозавод',
  health: 'Медик (health monitor)',
};

async function leadsToday() {
  try {
    const r = await fetch(`${GAS}?action=leads`, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 LegalAutoBot/1.0' } });
    const d = JSON.parse(await r.text());
    const t = new Date().toISOString().slice(0, 10);
    const all = d.leads || [];
    return { today: all.filter(l => String(l.date || l.created_at || '').slice(0, 10) === t).length, total: all.length };
  } catch { return { today: null, total: null }; }
}

async function apiState() {
  const st = getState();
  const day = (getSection('mission') || {})[new Date().toISOString().slice(0, 10)] || {};
  const subs = (getSection('mission') || {}).subs || {};
  const leads = await leadsToday();
  const now = Date.now();
  return {
    updated: new Date().toISOString(),
    employees: Object.entries(st.heartbeats || {}).map(([k, v]) => ({
      name: EMP[k] || k, at: v.at, note: v.note || '',
      alive: now - Date.parse(v.at) < 40 * 60e3,
    })),
    today: { scanned: day.scanned || 0, picked: day.picked || 0, published: day.published || 0, video: day.video || 0 },
    subs,
    leads,
    videos: ((getSection('videos') || {}).list || []).slice(0, 10),
    partners: (getSection('partners') || {}).list || [],
    settings: getSection('settings') || {},
    tasks: {
      active: Object.values(st.tasks || {}).filter(t => ['created', 'processing'].includes(t.status)).length,
      failed: Object.values(st.tasks || {}).filter(t => t.status === 'failed').slice(-5).map(t => ({ id: t.id.slice(0, 8), type: t.type, error: (t.error || '').slice(0, 90) })),
    },
    docs: { orders: listOrders().map(o => ({ ...o, margin: orderMargin(o) })), alerts: docsAlerts(), totals: docsTotals() },
    sources: sourceSummary(7),
    events: (st.events || []).slice(-25).reverse().map(e => ({ at: e.at, kind: e.kind, note: e.note || '' })),
  };
}

// ── Визуальный офис 2.0: комната в фирменном стиле, живые сотрудники ─────────
const OFFICE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LegalAuto — Офис</title><style>
:root{--gold:#D4AF37;--bg:#07090D;--wall:#10151C;--floor:#0D1219;--mut:#9AA1A8}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:#F0F2F4;font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;padding:14px;min-height:100vh}
h1{font-size:19px;letter-spacing:1px}h1 b{color:var(--gold)}.sub{color:var(--mut);font-size:12px;margin:4px 0 12px}
a{color:#00D1C2;text-decoration:none;font-size:12px}
.room{position:relative;max-width:1060px;margin:0 auto;border:2px solid rgba(212,175,55,.5);border-radius:18px;overflow:hidden;
 background:linear-gradient(180deg,var(--wall) 0 90px,var(--floor) 90px 100%);box-shadow:0 30px 80px rgba(0,0,0,.6)}
.room::after{content:"";position:absolute;inset:90px 0 0 0;background:
 repeating-linear-gradient(90deg,transparent 0 79px,rgba(212,175,55,.06) 79px 80px),
 repeating-linear-gradient(0deg,transparent 0 79px,rgba(212,175,55,.06) 79px 80px);pointer-events:none}
.logo-wall{position:absolute;top:18px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;z-index:2}
.shield{width:40px;height:46px;border:2.5px solid var(--gold);border-radius:8px 8px 16px 16px;display:flex;align-items:center;justify-content:center;color:var(--gold);font-weight:800;font-size:16px;background:#0B0F14}
.lw{font-weight:800;letter-spacing:3px;font-size:20px}.lw b{color:var(--gold)}
.lamp{position:absolute;top:0;width:120px;height:70px;background:radial-gradient(60% 100% at 50% 0%,rgba(212,175,55,.16),transparent 75%);pointer-events:none}
.grid{position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:26px;padding:110px 30px 26px;z-index:1}
.spot{position:relative;height:190px}
.desk{position:absolute;left:50%;top:78px;transform:translateX(-50%);width:150px;height:56px;background:linear-gradient(180deg,#1D2630,#141B23);border:1.5px solid rgba(212,175,55,.55);border-radius:10px;box-shadow:0 14px 22px rgba(0,0,0,.5)}
.desk::after{content:"";position:absolute;left:8px;right:8px;top:0;height:3px;border-radius:3px;background:linear-gradient(90deg,#FFD700,#D4AF37,#9A7B1E);opacity:.8}
.mon{position:absolute;left:50%;top:-34px;transform:translateX(-50%);width:64px;height:38px;background:#05070A;border:2px solid #2A333E;border-radius:5px;overflow:hidden}
.mon::after{content:"";position:absolute;left:50%;bottom:-8px;transform:translateX(-50%);width:16px;height:8px;background:#2A333E}
.scr{position:absolute;inset:2px;background:#0A0F14;transition:.4s}
.working .scr{background:linear-gradient(135deg,#1a2b1f,#0f1f2a);animation:flick 1.3s infinite}
.working .scr::before{content:"";position:absolute;left:4px;top:5px;right:22px;height:2px;background:#4ade80;box-shadow:0 7px 0 -0.5px #D4AF37,0 13px 0 -0.5px #4ade8088;animation:code 1.8s infinite}
@keyframes flick{50%{filter:brightness(1.35)}}
@keyframes code{50%{right:8px}}
.chair{position:absolute;left:50%;top:120px;transform:translateX(-50%);width:34px;height:10px;background:#1A222B;border:1px solid #2A333E;border-radius:4px}
.guy{position:absolute;left:50%;top:86px;transform:translateX(-50%);width:34px;text-align:center;z-index:3;transition:top 1s}
.head{width:16px;height:16px;border-radius:50%;background:#E8C9A0;margin:0 auto;border:1px solid #0008}
.body{width:26px;height:20px;border-radius:8px 8px 4px 4px;margin:-2px auto 0;background:linear-gradient(180deg,#232B35,#1A222B);border:1.5px solid var(--gold)}
.working .guy{animation:type .5s infinite}
@keyframes type{50%{transform:translateX(-50%) translateY(1.5px)}}
.idle .guy{animation:wander 9s ease-in-out infinite}
@keyframes wander{0%,55%,100%{transform:translateX(-50%)}20%,35%{transform:translateX(calc(-50% + 34px)) }}
.off .guy{opacity:.35;animation:none}
.off .scr{background:#05070A}
.zzz{position:absolute;right:-4px;top:-12px;font-size:11px;color:var(--mut);display:none}.off .zzz{display:block}
.tag{position:absolute;left:50%;top:148px;transform:translateX(-50%);white-space:nowrap;font-size:12px;font-weight:700}
.tag small{display:block;font-weight:500;color:var(--mut);font-size:10.5px;text-align:center}
.bub{position:absolute;left:50%;top:-6px;transform:translateX(-50%);max-width:170px;background:#141B23;border:1px solid rgba(212,175,55,.5);border-radius:9px;padding:5px 8px;font-size:10.5px;color:#E6E9EC;opacity:0;transition:.4s;z-index:4;white-space:normal;text-align:center}
.working .bub{opacity:1}
.cooler{position:absolute;right:26px;top:112px;width:26px;height:52px;background:linear-gradient(180deg,#1A222B,#10151C);border:1.5px solid #2A333E;border-radius:6px;z-index:1}
.cooler::before{content:"";position:absolute;left:4px;top:-12px;right:4px;height:16px;background:#78c7e344;border:1px solid #78c7e366;border-radius:4px}
.plant{position:absolute;left:22px;top:104px;font-size:30px;z-index:1}
.rug{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);width:200px;height:38px;border:1.5px dashed rgba(212,175,55,.4);border-radius:50%;display:flex;align-items:center;justify-content:center;color:rgba(212,175,55,.5);font-size:11px;letter-spacing:3px}
.feed{max-width:1060px;margin:14px auto 0;background:#141B23;border:1px solid rgba(212,175,55,.3);border-radius:14px;padding:12px 16px}
.feed h2{font-size:12px;letter-spacing:2px;color:var(--gold);text-transform:uppercase;margin-bottom:6px}
.frow{display:flex;gap:10px;padding:3px 0;font-size:12.5px;border-bottom:1px solid rgba(255,255,255,.04)}.frow .t{color:var(--mut);min-width:36px}
</style></head><body>
<h1>LEGAL <b>AUTO</b> — офис</h1>
<div class="sub"><span id="upd">открываем офис…</span> · <a id="back" href="#">← цифры</a></div>
<div class="room" id="room">
 <div class="logo-wall"><div class="shield">LA</div><div class="lw">LEGAL <b>AUTO</b><div style="font-size:9px;letter-spacing:4px;color:var(--mut);font-weight:600">ФАКТЫ • КОНТРОЛЬ • РЕЗУЛЬТАТ</div></div></div>
 <div class="lamp" style="left:12%"></div><div class="lamp" style="left:44%"></div><div class="lamp" style="left:76%"></div>
 <div class="grid" id="grid"></div>
 <div class="cooler" title="кулер"></div><div class="plant">🪴</div>
 <div class="rug">LEGAL AUTO</div>
</div>
<div class="feed"><h2>Рабочий эфир</h2><div id="feed"></div></div>
<script>
const KEY=new URLSearchParams(location.search).get('key')||'';
document.getElementById('back').href='/?key='+encodeURIComponent(KEY);
function esc(s){return String(s??'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}
const STAFF=[
 {id:'jarvis',name:'Джарвис',role:'директор',match:['jarvis','autopilot_toggle','remember']},
 {id:'autoads',name:'Разведчик',role:'каналы партнёров',match:['autoads','mission_scanned','mission_picked','partners']},
 {id:'writer',name:'Копирайтер',role:'посты и рерайт',match:['autoads_poll']},
 {id:'photo',name:'Фоторедактор',role:'отбор фото',match:['photo']},
 {id:'video',name:'Видеозавод',role:'Shorts',match:['yt_upload','video']},
 {id:'autopost',name:'Публикатор',role:'запчасти в канал',match:['autopost','post_part']},
 {id:'docs',name:'Документовед',role:'СБКТС / ЭПТС',match:['docs_']},
 {id:'mission',name:'Mission Engine',role:'цели и отчёты',match:['mission_published','growth_report']},
 {id:'health',name:'Медик',role:'здоровье систем',match:['health']},
];
let built=false;
function build(){
 document.getElementById('grid').innerHTML=STAFF.map((st,i)=>
  '<div class="spot" id="spot-'+st.id+'">'+
   '<div class="bub" id="bub-'+st.id+'"></div>'+
   '<div class="mon"><div class="scr"></div></div>'.replace('class="mon"','class="mon" style="position:absolute;left:50%;top:44px;transform:translateX(-50%)"')+
   '<div class="desk"></div>'+
   '<div class="guy"><span class="zzz">💤</span><div class="head"></div><div class="body"></div></div>'+
   '<div class="chair"></div>'+
   '<div class="tag">'+st.name+'<small>'+st.role+'</small></div>'+
  '</div>').join('');
 built=true;
}
async function tick(){
 try{
  const d=await (await fetch('/api/state?key='+encodeURIComponent(KEY))).json();
  if(!built)build();
  document.getElementById('upd').textContent='живой эфир · '+new Date(d.updated).toLocaleTimeString('ru-RU');
  const hb={};d.employees.forEach(e=>hb[(e.name||'').toLowerCase()]=e);
  const now=Date.now();
  for(const st of STAFF){
   const evs=d.events.filter(e=>st.match.some(m=>e.kind.startsWith(m)||e.kind.includes(m)));
   const last=evs[0];
   const fresh=last&&(now-Date.parse(last.at)<10*60e3);
   const hbAlive=Object.keys(hb).some(k=>k.includes(st.id)&&hb[k].alive);
   const alive=fresh||hbAlive||st.id==='jarvis';
   const spot=document.getElementById('spot-'+st.id);
   spot.className='spot '+(fresh?'working':alive?'idle':'off');
   document.getElementById('bub-'+st.id).textContent=last?(esc(last.note||last.kind).slice(0,70)):'';
  }
  document.getElementById('feed').innerHTML=d.events.slice(0,12).map(e=>'<div class="frow"><span class="t">'+e.at.slice(11,16)+'</span><span>'+esc(e.kind)+'</span><span style="color:var(--mut)">'+esc(e.note)+'</span></div>').join('');
 }catch(e){document.getElementById('upd').textContent='ошибка: '+e.message}
}
tick();setInterval(tick,15000);
</script></body></html>`;

const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LegalAuto — Центр управления</title><style>
:root{--gold:#D4AF37;--teal:#00D1C2;--orange:#FF6B00;--bg:#0B0F14;--surf:#141B23;--mut:#9AA1A8}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:#F0F2F4;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:18px}
h1{font-size:20px;letter-spacing:1px}h1 b{color:var(--gold)}.sub{color:var(--mut);font-size:12px;margin:4px 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.card{background:var(--surf);border:1px solid rgba(212,175,55,.25);border-radius:14px;padding:16px}
.card h2{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:10px}
.kpi{display:flex;gap:18px;flex-wrap:wrap}.kpi div{text-align:center}.kpi b{display:block;font-size:26px}.kpi span{color:var(--mut);font-size:11px}
.row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:13px}
.ok{color:#4ade80}.bad{color:#f87171}.warn{color:#fbbf24}.mut{color:var(--mut)}
a{color:var(--teal);text-decoration:none}.tag{font-size:11px;padding:2px 8px;border-radius:6px;background:rgba(212,175,55,.15);color:var(--gold)}
</style></head><body>
<h1>LEGAL <b>AUTO</b> — центр управления</h1><div class="sub"><span id="upd">загрузка…</span> · <a id="toOffice" href="#" style="color:#00D1C2;text-decoration:none">🏢 офис сотрудников →</a></div>
<script>document.addEventListener('DOMContentLoaded',()=>{document.getElementById('toOffice').href='/office?key='+encodeURIComponent(new URLSearchParams(location.search).get('key')||'')})</script>
<div class="grid" id="g"></div>
<script>
const KEY=new URLSearchParams(location.search).get('key')||'';
function esc(s){return String(s??'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}
async function tick(){
 try{
  const d=await (await fetch('/api/state?key='+encodeURIComponent(KEY))).json();
  document.getElementById('upd').textContent='обновлено '+new Date(d.updated).toLocaleTimeString('ru-RU')+' · автообновление 30 сек';
  const emp=d.employees.map(e=>'<div class="row"><span>'+(e.alive?'🟢':'🔴')+' '+esc(e.name)+'</span><span class="mut">'+esc(e.note)+'</span></div>').join('')||'<div class="mut">нет данных</div>';
  const subs=Object.entries(d.subs).map(([k,v])=>'<div class="row"><span>'+esc(k)+'</span><b>'+v+'</b></div>').join('')||'<div class="mut">нет замеров</div>';
  const vids=d.videos.map(v=>'<div class="row"><a target="_blank" href="'+esc(v.url)+'">'+esc(v.title)+'</a><span class="mut">'+v.at.slice(5,16).replace('T',' ')+'</span></div>').join('')||'<div class="mut">пока нет</div>';
  const parts=d.partners.map(p=>'<div class="row"><span>'+esc(p.ch)+'</span><span class="mut">'+esc(p.purpose||'')+'</span></div>').join('')||'<div class="mut">каналы не подключены</div>';
  const fails=d.tasks.failed.map(t=>'<div class="row bad"><span>'+esc(t.type)+'</span><span>'+esc(t.error)+'</span></div>').join('');
  const orders=d.docs.orders.map(o=>{
    const ws=(o.works||[]).map(w=>'<span class="tag" title="'+esc(w.status)+'">'+esc(w.type)+' '+(w.status==='Оплачено'?'✅':w.status==='Отмена'?'🚫':esc(w.status))+'</span>').join(' ');
    return '<div class="row"><span><b>'+esc(o.id)+'</b> '+esc(o.client)+' · '+esc(o.car)+(o.lab?' · 🏭 '+esc(o.lab)+' '+esc(o.lab_date||''):'')+'</span><span>'+ws+' · маржа <b>'+(o.margin||0).toLocaleString('ru-RU')+' ₽</b></span></div>';
  }).join('')||'<div class="mut">машин нет — скажи Джарвису: «запиши: Влад, Geely Monjaro, СБКТС 30000, ЭПТС 2000»</div>';
  const alerts=d.docs.alerts.map(a=>'<div class="row warn">'+esc(a)+'</div>').join('');
  const ev=d.events.map(e=>'<div class="row"><span class="mut">'+e.at.slice(11,16)+'</span><span>'+esc(e.kind)+'</span><span class="mut">'+esc(e.note)+'</span></div>').join('');
  const ap=d.settings.video_autopilot==='off'?'<span class="bad">ВЫКЛ</span>':'<span class="ok">ВКЛ</span>';
  document.getElementById('g').innerHTML=
   '<div class="card"><h2>Сегодня</h2><div class="kpi">'+
    '<div><b>'+d.today.scanned+'</b><span>постов просмотрено</span></div>'+
    '<div><b>'+d.today.picked+'</b><span>отобрано лучших</span></div>'+
    '<div><b>'+d.today.published+'</b><span>опубликовано</span></div>'+
    '<div><b>'+d.today.video+'</b><span>роликов</span></div>'+
    '<div><b>'+(d.leads.today??'—')+'</b><span>лидов сегодня</span></div>'+
    '<div><b>'+(d.leads.total??'—')+'</b><span>лидов всего</span></div></div>'+
    '<div style="margin-top:10px" class="mut">Автопилот роликов: '+ap+' · Активных задач: '+d.tasks.active+'</div></div>'+
   '<div class="card"><h2>ИИ-сотрудники</h2>'+emp+'</div>'+
   '<div class="card"><h2>Подписчики каналов</h2>'+subs+'</div>'+
   '<div class="card"><h2>Документы — СБКТС / ЭПТС / утиль</h2><div class="kpi" style="margin-bottom:8px"><div><b>'+(d.docs.totals.active.revenue).toLocaleString('ru-RU')+'</b><span>выручка (актив), ₽</span></div><div><b>'+(d.docs.totals.active.margin).toLocaleString('ru-RU')+'</b><span>маржа (актив), ₽</span></div><div><b>'+(d.docs.totals.total.margin).toLocaleString('ru-RU')+'</b><span>маржа всего, ₽</span></div></div>'+alerts+orders+'</div>'+
   '<div class="card"><h2>Последние видео (YouTube)</h2>'+vids+'</div>'+
   '<div class="card"><h2>Источники лидов (7 дней)</h2>'+(Object.entries(d.sources||{}).sort((a,b)=>b[1].leads-a[1].leads||b[1].clicks-a[1].clicks).map(([k,v])=>'<div class="row"><span>'+esc(k)+'</span><span>'+v.clicks+' кликов → <b>'+v.leads+' лидов</b></span></div>').join('')||'<div class="mut">пока нет переходов по ссылкам из роликов</div>')+'</div>'+
   '<div class="card"><h2>Каналы партнёров</h2>'+parts+'</div>'+
   (fails?'<div class="card"><h2>Провалы</h2>'+fails+'</div>':'')+
   '<div class="card"><h2>Лента событий</h2>'+ev+'</div>';
 }catch(e){document.getElementById('upd').textContent='ошибка: '+e.message}
}
tick();setInterval(tick,30000);
</script></body></html>`;

let started = false;
export function startDashboard() {
  if (started) return; started = true;
  const port = process.env.PORT || 8080;
  http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (u.searchParams.get('key') !== KEY) { res.writeHead(403); return res.end('нужен ?key='); }
    if (u.pathname === '/office') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(OFFICE);
    }
    if (u.pathname === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(await apiState()));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  }).listen(port, () => console.log(`[Dashboard] 📊 Центр управления на порту ${port} (?key=${KEY.slice(0, 3)}…)`));
}
