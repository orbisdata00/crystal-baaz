import React,{useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import htm from 'htm';
import {useShoppingOverlay} from './shopping-experience.js';
const html=htm.bind(React.createElement);
export function ProductGallery({images,index,onIndex,title,onClose}){
 useShoppingOverlay();
 const ref=useRef(null),start=useRef(null),closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{
  const previous=document.activeElement,root=document.getElementById('root'),wasInert=root?.inert,scrollY=window.scrollY;
  const before={overflow:document.body.style.overflow,position:document.body.style.position,top:document.body.style.top,width:document.body.style.width};
  document.body.style.overflow='hidden';document.body.style.position='fixed';document.body.style.top=`-${scrollY}px`;document.body.style.width='100%';if(root)root.inert=true;
  window.history.pushState({...window.history.state,crystalGallery:true},'',window.location.href);
  ref.current?.querySelector('button')?.focus();
  const pop=()=>closeRef.current();
  const key=e=>{if(e.key==='Escape'){e.preventDefault();window.history.back();}if(e.key==='Tab'){const controls=[...ref.current.querySelectorAll('button:not(:disabled)')],first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  window.addEventListener('popstate',pop);document.addEventListener('keydown',key);
  return()=>{window.removeEventListener('popstate',pop);document.removeEventListener('keydown',key);Object.assign(document.body.style,before);if(root)root.inert=wasInert;window.scrollTo({top:scrollY,behavior:'instant'});previous?.focus?.({preventScroll:true});};
 },[]);
 const change=delta=>onIndex((index+delta+images.length)%images.length);
 return createPortal(html`<section className="crystal-gallery-dialog" ref=${ref} role="dialog" aria-modal="true" aria-label=${`${title} image gallery`}><header><span>${title}</span><button type="button" aria-label="Close product gallery" onClick=${()=>window.history.back()}>×</button></header><div className="crystal-gallery-stage" onTouchStart=${e=>start.current=e.touches[0].clientX} onTouchEnd=${e=>{if(start.current==null)return;const dx=e.changedTouches[0].clientX-start.current;start.current=null;if(Math.abs(dx)>40)change(dx<0?1:-1);}}><img key=${images[index]} src=${images[index]} alt=${`${title}, image ${index+1} of ${images.length}`} draggable="false"/></div><footer><button type="button" aria-label="Previous gallery image" disabled=${images.length<2} onClick=${()=>change(-1)}>←</button><span aria-live="polite">${index+1} / ${images.length}</span><button type="button" aria-label="Next gallery image" disabled=${images.length<2} onClick=${()=>change(1)}>→</button></footer></section>`,document.body,'product-fullscreen-gallery');
}
