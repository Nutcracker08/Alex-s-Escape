/* ------------------------------
   AXEL'S ESCAPE — game.js
   Version mit einfachen Sprites + Sounds + Balancing
   ------------------------------*/

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

/* ------------------------
   Sounds (platzhalter Beeps via WebAudio)
   ------------------------*/
function playBeep(freq=440, dur=0.2){
  try{
    const actx = new (window.AudioContext||window.webkitAudioContext)();
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = "sine"; osc.frequency.value = freq;
    osc.connect(gain); gain.connect(actx.destination);
    osc.start();
    gain.gain.setValueAtTime(0.15, actx.currentTime);
    osc.stop(actx.currentTime+dur);
  }catch(e){/*ignore*/}
}
const snd = {
  sword: ()=>playBeep(440,0.1),
  bow: ()=>playBeep(660,0.15),
  hit: ()=>playBeep(220,0.05),
  enemyDie: ()=>playBeep(110,0.3),
  heal: ()=>playBeep(880,0.1)
};

/* ------------------------
   Game state
   ------------------------*/
let state = {
  levelIndex: 0,
  stageTimeLeft: 20*60,
  inPoison: false,
  poisonTickAcc: 0,
  inventory: new Array(10).fill(null),
  hotbar: new Array(5).fill(null),
  player: {
    x: 80, y: H-140, w:28, h:36,
    vx:0, vy:0,
    hp:120, maxHp:120,
    armor:0, armorMax:0,
    facing:1,
    speed:3.6,
    grounded:true,
    lastSpace:0,
    canDoubleDamageWindow:false,
    isBlocking:false,
    lastRoll:-9999
  },
  keys: {},
  mouse: {x:0,y:0,down:false, rdown:false, pressedAt:0},
  tick: 0,
  projectiles: [],
  lastRegen: 0,
  paused:false
};

/* ------------------------
   Items (balancing angepasst)
   ------------------------*/
const ITEMS = {
  kaktusstachel: {id:'kaktusstachel', name:'Kaktusstachel'},
  orka_zahn: {id:'orka-zahn', name:'Orka-Zahn'},
  drachenei: {id:'drachenei', name:'Drachenei'},
  heal: {id:'heal', name:'Heiltrank', heal:40},
  armor: amt => ({id:'armor', name:'Rüstung', armor:amt}),
  sword: dmg => ({id:'sword', name:`Schwert (${dmg})`, damage:dmg}),
  bow: dmg => ({id:'bow', name:`Bogen (${dmg})`, damage:dmg}),
  harpoon: {id:'harpoon', name:'Harpune', damage:12}
};

/* ------------------------
   Levels mit Balancing
   ------------------------*/
const levels = [
  { name:'Wüste', timeLimit:20*60,
    tiles:[], cactiDps:1,
    chests:[{x:W-180,y:100,w:48,h:36,contains:'kaktusstachel',opened:false}],
    door:{x:W-120,y:70,w:80,h:110,open:false}
  },
  { name:'Eis', timeLimit:20*60,
    chests:[], foundHarpoon:false,
    harpoonChestIndex: Math.floor(Math.random()*30),
    orca:{alive:false,x:W/2,y:H/2,hp:80,maxHp:80,regenAcc:0},
    door:{x:60,y:40,w:80,h:110,open:false},
    orcaTimerRemaining:0
  },
  { name:'Drachenebene', timeLimit:20*60,
    chests:[{x:60,y:60,w:48,h:36,contains:'starter',opened:false}],
    dragon:{hp:130,maxHp:130,spawned:false,spawnCountdown:60,fireCooldown:0,alive:true},
    door:{x:W-120,y:70,w:80,h:110,open:false}
  },
  { name:'Boss',
    boss:{hp:400,maxHp:400,minions:[],lastMinionSpawn:0,attackAcc:0},
    portalOpen:false
  }
];
// generate chests
(function buildDesert(){ const L=levels[0]; for(let i=0;i<8;i++)for(let j=0;j<6;j++)if(Math.random()>0.35)L.tiles.push({x:140+i*90,y:120+j*70,w:40,h:40}); })();
(function buildIce(){ const L=levels[1]; for(let i=0;i<30;i++){ const x=60+Math.random()*(W-160), y=140+Math.random()*(H-200); L.chests.push({x,y,w:48,h:36,opened:false,contains:(i===L.harpoonChestIndex?'harpoon':null)}); }})();

/* ------------------------
   Inventar + Hotbar UI
   ------------------------*/
