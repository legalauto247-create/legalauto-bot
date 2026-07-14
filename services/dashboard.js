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
    events: (st.events || []).slice(-25).reverse().map(e => ({ at: e.at, kind: e.kind, note: e.note || '' })),
  };
}

// ── Визуальный офис: живая сцена, каждый ИИ-сотрудник за своим столом ────────
const OFFICE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LegalAuto — Офис ИИ-сотрудников</title><style>
:root{--gold:#D4AF37;--bg:#0B0F14;--surf:#141B23;--mut:#9AA1A8}
*{box-sizing:border-box;margin:0}body{background:radial-gradient(120% 100% at 50% 0%,#131A22 0%,#0B0F14 60%,#06090D 100%);color:#F0F2F4;font:15px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;padding:18px;min-height:100vh}
h1{font-size:20px;letter-spacing:1px}h1 b{color:var(--gold)}.sub{color:var(--mut);font-size:12px;margin:4px 0 18px}
.office{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}
.desk{position:relative;background:var(--surf);border:1px solid rgba(212,175,55,.25);border-radius:16px;padding:18px 16px 14px;transition:box-shadow .4s}
.desk.working{box-shadow:0 0 24px rgba(212,175,55,.35);border-color:var(--gold)}
.ava{font-size:44px;line-height:1}.led{position:absolute;top:14px;right:14px;width:10px;height:10px;border-radius:50%}
.led.on{background:#4ade80;box-shadow:0 0 10px #4ade80;animation:pulse 2s infinite}.led.off{background:#f87171}
@keyframes pulse{50%{opacity:.4}}
.name{font-weight:700;margin-top:8px}.role{color:var(--mut);font-size:12px}
.bubble{margin-top:10px;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.25);border-radius:10px;padding:8px 10px;font-size:12.5px;min-height:38px}
.bubble .t{color:var(--mut);font-size:11px}
.typing{display:inline-block;animation:blink 1.1s infinite}@keyframes blink{50%{opacity:.2}}
.feed{margin-top:22px;background:var(--surf);border:1px solid rgba(212,175,55,.25);border-radius:14px;padding:14px}
.feed h2{font-size:13px;letter-spacing:2px;color:var(--gold);text-transform:uppercase;margin-bottom:8px}
.frow{display:flex;gap:10px;padding:4px 0;font-size:13px;border-bottom:1px solid rgba(255,255,255,.04)}.frow .t{color:var(--mut);min-width:38px}
a{color:#00D1C2;text-decoration:none;font-size:12px}
</style></head><body>
<h1>LEGAL <b>AUTO</b> — офис ИИ-сотрудников</h1>
<div class="sub"><span id="upd">загрузка…</span> · <a id="back" href="#">← цифры</a></div>
<div class="office" id="office"></div>
<div class="feed"><h2>Что происходит прямо сейчас</h2><div id="feed"></div></div>
<script>
const KEY=new URLSearchParams(location.search).get('key')||'';
document.getElementById('back').href='/?key='+encodeURIComponent(KEY);
function esc(s){return String(s??'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}
const STAFF=[
 {id:'jarvis',ava:'🧠',name:'Джарвис',role:'директор: команды, решения',match:['jarvis','autopilot_toggle','remember']},
 {id:'autoads',ava:'🕵️',name:'Разведчик',role:'каналы партнёров, отбор авто',match:['autoads','mission_scanned','mission_picked','partners']},
 {id:'mission',ava:'🎯',name:'Mission Engine',role:'цели, отчёты, подписчики',match:['mission_published','growth_report','mission_video']},
 {id:'writer',ava:'✍️',name:'Копирайтер',role:'посты фирменным голосом',match:['autoads_poll']},
 {id:'photo',ava:'📸',name:'Фоторедактор',role:'отбор чистых фото',match:['photo']},
 {id:'video',ava:'🎬',name:'Видеозавод',role:'Shorts по брендбуку',match:['yt_upload','video']},
 {id:'autopost',ava:'📦',name:'Публикатор',role:'запчасти в канал',match:['autopost','post_part']},
 {id:'docs',ava:'📄',name:'Документовед',role:'СБКТС/ЭПТС, оплаты, стадии',match:['docs_']},
 {id:'health',ava:'🩺',name:'Медик',role:'здоровье платформы',match:['health']},
];
async function tick(){
 try{
  const d=await (await fetch('/api/state?key='+encodeURIComponent(KEY))).json();
  document.getElementById('upd').textContent='живой эфир · '+new Date(d.updated).toLocaleTimeString('ru-RU');
  const hb={};d.employees.forEach(e=>hb[e.name]=e);
  const now=Date.now();
  const cards=STAFF.map(st=>{
   const evs=d.events.filter(e=>st.match.some(m=>e.kind.startsWith(m)||e.kind.includes(m)));
   const last=evs[0];
   const fresh=last&&(now-Date.parse(last.at)<10*60e3);
   const hbAlive=Object.entries(hb).some(([k,v])=>k.toLowerCase().includes(st.id)&&v.alive);
   const alive=fresh||hbAlive||st.id==='jarvis';
   const doing=last?('<span class="t">'+last.at.slice(11,16)+'</span> '+esc(last.note||last.kind)):'<span class="t">ждёт задач…</span>';
   return '<div class="desk'+(fresh?' working':'')+'"><span class="led '+(alive?'on':'off')+'"></span>'+
    '<div class="ava">'+st.ava+'</div><div class="name">'+st.name+(fresh?' <span class="typing">⌨️</span>':'')+'</div>'+
    '<div class="role">'+st.role+'</div><div class="bubble">'+doing+'</div></div>';
  }).join('');
  document.getElementById('office').innerHTML=cards;
  document.getElementById('feed').innerHTML=d.events.slice(0,14).map(e=>'<div class="frow"><span class="t">'+e.at.slice(11,16)+'</span><span>'+esc(e.kind)+'</span><span style="color:var(--mut)">'+esc(e.note)+'</span></div>').join('');
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
