'use client';
import { memo, useEffect, useRef } from 'react';
import { type Game, WORLD_WIDTH, WORLD_HEIGHT } from '@/lib/tower-game';
import type { Camera } from '@/lib/camera';

// One drawing surface instead of hundreds of independently animated DOM images.
export const TroopLayer = memo(function TroopLayer({game, camera, viewport, speech, paused}: {
  game: Game; camera: Camera; viewport: {w:number;h:number}; speech:boolean; paused:boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef({game,camera,viewport,speech,paused,at:0,interval:50,previous:new Map<number,{x:number;y:number}>()});
  useEffect(()=> {
    const old=frame.current;
    if (old.game === game) {
      frame.current={...old,camera,viewport,speech,paused};
      return;
    }
    const now=performance.now();
    frame.current={game,camera,viewport,speech,paused,at:now,interval:Math.max(16,Math.min(150,now-old.at)),
      previous: game.age>=old.game.age && game.age-old.game.age<=.25
        ? new Map(old.game.troops.map(p=>[p.id,{x:p.x,y:p.y}])) : new Map()};
  },[game,camera,viewport,speech,paused]);
  useEffect(()=> {
    let id=0,disposed=false;
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
    const source=new Image();
    const sprites:Record<string,HTMLCanvasElement>={};
    source.onload=()=> {
      const hue: Record<string, number | null> = {you:null, red:0.01, purple:0.76, green:0.36};
      for(const team of Object.keys(hue)) {
        const tile=document.createElement('canvas');tile.width=96;tile.height=120;
        const ctx=tile.getContext('2d')!;
        const scale=Math.min(96/source.width,120/source.height);
        const dw=source.width*scale, dh=source.height*scale;
        const dx=(96-dw)/2, dy=(120-dh)/2;
        ctx.drawImage(source,dx,dy,dw,dh);
        const target=hue[team];
        if(target!==null) {
          const img=ctx.getImageData(0,0,96,120), d=img.data;
          for(let i=0;i<d.length;i+=4) {
            if(d[i+3]<16) continue;
            const r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255;
            const max=Math.max(r,g,b), min=Math.min(r,g,b), l=(max+min)/2;
            const delta=max-min;
            if(delta<0.06) continue;
            const s=l>0.5?delta/(2-max-min):delta/(max+min);
            if(s<0.18) continue;
            let h=max===r?(g-b)/delta+(g<b?6:0):max===g?(b-r)/delta+2:(r-g)/delta+4;
            h/=6;
            if(h<0.52||h>0.72) continue;
            const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
            const ch=(t:number)=>{
              const w=t<0?t+1:t>1?t-1:t;
              if(w<1/6) return p+(q-p)*6*w;
              if(w<1/2) return q;
              if(w<2/3) return p+(q-p)*(2/3-w)*6;
              return p;
            };
            d[i]=Math.round(ch(target+1/3)*255);
            d[i+1]=Math.round(ch(target)*255);
            d[i+2]=Math.round(ch(target-1/3)*255);
          }
          ctx.putImageData(img,0,0);
        }
        sprites[team]=tile;
      }
    };
    source.src='/assets/soldier.png';
    const draw=(now:number)=> {
      if(disposed)return;
      const el=canvas.current, f=frame.current;
      if(el) {
        const ratio=Math.min(window.devicePixelRatio||1,1.5), zoom=f.camera.zoom;
        const width=Math.max(1,Math.round(f.viewport.w*ratio)),height=Math.max(1,Math.round(f.viewport.h*ratio));
        if(el.width!==width||el.height!==height){el.width=width;el.height=height;}
        const ctx=el.getContext('2d');
        if(ctx){
          ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,f.viewport.w,f.viewport.h);
          const blend=f.paused?1:Math.min(1,(now-f.at)/f.interval);
          const motion=f.paused?f.game.age:now/1000;
          const spot=(px:number,py:number)=>({
            x:px/100*WORLD_WIDTH*zoom+f.camera.x,
            y:py/100*WORLD_HEIGHT*zoom+f.camera.y,
          });
          ctx.save();
          ctx.lineCap='round';
          for(const p of f.game.troops){
            if(!p.cargo||p.delay>0)continue;
            const a=f.game.towers.find(t=>t.id===p.from), b=f.game.towers.find(t=>t.id===p.to);
            if(!a||!b)continue;
            const s=spot(a.x,a.y), e=spot(b.x,b.y);
            ctx.strokeStyle='#c4a15a99';ctx.lineWidth=3*zoom;ctx.setLineDash([10*zoom,8*zoom]);
            ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(e.x,e.y);ctx.stroke();
          }
          ctx.restore();
          for(const p of f.game.troops){
            if(p.delay>0)continue;
            const old=f.previous.get(p.id)??p;
            const x=(old.x+(p.x-old.x)*blend)/100*WORLD_WIDTH*zoom+f.camera.x;
            const y=(old.y+(p.y-old.y)*blend)/100*WORLD_HEIGHT*zoom+f.camera.y;
            if(x < -100 || y < -100 || x>f.viewport.w+100 || y>f.viewport.h+100)continue;
            ctx.save();ctx.translate(x,y);ctx.scale(zoom,zoom);
            if(!p.cargo){
              const dest=f.game.towers[p.to];
              const dx=dest?((dest.x-p.sx)/100)*WORLD_WIDTH:1;
              const dy=dest?((dest.y-p.sy)/100)*WORLD_HEIGHT:0;
              const len=Math.hypot(dx,dy)||1;
              const slot=(p.id%5)-2;
              ctx.translate((-dy/len)*slot*16,(dx/len)*slot*16);
            }
            ctx.fillStyle='#3b572d38';ctx.beginPath();ctx.ellipse(0,0,11,4,0,0,Math.PI*2);ctx.fill();
            if(p.cargo){
              const spin=reducedMotion.matches?p.id:motion*8+p.id*1.7;
              const bob=reducedMotion.matches?0:Math.sin(motion*5+p.id*1.3)*3;
              ctx.translate(0,-8+bob);
              const wheel=(wx:number)=>{
                ctx.save();ctx.translate(wx,9);ctx.rotate(spin);
                ctx.fillStyle='#2c2c2c';ctx.beginPath();ctx.arc(0,0,4.4,0,Math.PI*2);ctx.fill();
                ctx.strokeStyle='#f4f4f4';ctx.lineWidth=1.4;
                ctx.beginPath();ctx.moveTo(-3.2,0);ctx.lineTo(3.2,0);ctx.moveTo(0,-3.2);ctx.lineTo(0,3.2);ctx.stroke();
                ctx.restore();
              };
              wheel(-10);wheel(10);
              ctx.fillStyle='#8a552c';ctx.strokeStyle='#5c3818';ctx.lineWidth=1.5;
              ctx.beginPath();ctx.roundRect(-16,-8,32,16,3);ctx.fill();ctx.stroke();
              ctx.fillStyle=p.haul?.resources&&!p.haul.gold?'#6fa84a':'#f0c14a';
              ctx.beginPath();ctx.moveTo(-11,-8);ctx.lineTo(-4,-18);ctx.lineTo(3,-8);ctx.fill();
              ctx.beginPath();ctx.moveTo(-2,-8);ctx.lineTo(5,-17);ctx.lineTo(12,-8);ctx.fill();
              ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.fillStyle='#fff';ctx.strokeStyle='#805025';ctx.lineWidth=3;
              const text=p.haul?String(Math.floor(p.haul.gold+p.haul.resources)):`+${p.strength}`;
              ctx.strokeText(text,0,-24);ctx.fillText(text,0,-24);
            }else if(sprites[p.team]){
              const hop=reducedMotion.matches?0:Math.abs(Math.sin(motion*7+p.id*1.7))*8;
              ctx.save();ctx.translate(0,-18-hop);
              const face = p.waypoint?.x ?? f.game.towers[p.to]?.x;
              if (face !== undefined && face < p.sx) ctx.scale(-1, 1);
              ctx.rotate(reducedMotion.matches?0:Math.sin(motion*7+p.id*1.7)*.12);
              ctx.drawImage(sprites[p.team],-19,-24,38,48);ctx.restore();
              if(p.scoutUntil||p.elite){ctx.fillStyle='#fff1a2';ctx.font='bold 14px Arial';ctx.fillText(p.elite?'★':'◉',-6,-46);}
            }
            if(f.speech&&!f.game.hideMessages&&p.speech&&p.progress>.07&&p.progress<.8){
              ctx.font='12px Arial';ctx.textAlign='center';const w=ctx.measureText(p.speech).width+16;
              ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(-w/2,-68,w,23,7);ctx.fill();
              ctx.fillStyle='#3b4937';ctx.fillText(p.speech,0,-52);
            }
            ctx.restore();
          }
        }
      }
      id=requestAnimationFrame(draw);
    };
    id=requestAnimationFrame(draw);
    return()=>{disposed=true;cancelAnimationFrame(id);source.onload=null;};
  },[]);
  return <canvas ref={canvas} className="troop-canvas" aria-hidden="true"/>;
});
