// $20 Draft — Cloudflare Worker + Durable Object (one Durable Object per room)
const now = () => Date.now();
/* =========================================================
   2) PLAYER POOL — stars and superstars only
   [name, positions, overall, era]
   ========================================================= */
/* 2026-27 season pool — stars & superstars, current teams after the 2026 offseason.
   [name, positions, overall, team, est. +/- per 100 possessions, fit tags]
   Tags: PM playmaker · SH shooter · RIM rim protector · DEF perimeter defender · BALL ball-dominant
   Overall follows ESPN's 2026 NBA Rank order; +/- is an estimate of on-court impact, not an official stat. */
const RAW = [
  ["Nikola Jokić","C",98,"DEN",10.5,"PM BALL"],["Shai Gilgeous-Alexander","PG/SG",97,"OKC",9.5,"PM BALL DEF"],
  ["Victor Wembanyama","C/PF",97,"SAS",9.0,"RIM SH DEF"],["Luka Dončić","PG/SG",96,"LAL",7.5,"PM BALL SH"],
  ["Giannis Antetokounmpo","PF/C",95,"MIA",7.5,"BALL RIM"],["Jalen Brunson","PG",94,"NYK",5.0,"PM BALL SH"],
  ["Cade Cunningham","PG",94,"DET",6.0,"PM BALL"],["Anthony Edwards","SG/SF",93,"MIN",5.0,"BALL SH DEF"],
  ["Jayson Tatum","SF/PF",93,"BOS",6.0,"BALL SH DEF"],["Donovan Mitchell","SG/PG",93,"CLE",5.0,"BALL SH"],
  ["Tyrese Maxey","PG/SG",91,"PHI",4.0,"BALL SH"],["Stephen Curry","PG",91,"GSW",6.5,"PM BALL SH"],
  ["Kevin Durant","SF/PF",91,"HOU",4.5,"BALL SH"],["Jaylen Brown","SG/SF",90,"PHI",3.5,"BALL DEF"],
  ["Kawhi Leonard","SF",90,"TOR",5.5,"BALL SH DEF"],["Karl-Anthony Towns","C/PF",90,"NYK",4.0,"SH"],
  ["Scottie Barnes","SF/PF",89,"TOR",4.0,"PM DEF"],["LeBron James","SF/PF",89,"PHI",4.0,"PM BALL"],
  ["Tyrese Haliburton","PG",89,"IND",4.5,"PM SH"],["Devin Booker","SG/PG",89,"PHX",3.0,"BALL SH PM"],
  ["Jamal Murray","PG",88,"DEN",3.5,"PM SH"],["Jalen Johnson","SF/PF",88,"ATL",3.5,"PM DEF"],
  ["Cooper Flagg","SF/PF",88,"DAL",2.5,"BALL DEF"],["Chet Holmgren","C/PF",88,"OKC",5.0,"RIM SH"],
  ["Jalen Williams","SG/SF",87,"OKC",3.5,"DEF"],["Evan Mobley","PF/C",87,"CLE",4.0,"RIM DEF"],
  ["Deni Avdija","SF",87,"POR",3.0,"PM"],["Bam Adebayo","C",87,"MIA",3.0,"RIM DEF"],
  ["Pascal Siakam","PF",86,"IND",2.5,""],["Alperen Şengün","C",86,"HOU",2.5,"PM"],
  ["Amen Thompson","SF/PG",86,"HOU",3.0,"DEF PM"],["James Harden","PG",86,"CLE",3.0,"PM BALL SH"],
  ["Jalen Duren","C",86,"DET",2.5,"RIM"],["OG Anunoby","SF/PF",85,"NYK",3.5,"DEF SH"],
  ["LaMelo Ball","PG",85,"MIN",2.0,"PM BALL SH"],["Paolo Banchero","PF",85,"ORL",1.5,"BALL"],
  ["Austin Reaves","SG/PG",85,"LAL",2.5,"SH PM"],["Stephon Castle","PG/SG",85,"SAS",2.5,"DEF PM"],
  ["Kyrie Irving","PG/SG",85,"DAL",2.5,"BALL SH"],["Anthony Davis","PF/C",85,"WAS",3.0,"RIM DEF"],
  ["Joel Embiid","C",85,"PHI",3.0,"BALL RIM"],["Rudy Gobert","C",84,"MIN",3.5,"RIM"],
  ["De'Aaron Fox","PG",84,"SAS",1.0,"BALL"],["Trae Young","PG",84,"WAS",1.0,"PM BALL SH"],
  ["Franz Wagner","SF",84,"ORL",2.0,""],["Brandon Miller","SF",84,"CHA",1.0,"SH"],
  ["Derrick White","SG/PG",84,"BOS",3.5,"DEF SH"],["Kon Knueppel","SG/SF",84,"CHA",2.0,"SH"],
  ["Lauri Markkanen","PF",83,"UTA",1.5,"SH"],["Dylan Harper","SG/PG",83,"SAS",2.0,"PM"],
  ["Zion Williamson","PF",83,"NOP",1.5,"BALL"],["Jaren Jackson Jr.","PF/C",83,"UTA",2.0,"RIM SH"],
  ["Desmond Bane","SG",83,"ORL",2.0,"SH"],["Darius Garland","PG",83,"LAC",1.5,"PM SH"],
  ["AJ Dybantsa","SF",82,"WAS",0.0,"BALL"],["Darryn Peterson","SG",82,"UTA",0.0,"SH"]
];
const PLAYERS = RAW.map(([name,pos,r,team,pm,tags])=>({name,pos:pos.split("/"),r,team,pm,tags:tags?tags.split(" "):[],tier:r>=93?"Superstar":"Star"}));
const TAG_LABEL = {PM:"Playmaker",SH:"Shooter",RIM:"Rim protector",DEF:"Defender",BALL:"Ball-dominant"};
const P = i => PLAYERS[i];
const SLOTS = ["PG","SG","SF","PF","C","SIX"];
const SLOT_LABEL = {PG:"PG",SG:"SG",SF:"SF",PF:"PF",C:"C",SIX:"6th man"};
const COLORS = ["#C42F2A","#1F4E8C","#1E7B4F","#7A3FA0","#D97A00","#0F7C8C","#B0306E","#4A4658"];
const BUDGET = 20;

/* ---------- game rules (run inside transactions) ---------- */
function norm(r){
  r.players=r.players||{}; r.settings=r.settings||{budget:BUDGET,timer:20};
  r.order=r.order||[]; r.pool=r.pool||[]; r.teams=r.teams||{}; r.log=r.log||[]; r.seen=r.seen||{};
  Object.values(r.teams).forEach(t=>{t.roster=t.roster||{};t.paid=t.paid||{}});
  if(r.round) r.round.active=r.round.active||{};
  return r;
}
const openSlots = t => SLOTS.filter(s=>t.roster[s]==null);
function fitSlot(t,pid){for(const p of P(pid).pos) if(t.roster[p]==null) return p; return t.roster.SIX==null?"SIX":null}
const maxBid = t => t.budget-(openSlots(t).length-1);
const canBid = (t,pid,cur) => fitSlot(t,pid)!=null && maxBid(t)>cur;
const isFull = t => openSlots(t).length===0;
const pname = (r,u) => (r.players[u]||{}).name||"Someone";
function addLog(r,m){r.log=r.log.concat([m]).slice(-12)}
const deadline = r => r.settings.timer ? now()+r.settings.timer*1000 : 0;

function startCard(r){
  let refilled=false;
  while(true){
    const alive=r.order.filter(u=>!(r.players[u]||{}).left);
    if(alive.every(u=>isFull(r.teams[u]))){ finish(r); return; }
    if(!r.pool.length){
      // pool ran dry before every team is full: bring in stars nobody owns yet.
      // At most once per empty pool and 3 times per draft, so it can never loop forever.
      if(refilled || (r.refills||0)>=3){ finish(r); return; }
      const owned=new Set(); Object.values(r.teams).forEach(t=>Object.values(t.roster).forEach(x=>owned.add(x)));
      const extra=shuffle(PLAYERS.map((_,i)=>i).filter(i=>!owned.has(i)));
      if(!extra.length){ finish(r); return; }
      refilled=true; r.refills=(r.refills||0)+1;
      r.pool=extra.slice(0,10); r.seen={}; addLog(r,"More players added to the pool");
    }
    const pid=r.pool.shift();
    r.seen[pid]=(r.seen[pid]||0)+1;
    const elig=alive.filter(u=>canBid(r.teams[u],pid,0));
    if(!elig.length) continue;
    const cardNo=(r.cardNo||0)+1; r.cardNo=cardNo;
    const starter=(cardNo-1)%r.order.length;
    const active={}; elig.forEach(u=>active[u]=true);
    let turn=null;
    for(let k=0;k<r.order.length;k++){const u=r.order[(starter+k)%r.order.length]; if(active[u]){turn=u;break}}
    r.round={pid,bid:0,bidder:null,active,turn,opener:turn,cardNo,deadline:deadline(r)};
    return;
  }
}

/* awards or discards the current player if bidding is over; returns true if it moved on */
function settle(r){
  const rd=r.round;
  Object.keys(rd.active).forEach(u=>{ if((r.players[u]||{}).left || (u!==rd.bidder && !canBid(r.teams[u],rd.pid,rd.bid))) delete rd.active[u]; });
  const act=Object.keys(rd.active), others=act.filter(u=>u!==rd.bidder);
  if(rd.bidder && !others.length){ award(r); return true; }
  if(!rd.bidder && !act.length){
    addLog(r,`Nobody bid on ${P(rd.pid).name}`);
    if((r.seen[rd.pid]||0)<4) r.pool.push(rd.pid);
    r.lastPick={pid:rd.pid,uid:null,bid:0,cardNo:rd.cardNo};
    startCard(r); return true;
  }
  return false;
}
function advance(r,fromUid){
  const rd=r.round;
  if(settle(r)) return;
  const i=r.order.indexOf(fromUid);
  for(let k=1;k<=r.order.length;k++){
    const u=r.order[(i+k)%r.order.length];
    if(rd.active[u] && u!==rd.bidder){ rd.turn=u; break; }
  }
  rd.deadline=deadline(r);
}

function award(r){
  const rd=r.round, t=r.teams[rd.bidder], slot=fitSlot(t,rd.pid);
  t.budget-=rd.bid; t.roster[slot]=rd.pid; t.paid[slot]=rd.bid;
  r.lastPick={pid:rd.pid,uid:rd.bidder,bid:rd.bid,slot,cardNo:rd.cardNo};
  addLog(r,`${pname(r,rd.bidder)} won ${P(rd.pid).name} for $${rd.bid} (${SLOT_LABEL[slot]})`);
  startCard(r);
}

