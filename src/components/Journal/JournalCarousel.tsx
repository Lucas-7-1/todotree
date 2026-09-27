import React, {useEffect, useRef, useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {JournalEntry,journalImageOrder} from '../../services/journal/model';
import {JournalImage} from './JournalImage';
export function JournalCarousel({entry,onOpen}:{entry:JournalEntry;onOpen:(images:string[],index:number)=>void}) {
  const images=journalImageOrder(entry), [at,setAt]=useState(0), rail=useRef<HTMLDivElement>(null), start=useRef<{x:number;y:number}|null>(null), swiped=useRef(false);
  const signature=images.join(',');
  useEffect(()=>{setAt(0);rail.current?.scrollTo({left:0});},[signature]);
  if(!images.length)return null;
  const scrollTo=(index:number)=>rail.current?.scrollTo({left:index*rail.current.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  return <div className="j-carousel">
    <div ref={rail} className="j-photo-rail" aria-label="左右滑动查看照片"
      onScroll={()=>{if(rail.current)setAt(Math.round(rail.current.scrollLeft/rail.current.clientWidth));}}
      onPointerDown={e=>{start.current={x:e.clientX,y:e.clientY};swiped.current=false;}}
      onPointerMove={e=>{if(start.current&&Math.hypot(e.clientX-start.current.x,e.clientY-start.current.y)>10)swiped.current=true;}}
      onTouchStart={e=>{start.current={x:e.touches[0].clientX,y:e.touches[0].clientY};swiped.current=false;}}
      onTouchMove={e=>{if(start.current&&Math.hypot(e.touches[0].clientX-start.current.x,e.touches[0].clientY-start.current.y)>10)swiped.current=true;}}
    >{images.map((id,i)=><button key={id} className="j-photo-slide" aria-label={`查看第 ${i+1} 张照片`} onClick={()=>{if(!swiped.current)onOpen(images,i);}}>
      {Math.abs(i-at)<=1?<JournalImage id={id} large />:<span className="j-image-placeholder"/>}
    </button>)}</div>
    {images.length>1&&<><span className="j-photo-counter" aria-live="polite">{at+1} / {images.length}</span><div className="j-photo-arrows"><button aria-label="卡片上一张" disabled={at===0} onClick={()=>scrollTo(at-1)}><ChevronLeft size={18}/></button><button aria-label="卡片下一张" disabled={at===images.length-1} onClick={()=>scrollTo(at+1)}><ChevronRight size={18}/></button></div></>}
  </div>;
}