function updateInvUI(){ const el=document.getElementById('inventory'); el.innerHTML=''; state.inventory.forEach((it,i)=>{ const s=document.createElement('div'); s.className='slot'; s.textContent=it?it.name:''; el.appendChild(s);}); }
function updateHotbarUI(){ const el=document.getElementById('hotbar'); el.innerHTML=''; state.hotbar.forEach((it,i)=>{ const s=document.createElement('div'); s.className='slot'; s.textContent=it?it.name:''; el.appendChild(s);}); }
updateInvUI(); updateHotbarUI();
function addItemToInventory(it){ for(let i=0;i<10;i++){ if(!state.inventory[i]){ state.inventory[i]=it; updateInvUI(); return true; } } return false; }

/* ------------------------
   Chest öffnen mit Bugfixes
   ------------------------*/
function openChest(li,chest){
  if(chest.opened) return; chest.opened=true;
  if(li===0){ addItemToInventory(ITEMS.kaktusstachel); levels[0].door.open=true; }
  else if(li===1){
    if(chest.contains==='harpoon'){ addItemToInventory(ITEMS.harpoon); levels[1].orca.alive=true; levels[1].orca.hp=levels[1].orca.maxHp; levels[1].orcaTimerRemaining=15*60; }
    else showMsg('Die Kiste ist leer.');
  } else if(li===2){
    addItemToInventory(ITEMS.sword(Math.floor(8+Math.random()*20)));
    addItemToInventory(ITEMS.bow(Math.floor(12+Math.random()*20)));
    addItemToInventory(ITEMS.armor(160));
  }
  updateInvUI();
}

/* ------------------------
   Update Loop
   ------------------------*/
function update(dt){
  state.tick+=dt;
  const p=state.player;
  // movement
  if(state.keys['w'])p.y-=p.speed;
  if(state.keys['s'])p.y+=p.speed;
  if(state.keys['a']){p.x-=p.speed;p.facing=-1;}
  if(state.keys['d']){p.x+=p.speed;p.facing=1;}
  p.x=Math.max(0,Math.min(W-p.w,p.x)); p.y=Math.max(0,Math.min(H-p.h,p.y));
  // regen
  state.lastRegen+=dt; if(state.lastRegen>=10){ state.lastRegen=0; p.hp=Math.min(p.maxHp,p.hp+8); }
  // orca regen
  if(state.levelIndex===1&&levels[1].orca.alive){ const or=levels[1].orca; or.regenAcc+=dt; if(or.regenAcc>=25){ or.hp=Math.min(or.maxHp,or.hp+3); or.regenAcc=0; } }
  // boss minions
  if(state.levelIndex===3){ const B=levels[3].boss; B.lastMinionSpawn+=dt; if(B.lastMinionSpawn>=12){ B.lastMinionSpawn=0; for(let i=0;i<8;i++)B.minions.push({x:Math.random()*W,y:-20,hp:8,dmg:2}); }}
}

/* ------------------------
   Render mit kleinen Sprites
   ------------------------*/
function render(){
  ctx.fillStyle='#89c'; ctx.fillRect(0,0,W,H);
  // level switch
  if(state.levelIndex===0) ctx.fillStyle='#e2c089', ctx.fillRect(0,0,W,H);
  if(state.levelIndex===1) ctx.fillStyle='#ccf', ctx.fillRect(0,0,W,H);
  if(state.levelIndex===2) ctx.fillStyle='#433', ctx.fillRect(0,0,W,H);
  if(state.levelIndex===3) ctx.fillStyle='#111', ctx.fillRect(0,0,W,H);
  // player sprite
  ctx.fillStyle='#0a8'; ctx.fillRect(state.player.x,state.player.y,state.player.w,state.player.h);
  ctx.strokeStyle='black'; ctx.strokeRect(state.player.x,state.player.y,state.player.w,state.player.h);
  // enemies
  if(state.levelIndex===1&&levels[1].orca.alive){ const o=levels[1].orca; ctx.fillStyle='#136'; ctx.beginPath(); ctx.ellipse(o.x,o.y,50,25,0,0,Math.PI*2); ctx.fill(); ctx.stroke(); }
  if(state.levelIndex===2&&levels[2].dragon.spawned&&levels[2].dragon.alive){ ctx.fillStyle='#800'; ctx.fillRect(W/2-60,100,120,80); ctx.strokeRect(W/2-60,100,120,80); }
  if(state.levelIndex===3){ ctx.fillStyle='#ccc'; ctx.fillRect(W/2-80,80,160,160); ctx.strokeRect(W/2-80,80,160,160); for(const m of levels[3].boss.minions){ ctx.fillStyle='#999'; ctx.fillRect(m.x,m.y,16,24);} }
}

/* ------------------------
   Main Loop
   ------------------------*/
let last=performance.now();
function loop(now){ const dt=(now-last)/1000; last=now; update(dt); render(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