function finish(r){r.status="done";r.round=null;r.seed=Math.floor(Math.random()*1e9)}


/* team strength = talent + on-court +/- + how well the pieces fit together */
function teamFit(t){
  const st=["PG","SG","SF","PF","C"].map(s=>t.roster[s]).filter(x=>x!=null).map(P);
  const has=tag=>st.filter(p=>p.tags.includes(tag)).length;
  const notes=[]; let fit=0;
  const pm=has("PM"), sh=has("SH"), rim=has("RIM"), def=has("DEF"), ball=has("BALL");
  if(pm){fit+=1.5;notes.push(["ok","Playmaker"])} else {fit-=2.5;notes.push(["no","No playmaker"])}
  if(sh>=3){fit+=2;notes.push(["ok",`Shooting (${sh})`])} else if(sh===2){fit+=1;notes.push(["ok","Shooting (2)"])} else {fit-=sh?0.5:2.5;notes.push(["no",`Shooting (${sh})`])}
  if(rim){fit+=1.5;notes.push(["ok","Rim protector"])} else {fit-=2;notes.push(["no","No rim protector"])}
  if(def>=2){fit+=1.5;notes.push(["ok",`Defenders (${def})`])} else if(def===1){fit+=0.5;notes.push(["ok","Defender (1)"])} else {fit-=1;notes.push(["no","No defenders"])}
  if(ball>2){fit-=1.5*(ball-2);notes.push(["no",`Too many ball-dominant (${ball})`])}
  return {fit,notes};
}
function rating(t){
  const st=["PG","SG","SF","PF","C"].map(s=>t.roster[s]);
  const six=t.roster.SIX;
  const ovr=st.reduce((a,x)=>a+(x!=null?P(x).r:60),0)/5*0.85+(six!=null?P(six).r:60)*0.15;
  const pm=st.reduce((a,x)=>a+(x!=null?P(x).pm:-4),0)+(six!=null?P(six).pm*0.5:-2);
  const {fit,notes}=teamFit(t);
  return {total:ovr+pm*0.35+fit, ovr, pm, fit, notes};
}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
/* actions shared by the server and practice mode; each returns true if it changed the room */
function applyBid(r,u,amount){
  const rd=r.round; if(r.status!=="drafting"||!rd||rd.turn!==u) return false;
  const t=r.teams[u]; amount=Math.floor(Number(amount));
  if(!(amount>rd.bid)||amount>maxBid(t)||fitSlot(t,rd.pid)==null) return false;
  rd.bid=amount; rd.bidder=u; advance(r,u); return true;
}
/* the first person up on a player must open with at least $1; after that, passing is free */
const mustOpen = (r,u) => !!(r.round && r.round.turn===u && r.round.opener===u && !r.round.bidder);
function applyPass(r,u,reason){
  const rd=r.round; if(r.status!=="drafting"||!rd||rd.turn!==u) return false;
  if(mustOpen(r,u)) return false;
  delete rd.active[u]; if(reason) addLog(r,`${pname(r,u)} ${reason}`);
  advance(r,u); return true;
}
/* out of time (or skipped by the host): the opener is auto-bid $1, anyone else passes */
function applyTimeout(r,u,reason){
  if(mustOpen(r,u)){ addLog(r,`${pname(r,u)} ${reason} — opened at $1`); return applyBid(r,u,1); }
  return applyPass(r,u,reason);
}
function applySettings(r,u,timer){
  timer=Number(timer); if(r.status!=="lobby"||r.hostId!==u||![0,15,20,30].includes(timer)) return false;
  r.settings.timer=timer; return true;
}
function applyStart(r,u){
  if(r.status!=="lobby"||r.hostId!==u) return false;
  const uids=Object.keys(r.players); if(uids.length<2) return false;
  r.order=shuffle(uids); r.teams={};
  uids.forEach(x=>r.teams[x]={budget:r.settings.budget||BUDGET,roster:{},paid:{}});
  r.pool=buildPool(uids.length); r.seen={}; r.refills=0; r.round=null; r.log=[]; r.lastPick=null; r.cardNo=0; r.seed=null;
  r.status="drafting"; startCard(r); return true;
}
/* draft pool: 10 players per person, with at least one superstar per person */
const POOL_PER_PLAYER = 10;
function buildPool(n){
  const size=Math.min(PLAYERS.length, n*POOL_PER_PLAYER);
  const ids=PLAYERS.map((_,i)=>i);
  const sup=shuffle(ids.filter(i=>PLAYERS[i].tier==="Superstar")).slice(0,Math.min(n,size));
  const rest=shuffle(ids.filter(i=>!sup.includes(i))).slice(0,size-sup.length);
  return shuffle(sup.concat(rest));
}
function applyLeave(r,u){
  if(r.status!=="drafting"||!r.players[u]||r.players[u].left) return false;
  r.players[u].left=true; addLog(r,`${pname(r,u)} left the draft`);
  const alive=r.order.filter(x=>!(r.players[x]||{}).left);
  if(r.hostId===u && alive.length) r.hostId=alive[0];
  if(alive.length<2){ addLog(r,"Draft ended early"); finish(r); return true; }
  const rd=r.round; if(!rd) return true;
  if(rd.bidder===u){ addLog(r,`${P(rd.pid).name} was skipped`); startCard(r); return true; }
  delete rd.active[u];
  if(rd.turn===u) advance(r,u); else settle(r);
  return true;
}
function applyEnd(r,u){
  if(r.status!=="drafting"||r.hostId!==u) return false;
  addLog(r,`${pname(r,u)} ended the draft`); finish(r); return true;
}
function applyAgain(r,u){
  if(r.status!=="done"||r.hostId!==u) return false;
  r.status="lobby"; r.teams={}; r.round=null; r.pool=[]; r.order=[]; r.log=[]; r.lastPick=null; r.seed=null; r.cardNo=0;
  Object.keys(r.players).forEach(x=>{ if(r.players[x].left) delete r.players[x]; });
  return true;
}

const HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-title\" content=\"$20 Draft\">\n<meta name=\"theme-color\" content=\"#E4BB7E\">\n\n<title>$20 Draft</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800;900&family=Barlow:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n<style>\n:root{\n  --maple:#E4BB7E; --maple-lt:#F1D3A4; --maple-dk:#C99A58;\n  --ink:#1C1B29; --ink-soft:#4A4658; --paper:#FFFDF8; --line:#EADFCD; --slot:#FFFFFF; --grain:rgba(120,72,20,.10);\n  --solid-bg:#1C1B29; --solid-fg:#FFFDF8;\n  --paddle:#C42F2A; --court:#1F4E8C; --win:#1E7B4F;\n  --display:\"Big Shoulders Display\", Impact, \"Arial Narrow\", sans-serif;\n  --body:\"Barlow\", system-ui, -apple-system, \"Segoe UI\", sans-serif;\n  box-sizing:border-box;\n  padding-top:env(safe-area-inset-top,0px);\n  padding-bottom:env(safe-area-inset-bottom,0px);\n}\n@media (prefers-color-scheme:dark){:root:not([data-theme=\"light\"]){\n  --maple:#3B2C1C; --maple-lt:#4A3824; --maple-dk:#6B5233; --ink:#F4E7D2; --ink-soft:#C9B9A0;\n  --paper:#251D15; --line:#3E3122; --slot:#2E241A; --grain:rgba(0,0,0,.25); --solid-bg:#F4E7D2; --solid-fg:#1C1B29;}}\n:root[data-theme=\"dark\"]{--maple:#3B2C1C; --maple-lt:#4A3824; --maple-dk:#6B5233; --ink:#F4E7D2; --ink-soft:#C9B9A0;\n  --paper:#251D15; --line:#3E3122; --slot:#2E241A; --grain:rgba(0,0,0,.25); --solid-bg:#F4E7D2; --solid-fg:#1C1B29;}\nhtml,body{height:100%}\n*,*::before,*::after{box-sizing:inherit}\nhtml,body{margin:0;min-height:100%}\nbody{\n  font-family:var(--body);color:var(--ink);font-size:16px;line-height:1.45;\n  background:var(--maple);\n  background-image:repeating-linear-gradient(90deg,transparent 0 46px,var(--grain) 46px 47px),\n    repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 3px,transparent 3px 9px);\n}\n.wrap{max-width:560px;margin:0 auto;padding:16px 16px 40px}\n.screen{display:none}.screen.on{display:block}\nh1,h2,h3{font-family:var(--display);margin:0;line-height:.95;letter-spacing:.01em}\n.logo{font-size:clamp(72px,24vw,128px);font-weight:900;color:var(--ink);margin:24px 0 4px}\n.logo small{display:block;font-size:.34em;font-weight:800;color:var(--paddle);letter-spacing:.02em;margin-top:6px}\n.lede{font-size:18px;max-width:34ch;margin:12px 0 24px;color:var(--ink-soft)}\nlabel{display:block;font-weight:600;margin:16px 0 6px}\ninput,select{\n  width:100%;font:600 18px var(--body);padding:12px 14px;border:2px solid var(--ink);\n  border-radius:10px;background:var(--paper);color:var(--ink)\n}\ninput.code{text-transform:uppercase;letter-spacing:.3em;font-family:var(--display);font-size:28px;text-align:center}\nbutton{\n  font:700 17px var(--body);border:2px solid var(--ink);border-radius:10px;padding:13px 16px;\n  background:var(--paper);color:var(--ink);cursor:pointer;width:100%;touch-action:manipulation\n}\nbutton.primary{background:var(--solid-bg);color:var(--solid-fg);border-color:var(--solid-bg)}\nbutton.red{background:var(--paddle);border-color:var(--paddle);color:#fff}\nbutton.green{background:var(--win);border-color:var(--win);color:#fff}\nbutton:disabled{opacity:.4;cursor:not-allowed}\nbutton:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--court);outline-offset:2px}\n.row{display:flex;gap:10px}.row>*{flex:1}\n.stack>*+*{margin-top:10px}\n.err{color:var(--paddle);font-weight:700;min-height:1.4em;margin-top:10px}\n.divider{display:flex;align-items:center;gap:12px;margin:22px 0 4px;color:var(--ink-soft);font-weight:600}\n.divider::before,.divider::after{content:\"\";flex:1;height:2px;background:var(--maple-dk)}\n\n/* lobby */\n.roomcode{font-family:var(--display);font-weight:900;font-size:84px;letter-spacing:.08em;line-height:1}\n.panel{background:var(--paper);border:2px solid var(--ink);border-radius:14px;padding:14px;margin-top:16px}\n.plist{list-style:none;margin:0;padding:0}\n.plist li{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-weight:600}\n.plist li:last-child{border:0}\n.dot{width:28px;height:28px;border-radius:50%;display:inline-grid;place-items:center;color:#fff;font:800 14px var(--display);flex:none}\n.tag{font-size:13px;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--maple-lt)}\n.off{opacity:.45}\n.muted{color:var(--ink-soft);font-size:14px}\n\n/* draft */\n.topbar{display:flex;justify-content:space-between;align-items:baseline;font-weight:700}\n.topbar b{font-family:var(--display);font-size:22px}\n.card{\n  position:relative;margin-top:12px;background:var(--paper);border:3px solid var(--ink);border-radius:18px;\n  padding:18px 18px 16px;overflow:hidden;min-height:196px\n}\n.card::before{content:\"\";position:absolute;inset:0 auto 0 0;width:12px;background:var(--court)}\n.card.legend::before{background:var(--paddle)}\n.card .era{font-weight:700;font-size:14px;color:var(--court);padding-left:8px}\n.card .tags{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0 8px}\n.tagp{font-size:13px;font-weight:700;padding:2px 9px;border-radius:99px;background:var(--maple-lt)}\n.tagp.ball{background:transparent;border:1.5px dashed var(--maple-dk)}\n.pmv{font:800 18px var(--display);padding-left:4px}\n.pmv.up{color:var(--win)} .pmv.down{color:var(--paddle)}\n.fit{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}\n.fit span{font-size:13px;font-weight:700;padding:2px 9px;border-radius:99px}\n.fit .ok{background:color-mix(in srgb,var(--win) 18%,transparent);color:var(--win)}\n.fit .no{background:color-mix(in srgb,var(--paddle) 14%,transparent);color:var(--paddle)}\n.card.legend .era{color:var(--paddle)}\n.card .name{font-family:var(--display);font-weight:900;font-size:clamp(46px,14vw,74px);line-height:.88;margin:8px 0 12px 8px;text-wrap:balance}\n.card .meta{display:flex;gap:8px;align-items:center;padding-left:8px}\n.pos{font:800 18px var(--display);border:2px solid var(--ink);border-radius:6px;padding:1px 8px}\n.ovr{position:absolute;right:14px;top:12px;text-align:center;font-family:var(--display)}\n.ovr b{display:block;font-size:44px;font-weight:900;line-height:1}\n.ovr span{font-size:13px;font-weight:800}\n.card.spin .name{color:var(--ink-soft);filter:blur(.5px)}\n.card.land{animation:land .35s ease-out}\n@keyframes land{0%{transform:scale(.96)}60%{transform:scale(1.02)}100%{transform:scale(1)}}\n\n.bidbox{display:flex;justify-content:space-between;align-items:flex-end;margin-top:14px}\n.bidbox .amt{font-family:var(--display);font-weight:900;font-size:64px;line-height:.9}\n.bidbox .who{font-weight:700;text-align:right}\n.timer{height:8px;border-radius:99px;background:color-mix(in srgb,var(--ink) 18%,transparent);margin-top:10px;overflow:hidden}\n.timer i{display:block;height:100%;width:100%;background:var(--ink);transition:width .25s linear}\n.timer.low i{background:var(--paddle)}\n.status{font-weight:700;font-size:18px;margin:12px 0 10px;min-height:1.5em}\n.status.you{color:var(--paddle)}\n.stepper{display:grid;grid-template-columns:56px 1fr 56px;gap:8px;align-items:center}\n.stepper output{font:900 40px var(--display);text-align:center}\n.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}\n.chip{display:flex;align-items:center;gap:6px;background:var(--paper);border:2px solid var(--ink);border-radius:99px;padding:3px 10px 3px 3px;font-weight:600;font-size:14px}\n.chip .dot{width:22px;height:22px;font-size:12px}\n.chip.out{opacity:.35;text-decoration:line-through}\n.chip.lead{background:var(--solid-bg);color:var(--solid-fg)}\n.chip.turn{box-shadow:0 0 0 3px var(--paddle)}\n.toast{margin-top:12px;font-weight:600;background:var(--maple-lt);border-left:5px solid var(--ink);padding:8px 12px;border-radius:6px}\n\n.team h3{font-size:30px;display:flex;justify-content:space-between;align-items:baseline}\n.team h3 span{font-size:24px}\n.slots{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}\n.slot{border:2px dashed var(--maple-dk);border-radius:10px;padding:6px 10px;min-height:54px}\n.slot.full{border-style:solid;border-color:var(--ink);background:var(--slot)}\n.slot .s{font:800 14px var(--display);color:var(--ink-soft)}\n.slot .n{font-weight:700;line-height:1.15}\n.slot .p{font-size:13px;color:var(--ink-soft)}\ndetails.other{background:var(--paper);border:2px solid var(--ink);border-radius:12px;padding:10px 12px;margin-top:8px}\ndetails.other summary{display:flex;align-items:center;gap:10px;font-weight:700;cursor:pointer;list-style:none}\ndetails.other summary::-webkit-details-marker{display:none}\ndetails.other summary .r{margin-left:auto;font-family:var(--display);font-size:20px}\n.feed{list-style:none;padding:0;margin:10px 0 0;font-size:14px;color:var(--ink-soft)}\n.feed li{padding:3px 0}\n\n/* results */\n.champ{background:var(--solid-bg);color:var(--solid-fg);border-radius:18px;padding:20px;margin-top:14px;text-align:center}\n.champ .t{font-weight:700;color:var(--paddle)}\n.champ h2{font-size:clamp(52px,16vw,88px);font-weight:900;margin:6px 0}\ntable{width:100%;border-collapse:collapse;font-weight:600}\nth,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}\nth{font-size:13px;color:var(--ink-soft)}\ntd.num,th.num{text-align:right;font-variant-numeric:tabular-nums}\n.series{padding:10px 0;border-bottom:1px solid var(--line)}\n.series:last-child{border:0}\n.series b{font-family:var(--display);font-size:22px}\n.games{font-size:13px;color:var(--ink-soft);font-variant-numeric:tabular-nums}\n.setup{background:var(--paper);border:3px solid var(--paddle);border-radius:14px;padding:16px;margin-top:20px}\n.setup code{background:var(--maple-lt);padding:1px 5px;border-radius:4px}\n@media (prefers-reduced-motion:reduce){.card.land{animation:none}.timer i{transition:none}}\n</style>\n</head>\n<body>\n<div class=\"wrap\">\n<div id=\"conn\" class=\"toast\" hidden role=\"status\">Reconnecting\u2026</div>\n\n<section id=\"s-loading\" class=\"screen on\"><h1 class=\"logo\">$20<small>Draft</small></h1><p class=\"muted\">Connecting\u2026</p></section>\n\n<!-- HOME -->\n<section id=\"s-home\" class=\"screen\">\n  <h1 class=\"logo\">$20<small>Draft</small></h1>\n  <p class=\"lede\">Bid on NBA stars, legends and today's best. Everyone gets $20 to build a starting five and a sixth man.</p>\n  <label for=\"name\">Your name</label>\n  <input id=\"name\" maxlength=\"14\" autocomplete=\"nickname\" placeholder=\"Jeff\">\n  <div class=\"stack\" style=\"margin-top:14px\">\n    <button class=\"primary\" id=\"btn-create\">Create a room</button>\n  </div>\n  <div id=\"resume\" class=\"panel\" hidden>\n    <p style=\"margin:0 0 10px;font-weight:600\">You have a game in progress in room <b id=\"resume-code\"></b>.</p>\n    <div class=\"row\"><button class=\"red\" id=\"btn-resume\">Rejoin</button><button id=\"btn-forget\">Start fresh</button></div>\n  </div>\n  <div class=\"divider\">or join one</div>\n  <label for=\"code\">Room code</label>\n  <div class=\"row\">\n    <input id=\"code\" class=\"code\" maxlength=\"4\" autocomplete=\"off\" placeholder=\"ABCD\">\n    <button id=\"btn-join\" style=\"flex:.6\">Join</button>\n  </div>\n  <div class=\"err\" id=\"home-err\" role=\"alert\"></div>\n  <div class=\"divider\">or test it solo</div>\n  <div class=\"row\">\n    <select id=\"bot-count\" aria-label=\"Number of bots\" style=\"flex:.55\">\n      <option value=\"1\">1 bot</option><option value=\"2\">2 bots</option>\n      <option value=\"3\" selected>3 bots</option><option value=\"5\">5 bots</option><option value=\"7\">7 bots</option>\n    </select>\n    <button class=\"primary\" id=\"btn-practice\">Practice vs bots</button>\n  </div>\n  <p class=\"muted\">Runs only on your phone, so you can try the game before inviting anyone.</p>\n</section>\n\n<!-- LOBBY -->\n<section id=\"s-lobby\" class=\"screen\">\n  <p class=\"muted\" style=\"margin:8px 0 0\">Room code</p>\n  <div class=\"roomcode\" id=\"lobby-code\"></div>\n  <div class=\"panel\">\n    <h3 style=\"font-size:26px\">Players <span id=\"lobby-count\" class=\"muted\"></span></h3>\n    <ul class=\"plist\" id=\"lobby-players\"></ul>\n  </div>\n  <div class=\"panel\" id=\"lobby-settings\">\n    <label for=\"set-timer\" style=\"margin-top:0\">Turn timer</label>\n    <select id=\"set-timer\">\n      <option value=\"15\">15 seconds</option>\n      <option value=\"20\">20 seconds</option>\n      <option value=\"30\">30 seconds</option>\n      <option value=\"0\">No timer</option>\n    </select>\n    <p class=\"muted\">Budget is $20 per team. Fill PG, SG, SF, PF, C and a 6th man.</p>\n    <p class=\"muted\" id=\"lobby-rules\"></p>\n  </div>\n  <div class=\"stack\" style=\"margin-top:16px\">\n    <button class=\"primary\" id=\"btn-share\">Invite friends</button>\n    <button class=\"red\" id=\"btn-start\">Start the draft</button>\n    <p class=\"muted\" id=\"lobby-wait\" style=\"text-align:center\"></p>\n    <button id=\"btn-leave\">Leave room</button>\n  </div>\n</section>\n\n<!-- DRAFT -->\n<section id=\"s-draft\" class=\"screen\">\n  <div class=\"topbar\"><span>Room <b id=\"d-code\"></b></span><span id=\"d-card\"></span></div>\n  <div class=\"card\" id=\"d-cardbox\" aria-live=\"polite\">\n    <div class=\"era\" id=\"d-era\"></div>\n    <div class=\"ovr\"><b id=\"d-ovr\"></b><span>OVR</span></div>\n    <div class=\"name\" id=\"d-name\"></div>\n    <div class=\"meta\" id=\"d-pos\"></div>\n    <div class=\"tags\" id=\"d-tags\"></div>\n  </div>\n  <div class=\"bidbox\">\n    <div><div class=\"muted\">Current bid</div><div class=\"amt\" id=\"d-bid\">$0</div></div>\n    <div class=\"who\" id=\"d-leader\"></div>\n  </div>\n  <div class=\"timer\" id=\"d-timer\"><i></i></div>\n  <div class=\"status\" id=\"d-status\" aria-live=\"polite\"></div>\n  <div id=\"d-controls\">\n    <div class=\"stepper\">\n      <button id=\"b-minus\" aria-label=\"Lower bid\">\u2212</button>\n      <output id=\"b-val\">$1</output>\n      <button id=\"b-plus\" aria-label=\"Raise bid\">+</button>\n    </div>\n    <div class=\"row\" style=\"margin-top:10px\">\n      <button class=\"green\" id=\"b-bid\">Bid $1</button>\n      <button id=\"b-max\" style=\"flex:.5\">Max</button>\n      <button class=\"green\" id=\"b-pass\" style=\"flex:.9;white-space:nowrap\">Pass</button>\n    </div>\n  </div>\n  <div class=\"chips\" id=\"d-chips\"></div>\n  <div id=\"d-toast\"></div>\n  <button id=\"b-force\" style=\"margin-top:10px;display:none\">Skip this player's turn</button>\n\n  <div class=\"panel team\" id=\"d-myteam\"></div>\n  <div id=\"d-others\"></div>\n  <ul class=\"feed\" id=\"d-feed\"></ul>\n  <div class=\"row\" style=\"margin-top:16px\">\n    <button id=\"btn-quit\">Leave draft</button>\n    <button id=\"btn-end\" style=\"display:none\">End draft for everyone</button>\n  </div>\n</section>\n\n<!-- RESULTS -->\n<section id=\"s-results\" class=\"screen\">\n  <div class=\"champ\">\n    <div class=\"t\">Champion</div>\n    <h2 id=\"r-champ\"></h2>\n    <div id=\"r-champsub\"></div>\n  </div>\n  <div class=\"panel\">\n    <h3 style=\"font-size:28px\">Standings</h3>\n    <table><thead><tr><th>Team</th><th class=\"num\">Rating</th><th class=\"num\">Series</th><th class=\"num\">Games</th></tr></thead><tbody id=\"r-table\"></tbody></table>\n  </div>\n  <div class=\"panel\"><h3 style=\"font-size:28px\">Best-of-7 series</h3><div id=\"r-series\"></div></div>\n  <div id=\"r-teams\"></div>\n  <div class=\"stack\" style=\"margin-top:16px\">\n    <button class=\"red\" id=\"btn-again\">Run it back</button>\n    <button id=\"btn-exit\">Leave room</button>\n  </div>\n</section>\n\n</div>\n\n<script>\n/* =========================================================\n   2) PLAYER POOL \u2014 stars and superstars only\n   [name, positions, overall, era]\n   ========================================================= */\n/* 2026-27 season pool \u2014 stars & superstars, current teams after the 2026 offseason.\n   [name, positions, overall, team, est. +/- per 100 possessions, fit tags]\n   Tags: PM playmaker \u00b7 SH shooter \u00b7 RIM rim protector \u00b7 DEF perimeter defender \u00b7 BALL ball-dominant\n   Overall follows ESPN's 2026 NBA Rank order; +/- is an estimate of on-court impact, not an official stat. */\nconst RAW = [\n  [\"Nikola Joki\u0107\",\"C\",98,\"DEN\",10.5,\"PM BALL\"],[\"Shai Gilgeous-Alexander\",\"PG/SG\",97,\"OKC\",9.5,\"PM BALL DEF\"],\n  [\"Victor Wembanyama\",\"C/PF\",97,\"SAS\",9.0,\"RIM SH DEF\"],[\"Luka Don\u010di\u0107\",\"PG/SG\",96,\"LAL\",7.5,\"PM BALL SH\"],\n  [\"Giannis Antetokounmpo\",\"PF/C\",95,\"MIA\",7.5,\"BALL RIM\"],[\"Jalen Brunson\",\"PG\",94,\"NYK\",5.0,\"PM BALL SH\"],\n  [\"Cade Cunningham\",\"PG\",94,\"DET\",6.0,\"PM BALL\"],[\"Anthony Edwards\",\"SG/SF\",93,\"MIN\",5.0,\"BALL SH DEF\"],\n  [\"Jayson Tatum\",\"SF/PF\",93,\"BOS\",6.0,\"BALL SH DEF\"],[\"Donovan Mitchell\",\"SG/PG\",93,\"CLE\",5.0,\"BALL SH\"],\n  [\"Tyrese Maxey\",\"PG/SG\",91,\"PHI\",4.0,\"BALL SH\"],[\"Stephen Curry\",\"PG\",91,\"GSW\",6.5,\"PM BALL SH\"],\n  [\"Kevin Durant\",\"SF/PF\",91,\"HOU\",4.5,\"BALL SH\"],[\"Jaylen Brown\",\"SG/SF\",90,\"PHI\",3.5,\"BALL DEF\"],\n  [\"Kawhi Leonard\",\"SF\",90,\"TOR\",5.5,\"BALL SH DEF\"],[\"Karl-Anthony Towns\",\"C/PF\",90,\"NYK\",4.0,\"SH\"],\n  [\"Scottie Barnes\",\"SF/PF\",89,\"TOR\",4.0,\"PM DEF\"],[\"LeBron James\",\"SF/PF\",89,\"PHI\",4.0,\"PM BALL\"],\n  [\"Tyrese Haliburton\",\"PG\",89,\"IND\",4.5,\"PM SH\"],[\"Devin Booker\",\"SG/PG\",89,\"PHX\",3.0,\"BALL SH PM\"],\n  [\"Jamal Murray\",\"PG\",88,\"DEN\",3.5,\"PM SH\"],[\"Jalen Johnson\",\"SF/PF\",88,\"ATL\",3.5,\"PM DEF\"],\n  [\"Cooper Flagg\",\"SF/PF\",88,\"DAL\",2.5,\"BALL DEF\"],[\"Chet Holmgren\",\"C/PF\",88,\"OKC\",5.0,\"RIM SH\"],\n  [\"Jalen Williams\",\"SG/SF\",87,\"OKC\",3.5,\"DEF\"],[\"Evan Mobley\",\"PF/C\",87,\"CLE\",4.0,\"RIM DEF\"],\n  [\"Deni Avdija\",\"SF\",87,\"POR\",3.0,\"PM\"],[\"Bam Adebayo\",\"C\",87,\"MIA\",3.0,\"RIM DEF\"],\n  [\"Pascal Siakam\",\"PF\",86,\"IND\",2.5,\"\"],[\"Alperen \u015eeng\u00fcn\",\"C\",86,\"HOU\",2.5,\"PM\"],\n  [\"Amen Thompson\",\"SF/PG\",86,\"HOU\",3.0,\"DEF PM\"],[\"James Harden\",\"PG\",86,\"CLE\",3.0,\"PM BALL SH\"],\n  [\"Jalen Duren\",\"C\",86,\"DET\",2.5,\"RIM\"],[\"OG Anunoby\",\"SF/PF\",85,\"NYK\",3.5,\"DEF SH\"],\n  [\"LaMelo Ball\",\"PG\",85,\"MIN\",2.0,\"PM BALL SH\"],[\"Paolo Banchero\",\"PF\",85,\"ORL\",1.5,\"BALL\"],\n  [\"Austin Reaves\",\"SG/PG\",85,\"LAL\",2.5,\"SH PM\"],[\"Stephon Castle\",\"PG/SG\",85,\"SAS\",2.5,\"DEF PM\"],\n  [\"Kyrie Irving\",\"PG/SG\",85,\"DAL\",2.5,\"BALL SH\"],[\"Anthony Davis\",\"PF/C\",85,\"WAS\",3.0,\"RIM DEF\"],\n  [\"Joel Embiid\",\"C\",85,\"PHI\",3.0,\"BALL RIM\"],[\"Rudy Gobert\",\"C\",84,\"MIN\",3.5,\"RIM\"],\n  [\"De'Aaron Fox\",\"PG\",84,\"SAS\",1.0,\"BALL\"],[\"Trae Young\",\"PG\",84,\"WAS\",1.0,\"PM BALL SH\"],\n  [\"Franz Wagner\",\"SF\",84,\"ORL\",2.0,\"\"],[\"Brandon Miller\",\"SF\",84,\"CHA\",1.0,\"SH\"],\n  [\"Derrick White\",\"SG/PG\",84,\"BOS\",3.5,\"DEF SH\"],[\"Kon Knueppel\",\"SG/SF\",84,\"CHA\",2.0,\"SH\"],\n  [\"Lauri Markkanen\",\"PF\",83,\"UTA\",1.5,\"SH\"],[\"Dylan Harper\",\"SG/PG\",83,\"SAS\",2.0,\"PM\"],\n  [\"Zion Williamson\",\"PF\",83,\"NOP\",1.5,\"BALL\"],[\"Jaren Jackson Jr.\",\"PF/C\",83,\"UTA\",2.0,\"RIM SH\"],\n  [\"Desmond Bane\",\"SG\",83,\"ORL\",2.0,\"SH\"],[\"Darius Garland\",\"PG\",83,\"LAC\",1.5,\"PM SH\"],\n  [\"AJ Dybantsa\",\"SF\",82,\"WAS\",0.0,\"BALL\"],[\"Darryn Peterson\",\"SG\",82,\"UTA\",0.0,\"SH\"]\n];\nconst PLAYERS = RAW.map(([name,pos,r,team,pm,tags])=>({name,pos:pos.split(\"/\"),r,team,pm,tags:tags?tags.split(\" \"):[],tier:r>=93?\"Superstar\":\"Star\"}));\nconst TAG_LABEL = {PM:\"Playmaker\",SH:\"Shooter\",RIM:\"Rim protector\",DEF:\"Defender\",BALL:\"Ball-dominant\"};\nconst P = i => PLAYERS[i];\nconst SLOTS = [\"PG\",\"SG\",\"SF\",\"PF\",\"C\",\"SIX\"];\nconst SLOT_LABEL = {PG:\"PG\",SG:\"SG\",SF:\"SF\",PF:\"PF\",C:\"C\",SIX:\"6th man\"};\nconst COLORS = [\"#C42F2A\",\"#1F4E8C\",\"#1E7B4F\",\"#7A3FA0\",\"#D97A00\",\"#0F7C8C\",\"#B0306E\",\"#4A4658\"];\nconst BUDGET = 20;\n\n/* ---------- game rules (run inside transactions) ---------- */\nfunction norm(r){\n  r.players=r.players||{}; r.settings=r.settings||{budget:BUDGET,timer:20};\n  r.order=r.order||[]; r.pool=r.pool||[]; r.teams=r.teams||{}; r.log=r.log||[]; r.seen=r.seen||{};\n  Object.values(r.teams).forEach(t=>{t.roster=t.roster||{};t.paid=t.paid||{}});\n  if(r.round) r.round.active=r.round.active||{};\n  return r;\n}\nconst openSlots = t => SLOTS.filter(s=>t.roster[s]==null);\nfunction fitSlot(t,pid){for(const p of P(pid).pos) if(t.roster[p]==null) return p; return t.roster.SIX==null?\"SIX\":null}\nconst maxBid = t => t.budget-(openSlots(t).length-1);\nconst canBid = (t,pid,cur) => fitSlot(t,pid)!=null && maxBid(t)>cur;\nconst isFull = t => openSlots(t).length===0;\nconst pname = (r,u) => (r.players[u]||{}).name||\"Someone\";\nfunction addLog(r,m){r.log=r.log.concat([m]).slice(-12)}\nconst deadline = r => r.settings.timer ? now()+r.settings.timer*1000 : 0;\n\nfunction startCard(r){\n  let refilled=false;\n  while(true){\n    const alive=r.order.filter(u=>!(r.players[u]||{}).left);\n    if(alive.every(u=>isFull(r.teams[u]))){ finish(r); return; }\n    if(!r.pool.length){\n      // pool ran dry before every team is full: bring in stars nobody owns yet.\n      // At most once per empty pool and 3 times per draft, so it can never loop forever.\n      if(refilled || (r.refills||0)>=3){ finish(r); return; }\n      const owned=new Set(); Object.values(r.teams).forEach(t=>Object.values(t.roster).forEach(x=>owned.add(x)));\n      const extra=shuffle(PLAYERS.map((_,i)=>i).filter(i=>!owned.has(i)));\n      if(!extra.length){ finish(r); return; }\n      refilled=true; r.refills=(r.refills||0)+1;\n      r.pool=extra.slice(0,10); r.seen={}; addLog(r,\"More players added to the pool\");\n    }\n    const pid=r.pool.shift();\n    r.seen[pid]=(r.seen[pid]||0)+1;\n    const elig=alive.filter(u=>canBid(r.teams[u],pid,0));\n    if(!elig.length) continue;\n    const cardNo=(r.cardNo||0)+1; r.cardNo=cardNo;\n    const starter=(cardNo-1)%r.order.length;\n    const active={}; elig.forEach(u=>active[u]=true);\n    let turn=null;\n    for(let k=0;k<r.order.length;k++){const u=r.order[(starter+k)%r.order.length]; if(active[u]){turn=u;break}}\n    r.round={pid,bid:0,bidder:null,active,turn,opener:turn,cardNo,deadline:deadline(r)};\n    return;\n  }\n}\n\n/* awards or discards the current player if bidding is over; returns true if it moved on */\nfunction settle(r){\n  const rd=r.round;\n  Object.keys(rd.active).forEach(u=>{ if((r.players[u]||{}).left || (u!==rd.bidder && !canBid(r.teams[u],rd.pid,rd.bid))) delete rd.active[u]; });\n  const act=Object.keys(rd.active), others=act.filter(u=>u!==rd.bidder);\n  if(rd.bidder && !others.length){ award(r); return true; }\n  if(!rd.bidder && !act.length){\n    addLog(r,`Nobody bid on ${P(rd.pid).name}`);\n    if((r.seen[rd.pid]||0)<4) r.pool.push(rd.pid);\n    r.lastPick={pid:rd.pid,uid:null,bid:0,cardNo:rd.cardNo};\n    startCard(r); return true;\n  }\n  return false;\n}\nfunction advance(r,fromUid){\n  const rd=r.round;\n  if(settle(r)) return;\n  const i=r.order.indexOf(fromUid);\n  for(let k=1;k<=r.order.length;k++){\n    const u=r.order[(i+k)%r.order.length];\n    if(rd.active[u] && u!==rd.bidder){ rd.turn=u; break; }\n  }\n  rd.deadline=deadline(r);\n}\n\nfunction award(r){\n  const rd=r.round, t=r.teams[rd.bidder], slot=fitSlot(t,rd.pid);\n  t.budget-=rd.bid; t.roster[slot]=rd.pid; t.paid[slot]=rd.bid;\n  r.lastPick={pid:rd.pid,uid:rd.bidder,bid:rd.bid,slot,cardNo:rd.cardNo};\n  addLog(r,`${pname(r,rd.bidder)} won ${P(rd.pid).name} for $${rd.bid} (${SLOT_LABEL[slot]})`);\n  startCard(r);\n}\n\nfunction finish(r){r.status=\"done\";r.round=null;r.seed=Math.floor(Math.random()*1e9)}\n\n\n/* team strength = talent + on-court +/- + how well the pieces fit together */\nfunction teamFit(t){\n  const st=[\"PG\",\"SG\",\"SF\",\"PF\",\"C\"].map(s=>t.roster[s]).filter(x=>x!=null).map(P);\n  const has=tag=>st.filter(p=>p.tags.includes(tag)).length;\n  const notes=[]; let fit=0;\n  const pm=has(\"PM\"), sh=has(\"SH\"), rim=has(\"RIM\"), def=has(\"DEF\"), ball=has(\"BALL\");\n  if(pm){fit+=1.5;notes.push([\"ok\",\"Playmaker\"])} else {fit-=2.5;notes.push([\"no\",\"No playmaker\"])}\n  if(sh>=3){fit+=2;notes.push([\"ok\",`Shooting (${sh})`])} else if(sh===2){fit+=1;notes.push([\"ok\",\"Shooting (2)\"])} else {fit-=sh?0.5:2.5;notes.push([\"no\",`Shooting (${sh})`])}\n  if(rim){fit+=1.5;notes.push([\"ok\",\"Rim protector\"])} else {fit-=2;notes.push([\"no\",\"No rim protector\"])}\n  if(def>=2){fit+=1.5;notes.push([\"ok\",`Defenders (${def})`])} else if(def===1){fit+=0.5;notes.push([\"ok\",\"Defender (1)\"])} else {fit-=1;notes.push([\"no\",\"No defenders\"])}\n  if(ball>2){fit-=1.5*(ball-2);notes.push([\"no\",`Too many ball-dominant (${ball})`])}\n  return {fit,notes};\n}\nfunction rating(t){\n  const st=[\"PG\",\"SG\",\"SF\",\"PF\",\"C\"].map(s=>t.roster[s]);\n  const six=t.roster.SIX;\n  const ovr=st.reduce((a,x)=>a+(x!=null?P(x).r:60),0)/5*0.85+(six!=null?P(six).r:60)*0.15;\n  const pm=st.reduce((a,x)=>a+(x!=null?P(x).pm:-4),0)+(six!=null?P(six).pm*0.5:-2);\n  const {fit,notes}=teamFit(t);\n  return {total:ovr+pm*0.35+fit, ovr, pm, fit, notes};\n}\nfunction shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}\n/* actions shared by the server and practice mode; each returns true if it changed the room */\nfunction applyBid(r,u,amount){\n  const rd=r.round; if(r.status!==\"drafting\"||!rd||rd.turn!==u) return false;\n  const t=r.teams[u]; amount=Math.floor(Number(amount));\n  if(!(amount>rd.bid)||amount>maxBid(t)||fitSlot(t,rd.pid)==null) return false;\n  rd.bid=amount; rd.bidder=u; advance(r,u); return true;\n}\n/* the first person up on a player must open with at least $1; after that, passing is free */\nconst mustOpen = (r,u) => !!(r.round && r.round.turn===u && r.round.opener===u && !r.round.bidder);\nfunction applyPass(r,u,reason){\n  const rd=r.round; if(r.status!==\"drafting\"||!rd||rd.turn!==u) return false;\n  if(mustOpen(r,u)) return false;\n  delete rd.active[u]; if(reason) addLog(r,`${pname(r,u)} ${reason}`);\n  advance(r,u); return true;\n}\n/* out of time (or skipped by the host): the opener is auto-bid $1, anyone else passes */\nfunction applyTimeout(r,u,reason){\n  if(mustOpen(r,u)){ addLog(r,`${pname(r,u)} ${reason} \u2014 opened at $1`); return applyBid(r,u,1); }\n  return applyPass(r,u,reason);\n}\nfunction applySettings(r,u,timer){\n  timer=Number(timer); if(r.status!==\"lobby\"||r.hostId!==u||![0,15,20,30].includes(timer)) return false;\n  r.settings.timer=timer; return true;\n}\nfunction applyStart(r,u){\n  if(r.status!==\"lobby\"||r.hostId!==u) return false;\n  const uids=Object.keys(r.players); if(uids.length<2) return false;\n  r.order=shuffle(uids); r.teams={};\n  uids.forEach(x=>r.teams[x]={budget:r.settings.budget||BUDGET,roster:{},paid:{}});\n  r.pool=buildPool(uids.length); r.seen={}; r.refills=0; r.round=null; r.log=[]; r.lastPick=null; r.cardNo=0; r.seed=null;\n  r.status=\"drafting\"; startCard(r); return true;\n}\n/* draft pool: 10 players per person, with at least one superstar per person */\nconst POOL_PER_PLAYER = 10;\nfunction buildPool(n){\n  const size=Math.min(PLAYERS.length, n*POOL_PER_PLAYER);\n  const ids=PLAYERS.map((_,i)=>i);\n  const sup=shuffle(ids.filter(i=>PLAYERS[i].tier===\"Superstar\")).slice(0,Math.min(n,size));\n  const rest=shuffle(ids.filter(i=>!sup.includes(i))).slice(0,size-sup.length);\n  return shuffle(sup.concat(rest));\n}\nfunction applyLeave(r,u){\n  if(r.status!==\"drafting\"||!r.players[u]||r.players[u].left) return false;\n  r.players[u].left=true; addLog(r,`${pname(r,u)} left the draft`);\n  const alive=r.order.filter(x=>!(r.players[x]||{}).left);\n  if(r.hostId===u && alive.length) r.hostId=alive[0];\n  if(alive.length<2){ addLog(r,\"Draft ended early\"); finish(r); return true; }\n  const rd=r.round; if(!rd) return true;\n  if(rd.bidder===u){ addLog(r,`${P(rd.pid).name} was skipped`); startCard(r); return true; }\n  delete rd.active[u];\n  if(rd.turn===u) advance(r,u); else settle(r);\n  return true;\n}\nfunction applyEnd(r,u){\n  if(r.status!==\"drafting\"||r.hostId!==u) return false;\n  addLog(r,`${pname(r,u)} ended the draft`); finish(r); return true;\n}\nfunction applyAgain(r,u){\n  if(r.status!==\"done\"||r.hostId!==u) return false;\n  r.status=\"lobby\"; r.teams={}; r.round=null; r.pool=[]; r.order=[]; r.log=[]; r.lastPick=null; r.seed=null; r.cardNo=0;\n  Object.keys(r.players).forEach(x=>{ if(r.players[x].left) delete r.players[x]; });\n  return true;\n}\n\n/* =========================================================\n   3) APP\n   ========================================================= */\nconst $ = id => document.getElementById(id);\nconst esc = s => String(s).replace(/[&<>\"']/g,c=>({\"&\":\"&amp;\",\"<\":\"&lt;\",\">\":\"&gt;\",'\"':\"&quot;\",\"'\":\"&#39;\"}[c]));\nconst store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};\nlet me=store.get(\"d20pid\");\nif(!me){ me=\"p\"+Math.random().toString(36).slice(2,10)+Date.now().toString(36); store.set(\"d20pid\",me); }\nlet ws=null, code=null, room=null, offset=0, retryTimer=null, createTries=0;\nlet practice=false, localRoom=null, botTimer=null;\nlet bidVal=1, lastCardShown=0, lastBidSeen=-1, timeoutSent={};\nconst now = () => Date.now()+(practice?0:offset);\nfunction show(id){document.querySelectorAll(\".screen\").forEach(s=>s.classList.toggle(\"on\",s.id===id))}\nfunction makeCode(){const L=\"ABCDEFGHJKLMNPQRSTUVWXYZ\";let s=\"\";for(let i=0;i<4;i++)s+=L[Math.floor(Math.random()*L.length)];return s}\nfunction getName(){const n=$(\"name\").value.trim().slice(0,14);if(!n){$(\"home-err\").textContent=\"Enter your name first.\";return null}store.set(\"d20name\",n);return n}\nfunction homeError(msg){ $(\"home-err\").textContent=msg||\"\"; }\n\n/* ---------- connection ---------- */\nfunction closeWs(){ clearTimeout(retryTimer); if(ws){ const w=ws; ws=null; try{w.close()}catch(e){} } }\nfunction connect(c,hello){\n  closeWs(); code=c;\n  const sock=new WebSocket(`${location.protocol===\"https:\"?\"wss\":\"ws\"}://${location.host}/ws/${c}`);\n  ws=sock; lastMsg=Date.now();\n  sock.onopen=()=>sock.send(JSON.stringify({...hello,pid:me}));\n  sock.onmessage=e=>{\n    if(sock!==ws) return;\n    let m; try{m=JSON.parse(e.data)}catch(_){return}\n    lastMsg=Date.now();\n    if(m.t===\"pong\") return;\n    if(m.t===\"state\"){\n      offset=m.now-Date.now(); $(\"conn\").hidden=true;\n      if(!m.room||!m.room.players||!m.room.players[me]){ leaveLocal(); return; }\n      store.set(\"d20room\",c); room=norm(m.room); render();\n      if(pending){ const p=pending; pending=null; sock.send(JSON.stringify(p)); }\n    } else if(m.t===\"error\"){\n      if(m.code===\"taken\" && hello.t===\"create\" && createTries++<6){ connect(makeCode(),hello); return; }\n      closeWs(); code=null; room=null; store.del(\"d20room\"); showHome(); homeError(m.msg||\"Something went wrong. Try again.\");\n    } else if(m.t===\"left\"){ leaveLocal(); }\n  };\n  sock.onclose=()=>{\n    if(sock!==ws) return;\n    ws=null;\n    if(code===c && room){ $(\"conn\").hidden=false; retryTimer=setTimeout(()=>connect(c,{t:\"join\",name:store.get(\"d20name\")||\"Player\"}),1500); }\n    else if(code===c){ code=null; showHome(); homeError(\"Couldn't reach that room. Check the code and try again.\"); }\n  };\n}\n/* phones silently kill sockets in the background, so: heartbeat, reconnect on wake, and retry the last tap */\nlet lastMsg=Date.now(), pending=null;\nfunction reconnect(){ if(!practice && code && room){ $(\"conn\").hidden=false; connect(code,{t:\"join\",name:store.get(\"d20name\")||\"Player\"}); } }\nfunction send(o){\n  if(ws&&ws.readyState===1&&Date.now()-lastMsg<20000){ ws.send(JSON.stringify(o)); return; }\n  pending=o; reconnect();\n}\nsetInterval(()=>{\n  if(practice||!code||!room) return;\n  if(ws&&ws.readyState===1) ws.send(JSON.stringify({t:\"ping\"}));\n  if(Date.now()-lastMsg>20000) reconnect();\n},8000);\ndocument.addEventListener(\"visibilitychange\",()=>{ if(document.visibilityState===\"visible\"){ lastMsg=0; reconnect(); } });\nwindow.addEventListener(\"pageshow\",e=>{ if(e.persisted){ lastMsg=0; reconnect(); } });\n\n/* ---------- home ---------- */\n$(\"name\").value=store.get(\"d20name\")||\"\";\n$(\"btn-create\").onclick=()=>{ const name=getName(); if(!name) return; homeError(\"\"); createTries=0; connect(makeCode(),{t:\"create\",name}); };\n$(\"btn-join\").onclick=()=>{\n  const name=getName(); if(!name) return;\n  const c=$(\"code\").value.trim().toUpperCase();\n  if(!/^[A-Z]{4}$/.test(c)){homeError(\"Room codes are 4 letters.\");return}\n  homeError(\"\"); connect(c,{t:\"join\",name});\n};\nconst urlCode=(new URLSearchParams(location.search).get(\"room\")||\"\").toUpperCase();\nif(/^[A-Z]{4}$/.test(urlCode)) $(\"code\").value=urlCode;\nfunction showHome(){\n  const saved=store.get(\"d20room\");\n  const ok=saved && /^[A-Z]{4}$/.test(saved) && !(/^[A-Z]{4}$/.test(urlCode) && urlCode!==saved);\n  $(\"resume\").hidden=!ok; if(ok) $(\"resume-code\").textContent=saved;\n  show(\"s-home\");\n}\n$(\"btn-resume\").onclick=()=>{ const s=store.get(\"d20room\"); if(s){ homeError(\"\"); connect(s,{t:\"join\",name:store.get(\"d20name\")||\"Player\"}); } };\n$(\"btn-forget\").onclick=()=>{ store.del(\"d20room\"); $(\"resume\").hidden=true; };\nshowHome();\n\nfunction leaveLocal(){\n  if(practice){practice=false;localRoom=null;clearTimeout(botTimer)}\n  closeWs(); room=null; code=null; pending=null; store.del(\"d20room\"); $(\"conn\").hidden=true; showHome();\n}\nfunction leaveRoom(){ if(practice) return leaveLocal(); if(ws&&ws.readyState===1) ws.send(JSON.stringify({t:\"leave\"})); setTimeout(leaveLocal,150); }\n$(\"btn-quit\").onclick=()=>{ if(confirm(practice?\"Exit this practice draft?\":\"Leave this draft? Your turns will be skipped and you can't come back.\")) leaveRoom(); };\n$(\"btn-end\").onclick=()=>{ if(confirm(\"End the draft now? Results will use the teams as they are.\")){ practice?localAct(r=>applyEnd(r,me)):send({t:\"end\"}); } };\n$(\"btn-leave\").onclick=leaveRoom; $(\"btn-exit\").onclick=leaveRoom;\n\n/* ---------- actions ---------- */\nfunction localAct(fn){\n  const r=norm(JSON.parse(JSON.stringify(localRoom)));\n  if(!fn(r)) return;\n  localRoom=r; room=norm(JSON.parse(JSON.stringify(r))); render(); botTick();\n}\nfunction doBid(amount){ practice?localAct(r=>applyBid(r,me,amount)):send({t:\"bid\",amount}); }\nfunction doPass(){ practice?localAct(r=>applyPass(r,me)):send({t:\"pass\"}); }\n$(\"btn-start\").onclick=()=>{ practice?localAct(r=>applyStart(r,me)):send({t:\"start\"}); };\n$(\"btn-again\").onclick=()=>{ practice?localAct(r=>applyAgain(r,me)):send({t:\"again\"}); };\n$(\"set-timer\").onchange=()=>{ const v=Number($(\"set-timer\").value); practice?localAct(r=>applySettings(r,me,v)):send({t:\"settings\",timer:v}); };\n$(\"b-force\").onclick=()=>send({t:\"skip\"});\n$(\"btn-share\").onclick=async()=>{\n  const link=`${location.origin}/?room=${code}`;\n  try{ if(navigator.share){ await navigator.share({title:\"$20 Draft\",text:`Join my $20 NBA Draft \u2014 room ${code}`,url:link}); return; } }catch(e){ return; }\n  try{ await navigator.clipboard.writeText(link); $(\"btn-share\").textContent=\"Link copied\"; setTimeout(()=>$(\"btn-share\").textContent=\"Invite friends\",1800); }catch(e){ prompt(\"Copy this link:\",link); }\n};\n\n/* ---------- practice mode (local, vs bots) ---------- */\nconst BOT_NAMES=[\"Hoops Bot\",\"Buckets Bot\",\"Glass Bot\",\"Swish Bot\",\"Dime Bot\",\"Block Bot\",\"Clutch Bot\"];\nfunction startPractice(nBots){\n  closeWs(); practice=true; code=\"TEST\";\n  const name=($(\"name\").value.trim()||\"You\").slice(0,14);\n  const players={[me]:{name,color:0,joinedAt:1}};\n  for(let i=0;i<nBots;i++) players[\"bot\"+i]={name:BOT_NAMES[i],color:i+1,joinedAt:2+i,bot:true};\n  localRoom={hostId:me,status:\"lobby\",createdAt:Date.now(),settings:{budget:BUDGET,timer:30},players};\n  lastCardShown=0; room=norm(JSON.parse(JSON.stringify(localRoom))); render();\n}\n$(\"btn-practice\").onclick=()=>startPractice(Number($(\"bot-count\").value));\nfunction botTick(){\n  clearTimeout(botTimer);\n  if(!practice||!room||room.status!==\"drafting\"||!room.round) return;\n  const u=room.round.turn; if(!(room.players[u]||{}).bot) return;\n  const key=room.round.cardNo+\"|\"+u+\"|\"+room.round.bid;\n  botTimer=setTimeout(()=>{\n    localAct(r=>{\n      const rd=r.round; if(!rd||r.status!==\"drafting\"||rd.turn!==u||(rd.cardNo+\"|\"+u+\"|\"+rd.bid)!==key) return false;\n      const t=r.teams[u], pl=P(rd.pid), open=openSlots(t).length, perSlot=t.budget/Math.max(open,1);\n      const before=teamFit(t).fit, tt=JSON.parse(JSON.stringify(t)); const sl=fitSlot(tt,rd.pid); if(sl) tt.roster[sl]=rd.pid;\n      const fitGain=sl&&sl!==\"SIX\"?teamFit(tt).fit-before:0;\n      let worth=Math.round(((pl.r-82)*0.45+pl.pm*0.4+fitGain*0.6)*(perSlot/3.3)+(Math.random()*2-1));\n      if(fitSlot(t,rd.pid)!==\"SIX\") worth+=1;\n      worth=Math.max(1,Math.min(worth,maxBid(t)));\n      if(mustOpen(r,u)) return applyBid(r,u,Math.max(1,Math.min(worth,1+(Math.random()<.35?1:0))));\n      if(canBid(t,rd.pid,rd.bid) && worth>rd.bid) return applyBid(r,u,Math.min(worth,rd.bid+1+(Math.random()<.35?1:0)));\n      return applyPass(r,u);\n    });\n  },650+Math.random()*700);\n}\n\n/* ---------- controls ---------- */\nfunction clampBid(){\n  if(!room||!room.round) return;\n  const t=room.teams[me]; if(!t) return;\n  const lo=room.round.bid+1, hi=Math.max(lo,maxBid(t));\n  bidVal=Math.min(Math.max(bidVal,lo),hi);\n}\n$(\"b-minus\").onclick=()=>{bidVal--;clampBid();renderControls()};\n$(\"b-plus\").onclick=()=>{bidVal++;clampBid();renderControls()};\n$(\"b-max\").onclick=()=>{ if(room&&room.teams[me]) doBid(maxBid(room.teams[me])); };\n$(\"b-bid\").onclick=()=>doBid(bidVal);\n$(\"b-pass\").onclick=doPass;\n/* ---------- render ---------- */\nfunction dot(r,u){const p=r.players[u]||{name:\"?\",color:7};return `<span class=\"dot\" style=\"background:${COLORS[p.color%8]}\">${esc(p.name[0].toUpperCase())}</span>`}\n\nfunction render(){\n  if(room.status===\"lobby\") return renderLobby();\n  if(room.status===\"drafting\") return renderDraft();\n  if(room.status===\"done\") return renderResults();\n}\n\nfunction renderLobby(){\n  show(\"s-lobby\");\n  $(\"lobby-code\").textContent=practice?\"TEST\":code;\n  $(\"btn-share\").style.display=practice?\"none\":\"\";\n  $(\"btn-leave\").textContent=practice?\"Exit practice\":\"Leave room\";\n  const ids=Object.keys(room.players).sort((a,b)=>(room.players[a].joinedAt||0)-(room.players[b].joinedAt||0));\n  $(\"lobby-count\").textContent=`${ids.length}/8`;\n  const poolN=Math.min(PLAYERS.length,Math.max(ids.length,2)*POOL_PER_PLAYER);\n  $(\"lobby-rules\").textContent=`Draft pool: ${poolN} players (10 per person). Whoever is up first on a player must open at $1 or more \u2014 if everyone else passes, he's theirs. After that, passing is free. Full at his position and 6th man? You're skipped.`;\n  $(\"lobby-players\").innerHTML=ids.map(u=>{\n    const p=room.players[u];\n    return `<li class=\"${p.online===false?\"off\":\"\"}\">${dot(room,u)}${esc(p.name)}${u===me?' <span class=\"tag\">You</span>':\"\"}${u===room.hostId?' <span class=\"tag\">Host</span>':\"\"}</li>`;\n  }).join(\"\");\n  const host=room.hostId===me;\n  $(\"set-timer\").value=String(room.settings.timer??20);\n  $(\"set-timer\").disabled=!host;\n  $(\"btn-start\").style.display=host?\"\":\"none\";\n  $(\"btn-start\").disabled=ids.length<2;\n  if(practice){$(\"lobby-wait\").textContent=\"Practice game \u2014 bots bid on their own.\";}\n  else $(\"lobby-wait\").textContent=host?(ids.length<2?\"Need at least 2 players to start.\":\"\"):\"Waiting for the host to start the draft.\";\n  lastCardShown=0;\n}\n\nfunction renderCard(pid,spin){\n  const pl=P(pid), box=$(\"d-cardbox\");\n  box.classList.toggle(\"legend\",pl.tier===\"Superstar\");\n  $(\"d-era\").textContent=`${pl.tier} \u00b7 ${pl.team} \u00b7 2026\u201327`;\n  $(\"d-name\").textContent=pl.name;\n  $(\"d-ovr\").textContent=pl.r;\n  $(\"d-pos\").innerHTML=pl.pos.map(p=>`<span class=\"pos\">${p}</span>`).join(\"\")+`<span class=\"pmv ${pl.pm>0?\"up\":pl.pm<0?\"down\":\"\"}\">${pl.pm>0?\"+\":\"\"}${pl.pm.toFixed(1)} +/-</span>`;\n  $(\"d-tags\").innerHTML=pl.tags.map(t=>`<span class=\"tagp ${t===\"BALL\"?\"ball\":\"\"}\">${TAG_LABEL[t]}</span>`).join(\"\");\n  box.classList.toggle(\"spin\",!!spin);\n}\n\nfunction revealCard(pid){\n  const box=$(\"d-cardbox\");\n  const reduce=matchMedia(\"(prefers-reduced-motion: reduce)\").matches;\n  if(reduce){renderCard(pid);return}\n  let n=0;\n  const iv=setInterval(()=>{\n    renderCard(Math.floor(Math.random()*PLAYERS.length),true);\n    if(++n>=12){clearInterval(iv);renderCard(pid);box.classList.remove(\"land\");void box.offsetWidth;box.classList.add(\"land\")}\n  },60);\n}\n\nfunction renderDraft(){\n  show(\"s-draft\");\n  const rd=room.round; if(!rd) return;\n  $(\"d-code\").textContent=code;\n  $(\"d-card\").textContent=`Player ${rd.cardNo} \u00b7 ${room.pool.length} left`;\n  if(rd.cardNo!==lastCardShown){lastCardShown=rd.cardNo;lastBidSeen=-1;revealCard(rd.pid)}\n  if(rd.bid!==lastBidSeen){lastBidSeen=rd.bid;bidVal=rd.bid+1}\n  clampBid();\n\n  $(\"d-bid\").textContent=\"$\"+rd.bid;\n  $(\"d-leader\").innerHTML=rd.bidder?`${dot(room,rd.bidder)}<div>${esc(pname(room,rd.bidder))}${rd.bidder===me?\" (you)\":\"\"}</div>`:'<span class=\"muted\">No bids yet</span>';\n\n  const t=room.teams[me];\n  const st=$(\"d-status\");\n  st.classList.remove(\"you\");\n  if(mustOpen(room,me)){st.textContent=\"You're up first \u2014 open with at least $1\";st.classList.add(\"you\")}\n  else if(rd.turn===me){st.textContent=\"Your turn \u2014 bid or pass\";st.classList.add(\"you\")}\n  else if(rd.bidder===me) st.textContent=`You're winning \u2014 ${pname(room,rd.turn)} is up`;\n  else if(!rd.active[me]){\n    st.textContent = fitSlot(t,rd.pid)==null ? \"No open spot for this player on your team\"\n      : maxBid(t)<=rd.bid ? \"Out of your price range\"\n      : \"You passed on this one\";\n  } else st.textContent=`${pname(room,rd.turn)} is deciding\u2026`;\n\n  $(\"d-chips\").innerHTML=room.order.map(u=>{\n    const cls=[\"chip\"]; if(!rd.active[u]&&u!==rd.bidder) cls.push(\"out\");\n    const gone=(room.players[u]||{}).left; if(u===rd.bidder) cls.push(\"lead\"); if(u===rd.turn) cls.push(\"turn\");\n    return `<span class=\"${cls.join(\" \")}\">${dot(room,u)}${esc(pname(room,u))} ${gone?\"left\":\"$\"+room.teams[u].budget}</span>`;\n  }).join(\"\");\n\n  const lp=room.lastPick;\n  $(\"d-toast\").innerHTML=lp?`<div class=\"toast\">${lp.uid?`${esc(pname(room,lp.uid))} won ${esc(P(lp.pid).name)} for $${lp.bid}`:`Nobody bid on ${esc(P(lp.pid).name)}`}</div>`:\"\";\n  $(\"b-force\").style.display=(!practice && room.hostId===me && rd.turn!==me)?\"\":\"none\";\n  $(\"btn-end\").style.display=room.hostId===me?\"\":\"none\";\n  $(\"btn-quit\").textContent=practice?\"Exit practice\":\"Leave draft\";\n  $(\"b-force\").textContent=`Skip ${pname(room,rd.turn)}'s turn`;\n\n  renderControls();\n  $(\"d-myteam\").innerHTML=teamHTML(me,true);\n  $(\"d-others\").innerHTML=room.order.filter(u=>u!==me).map(u=>`<details class=\"other\"><summary>${dot(room,u)}${esc(pname(room,u))}<span class=\"muted\">${6-openSlots(room.teams[u]).length}/6</span><span class=\"r\">$${room.teams[u].budget}</span></summary>${slotsHTML(room.teams[u])}</details>`).join(\"\");\n  $(\"d-feed\").innerHTML=room.log.slice(-5).reverse().map(m=>`<li>${esc(m)}</li>`).join(\"\");\n}\n\nfunction renderControls(){\n  const rd=room&&room.round; if(!rd) return;\n  const t=room.teams[me], mine=rd.turn===me;\n  const hi=maxBid(t), canRaise=mine && fitSlot(t,rd.pid)!=null && hi>rd.bid;\n  $(\"b-val\").textContent=\"$\"+bidVal;\n  $(\"b-bid\").textContent=\"Bid $\"+bidVal;\n  $(\"b-max\").textContent=\"Max $\"+Math.max(hi,0);\n  [\"b-minus\",\"b-plus\",\"b-bid\",\"b-max\"].forEach(id=>$(id).disabled=!canRaise);\n  $(\"b-minus\").disabled=!canRaise||bidVal<=rd.bid+1;\n  $(\"b-plus\").disabled=!canRaise||bidVal>=hi;\n  $(\"b-pass\").disabled=!mine||mustOpen(room,me);\n  $(\"b-pass\").textContent=\"Pass\";\n}\n\nfunction slotsHTML(t){\n  return `<div class=\"slots\">${SLOTS.map(s=>{\n    const pid=t.roster[s];\n    return pid==null?`<div class=\"slot\"><div class=\"s\">${SLOT_LABEL[s]}</div><div class=\"p\">Open</div></div>`\n      :`<div class=\"slot full\"><div class=\"s\">${SLOT_LABEL[s]}</div><div class=\"n\">${esc(P(pid).name)}</div><div class=\"p\">${P(pid).r} OVR \u00b7 ${P(pid).pm>0?\"+\":\"\"}${P(pid).pm.toFixed(1)} \u00b7 $${t.paid[s]}</div></div>`;\n  }).join(\"\")}</div>`;\n}\nfunction teamHTML(u,isMe){\n  const t=room.teams[u];\n  const rt=rating(t);\n  const fit=`<div class=\"fit\">${rt.notes.map(([k,txt])=>`<span class=\"${k}\">${k===\"ok\"?\"\u2713\":\"\u2717\"} ${txt}</span>`).join(\"\")}</div>`;\n  return `<h3>${isMe?\"Your team\":esc(pname(room,u))}<span>$${t.budget} left</span></h3>${slotsHTML(t)}${fit}<p class=\"muted\" style=\"margin:8px 0 0\">Team fit ${rt.fit>=0?\"+\":\"\"}${rt.fit.toFixed(1)} \u00b7 lineup +/- ${rt.pm>=0?\"+\":\"\"}${rt.pm.toFixed(1)}</p>`;\n}\n\n/* ---------- results (deterministic from seed) ---------- */\nfunction rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}\nfunction simulate(r){\n  const R=rng(r.seed||1), g=()=>(R()+R()+R()-1.5)*2;\n  const teams=r.order.map(u=>({u,rt:rating(r.teams[u]).total,sw:0,gw:0,gl:0,pd:0}));\n  const series=[];\n  for(let i=0;i<teams.length;i++) for(let j=i+1;j<teams.length;j++){\n    const A=teams[i],B=teams[j]; let wa=0,wb=0; const games=[];\n    while(wa<4&&wb<4){\n      let a=Math.round(108+(A.rt-90)*2.4+g()*9), b=Math.round(108+(B.rt-90)*2.4+g()*9);\n      while(a===b){a+=Math.floor(R()*8);b+=Math.floor(R()*8)}\n      games.push([a,b]); A.pd+=a-b; B.pd+=b-a;\n      if(a>b){wa++;A.gw++;B.gl++}else{wb++;B.gw++;A.gl++}\n    }\n    (wa>wb?A:B).sw++;\n    series.push({a:A.u,b:B.u,wa,wb,games});\n  }\n  teams.sort((x,y)=>y.sw-x.sw||y.gw-x.gw||y.pd-x.pd||y.rt-x.rt);\n  return {teams,series};\n}\n\nfunction renderResults(){\n  show(\"s-results\");\n  const {teams,series}=simulate(room);\n  const champ=teams[0];\n  $(\"r-champ\").textContent=pname(room,champ.u);\n  $(\"r-champsub\").textContent=`${champ.rt.toFixed(1)} team rating (talent + +/- + fit) \u00b7 ${champ.gw}\u2013${champ.gl} in games`;\n  $(\"r-table\").innerHTML=teams.map(x=>`<tr><td>${dot(room,x.u)} ${esc(pname(room,x.u))}</td><td class=\"num\">${x.rt.toFixed(1)}</td><td class=\"num\">${x.sw}</td><td class=\"num\">${x.gw}\u2013${x.gl}</td></tr>`).join(\"\");\n  $(\"r-series\").innerHTML=series.map(s=>{\n    const w=s.wa>s.wb?s.a:s.b, l=w===s.a?s.b:s.a, hi=Math.max(s.wa,s.wb), lo=Math.min(s.wa,s.wb);\n    return `<div class=\"series\"><b>${esc(pname(room,w))}</b> beat ${esc(pname(room,l))} ${hi}\u2013${lo}<div class=\"games\">${s.games.map(([a,b])=>`${a}\u2013${b}`).join(\"  \u00b7  \")}</div><div class=\"games\">Scores listed ${esc(pname(room,s.a))} first</div></div>`;\n  }).join(\"\");\n  $(\"r-teams\").innerHTML=teams.map(x=>`<div class=\"panel team\">${teamHTML(x.u,x.u===me)}</div>`).join(\"\");\n  $(\"btn-again\").style.display=room.hostId===me?\"\":\"none\";\n  $(\"btn-exit\").textContent=practice?\"Exit practice\":\"Leave room\";\n}\n\n\n/* ---------- turn timer (server enforces it online; practice enforces it here) ---------- */\nsetInterval(()=>{\n  if(!room||room.status!==\"drafting\"||!room.round) return;\n  const rd=room.round, bar=$(\"d-timer\");\n  if(!rd.deadline){bar.style.visibility=\"hidden\";return}\n  bar.style.visibility=\"visible\";\n  const total=(room.settings.timer||20)*1000, rem=rd.deadline-now();\n  bar.firstElementChild.style.width=Math.max(0,Math.min(100,rem/total*100))+\"%\";\n  bar.classList.toggle(\"low\",rem<5000);\n  const key=rd.cardNo+\"|\"+rd.turn+\"|\"+rd.deadline;\n  if(practice && rem<-300 && !timeoutSent[key]){timeoutSent[key]=1;localAct(r=>r.round&&r.round.deadline===rd.deadline&&applyTimeout(r,rd.turn,\"ran out of time\"))}\n},250);\n</script>\n</body>\n</html>\n";
const IDLE_MS = 6 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/([A-Z]{4})$/);
    if (m) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
    }
    if (url.pathname === "/" || url.pathname === "/index.html")
      return new Response(HTML, { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-cache" } });
    return new Response("Not found", { status: 404 });
  }
};

