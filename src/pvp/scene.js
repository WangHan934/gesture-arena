const image = typeof Image !== 'undefined' ? new Image() : null;
if (image) image.src = 'art/renders/arena/arena_battle_view.png';
export function drawArena(ctx, state, seat, monsters, now) {
  const w = 1000, h = 420;
  ctx.save(); ctx.clearRect(0,0,w,h);
  const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,'#100c20');gradient.addColorStop(1,'#2d1736');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
  if(image?.complete && image.naturalWidth){ctx.globalAlpha=.46;ctx.drawImage(image,0,0,w,h);ctx.globalAlpha=1;ctx.fillStyle='#130c2280';ctx.fillRect(0,0,w,h);}
  for(let i=0;i<35;i++){const x=(i*131.3)%w,y=100+(i*71.9)%230;ctx.globalAlpha=.2+.15*Math.sin(now/900+i);ctx.fillStyle='#e1b5ff';ctx.beginPath();ctx.arc(x,y,1.5,0,7);ctx.fill();}ctx.globalAlpha=1;
  for(const [side,x] of [[seat,265],[1-seat,735]]){
    const unit=state?.players[side],fighter=state?.battle?.players[side];if(!unit)continue;
    const monster=monsters.find(m=>m.id===unit.monster)||monsters[0];
    const bob=Math.sin(now/700+side)*5;
    ctx.save();ctx.translate(x,270+bob);
    ctx.shadowColor=monster.color;ctx.shadowBlur=30;ctx.strokeStyle=monster.color;ctx.lineWidth=2;
    ctx.beginPath();ctx.ellipse(0,65,100,20,0,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
    ctx.font='95px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(monster.glyph,0,0);
    if(fighter?.shield){ctx.strokeStyle='#9bd7ff';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,0,72,90,0,0,Math.PI*2);ctx.stroke();}
    if(fighter?.support){ctx.fillStyle='#e2c680';ctx.font='18px system-ui';ctx.fillText('✦ 援军就绪',0,-82);}
    ctx.fillStyle='#f0e6ff';ctx.font='600 16px system-ui';ctx.fillText(monster.name,0,109);ctx.restore();
  }
  if(state?.battle){ctx.textAlign='center';ctx.fillStyle='#d8c1f3';ctx.font='12px system-ui';ctx.fillText('画符号 · 选择攻守 · 每次施法消耗一个回合',500,400);}
  ctx.restore();
}
