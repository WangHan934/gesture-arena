import { RoomClient } from './network/client.js';
import { MONSTERS, SPELLS } from './pvp/rules.js';
import { GestureCanvas } from './input/gesture-canvas.js';
import { recognizeSpell } from './input/gesture-recognizer.js';
import { CameraInput } from './input/camera-input.js';
import { AirStroke } from './input/air-stroke.js';
import { SelectionScreen } from './ui/selection.js';

const $ = id => document.getElementById(id);
let arenaView = null;
let chosen = 'fire', state = null, connection = 'offline', pending = false, feedbackTimer, offset = 0;
const client = new RoomClient({
  onState(next) { const first=!state;state=next;if(first&&next.players[mySeat()]?.monster)chosen=next.players[mySeat()].monster;offset=next.serverNow-Date.now();render(); },
  onConnection(status) { connection=status; render(); },
  onExpired() { state=null; render(); tell('房间已过期，请重新创建或加入'); },
});
function tell(message){$('feedback').textContent=message;$('feedback').classList.add('show');clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>$('feedback').classList.remove('show'),3000);}
function mySeat(){return client.session?.seat??0;}
function canCast(){return state?.battle && state.battle.winner===null && state.battle.turn===mySeat() && connection==='online' && !pending;}
async function cast(id){
  if(!canCast()){tell(connection!=='online'?'正在重连，请稍候':'请等待对手回合');return;}
  pending=true;render();
  try{const out=await client.action('cast',{spell:id});tell(out.message);}catch(error){tell(error.message);}finally{pending=false;render();}
}
const gesture=new GestureCanvas($('gesture-canvas'),{recognizer:recognizeSpell,onRecognized(result){if(result)cast(result.id);else tell('没认出来，请再画一次');}});
const air=new AirStroke(points=>{const result=recognizeSpell(points);gesture.points=points;gesture.opacity=1;gesture.holdTimer=.7;if(result)cast(result.id);else tell('没认出来，放下手后再试一次');});
const camera=new CameraInput({onStatus(status){$('camera-btn').textContent=camera.active?'关闭摄像头':'开启摄像头';$('camera-note').textContent=status.state==='ready'?'只伸食指在空中画符号，停住 1.5 秒提交；放下手后开始下一笔。':status.state==='error'?status.message:'鼠标、触屏均可绘制。';}});
function roster(container){
  container.replaceChildren();
  for(const monster of MONSTERS){const button=document.createElement('button');button.type='button';button.className='monster';button.dataset.monster=monster.id;button.setAttribute('aria-pressed',String(chosen===monster.id));
    const img=document.createElement('img');img.src=`art/renders/monsters/${monster.image}`;img.alt=monster.name+'模型预览';
    const title=document.createElement('b');title.textContent=monster.name;const sub=document.createElement('small');sub.textContent='140 HP · 六种技能';button.append(img,title,sub);
    button.addEventListener('click',()=>{chosen=monster.id;render();});container.append(button);
  }
}
const selection = new SelectionScreen(id => { chosen=id; arenaView?.setSelection(id); render(); });
roster($('room-roster'));
for(const spell of SPELLS){const button=document.createElement('button');button.type='button';button.className='spell';button.dataset.spell=spell.id;button.title=spell.hint;button.setAttribute('aria-label',spell.name);
  const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=spell.glyph;const title=document.createElement('b');title.textContent=spell.name;const hint=document.createElement('small');hint.textContent=spell.hint;const key=document.createElement('kbd');key.textContent=spell.key;button.append(glyph,title,hint,key);button.addEventListener('click',()=>cast(spell.id));$('spells').append(button);
}
function render(){
  arenaView?.setState(state,mySeat());
  const room=Boolean(client.session);$('home').hidden=room;$('room').hidden=!room;
  document.body.classList.toggle('selecting',!room);$('game-topbar').hidden=!room;$('game-footer').hidden=!room;
  selection.update(chosen,!room);arenaView?.setSelection(chosen);
  $('connection').textContent=room?({online:'● 房间已连接',connecting:'正在连接…',reconnecting:'连接中断，正在重连…',offline:'未连接'}[connection]):'双人联网 · 回合对战';$('connection').classList.toggle('online',connection==='online');
  for(const b of document.querySelectorAll('[data-monster]')){b.classList.toggle('selected',b.dataset.monster===chosen);b.setAttribute('aria-pressed',String(b.dataset.monster===chosen));b.disabled=Boolean(state?.players[mySeat()]?.ready && b.closest('#room-roster'));}
  if(!room||!state)return;
  $('room-id').textContent=client.session.roomId;
  const battle=state.battle;const seat=mySeat();const self=state.players[seat];const enemy=state.players[1-seat];
  $('lobby').hidden=Boolean(battle);$('battle').hidden=!battle;
  if(!battle){
    $('lobby-players').replaceChildren();
    for(let i=0;i<2;i++){const p=state.players[i];const box=document.createElement('div');box.className='player-slot';const title=document.createElement('strong');title.textContent=p?`${p.name}${i===seat?'（你）':''}`:'等待朋友加入…';const status=document.createElement('span');status.textContent=p?`${p.online?'在线':'已断线'} · ${p.ready?'已准备':'选择怪兽中'}`:'分享房间码即可邀请';box.append(title,status);$('lobby-players').append(box);}
    $('ready-btn').disabled=Boolean(self?.ready)||connection!=='online';$('ready-btn').textContent=self?.ready?'已准备，等待对手…':'锁定怪兽，准备对战';return;
  }
  const a=battle.players[seat],b=battle.players[1-seat];
  $('self-name').textContent=self?.name||'你';$('enemy-name').textContent=enemy?.name||'对手';
  $('self-hp').textContent=`${a.hp} / 140`;$('enemy-hp').textContent=`${b.hp} / 140`;$('self-health').value=a.hp;$('enemy-health').value=b.hp;
  const buffs=p=>[p.shield?'护盾生效':'',p.support?'援军就绪':''].filter(Boolean).join(' · ');
  $('self-buffs').textContent=buffs(a);$('enemy-buffs').textContent=`${enemy?.online?'':'对手断线 · '}${buffs(b)}`;
  $('turn-label').textContent=battle.winner!==null?'对战结束':battle.turn===seat?'你的回合 · 画出技能符号':'对手回合 · 等待出招';$('turn-count').textContent=`第 ${battle.turns} 回合`;
  $('pad-label').textContent=canCast()?'按住拖拽，松开施法':'等待对手出招';
  for(const button of document.querySelectorAll('[data-spell]')){const id=button.dataset.spell,spell=SPELLS.find(s=>s.id===id),cd=Math.max(0,(a.cooldowns[id]||0)-(battle.turn!==seat?1:0));button.disabled=!canCast()||cd>0;button.querySelector('small').textContent=cd>0?`冷却 ${cd} 个己方回合`:spell.hint;}
  $('battle-log').replaceChildren(...battle.log.slice(-4).map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  $('result').hidden=battle.winner===null;
  if(battle.winner!==null){$('result-title').textContent=battle.winner==='draw'?'势均力敌':battle.winner===seat?'对决胜利':'下次再战';$('result-detail').textContent=`共 ${battle.turns} 回合 · 双方确认后再战`;$('rematch-btn').disabled=Boolean(self?.rematch)||connection!=='online';$('rematch-btn').textContent=self?.rematch?'等待对手确认…':'再战一局';}
}
async function enter(join){
  const code=$('room-code').value.trim().toUpperCase();if(join&&!/^[A-F0-9]{6}$/.test(code)){tell('请输入六位房间码');return;}
  $('create-room').disabled=$('join-room').disabled=true;
  try{await client.enter(join?code:null,{name:$('player-name').value,monster:chosen});const u=new URL(location.href);u.searchParams.set('room',client.session.roomId);history.replaceState(null,'',u);render();}catch(error){tell(error.message);}finally{$('create-room').disabled=$('join-room').disabled=false;}
}
$('entry-form').addEventListener('submit',event=>{event.preventDefault();enter(false);});$('join-room').addEventListener('click',()=>enter(true));
$('ready-btn').addEventListener('click',async()=>{try{await client.action('ready',{monster:chosen});}catch(error){tell(error.message);}});
$('rematch-btn').addEventListener('click',async()=>{try{await client.action('rematch');}catch(error){tell(error.message);}});
$('leave-room').addEventListener('click',async()=>{camera.disable();await client.leave().catch(()=>{});state=null;gesture.clear();air.reset();const u=new URL(location.href);u.searchParams.delete('room');history.replaceState(null,'',u);render();});
$('copy-invite').addEventListener('click',async()=>{const link=new URL(location.href);link.search='';link.searchParams.set('room',client.session.roomId);try{await navigator.clipboard.writeText(link.href);tell('邀请链接已复制');}catch{tell(`房间码 ${client.session.roomId} · 请复制地址栏链接`);}});
$('camera-btn').addEventListener('click',async()=>{const button=$('camera-btn');button.disabled=true;try{await camera.toggle();air.reset();}finally{button.disabled=false;}});
window.addEventListener('keydown',event=>{if(event.repeat||event.isComposing||['INPUT','TEXTAREA'].includes(event.target.tagName)||event.target.isContentEditable)return;const match=/^(?:Digit|Numpad)([1-6])$/.exec(event.code);if(match&&state?.battle){event.preventDefault();cast(SPELLS[Number(match[1])-1].id);}});
window.addEventListener('pagehide',()=>{camera.disable();client.stopStream();});
window.addEventListener('pageshow',event=>{if(event.persisted&&client.session)client.connect();});
const query=new URLSearchParams(location.search).get('room');if(query)$('room-code').value=query.toUpperCase();
const restored=client.restore();render();if(query&&!restored)selection.open();
import('./pvp/scene-3d.js').then(({ Arena3D }) => {
  arenaView = new Arena3D($('battle-canvas'), (status, message) => {
    $('model-status').textContent = message;
    $('model-status').dataset.state = status;
    if (status === 'error') tell(message);
  });
  arenaView.setSelection(chosen);
  arenaView.setState(state,mySeat());
  arenaView.ready.catch(error => {
    console.error('[3D] 模型加载失败',error);
    $('model-status').textContent = '3D 模型加载失败：' + error.message;
    $('model-status').dataset.state = 'error';
    tell($('model-status').textContent);
  });
}).catch(error => {
  console.error('[3D] 渲染初始化失败',error);
  $('model-status').textContent = '3D 初始化失败，请确认浏览器已启用 WebGL 2：' + error.message;
  $('model-status').dataset.state = 'error';
  tell($('model-status').textContent);
});
let previous=performance.now();
function frame(now){const dt=Math.min(.05,(now-previous)/1000);previous=now;
  if(state?.battle){const seconds=Math.max(0,Math.ceil((state.battle.deadline-Date.now()-offset)/1000));$('clock').textContent=state.battle.winner===null?`${seconds}s`:'—';}
  try { arenaView?.update(dt); } catch (error) {
    console.error('[3D] 渲染帧失败', error);
    arenaView = null;
    $('model-status').textContent = '3D 渲染失败，请刷新页面：' + error.message;
    $('model-status').dataset.state = 'error';
    tell($('model-status').textContent);
  }
  gesture.update(dt);air.update(camera.getFrame(now),now,canCast()&&camera.active);if(air.points.length){gesture.points=air.points.slice();gesture.opacity=1;gesture.holdTimer=.1;}gesture.render();requestAnimationFrame(frame);
}requestAnimationFrame(frame);