export class DraftRoom {
  constructor(state, env) {
    this.state = state; this.sockets = new Map(); this.room = null;
    state.blockConcurrencyWhile(async () => { this.room = (await state.storage.get("room")) || null; });
  }

  async fetch(request) {
    const code = new URL(request.url).pathname.slice(4);
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.addEventListener("message", e => this.onMessage(server, code, e.data).catch(() => {}));
    const gone = () => this.onClose(server).catch(() => {});
    server.addEventListener("close", gone); server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  sendTo(ws, o) { try { ws.send(JSON.stringify(o)); } catch (e) {} }
  broadcast() {
    const msg = JSON.stringify({ t: "state", room: this.room, now: now() });
    for (const ws of this.sockets.keys()) { try { ws.send(msg); } catch (e) {} }
  }
  markOnline() {
    if (!this.room) return;
    const on = new Set(this.sockets.values());
    for (const [u, p] of Object.entries(this.room.players || {})) p.online = on.has(u);
  }
  async save() {
    this.room.lastActive = now();
    await this.state.storage.put("room", this.room);
    this.broadcast(); await this.schedule();
  }
  async schedule() {
    const r = this.room;
    if (r && r.status === "drafting" && r.round && r.round.deadline) await this.state.storage.setAlarm(r.round.deadline + 250);
    else if (!this.sockets.size) await this.state.storage.setAlarm(now() + IDLE_MS);
    else await this.state.storage.deleteAlarm();
  }
  async alarm() {
    const r = this.room; if (!r) return;
    norm(r);
    if (r.status === "drafting" && r.round && r.round.deadline && now() >= r.round.deadline) {
      applyTimeout(r, r.round.turn, "ran out of time"); await this.save(); return;
    }
    if (!this.sockets.size && now() - (r.lastActive || 0) >= IDLE_MS - 5000) {
      this.room = null; await this.state.storage.deleteAll(); return;
    }
    await this.schedule();
  }

  async onMessage(ws, code, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === "create" || m.t === "join") {
      const pid = String(m.pid || "").slice(0, 40); if (!pid) return;
      const name = String(m.name || "").trim().slice(0, 14) || "Player";
      if (m.t === "create") {
        if (this.room && Object.keys(this.room.players || {}).length) return this.sendTo(ws, { t: "error", code: "taken" });
        this.room = { code, hostId: pid, status: "lobby", createdAt: now(), settings: { budget: BUDGET, timer: 20 },
                      players: { [pid]: { name, color: 0, joinedAt: now() } } };
      } else {
        if (!this.room) return this.sendTo(ws, { t: "error", msg: `No room with code ${code}.` });
        norm(this.room);
        if (!this.room.players[pid]) {
          if (this.room.status !== "lobby") return this.sendTo(ws, { t: "error", msg: "That draft already started." });
          const ps = Object.values(this.room.players);
          if (ps.length >= 8) return this.sendTo(ws, { t: "error", msg: "That room is full (8 players)." });
          const used = ps.map(p => p.color);
          const color = [0,1,2,3,4,5,6,7].find(i => !used.includes(i)) ?? 0;
          this.room.players[pid] = { name, color, joinedAt: now() };
        }
      }
      this.sockets.set(ws, pid); norm(this.room); this.markOnline(); await this.save(); return;
    }

    const pid = this.sockets.get(ws);
    const r = this.room; if (!pid || !r || !r.players[pid]) return;
    norm(r);
    let changed = false;
    switch (m.t) {
      case "bid": changed = applyBid(r, pid, m.amount); break;
      case "pass": changed = applyPass(r, pid); break;
      case "start": changed = applyStart(r, pid); break;
      case "again": changed = applyAgain(r, pid); break;
      case "settings": changed = applySettings(r, pid, m.timer); break;
      case "ping": return this.sendTo(ws, { t: "pong" });
      case "end": changed = applyEnd(r, pid); break;
      case "skip":
        if (r.hostId === pid && r.status === "drafting" && r.round && r.round.turn !== pid)
          changed = applyTimeout(r, r.round.turn, "was skipped by the host");
        break;
      case "leave":
        this.sockets.delete(ws);
        if (r.status === "drafting") { applyLeave(r, pid); }
        else {
          delete r.players[pid];
          const left = Object.keys(r.players);
          if (!left.length) { this.room = null; await this.state.storage.deleteAll(); this.sendTo(ws, { t: "left" }); return; }
          if (r.hostId === pid) r.hostId = left[0];
        }
        this.sendTo(ws, { t: "left" }); this.markOnline(); changed = true; break;
    }
    if (changed) await this.save();
  }

  async onClose(ws) {
    if (!this.sockets.has(ws)) return;
    this.sockets.delete(ws);
    if (this.room) { this.markOnline(); await this.save(); }
  }
}
