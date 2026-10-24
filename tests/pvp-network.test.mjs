import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('two independent clients: room → ready → synced battle → reconnect → result → rematch', async t => {
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  let output='',origin;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server did not start: '+output)),5000);
    child.stdout.on('data',chunk=>{output+=chunk;const m=/http:\/\/localhost:(\d+)/.exec(output);if(m){origin=`http://127.0.0.1:${m[1]}`;clearTimeout(timer);resolve();}});
    child.stderr.on('data',chunk=>{output+=chunk;});child.on('exit',()=>{clearTimeout(timer);reject(new Error(output));});
  });
  async function post(path,data,token){const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data)});return {status:response.status,data:await response.json()};}
  const host=(await post('/api/rooms',{name:'主机',monster:'fire'})).data;
  const room=`/api/rooms/${host.roomId}`;
  const guest=(await post(room+'/join',{name:'访客',monster:'rock'})).data;
  assert.equal((await post(room+'/join',{})).status,409);
  assert.equal((await post(room+'/action',{type:'ready',monster:'fire'},'invalid')).status,401);
  assert.equal((await fetch(origin+'/.git/config')).status,404);
  assert.equal((await fetch(origin+'/server.mjs')).status,404);
  async function stream(session){
    const controller=new AbortController();t.after(()=>controller.abort());
    const response=await fetch(origin+room+'/events',{headers:{Authorization:`Bearer ${session.token}`},signal:controller.signal});
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    return {abort:()=>controller.abort(),async next(predicate=()=>true){
      const timeout=setTimeout(()=>controller.abort(),5000);
      try {while(true){let at;while((at=buffer.indexOf('\n\n'))>=0){const msg=buffer.slice(0,at);buffer=buffer.slice(at+2);if(msg.startsWith('data: ')){const state=JSON.parse(msg.slice(6));if(predicate(state))return state;}}
        const part=await reader.read();if(part.done)throw new Error('stream closed');buffer+=decoder.decode(part.value,{stream:true});}
      }finally{clearTimeout(timeout);}
    }};
  }
  const a=await stream(host),b=await stream(guest);
  await a.next(s=>s.players.every(p=>p?.online));
  await b.next(s=>s.players.every(p=>p?.online));
  await post(room+'/action',{type:'ready',monster:'fire'},host.token);
  await post(room+'/action',{type:'ready',monster:'rock'},guest.token);
  let state=await a.next(s=>s.battle);
  const remote=await b.next(s=>s.battle);
  assert.deepEqual(state.battle,remote.battle);
  const sessions=[host,guest];
  const wrong=1-state.battle.turn;
  assert.equal((await post(room+'/action',{type:'cast',spell:'line_h',damage:999},sessions[wrong].token)).status,409);
  const first=state.battle.turn;
  await post(room+'/action',{type:'cast',spell:'line_h',damage:999},sessions[first].token);
  state=await a.next(s=>s.battle.turns===2);
  assert.equal(state.battle.players[1-first].hp,70);
  assert.deepEqual(state.battle,(await b.next(s=>s.battle.turns===2)).battle);
  b.abort();
  await a.next(s=>!s.players[1].online);
  const reconnected=await stream(guest);
  const restored=await reconnected.next(s=>s.battle?.turns===2);
  assert.deepEqual(restored.battle,state.battle);
  for(let i=0;i<20&&state.battle.winner===null;i++){
    const turns=state.battle.turns;
    await post(room+'/action',{type:'cast',spell:'circle'},sessions[state.battle.turn].token);
    state=await a.next(s=>s.battle.turns>turns||s.battle.winner!==null);
  }
  assert.notEqual(state.battle.winner,null);
  const end=await reconnected.next(s=>s.battle?.winner!==null);
  assert.deepEqual(end.battle,state.battle);
  await post(room+'/action',{type:'rematch'},host.token);
  await post(room+'/action',{type:'rematch'},guest.token);
  assert.equal((await a.next(s=>s.battle===null)).players[0].ready,false);
  assert.equal((await reconnected.next(s=>s.battle===null)).players[1].ready,false);
});
