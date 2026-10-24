import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, castSpell, expireTurn } from '../src/pvp/engine.js';
import { recognizeSpell, recognize } from '../src/input/gesture-recognizer.js';
import { AirStroke } from '../src/input/air-stroke.js';

test('wrong seat and forged damage cannot change the battle', () => {
  const battle = createBattle(0, 0);
  assert.equal(castSpell(battle, 1, 'line_h', 1).ok, false);
  assert.equal(battle.players[0].hp, 140);
  assert.equal(castSpell(battle, 0, 'not-a-spell', 1).ok, false);
  assert.equal(battle.turns, 1);
});
test('turn ownership, cooldown, support and shield are authoritative', () => {
  const b = createBattle(0, 0);
  assert(castSpell(b, 0, 'triangle', 1).ok);
  assert(castSpell(b, 1, 'square', 2).ok);
  assert(castSpell(b, 0, 'line_h', 3).ok);
  assert.equal(b.players[1].hp, 98); // (70 + 15) / 2, rounded down
  assert.equal(b.players[0].support, false);
  assert.equal(b.players[1].shield, false);
  assert(castSpell(b, 1, 'circle', 4).ok);
  assert.equal(castSpell(b, 0, 'line_h', 5).ok, false);
  assert.equal(b.turn, 0);
});
test('heal caps at maximum and lethal casts end exactly once', () => {
  const b = createBattle(0,0);
  assert(castSpell(b,0,'two',1).ok);
  assert.equal(b.players[0].hp,140);
  b.players[0].hp=20;
  assert(castSpell(b,1,'line_h',2).ok);
  assert.equal(b.winner,1);
  const after=JSON.stringify(b);
  assert.equal(castSpell(b,1,'circle',3).ok,false);
  assert.equal(JSON.stringify(b),after);
});
test('late actions expire the turn and idle matches have a finite limit',()=>{
  const b=createBattle(0,0);
  assert.equal(castSpell(b,0,'line_h',45000).ok,false);
  assert.equal(b.turn,1);
  assert.equal(b.players[1].hp,140);
  assert.equal(expireTurn(b,45001),false);
  for(let i=0;i<125&&b.winner===null;i++)expireTurn(b,b.deadline);
  assert.equal(b.winner,'draw');
});
function interpolate(vertices) {
  return vertices.flatMap((p,i)=>i===vertices.length-1?[p]:Array.from({length:20},(_,j)=>({x:p.x+(vertices[i+1].x-p.x)*j/20,y:p.y+(vertices[i+1].y-p.y)*j/20})));
}
test('six c.html spell shapes work at different positions, sizes and directions',()=>{
  const shapes={
    circle:Array.from({length:73},(_,i)=>({x:Math.cos(i/72*Math.PI*2)*100,y:Math.sin(i/72*Math.PI*2)*100})),
    line_h:interpolate([{x:0,y:0},{x:200,y:0}]),
    line_v:interpolate([{x:0,y:0},{x:0,y:200}]),
    triangle:interpolate([{x:100,y:0},{x:200,y:180},{x:0,y:180},{x:100,y:0}]),
    square:interpolate([{x:0,y:0},{x:200,y:0},{x:200,y:200},{x:0,y:200},{x:0,y:0}]),
    two:interpolate([{x:0,y:35},{x:35,y:0},{x:135,y:0},{x:180,y:35},{x:180,y:75},{x:0,y:200},{x:200,y:200}]),
  };
  for(const [id,points] of Object.entries(shapes))for(const reverse of [false,true]){
    const transformed=points.map((p,i)=>({x:p.x*.8+50+Math.sin(i)*1.5,y:p.y*.8+80+Math.cos(i)*1.5}));
    if(reverse)transformed.reverse();
    assert.equal(recognizeSpell(transformed)?.id,id,`${id} reverse=${reverse}`);
  }
  assert.equal(recognizeSpell([{x:1,y:1},{x:2,y:2}]),null);
  assert.equal(recognizeSpell(interpolate([{x:0,y:0},{x:200,y:200}])),null);
  // New vertical spells must not change the old modes' negative sample behavior.
  assert.equal(recognize(shapes.line_v),null);
});
test('air drawing submits once and needs a hand release before another stroke',()=>{
  const submitted=[];const air=new AirStroke(points=>submitted.push(points));
  const frame=x=>({pose:'one',landmarks:Array.from({length:21},()=>({x,y:.5}))});
  for(let i=0;i<30;i++)air.update(frame(.2+i*.015),i*50,true);
  for(let i=30;i<90;i++)air.update(frame(.635),i*50,true);
  assert.equal(submitted.length,1);
  air.update(null,4600,true);
  for(let i=0;i<30;i++)air.update(frame(.3+i*.01),4700+i*50,true);
  air.update(null,6500,true);
  assert.equal(submitted.length,2);
});
