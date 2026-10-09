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
      for(const [team,filter] of Object.entries({you:'none',red:'hue-rotate(140deg) saturate(.9)',purple:'hue-rotate(45deg) saturate(.8)',green:'hue-rotate(-85deg) saturate(.9)'})) {
        const tile=document.createElement('canvas');tile.width=96;tile.height=120;
        const ctx=tile.getContext('2d')!;ctx.filter=filter;
        const scale=Math.min(96/source.width,120/source.height);
        ctx.drawImage(source,(96-source.width*scale)/2,(120-source.height*scale)/2,source.width*scale,source.height*scale);
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
          for(const p of f.game.troops){
            if(p.delay>0)continue;
            const old=f.previous.get(p.id)??p;
            const x=(old.x+(p.x-old.x)*blend)/100*WORLD_WIDTH*zoom+f.camera.x;
            const y=(old.y+(p.y-old.y)*blend)/100*WORLD_HEIGHT*zoom+f.camera.y;
            if(x < -100 || y < -100 || x>f.viewport.w+100 || y>f.viewport.h+100)continue;
            ctx.save();ctx.translate(x,y);ctx.scale(zoom,zoom);
            ctx.fillStyle='#3b572d38';ctx.beginPath();ctx.ellipse(0,0,11,4,0,0,Math.PI*2);ctx.fill();
            if(p.cargo){
              ctx.font='24px Arial';ctx.textAlign='center';ctx.fillText(p.haul?.gold?'💰':'📦',0,-4);
              ctx.font='bold 12px Arial';ctx.fillStyle='#fff';ctx.strokeStyle='#805025';ctx.lineWidth=3;
              const text=p.haul?String(Math.floor(p.haul.gold+p.haul.resources)):`+${p.strength}`;
              ctx.strokeText(text,0,-28);ctx.fillText(text,0,-28);
            }else if(sprites[p.team]){
              ctx.save();ctx.translate(0,-18+(reducedMotion.matches?0:Math.sin(motion*26+p.id)*2));
              const face = p.waypoint?.x ?? f.game.towers[p.to]?.x;
              if (face !== undefined && face < p.sx) ctx.scale(-1, 1);
              ctx.rotate((reducedMotion.matches?0:Math.sin(motion*26+p.id)*.08));
              ctx.drawImage(sprites[p.team],-19,-24,38,48);ctx.restore();
              if(p.scoutUntil||p.elite){ctx.fillStyle='#fff1a2';ctx.font='bold 14px Arial';ctx.fillText(p.elite?'★':'◉',-6,-38);}
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
