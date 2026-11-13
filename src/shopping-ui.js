import React, { useEffect, useRef, useState } from 'react';
import htm from 'htm';
import {createPortal,flushSync} from 'react-dom';
import {useExperience,useShoppingOverlay} from './shopping-experience.js';
import {shareCart,shareCategoryLink,shareProductLink} from './cart-share.js';
import {ProductGallery} from './product-gallery.js';
import {verifiedDiscount} from './product-media.js';
import { Icon } from './Icon.js';
import { categoryParents, hierarchyHref, resolveHierarchy, productsForCategory } from './category-hierarchy.js';
import { resolveCategoryArtwork } from './category-artwork.js';
import { customerVariantLabel, formatVariantLabel, selectProducts } from './catalog.js';
import { selectVariant, calculateCart } from './cart.js';
import { formatCurrencyAmount } from './money.js';
const html=htm.bind(React.createElement);
const money=value=>formatCurrencyAmount(value,'INR',0);
const discount=(price,compare,currencyCode,compareAtCurrencyCode)=>verifiedDiscount({price,compareAt:compare,currencyCode,compareAtCurrencyCode})||0;
const validImage=url=>url&&url!=='/assets/product-placeholder.svg';
export function ProductImage({src,alt='',className='',width=420,sizes='(max-width: 600px) 42vw, (max-width: 1100px) 28vw, 240px',priority=false}) {
 const [failed,setFailed]=useState(false),[loaded,setLoaded]=useState(false);useEffect(()=>{setFailed(false);setLoaded(false);},[src]);
 let displaySrc=src,srcSet='';try{const url=new URL(src);if(url.hostname==='cdn.shopify.com'){const widths=[160,240,320,420,640,840,1200].filter(value=>value<=Math.max(width,420));if(!widths.includes(Math.min(width,1200)))widths.push(Math.min(width,1200));srcSet=widths.sort((a,b)=>a-b).map(value=>{const candidate=new URL(src);candidate.searchParams.set('width',String(value));return `${candidate.href} ${value}w`;}).join(', ');url.searchParams.set('width',String(width));displaySrc=url.href;}}catch{}
 return validImage(src)&&!failed?html`<img className=${className} src=${displaySrc} srcSet=${srcSet||undefined} sizes=${sizes} width=${width} height=${width} alt=${alt} loading=${priority?'eager':'lazy'} fetchPriority=${priority?'high':'auto'} decoding="async" data-image-state=${loaded?'loaded':'loading'} onLoad=${()=>setLoaded(true)} onError=${()=>setFailed(true)}/>`:html`<span className=${`shopping-image-unavailable ${className}`} role="img" aria-label=${`${alt ? `${alt}: `:''}Image unavailable`}>Image unavailable</span>`;
}
function CategoryArtwork({item,collectionImages={}}) {
 const artwork=resolveCategoryArtwork(item,collectionImages);const [failedUrl,setFailedUrl]=useState('');useEffect(()=>setFailedUrl(''),[artwork?.url]);
 const category=item.parentId||item.id||item.target||'';
 const remoteUrl=artwork?.url&&failedUrl!==artwork.url?artwork.url:'';const temporary=artwork?.temporary;
 if(!remoteUrl&&!temporary)return null;
 const columns=temporary?.columns||4,rows=temporary?.rows||4,index=temporary?.index??0,column=index%columns,row=Math.floor(index/columns);
 const spriteStyle=temporary?{backgroundImage:`url("${temporary.assetUrl}")`,backgroundPosition:`${columns>1?column/(columns-1)*100:0}% ${rows>1?row/(rows-1)*100:0}%`}:undefined;
 return html`<span className=${`shopping-category-artwork ${remoteUrl?'has-category-image':`is-temporary category-icon-${temporary?.name||'default'}`}`} data-category-color=${category} data-art-source=${remoteUrl?artwork.source:'temporary'} aria-hidden="true" style=${spriteStyle}>${remoteUrl&&html`<img src=${remoteUrl} alt="" loading="lazy" decoding="async" onError=${event=>{setFailedUrl(artwork.url);if(!temporary){const tile=event.currentTarget.closest('.shopping-category-card');tile?.classList.remove('has-artwork');tile?.classList.add('is-text-only');}}}/>`}</span>`;
}
function ShoppingCategoryMenu({collectionImages={},onNavigate}) {
 return html`<aside className="shopping-sidebar shopping-results-sidebar" aria-label="Browse categories"><div className="shopping-sidebar-scroll">${categoryParents.map(item=>html`<button type="button" className="shopping-sidebar-item" key=${item.id} onClick=${()=>onNavigate?.(hierarchyHref(item.id))}><${CategoryArtwork} item=${item} collectionImages=${collectionImages}/><span>${item.label}</span></button>`)}</div></aside>`;
}
export function ShoppingHeader({catalog,query,setQuery,onSearch,onNavigate,onAccount,onCart,cartCount,savedCount,loading,route,onBack,remoteCart,pending,cartError,accountAuthenticated=false}) {
 const [suggestions,setSuggestions]=useState([]);const [focused,setFocused]=useState(false);
 const [recentSearches,setRecentSearches]=useState(()=>{try{return JSON.parse(localStorage.getItem('crystal-bazz-recent-searches')||'[]').filter(item=>typeof item==='string').slice(0,6);}catch{return[];}});
 const popularSearches=['Rudraksha mala','Crystal bracelet','Gemstone rings','Puja essentials'];
 useEffect(()=>{const timer=setTimeout(()=>setSuggestions(query.trim()?selectProducts(catalog,{query}).slice(0,5):[]),220);return()=>clearTimeout(timer);},[query,catalog]);
 const search=term=>{const value=String(term||'').trim();if(value){const next=[value,...recentSearches.filter(item=>item.toLowerCase()!==value.toLowerCase())].slice(0,6);setRecentSearches(next);try{localStorage.setItem('crystal-bazz-recent-searches',JSON.stringify(next));}catch{}}setFocused(false);onSearch(value);};
 const clearRecentSearches=()=>{setRecentSearches([]);try{localStorage.removeItem('crystal-bazz-recent-searches');}catch{}};
 useEffect(()=>setFocused(false),[route?.page,route?.query]);
 if(route?.page==='product')return html`<header className="shopping-header shopping-compact-header shopping-pdp-header"><button type="button" className="shopping-pdp-back" aria-label="Back to shopping" onClick=${onBack}><${Icon} name="arrowLeft" size=${21}/></button><button type="button" className="shopping-logo" onClick=${()=>onNavigate('#home')} aria-label="Crystal Baaz home">Crystal Baaz<span>.</span></button><nav aria-label="Product page actions"><button type="button" aria-label="Search products" onClick=${()=>onNavigate('#search/')}><${Icon} name="search" size=${20}/></button><button type="button" aria-label="Customer account" onClick=${()=>onAccount?onAccount():onNavigate('#account')}><${Icon} name="user" size=${20}/></button><button type="button" className="shopping-pdp-cart" aria-label=${cartCount?`Cart, ${cartCount} items`:'Cart'} onClick=${onCart}><${Icon} name="bag" size=${20}/>${cartCount>0&&html`<span aria-hidden="true">${cartCount}</span>`}</button></nav></header>`;
 return html`<header className=${`shopping-header ${focused?'is-searching':''}`}>
  ${focused&&createPortal(html`<button type="button" className="shopping-search-backdrop" aria-label="Close search" tabIndex="-1" onClick=${()=>setFocused(false)}></button>`,document.body)}
  <div className="shopping-header-main">
   ${focused&&html`<button type="button" className="shopping-search-back" aria-label="Back to shopping" onMouseDown=${event=>event.preventDefault()} onClick=${()=>{document.activeElement?.blur?.();setFocused(false);}}><${Icon} name="arrowLeft" size=${20}/></button>`}
   <button className="shopping-logo" onClick=${()=>onNavigate('#home')} aria-label="Crystal Baaz home">Crystal Baaz<span>.</span><small>Crystals · Jewellery · Spiritual Essentials</small></button>
   <form className="shopping-search" role="search" onSubmit=${event=>{event.preventDefault();search(query);}}>
    <button className="shopping-search-icon" type="submit" aria-label="Search"><${Icon} name="search" size=${21}/></button>
    <input aria-label="Search products" placeholder="Search crystals, rings, malas..." value=${query} onChange=${event=>setQuery(event.target.value)} onFocus=${()=>setFocused(true)} onBlur=${()=>setTimeout(()=>setFocused(false),150)} onKeyDown=${event=>{if(event.key==='Escape'){setFocused(false);event.currentTarget.blur();}}}/>
   </form>
   <div className="shopping-tools"><button aria-label="Wishlist" onClick=${()=>onNavigate('#wishlist')}><${Icon} name="heart" size=${20}/><span>Saved${savedCount?` (${savedCount})`:''}</span></button><button className="shopping-account-trigger" aria-label=${accountAuthenticated ? "Account menu" : "Login"} aria-haspopup="dialog" onClick=${()=>onAccount?onAccount():onNavigate('#account')}><${Icon} name="user" size=${20}/><span>${accountAuthenticated ? "Account" : "Login"}</span><span className="shopping-account-caret" aria-hidden="true">▾</span></button><button className="shopping-cart-button" onClick=${onCart}><${Icon} name=${focused?'cart':'bag'} size=${20}/><span>${cartCount?`${cartCount} ${cartCount===1?'item':'items'}`:'My cart'}${cartCount>0&&html`<small>${cartError||!remoteCart?'Unconfirmed':money(remoteCart.cost.totalAmount.amount)}</small>`}</span></button></div>
  </div>
  ${focused&&html`<section className="shopping-search-panel" aria-label="Search suggestions">
   ${query.trim()?html`<div className="shopping-search-results">${loading?html`<div className="shopping-suggestion-skeleton" role="status" aria-label="Loading product suggestions"></div>`:suggestions.length?suggestions.map(product=>html`<button type="button" key=${product.id} onMouseDown=${event=>event.preventDefault()} onClick=${()=>{setFocused(false);onNavigate(`#product/${encodeURIComponent(product.handle)}`);}}><${ProductImage} src=${product.image}/><span>${product.title}<small>${product.price?money(product.price):'Price unavailable'}</small></span></button>`):html`<p>No products match this search.</p>`}<button type="button" className="shopping-search-all" onMouseDown=${event=>event.preventDefault()} onClick=${()=>search(query)}>See all results →</button></div>`:html`<div className="shopping-search-heading"><strong>${recentSearches.length?'Recent searches':'Popular searches'}</strong>${recentSearches.length>0&&html`<button type="button" onMouseDown=${event=>event.preventDefault()} onClick=${clearRecentSearches}>Clear</button>`}</div><div className="shopping-search-chips">${(recentSearches.length?recentSearches:popularSearches).map(term=>html`<button type="button" key=${term} className="shopping-search-chip" onMouseDown=${event=>event.preventDefault()} onClick=${()=>search(term)}>${term}</button>`)}</div>`}
  </section>`}
  ${!focused&&html`<nav className="shopping-topnav" aria-label="Shopping categories">${categoryParents.map(parent=>html`<button type="button" key=${parent.id} onClick=${()=>onNavigate(hierarchyHref(parent.id))}>${parent.label}</button>`)}</nav>`}
 </header>`;
}
export function Quantity({line,onUpdate,label='',pending=false}) {const [busy,setBusy]=useState(false);const disabled=busy||pending;const change=async delta=>{if(disabled)return;setBusy(true);try{await onUpdate(line.key,delta,label);}finally{setBusy(false);}};return html`<div className="shopping-quantity" role="group" aria-label=${`Quantity for ${label}`} aria-busy=${disabled}><button disabled=${disabled} type="button" aria-label=${`Decrease ${label} quantity`} onClick=${()=>change(-1)}>−</button><span aria-live="polite">${line.quantity}</span><button disabled=${disabled} type="button" aria-label=${`Increase ${label} quantity`} onClick=${()=>change(1)}>+</button></div>`;}
function Purchase({product,variant,cart,pendingKeys=[],pendingOperations=[],onAdd,onUpdate,onOptions}) {
 const [busy,setBusy]=useState(false);const line=cart.find(l=>l.productId===product.id&&l.variantId===variant?.id);
 const identityVerified=product.variants.length<=1||Boolean(formatVariantLabel(product,variant));
 const enabled=variant?.canPurchase===true&&variant?.available===true&&Number(variant.price)>0&&identityVerified;
 const unavailable=variant?.available===false;
 const label=enabled?'Buy Now':unavailable?'Unavailable':Number(variant?.price)>0?'Needs confirmation':'Price pending';
 const stateClass=onOptions?'':unavailable?'shopping-add-unavailable':!enabled?'shopping-add-unconfirmed':'';
 const buttonClass=['shopping-add',stateClass].filter(Boolean).join(' ');
 const optionLabel=product.variantsComplete===false?'More options':`${product.variants.length} options`;
 const content=onOptions?html`<span>Buy Now</span><small className="shopping-add-option-count">${optionLabel}</small>`:label;
 const operation=pendingOperations.find(item=>item.key===line?.key);
 if(line&&operation?.type==='add')return html`<button className="shopping-add shopping-add-pending" type="button" disabled aria-busy="true" aria-label="Saving item to cart">${content}</button>`;
 return line?html`<${Quantity} line=${line} onUpdate=${onUpdate} label=${product.title} pending=${pendingKeys.includes(line.key)}/>`:html`<button className=${buttonClass} type="button" disabled=${busy||(!enabled&&!onOptions)} aria-busy=${busy} aria-label=${onOptions?product.variantsComplete===false?`View more options for ${product.title}`:`Choose from ${optionLabel} for ${product.title}`:busy?'Saving item to cart':label} aria-haspopup=${onOptions&&product.variantsComplete!==false?'dialog':undefined} onClick=${async()=>{if(onOptions){onOptions();return;}flushSync(()=>setBusy(true));try{await onAdd(product,variant.id);}finally{setBusy(false);}}}>${content}</button>`;
}
export function VariantSheetContent({product,onClose,cart=[],pendingKeys=[],pendingOperations=[],onAdd,onUpdate,status='',sheetRef}) {
 return html`<section className="shopping-variant-sheet" ref=${sheetRef} tabIndex="-1" role="dialog" aria-modal="true" aria-label=${`Select ${product.title} variant`}>
  <header><h2>${product.title}</h2><button type="button" aria-label="Close variants" onClick=${onClose}>×</button></header>
  ${status&&html`<p className="shopping-variant-status" role="alert">${status}</p>`}
  <div className="shopping-variant-list" aria-label="Product variants">${product.variants.map(variant=>{
   const label=customerVariantLabel(product,variant);
   const identityVerified=product.variants.length<=1||Boolean(formatVariantLabel(product,variant));
   const unavailable=variant.available===false;
   const availability=!identityVerified?'Option details need confirmation':unavailable?'Unavailable':variant.canPurchase===true?'Available':'Availability not confirmed';
   const availabilityClass=!identityVerified?'is-unconfirmed':unavailable?'is-unavailable':variant.canPurchase===true?'is-available':'is-unconfirmed';
   return html`<div className="shopping-variant-line" key=${variant.id} data-variant-id=${variant.id}>
    <${ProductImage} className="shopping-variant-thumb" src=${variant.image||product.image} alt=${product.title} width=${100} sizes="52px"/>
    <div className="shopping-variant-details"><strong className="shopping-variant-label">${label||'Option details need confirmation'}</strong><strong className="shopping-variant-price">${Number(variant.price)>0?money(variant.price):'Price unavailable'}</strong><small className=${`shopping-variant-availability ${availabilityClass}`}>${availability}</small></div>
    <${Purchase} product=${product} variant=${variant} cart=${cart} pendingKeys=${pendingKeys} pendingOperations=${pendingOperations} onAdd=${onAdd} onUpdate=${onUpdate}/>
   </div>`;
  })}</div>
 </section>`;
}
function VariantSheet({product,onClose,...props}) {
 useShoppingOverlay();
 const ref=useRef(null),[status,setStatus]=useState('');
 useEffect(()=>{
  const previous=document.activeElement,body=document.body,scrollY=window.scrollY;
  const oldStyle={overflow:body.style.overflow,position:body.style.position,top:body.style.top,width:body.style.width};
  body.style.overflow='hidden';body.style.position='fixed';body.style.top=`-${scrollY}px`;body.style.width='100%';
  ref.current?.querySelector('button:not(:disabled)')?.focus();
  const key=e=>{
   if(e.key==='Escape'){onClose();return;}
   if(e.key==='Tab'){
    const controls=[...ref.current.querySelectorAll('button:not(:disabled)')],first=controls[0],last=controls.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
   }
  };
  document.addEventListener('keydown',key);
  return()=>{Object.assign(body.style,oldStyle);document.removeEventListener('keydown',key);window.scrollTo(0,scrollY);previous?.focus?.({preventScroll:true});};
 },[]);
 const addVariant=async(...args)=>{
  setStatus('');
  try{
   const added=await props.onAdd(...args);
   if(added===true){onClose();return true;}
   setStatus('Shopify could not confirm this addition. Your cart has not been confirmed; please try again.');
   return added;
  }catch{
   setStatus('Shopify could not confirm this addition. Your cart has not been confirmed; please try again.');
   return false;
  }
 };
 return createPortal(html`<div className="shopping-modal-backdrop shopping-variant-backdrop" onClick=${event=>{if(event.target===event.currentTarget)onClose();}}><${VariantSheetContent} product=${product} onClose=${onClose} cart=${props.cart||[]} pendingKeys=${props.pendingKeys||[]} pendingOperations=${props.pendingOperations||[]} onAdd=${addVariant} onUpdate=${props.onUpdate} status=${status} sheetRef=${ref}/></div>`,document.body,`variant-sheet-${product.id}`);
}

function productAttributeLabels(product) {
 const normalize=value=>typeof value==='string'?value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' '):'';
 const categoryValues=new Set([product.type,product.category,...(product.collectionTitles||[])].map(normalize).filter(Boolean));
 const isCategoryValue=value=>{const normalized=normalize(value);return categoryValues.has(normalized)||categoryValues.has(normalized.replace(/s$/,''))||categoryValues.has(`${normalized}s`);};
 const valid=value=>typeof value==='string'&&value.trim()&&!/^(?:default title|standard|(?:option|variant)\s*\d+)$/i.test(value.trim());
 return [...new Set((product.attributes||[]).map(attribute=>{
  if(typeof attribute==='string')return isCategoryValue(attribute)?'':attribute.trim();
  if(!attribute?.value)return '';
  const label=typeof attribute.label==='string'?attribute.label.trim():'';
  const value=String(attribute.value).trim();
  if(/category|collection|product\s*type/i.test(label)||isCategoryValue(value))return '';
  return label?`${label}: ${value}`:value;
 }).filter(valid))];
}
function ProductTitle({product,onOpen}) {
 return product.title?html`<button className="shopping-product-title" type="button" onClick=${()=>onOpen(product)}><span>${product.title}</span></button>`:null;
}
function ProductAttributes({product}) {
 const labels=productAttributeLabels(product);
 return labels.length?html`<div className="shopping-product-attributes">${labels.map((label,index)=>html`<span key=${`${index}-${label}`}>${label}</span>`)}</div>`:null;
}
function ProductPriceInfo({price,compare}) {
 return html`<div className="shopping-tile-prices"><strong>${price>0?money(price):'Price unavailable'}</strong>${price>0&&compare>price&&html`<span className="shopping-tile-comparison"><del>${money(compare)}</del></span>`}</div>`;
}
function WishlistControl({product,saved,onSave}) {
 const isSaved=saved.includes(product.id);
 return html`<button type="button" className="shopping-save" aria-label=${isSaved?'Remove from wishlist':'Add to wishlist'} aria-pressed=${isSaved} onClick=${()=>onSave(product.id)}><${Icon} name="heart" size=${16}/></button>`;
}
function VariantAddControl({product,variant,line,cart,pendingKeys,pendingOperations,onAdd,onUpdate,onOptions,off}) {
 const label=customerVariantLabel(product,variant,line?.variantTitle);
 const isInternalVariantLabel=/^(?:option|variant)\s*\d+$/i.test(label)||/^SKU\s*:/i.test(label)||(variant?.sku&&label.trim().toLowerCase()===String(variant.sku).trim().toLowerCase());
 const displayLabel=isInternalVariantLabel?'':label;
 const optionsCta=Boolean(onOptions&&!line);
 const price=html`<${ProductPriceInfo} price=${Number(variant?.price)} compare=${Number(variant?.compareAt)}/>`;
 const purchase=html`<${Purchase} product=${product} variant=${variant} cart=${cart} pendingKeys=${pendingKeys} pendingOperations=${pendingOperations} onAdd=${onAdd} onUpdate=${onUpdate} onOptions=${onOptions}/>`;
 return html`<div className=${`shopping-tile-action ${displayLabel?'has-variant-label':''}`}>${displayLabel&&html`<span className="shopping-tile-variant-label">${displayLabel}</span>`}<div className=${`shopping-tile-purchase-row ${optionsCta?'has-options-cta':''}`}>${optionsCta?purchase:price}${optionsCta?price:purchase}</div></div>`;
}
function ProductImagePanel({product,saved,onOpen,onSave,variant,line,cart,pendingKeys,pendingOperations,onAdd,onUpdate,onOptions,imagePriority=false,off}) {
 const imageSources=[variant?.image,...(product.galleryMedia||[]).filter(media=>media?.type==='image').map(media=>media.src),...(product.images||[]),product.image].filter(src=>validImage(src));
 const images=[...new Set(imageSources)],imageKey=images.join('|');const [photo,setPhoto]=useState(0),touch=useRef(null),skipClick=useRef(false);
 useEffect(()=>{setPhoto(0);},[product.id,variant?.id,imageKey]);
 const move=delta=>setPhoto(index=>(index+delta+images.length)%images.length);
 const start=event=>{const point=event.touches?.[0];if(point)touch.current={x:point.clientX,y:point.clientY};};
 const end=event=>{if(!touch.current)return;const point=event.changedTouches?.[0],dx=(point?.clientX||0)-touch.current.x,dy=(point?.clientY||0)-touch.current.y;touch.current=null;if(images.length>1&&Math.abs(dx)>36&&Math.abs(dx)>Math.abs(dy)){skipClick.current=true;setTimeout(()=>{skipClick.current=false;},350);move(dx<0?1:-1);}};
 return html`<div className="shopping-product-image-panel" data-product-image-tile><button className="shopping-product-image-link" type="button" onTouchStart=${start} onTouchEnd=${end} onClick=${()=>{if(skipClick.current){skipClick.current=false;return;}onOpen(product);}} aria-label=${images.length>1?`View ${product.title}, image ${photo+1} of ${images.length}`:`View ${product.title}`}><${ProductImage} src=${images[photo]||variant?.image||product.image} alt=${product.title} width=${420} priority=${imagePriority}/></button>${off>0&&html`<span className="shopping-product-discount" aria-label=${`${off}% off`}>${off}% OFF</span>`}<${WishlistControl} product=${product} saved=${saved} onSave=${onSave}/>${images.length>1&&html`<div className="shopping-product-image-dots" role="group" aria-label="Product images">${images.map((src,index)=>html`<button type="button" key=${src} className=${index===photo?'is-active':''} aria-label=${`Show image ${index+1} of ${images.length}`} aria-current=${index===photo?'true':undefined} onClick=${event=>{event.stopPropagation();setPhoto(index);}}></button>`)}</div>`}<${VariantAddControl} product=${product} variant=${variant} line=${line} cart=${cart} pendingKeys=${pendingKeys} pendingOperations=${pendingOperations} onAdd=${onAdd} onUpdate=${onUpdate} onOptions=${onOptions} off=${off}/></div>`;
}
function ProductTile({product,off,saved,selected,line,cart,pendingKeys,pendingOperations,onOpen,onAdd,onSave,onUpdate,onOptions,imagePriority=false}) {
 return html`<${React.Fragment}><${ProductImagePanel} product=${product} saved=${saved} onOpen=${onOpen} onSave=${onSave} variant=${selected} line=${line} cart=${cart} pendingKeys=${pendingKeys} pendingOperations=${pendingOperations} onAdd=${onAdd} onUpdate=${onUpdate} onOptions=${onOptions} imagePriority=${imagePriority} off=${off}/><div className="shopping-product-copy"><${ProductTitle} product=${product} onOpen=${onOpen}/><${ProductAttributes} product=${product}/>${line&&onOptions&&html`<button type="button" className="shopping-option-link" onClick=${onOptions}>Change option</button>`}</div></${React.Fragment}>`;
}
function ShoppingCardView({product,onOpen,onAdd,onSave,saved=[],cart=[],onUpdate,pendingKeys=[],pendingOperations=[],imagePriority=false}) {
 const [options,setOptions]=useState(false);const variant=selectVariant(product);const lines=cart.filter(l=>l.productId===product.id);const line=lines.find(l=>l.variantId===variant?.id)||lines[0];const selected=line?product.variants.find(v=>v.id===line.variantId)||variant:variant;const price=Number(selected?.price??product.price);const compare=Number(selected?.compareAt??product.compareAt);const off=discount(price,compare,selected?.currencyCode,selected?.compareAtCurrencyCode);
 const onOptions=product.variantsComplete===false?()=>onOpen(product):product.variants.length>1?()=>setOptions(true):null;
 return html`<article className="shopping-product-card" data-product-id=${product.id} data-product-handle=${product.handle} data-product-stale=${product.stale===true}><${ProductTile} product=${product} off=${off} saved=${saved} selected=${selected} line=${line} cart=${cart} pendingKeys=${pendingKeys} pendingOperations=${pendingOperations} onOpen=${onOpen} onAdd=${onAdd} onSave=${onSave} onUpdate=${onUpdate} onOptions=${onOptions} imagePriority=${imagePriority}/>${options&&html`<${VariantSheet} product=${product} onClose=${()=>setOptions(false)} cart=${cart} pendingKeys=${pendingKeys} pendingOperations=${pendingOperations} onAdd=${onAdd} onUpdate=${onUpdate}/>`}</article>`;
}
function sameProductState(left,right) {
 const leftLines=left.cart.filter(line=>line.productId===left.product.id),rightLines=right.cart.filter(line=>line.productId===right.product.id);
 const sameLines=leftLines.length===rightLines.length&&leftLines.every((line,index)=>line.key===rightLines[index].key&&line.quantity===rightLines[index].quantity);
 const leftPending=left.pendingOperations.filter(item=>item.productId===left.product.id),rightPending=right.pendingOperations.filter(item=>item.productId===right.product.id);
 const samePending=leftPending.length===rightPending.length&&leftPending.every((item,index)=>item.key===rightPending[index].key&&item.type===rightPending[index].type);
 return left.product===right.product&&left.saved===right.saved&&left.imagePriority===right.imagePriority&&left.onOpen===right.onOpen&&left.onAdd===right.onAdd&&left.onSave===right.onSave&&left.onUpdate===right.onUpdate&&sameLines&&samePending;
}
export const ShoppingCard=React.memo(ShoppingCardView,sameProductState);
export function ShoppingGrid({products,gridRef,...props}) {return html`<div className="shopping-product-grid" ref=${gridRef}>${products.map((p,index)=>html`<${ShoppingCard} key=${p.id} product=${p} imagePriority=${index<4} ...${props}/>` )}</div>`;}
function Empty({title='No products in this category',text='No verified Shopify products are assigned here yet.'}) {return html`<div className="shopping-empty"><h2>${title}</h2><p>${text}</p></div>`;}
function LoadingCards({count=4}) {return html`<div className="shopping-skeleton-grid" role="status" aria-label="Loading products">${Array.from({length:count},(_,i)=>html`<div key=${i} className="shopping-skeleton"></div>`)}</div>`;}
export function CatalogStatus({loading,error,onRetry}) {return error?html`<div className="shopping-error" role="alert"><h2>Products couldn’t be loaded</h2><p>We couldn’t load products just now. Please try again.</p><button className="shopping-primary" onClick=${onRetry}>Retry</button></div>`:loading?html`<div className="shopping-loading"><${LoadingCards} count=${viewportProductBatch(null,null)}/></div>`:null;}
function viewportProductBatch(grid,root) {
 if(typeof window==='undefined')return 8;
 const fallbackColumns=window.innerWidth<=780?2:4;
 if(!grid)return Math.max(fallbackColumns,Math.min(24,fallbackColumns*Math.ceil((window.innerHeight-160)/(window.innerWidth<=780?250:360))));
 const style=window.getComputedStyle(grid);
 const columns=Math.max(1,style.gridTemplateColumns.split(/\s+/).filter(Boolean).length);
 const cardHeight=grid.firstElementChild?.getBoundingClientRect().height|| (window.innerWidth<=780?250:360);
 const rowGap=Number.parseFloat(style.rowGap)||0;
 const rootRect=root?.getBoundingClientRect();
 const gridRect=grid.getBoundingClientRect();
 const offset=rootRect?Math.max(0,gridRect.top-rootRect.top):Math.max(0,gridRect.top);
 const available=Math.max(cardHeight,(root?.clientHeight||window.innerHeight)-offset-80);
 return Math.max(columns,Math.min(24,columns*Math.ceil(available/(cardHeight+rowGap))));
}
function useInfiniteGrid(itemCount,resetKey,rootRef) {
 const gridRef=useRef(null),sentinelRef=useRef(null);
 const [batchSize,setBatchSize]=useState(()=>viewportProductBatch(null,null)),[visibleCount,setVisibleCount]=useState(()=>viewportProductBatch(null,null));
 useEffect(()=>{
  const update=()=>setBatchSize(viewportProductBatch(gridRef.current,rootRef?.current));
  update();window.addEventListener('resize',update);
  return()=>window.removeEventListener('resize',update);
 },[rootRef]);
 useEffect(()=>{
  const next=viewportProductBatch(gridRef.current,rootRef?.current);
  setBatchSize(next);setVisibleCount(next);
 },[resetKey,rootRef]);
 useEffect(()=>{if(itemCount>0&&visibleCount>itemCount)setVisibleCount(Math.min(itemCount,batchSize));},[batchSize,itemCount,visibleCount]);
 useEffect(()=>{
  const sentinel=sentinelRef.current;
  if(!sentinel)return;
  if(typeof IntersectionObserver==='undefined'){setVisibleCount(itemCount);return;}
  const observer=new IntersectionObserver(([entry])=>{
   if(entry.isIntersecting)setVisibleCount(current=>Math.min(itemCount,current+batchSize));
  },{root:rootRef?.current||null,rootMargin:'0px 0px -96px 0px'});
  observer.observe(sentinel);
  return()=>observer.disconnect();
 },[batchSize,itemCount,resetKey,rootRef,visibleCount]);
 return {gridRef,sentinelRef,visibleCount};
}
export function ShoppingBrowse({route,catalog,sort,onSort,onNavigate,pageSize,onMore,loading,loadingMore=false,error,onRetry,collectionImages={},...props}) {
 const {parent,item,parents,items,state,invalidSelection}=resolveHierarchy(route);const [categoryQuery,setCategoryQuery]=useState('');const ref=useRef(null);const key=`${parent.id}/${item?.id||''}`;
 useEffect(()=>{ref.current?.scrollTo({top:0});setCategoryQuery('');},[key]);
 const raw=productsForCategory(catalog,item);const matches=selectProducts(raw,{sort});const siblings=state==='products'&&items.length?(item?.id===parent.id?[parent,...items]:items):parents;
 const {gridRef,sentinelRef,visibleCount}=useInfiniteGrid(matches.length,key,ref);
 const select=choice=>state==='products'&&items.length?onNavigate(choice.id===parent.id?`#${parent.kind}/${parent.target}`:hierarchyHref(parent.id,choice.id)):onNavigate(hierarchyHref(choice.id));
 const shareCategory=async()=>{const label=item?.label||parent.label;const result=await shareCategoryLink({category:label,routeHash:hierarchyHref(parent.id,item?.id)});if(result.message)props.onNotice?.(result.message);};
 const headingStatus=error?'Products unavailable':'';
 return html`<main className="shopping-browse" data-browse-state=${state} data-parent=${parent.id}><aside className="shopping-sidebar" aria-label=${state==='products'&&items.length?`${parent.label} subcategories`:'Parent categories'}>${state==='products'&&items.length&&html`<button className="shopping-parent-back" aria-label=${`Back to ${parent.label} categories`} onClick=${()=>onNavigate(hierarchyHref(parent.id))}><${Icon} name="arrowLeft" size=${15}/><span className="shopping-parent-back-short">Back</span><span className="shopping-parent-back-full">Back to ${parent.label}</span></button>`}<div className="shopping-sidebar-scroll">${siblings.map(choice=>html`<button className=${`shopping-sidebar-item ${choice.id===(state==='products'&&items.length?item.id:parent.id)?'is-active':''}`} key=${choice.id} aria-current=${choice.id===(state==='products'&&items.length?item.id:parent.id)?'page':undefined} onClick=${()=>select(choice)}><${CategoryArtwork} item=${choice} collectionImages=${collectionImages}/><span>${choice.label}</span></button>`)}</div></aside><section className="shopping-browse-content" ref=${ref}><header className="shopping-list-heading"><div><span className="shopping-breadcrumb">${state==='products'&&items.length?parent.label:'Shop by category'}</span><h1>${item?.label||parent.label}</h1>${headingStatus&&html`<p>${headingStatus}</p>`}</div>${state==='overview'?html`<input className="shopping-subcategory-filter" aria-label="Find a subcategory" placeholder="Find a category" value=${categoryQuery} onChange=${e=>setCategoryQuery(e.target.value)}/><button type="button" className="shopping-category-share" onClick=${shareCategory}><${Icon} name="share" size=${16}/> Share category</button>`:html`<div className="shopping-list-controls"><button type="button" className="shopping-category-share" onClick=${shareCategory}><${Icon} name="share" size=${16}/> Share category</button></div>`}</header>${invalidSelection?html`<${Empty} title="Category not found" text="Choose a category from the sidebar."/>`:state==='overview'?html`<div className="shopping-subcategory-grid">${items.filter(i=>i.label.toLowerCase().includes(categoryQuery.toLowerCase())).map(i=>{const artwork=resolveCategoryArtwork(i,collectionImages);return html`<button key=${i.id} className=${`shopping-category-card ${artwork?'has-artwork':'is-text-only'}`} onClick=${()=>onNavigate(hierarchyHref(i.relatedParentId||parent.id,i.relatedParentId?null:i.id))}><${CategoryArtwork} item=${i} collectionImages=${collectionImages}/><strong>${i.label}</strong></button>`;})}</div>`:html`<${CatalogStatus} key="catalog-status" loading=${loading} error=${error} onRetry=${onRetry}/>${!loading&&!error&&(matches.length?html`<${ShoppingGrid} key="product-grid" products=${matches.slice(0,visibleCount)} gridRef=${gridRef} ...${props}/>${(visibleCount<matches.length||loadingMore)&&html`<div ref=${sentinelRef} className="shopping-infinite-sentinel">${loadingMore&&visibleCount>=matches.length&&html`<span role="status">Loading more products…</span>`}</div>`}`:loadingMore?html`<${LoadingCards} count=${4}/>`:html`<${Empty} text=${item.mappingIssue||'No verified Shopify products match this category.'}/>` )}`}</section></main>`;
}
function ProductRail({title,products,onView,priority=false,...props}) {
 const ref=useRef(null);
 const productKey=products.map(product=>product.id).join('|');
 useEffect(()=>{
  const track=ref.current;
  if(!track)return;
  if(typeof IntersectionObserver==='undefined'){
   [...track.children].forEach(card=>{card.dataset.fullyVisible='true';});
   return;
  }
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{entry.target.dataset.fullyVisible=String(entry.isIntersecting&&entry.intersectionRatio>=.999);}),{root:track,threshold:[1]});
  [...track.children].forEach(card=>observer.observe(card));
  return()=>observer.disconnect();
 },[title,productKey]);
 return products.length?html`<section className="shopping-rail"><header><h2>${title}</h2><button onClick=${onView}>See all →</button></header><div className="shopping-rail-body"><div className="shopping-rail-track" ref=${ref} tabIndex="0" aria-label=${`${title} products`} onKeyDown=${e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.currentTarget.scrollBy({left:e.key==='ArrowRight'?190:-190,behavior:'smooth'});}}}>${products.slice(0,10).map((p,index)=>html`<${ShoppingCard} product=${p} key=${p.id} imagePriority=${priority&&index<2} ...${props}/>` )}</div>${products.length>6&&html`<button className="shopping-rail-next" aria-label=${`Next ${title} products`} onClick=${()=>{const track=ref.current;if(track)track.scrollBy({left:track.scrollLeft+track.clientWidth>=track.scrollWidth-5?-track.scrollWidth:380,behavior:'smooth'});}}>›</button>`}</div></section>`:null;
}
export function NewArrivalsPreview({products,onView,...props}) {
 const visible=products.filter(product=>/^gid:\/\/shopify\/Product\//.test(product.id||'')&&product.previewOnly!==true).slice(0,12);
 return html`<section className="shopping-rail shopping-new-arrivals"><header><h2>New Arrivals</h2><button onClick=${onView}>See all →</button></header><div className="shopping-product-grid shopping-new-arrivals-grid" aria-label="New Arrivals products">${visible.map((product,index)=>html`<${ShoppingCard} product=${product} key=${product.id} imagePriority=${index<4} ...${props}/>` )}</div></section>`;
}
export function ShoppingHome({catalog,onNavigate,loading,loadingMore=false,error,onRetry,collectionImages={},...props}) {
 const homepageParents=[...categoryParents].sort((a,b)=>a.id==='best-seller'?-1:b.id==='best-seller'?1:a.displayOrder-b.displayOrder);
 return html`<main className="shopping-home"><section className="shopping-home-categories"><header><h2>Shop by category</h2><button onClick=${()=>onNavigate(hierarchyHref())}>See all →</button></header><div className="shopping-home-category-grid" aria-label="Main categories">${homepageParents.map(p=>{const artwork=resolveCategoryArtwork(p,collectionImages);return html`<button className=${`shopping-category-card ${artwork?'has-artwork':'is-text-only'}`} key=${p.id} data-main-category=${p.id} onClick=${()=>onNavigate(hierarchyHref(p.id))}><${CategoryArtwork} item=${p} collectionImages=${collectionImages}/><strong>${p.label}</strong></button>`;})}</div></section><${CatalogStatus} key="catalog-status" loading=${loading} error=${error} onRetry=${onRetry}/>${!loading&&!error&&homepageParents.map(parent=>{const items=productsForCategory(catalog,parent);return items.length?html`<div key=${parent.id} data-home-section=${parent.id} className=${parent.id==='best-seller'?'home-best-seller-section':''}>${parent.id==='new-arrivals'?html`<${NewArrivalsPreview} products=${items} onView=${()=>onNavigate(hierarchyHref(parent.id))} ...${props}/>`:html`<${ProductRail} title=${parent.label} products=${items} priority=${parent.id==='best-seller'} onView=${()=>onNavigate(hierarchyHref(parent.id))} ...${props}/>`}</div>`:html`<section key=${parent.id} className=${`shopping-pending-section ${parent.id==='best-seller'?'home-best-seller-section':''}`} data-home-section=${parent.id}><header><h2>${parent.label}</h2><button onClick=${()=>onNavigate(hierarchyHref(parent.id))}>Explore →</button></header>${parent.id!=='new-arrivals'&&html`<p>No verified Shopify products are currently assigned to this category.</p>`}${loadingMore&&html`<${LoadingCards} count=${4}/>`}</section>`;})}</main>`;
}
export function ShoppingResults({catalog,title,query='',savedOnly=false,saved=[],loading,loadingMore=false,error,onRetry,pageSize,onMore,sort,onSort,collectionImages={},onNavigate,...props}) {
 const products=selectProducts(catalog,{query,sort,filter:savedOnly?{kind:'saved'}:{kind:'all'},saved});
 const headingStatus=error?'Products unavailable':'';
 const ref=useRef(null);
 const {gridRef,sentinelRef,visibleCount}=useInfiniteGrid(products.length,title,ref);
 return html`<main className="shopping-results shopping-results-layout"><${ShoppingCategoryMenu} collectionImages=${collectionImages} onNavigate=${onNavigate}/><section className="shopping-results-content" ref=${ref}><header className="shopping-list-heading"><div><h1>${title}</h1>${headingStatus&&html`<p>${headingStatus}</p>`}</div></header><${CatalogStatus} key="catalog-status" loading=${loading} error=${error} onRetry=${onRetry}/>${!loading&&!error&&(products.length?html`<${ShoppingGrid} key="product-grid" products=${products.slice(0,visibleCount)} gridRef=${gridRef} saved=${saved} ...${props}/>${(visibleCount<products.length||loadingMore)&&html`<div ref=${sentinelRef} className="shopping-infinite-sentinel">${loadingMore&&visibleCount>=products.length&&html`<span role="status">Loading more products…</span>`}</div>`}`:loadingMore?html`<${LoadingCards} count=${4}/>`:html`<${Empty} title=${savedOnly?'Your wishlist is empty':'No products found'} text=${savedOnly?'Save a product using its heart button.':'Try a different search.'}/>` )}</section></main>`;
}
function shopifyDescriptionText(value) {
 if(typeof value!=='string')return '';
 const decode=(value,radix)=>{try{return String.fromCodePoint(parseInt(value,radix));}catch{return ' ';}};
 return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<\s*br\s*\/?>|<\/(?:p|div|li|h[1-6])\s*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#x([\da-f]{1,6});/gi,(_,code)=>decode(code,16)).replace(/&#(\d{1,7});/g,(_,code)=>decode(code,10)).replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function verifiedProductReviews(product) {
 return (Array.isArray(product?.reviews)?product.reviews:[]).filter(review=>review?.verified===true&&Number(review.rating)>=1&&Number(review.rating)<=5&&(review.text||review.body||review.content)).slice(0,20);
}
function verifiedCertification(product) {
 const certification=product?.certification;
 return certification?.verified===true&&certification.issuer&&(certification.certificateNumber||certification.id)?certification:null;
}
function verifiedFeatureChips(product,certification) {
 const features=(Array.isArray(product?.featureChips)?product.featureChips:[]).filter(item=>item?.verified===true&&typeof item.label==='string'&&item.label.trim()).map(item=>item.label.trim()).slice(0,4);
 if(certification)features.push(`Certified · ${certification.issuer}`);
 return [...new Set(features)];
}
function verifiedProductRating(product) {
 const summary=product?.reviewSummary;const rating=Number(summary?.rating),count=Number(summary?.count);
 return summary?.verified===true&&typeof summary.source==='string'&&summary.source.trim()&&Number.isFinite(rating)&&rating>=1&&rating<=5&&Number.isInteger(count)&&count>0?{rating,count}:null;
}
function galleryItemLabel(media,index) {return media.alt||`Product media ${index+1}`;}
function ProductGalleryMedia({media,title,index,total,priority=false}) {
 const item=typeof media==='string'?{type:'image',src:media,alt:title}:media||{};
 let host='';try{host=new URL(item.src).hostname.toLowerCase();}catch{}
 const safeExternal=item.type==='external-video'&&/(^|\.)youtube(?:-nocookie)?\.com$|(^|\.)youtu\.be$|(^|\.)vimeo\.com$/.test(host);
 let source=null;try{const url=new URL(item.src);if(url.protocol==='https:')source=url.href;}catch{}
 if(!source)return html`<span className="shopping-image-unavailable" role="img" aria-label="Product media unavailable">Product media unavailable</span>`;
 if(item.type==='video')return html`<video className="shopping-gallery-media" poster=${item.poster||undefined} controls playsInline preload="metadata" aria-label=${item.alt||`${title} product video`}><source src=${source} type=${item.mimeType||undefined}/></video>`;
 if(item.type==='external-video')return safeExternal?html`<iframe className="shopping-gallery-media shopping-gallery-external" src=${source} title=${item.alt||`${title} product video`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation"/>`:html`<span className="shopping-image-unavailable" role="img" aria-label="Product video unavailable">Product video unavailable</span>`;
 if(item.type!=='image')return html`<span className="shopping-image-unavailable" role="img" aria-label="Product media unavailable">Product media unavailable</span>`;
 return html`<${ProductImage} className="shopping-gallery-media" src=${source} alt=${item.alt||`${title}, image ${index+1} of ${total}`} width=${1200} sizes="(max-width: 780px) 100vw, 50vw" priority=${priority}/>`;
}
export function PdpPurchaseBar({product,variant,off,thumbnail,cart=[],pendingKeys=[],pendingOperations=[],onAdd,onUpdate,onNavigate}) {
 const [quantity,setQuantity]=useState(1),[busy,setBusy]=useState(false),[quantityBusy,setQuantityBusy]=useState(false);
 const line=cart.find(item=>item.productId===product.id&&item.variantId===variant?.id);
 const identityVerified=product.variants.length<=1||Boolean(formatVariantLabel(product,variant));
 const enabled=variant?.canPurchase===true&&variant?.available===true&&Number(variant.price)>0&&identityVerified;
 const pending=Boolean(line&&pendingKeys.includes(line.key))||pendingOperations.some(item=>item.productId===product.id&&item.variantId===variant?.id);
 const pendingAdd=pendingOperations.some(item=>item.productId===product.id&&item.variantId===variant?.id&&item.type==='add');
 useEffect(()=>{setQuantity(1);setBusy(false);setQuantityBusy(false);},[product.id,variant?.id]);
 const changeQuantity=async delta=>{
  if(busy||quantityBusy||pending||!enabled)return;
  if(line){setQuantityBusy(true);try{await onUpdate(line.key,delta,product.title);}finally{setQuantityBusy(false);}return;}
  setQuantity(value=>Math.max(1,Math.min(999,value+delta)));
 };
 const buy=async()=>{
  if(busy||quantityBusy||pending||!enabled)return;
  if(line)return;
  setBusy(true);try{await onAdd(product,variant.id,quantity);}finally{setBusy(false);}
 };
 const offer=(Array.isArray(product.offers)?product.offers:[]).find(item=>item?.verified===true&&item?.active===true&&typeof (item.title||item.text)==='string'&&(item.title||item.text).trim());
 const buttonLabel=pendingAdd||busy?'Adding…':pending?'Updating…':line?'Added':enabled?'Buy Now':variant?.available===false?'Unavailable':'Availability unconfirmed';
 const availabilityClass=enabled||line?'':variant?.available===false?'is-unavailable':'is-unconfirmed';
 return html`<div className="shopping-pdp-sticky-wrap">${offer&&html`<div className="shopping-pdp-offer" role="note">${offer.title||offer.text}</div>`}<section className=${`shopping-pdp-sticky ${line?'has-cart-line':''}`} aria-label="Purchase product"><${ProductImage} className="shopping-pdp-sticky-thumb" src=${thumbnail} alt="" width=${100} sizes="52px"/><div className="shopping-pdp-sticky-price"><strong>${Number(variant?.price)>0?money(variant.price):'Price pending'}</strong>${off>0&&html`<span><small>MRP</small><del>${money(variant.compareAt)}</del></span>`}</div><div className="shopping-pdp-quantity" role="group" aria-label=${`Quantity for ${product.title}`} aria-busy=${busy||quantityBusy||pending}><button type="button" aria-label=${`Decrease ${product.title} quantity`} disabled=${!enabled||busy||quantityBusy||pending||Boolean(line?line.quantity<=0:quantity<=1)} onClick=${()=>changeQuantity(-1)}>−</button><span aria-live="polite">${line?.quantity||quantity}</span><button type="button" aria-label=${`Increase ${product.title} quantity`} disabled=${!enabled||busy||quantityBusy||pending||(line&&line.quantity>=999)} onClick=${()=>changeQuantity(1)}>+</button></div><button type="button" className=${`shopping-primary shopping-pdp-buy ${availabilityClass}`} disabled=${!enabled||busy||quantityBusy||pending||Boolean(line)} aria-busy=${busy||pending} onClick=${buy}>${buttonLabel}</button></section></div>`;
}
export function ShoppingProduct({product,catalog,loading,error,onRetry,onBack,selectedVariantId='',...props}) {
 const [variantId,setVariantId]=useState(selectedVariantId),[photo,setPhoto]=useState(0),[zoom,setZoom]=useState(false);const galleryTouch=useRef(null);
 useEffect(()=>{setVariantId(selectedVariantId||'');setPhoto(0);setZoom(false);},[product?.id,selectedVariantId]);
 if(loading||error)return html`<main className="shopping-results"><${CatalogStatus} key="catalog-status" loading=${loading} error=${error} onRetry=${onRetry}/></main>`;
 if(!product)return html`<main className="shopping-results"><${Empty} title="Product unavailable" text="This product could not be found in the Shopify catalog."/></main>`;
 const variants=product.variants||[];
 const variant=variantId&&!variants.some(v=>v.id===variantId)?null:variants.find(v=>v.id===variantId)||selectVariant(product);
 const baseImages=(product.images?.length?product.images:[product.image]).filter(Boolean);
 const suppliedGallery=Array.isArray(product.galleryMedia)?product.galleryMedia:[];
 const galleryImageUrls=new Set(suppliedGallery.filter(item=>item?.type==='image').map(item=>item.src));
 const additionalGalleryImages=baseImages.filter(src=>!galleryImageUrls.has(src)).map(src=>({type:'image',src,alt:product.title,poster:src}));
 const baseGallery=suppliedGallery.length?[...suppliedGallery,...additionalGalleryImages]:baseImages.map(src=>({type:'image',src,alt:product.title,poster:src}));
 const images=variant?.image?[{id:`variant-${variant.id}`,type:'image',src:variant.image,alt:product.title,poster:variant.image},...baseGallery.filter(item=>(typeof item==='string'?item:item?.src)!==variant.image)]:baseGallery;
 const selectedMedia=images[photo]||images[0];
 const off=discount(variant?.price,variant?.compareAt,variant?.currencyCode,variant?.compareAtCurrencyCode);
 const related=catalog.filter(p=>p.id!==product.id&&/^gid:\/\/shopify\/Product\//.test(p.id||'')&&p.previewOnly!==true&&(p.collectionHandles||[]).some(h=>(product.collectionHandles||[]).includes(h)));
 const description=shopifyDescriptionText(product.description);
 const reviews=verifiedProductReviews(product);
 const certification=verifiedCertification(product);
 const featureChips=verifiedFeatureChips(product,certification),rating=verifiedProductRating(product),saved=(props.saved||[]).includes(product.id);

 const specifications=(variant?.selectedOptions||[]).filter(option=>option?.name&&option?.value&&!/^(?:default title|standard|(?:option|variant)\s*\d+)$/i.test(String(option.value).trim())&&!/^(?:title|variant)$/i.test(String(option.name).trim()));
 const changeVariant=v=>{setVariantId(v.id);setPhoto(0);};
 const share=async()=>{const result=await shareProductLink({product,variantId:variant?.id});if(result.message)props.onNotice?.(result.message);};
 const savedControl=html`<button type="button" className="shopping-pdp-float-action" aria-label=${saved?'Remove from wishlist':'Add to wishlist'} aria-pressed=${saved} onClick=${()=>props.onSave?.(product.id)}><${Icon} name="heart" size=${20}/></button>`;
 const shareControl=html`<button type="button" className="shopping-pdp-float-action" aria-label="Share product" onClick=${share}><${Icon} name="share" size=${19}/></button>`;
 const desktopPurchase=html`<div className="shopping-pdp-price-row"><div className="shopping-pdp-price"><strong>${Number(variant?.price)>0?money(variant.price):'Price unavailable'}</strong>${off>0&&html`<span><small>MRP</small><del>${money(variant.compareAt)}</del></span>`}${off>0&&html`<b>${off}% OFF</b>`}</div><div className="shopping-pdp-desktop-action"><${Purchase} product=${product} variant=${variant} cart=${props.cart||[]} pendingKeys=${props.pendingKeys||[]} pendingOperations=${props.pendingOperations||[]} onAdd=${props.onAdd} onUpdate=${props.onUpdate}/></div></div>`;
 const thumbnail=variant?.image||product.image||baseGallery.find(item=>item?.poster)?.poster||baseGallery.find(item=>item?.type==='image')?.src;
 const videoTouch=e=>{galleryTouch.current=e.touches[0]?.clientX??null;};
 const videoSwipe=e=>{if(galleryTouch.current==null)return;const delta=e.changedTouches[0]?.clientX-galleryTouch.current;galleryTouch.current=null;if(Math.abs(delta)>45)setPhoto(index=>(index+(delta<0?1:-1)+images.length)%images.length);};
 return html`<main className="shopping-product-page">
  <section className="shopping-product-detail">
   <div className="shopping-gallery-column">
    <div className="shopping-gallery-stage" onTouchStart=${videoTouch} onTouchEnd=${videoSwipe}>
     ${images.length?html`<${ProductGalleryMedia} media=${selectedMedia} title=${product.title} index=${photo} total=${images.length} priority=${true}/>`:html`<span className="shopping-image-unavailable" role="img" aria-label="Product media unavailable">Product media unavailable</span>`}
     <div className="shopping-pdp-gallery-actions">${shareControl}${savedControl}</div>
     <button type="button" className="shopping-pdp-zoom" aria-label="Zoom product media" disabled=${!images.length} onClick=${()=>setZoom(true)}><${Icon} name="zoom" size=${18}/></button>
     ${selectedMedia?.type==='video'&&html`<span className="shopping-pdp-video-label">Video</span>`}
    </div>
    ${images.length>0&&html`<div className="shopping-thumbnails" aria-label="Product media">${images.map((media,index)=>{const item=typeof media==='string'?{type:'image',src:media,poster:media,alt:product.title}:media,thumb=item.poster||(item.type==='image'?item.src:product.image);return html`<button type="button" key=${item.id||item.src} aria-label=${`${item.type==='image'?'Image':'Video'} ${index+1}`} aria-pressed=${photo===index} onClick=${()=>setPhoto(index)}>${thumb?html`<${ProductImage} src=${thumb} alt="" width=${120}/>`:html`<span className="shopping-pdp-video-thumbnail"><${Icon} name="play" size=${16}/></span>`}${item.type!=='image'&&html`<span className="shopping-pdp-thumbnail-play"><${Icon} name="play" size=${14}/></span>`}</button>`;})}</div>`}
   </div>
   <div className="shopping-detail-copy">
    <h1>${product.title}</h1>
    ${featureChips.length>0&&html`<div className="shopping-pdp-trust-row">${featureChips.map((item,index)=>html`<span className="shopping-pdp-chip" key=${`${index}-${item}`}>${item}</span>`)}</div>`}
    ${rating&&html`<a className="shopping-pdp-rating" href="#product-reviews"><span aria-label="Rated ${rating.rating} out of 5">${'★'.repeat(Math.round(rating.rating))}</span><strong>${rating.rating.toFixed(1)}</strong><small>${rating.count} verified reviews</small></a>`}
    <div className="shopping-desktop-purchase">${desktopPurchase}</div>
    <section className="shopping-product-description"><h2>Product description</h2><p>${description||'A product description has not been provided by Shopify.'}</p></section>
    ${specifications.length>0&&html`<section className="shopping-product-specs"><h2>Specifications</h2><dl>${specifications.map((option,index)=>html`<div key=${`${option.name}-${index}`}><dt>${option.name}</dt><dd>${option.value}</dd></div>`)}</dl></section>`}
    ${variants.length>1&&html`<section className="shopping-product-options" aria-label="Product options"><div className="shopping-detail-variants">${variants.map(v=>{const verifiedLabel=formatVariantLabel(product,v),label=customerVariantLabel(product,v);return html`<button type="button" key=${v.id} data-variant-id=${v.id} aria-pressed=${variant?.id===v.id} disabled=${v.available===false||v.canPurchase===false||!(Number(v.price)>0)||!verifiedLabel} onClick=${()=>changeVariant(v)}><strong>${label||'Option details need confirmation'}</strong><span>${v.price?money(v.price):'Price unavailable'}</span><small>${v.available===false?'Unavailable':v.canPurchase===true&&verifiedLabel?'Available':'Unavailable for purchase'}</small></button>`;})}</div></section>`}
    ${certification?html`<section className="shopping-product-certification"><h2>Crystal certification</h2><p><strong>${certification.issuer}</strong>${certification.certificateNumber&&html` · Certificate ${certification.certificateNumber}`}${certification.details&&html`<br/>${certification.details}`}${typeof certification.documentUrl==='string'&&/^https:\/\//i.test(certification.documentUrl)&&html`<br/><a href=${certification.documentUrl} target="_blank" rel="noreferrer">View certificate</a>`}</p></section>`:html`<section className="shopping-product-certification"><h2>Crystal certification</h2><p>Verified certification details have not been supplied for this product.</p></section>`}
    <section className="shopping-product-reviews" id="product-reviews"><h2>Customer reviews</h2>${reviews.length?html`<div>${reviews.map((review,index)=>html`<article key=${review.id||index}><header><strong>${review.title||review.author||'Verified customer'}</strong><span aria-label=${`Rated ${Number(review.rating)} out of 5`}>${'★'.repeat(Math.round(Number(review.rating)))}</span></header><p>${review.text||review.body||review.content}</p></article>`)}</div>`:html`<p>Verified reviews are not available for this product yet.</p>`}</section>
   </div>
  </section>
  ${related.length>0&&html`<${ProductRail} title="More in this category" products=${related} onView=${()=>props.onNavigate(`#collection/${product.collectionHandles[0]}`)} ...${props}/>`}
  ${document.getElementById('mobile-purchase-slot')&&createPortal(html`<${PdpPurchaseBar} product=${product} variant=${variant} off=${off} thumbnail=${thumbnail} cart=${props.cart||[]} pendingKeys=${props.pendingKeys||[]} pendingOperations=${props.pendingOperations||[]} onAdd=${props.onAdd} onUpdate=${props.onUpdate} onNavigate=${props.onNavigate}/>` ,document.getElementById('mobile-purchase-slot'),'mobile-selected-purchase')}
  ${zoom&&html`<${ProductGallery} images=${images} index=${photo} onIndex=${setPhoto} title=${product.title} onClose=${()=>setZoom(false)}/>`}
 </main>`;
}
export function ShoppingCart({cart,catalog,remoteCart,syncing,error,pendingKeys=[],pendingOperations=[],onRetry,onClose,onUpdate,onRemove,checkoutEnabled=false,checkoutBusy=false,onCheckout=()=>{}}) {
 useEffect(()=>{
  const preventGesture=event=>event.preventDefault();
  const preventPinch=event=>{if(event.touches?.length>1)event.preventDefault();};
  const preventZoomKey=event=>{if((event.ctrlKey||event.metaKey)&&['+','=','-','0','_'].includes(event.key))event.preventDefault();};
  const preventCtrlWheel=event=>{if(event.ctrlKey)event.preventDefault();};
  document.addEventListener('gesturestart',preventGesture,{passive:false});
  document.addEventListener('gesturechange',preventGesture,{passive:false});
  document.addEventListener('gestureend',preventGesture,{passive:false});
  document.addEventListener('touchmove',preventPinch,{passive:false});
  document.addEventListener('keydown',preventZoomKey);
  document.addEventListener('wheel',preventCtrlWheel,{passive:false});
  return ()=>{
   document.removeEventListener('gesturestart',preventGesture);
   document.removeEventListener('gesturechange',preventGesture);
   document.removeEventListener('gestureend',preventGesture);
   document.removeEventListener('touchmove',preventPinch);
   document.removeEventListener('keydown',preventZoomKey);
   document.removeEventListener('wheel',preventCtrlWheel);
  };
 },[]);
 const {lines,count}=calculateCart(cart,catalog);
 const [sharing,setSharing]=useState(false);
 const subtotal=remoteCart?.cost?.subtotalAmount;const total=remoteCart?.cost?.totalAmount;
 const validAmount=amount=>amount?.amount!=null&&Number.isFinite(Number(amount.amount))&&Number(amount.amount)>=0;
 const confirmed=!syncing&&!error&&validAmount(subtotal)&&validAmount(total);
 const canProceed=checkoutEnabled&&confirmed&&Boolean(remoteCart?.id)&&lines.length>0&&lines.every(line=>/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(line.variantId||''));
 const currency=total?.currencyCode||subtotal?.currencyCode||'INR';
 const format=value=>formatCurrencyAmount(value,currency,currency==='INR'?0:2);
 const remoteLines=remoteCart?.lines?.nodes||remoteCart?.lines?.edges?.map(edge=>edge.node)||[];
 const serverLine=line=>remoteLines.find(item=>item.merchandise?.id===line.variantId);
 const lineAmount=line=>{const remote=serverLine(line);const unit=remote?.cost?.amountPerQuantity?.amount;if(unit!=null&&Number.isFinite(Number(unit)))return Number(unit)*line.quantity;return line.price>0?line.price*line.quantity:null;};
 const estimatedSubtotal=lines.reduce((sum,line)=>sum+(Number(line.price)||0)*line.quantity,0);
 const comparisonTotal=lines.reduce((sum,line)=>{const remote=serverLine(line);return sum+Math.max(Number(remote?.cost?.compareAtAmountPerQuantity?.amount||0),Number(remote?.cost?.amountPerQuantity?.amount||0))*line.quantity;},0);
 const savings=confirmed&&lines.every(line=>validAmount(serverLine(line)?.cost?.amountPerQuantity))?Math.max(0,comparisonTotal-Number(subtotal.amount)):0;
 const shareableCount=lines.length>0&&lines.every(line=>/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(line.variantId||'')&&Number.isInteger(line.quantity)&&line.quantity>0&&line.quantity<=999);
 const share=async()=>{if(sharing||syncing)return;setSharing(true);try{await shareCart({lines});}finally{setSharing(false);}};
 const pendingMessage=pendingOperations.length===1&&pendingOperations[0].type==='add'?'Adding '+pendingOperations[0].label+'…':pendingOperations.length===1&&pendingOperations[0].type==='remove'?'Removing '+pendingOperations[0].label+'…':'';
 const status=error?'Your latest cart change is not confirmed. Retry to continue.':syncing?pendingMessage:'';
 const pendingRemovals=pendingOperations.filter(operation=>operation.type==='remove');
 return html`<main className="shopping-cart-page"><section className="shopping-cart-panel" aria-label="Your cart"><header className="shopping-cart-header"><button type="button" className="shopping-back" aria-label="Back to shopping" onClick=${onClose}>←</button><h1>My cart${count?html`<span key="cart-count">(${count})</span>`:null}</h1><button type="button" className="shopping-cart-share" disabled=${sharing||syncing||!shareableCount} onClick=${share}>${sharing?'Sharing…':'Share'}</button></header><div className="shopping-cart-scroll">${status&&html`<p className="shopping-cart-status" role="status">${status}</p>`}${pendingRemovals.length>1&&pendingRemovals.map(operation=>html`<p className="shopping-cart-action-status" key=${operation.key} role="status">Removing ${operation.label}…</p>`)}${error&&html`<div className="shopping-error" role="alert"><p>Your latest cart change could not be confirmed. Please try again.</p><button type="button" className="shopping-primary" disabled=${syncing} onClick=${onRetry}>Retry cart update</button></div>`}${lines.length?html`<div className="shopping-cart-layout"><section className="shopping-cart-content">${savings>0&&html`<div className="shopping-cart-savings"><span>Your total savings</span><strong>${format(savings)}</strong></div>`}<div className="shopping-cart-lines"><h2>Your items</h2>${lines.map(line=>{const linePending=pendingKeys.includes(line.key);const amount=lineAmount(line);const merchandise=serverLine(line)?.merchandise;const productVariant=line.product.variants?.find(item=>item.id===line.variantId);const variant=productVariant||merchandise;const variantLabel=customerVariantLabel(line.product,variant,line.variantTitle);return html`<article className="shopping-cart-line" key=${line.key}><${ProductImage} src=${variant?.image||line.product.image} alt=${line.product.title}/><div className="shopping-cart-line-copy"><h3>${line.product.title}</h3>${variantLabel&&html`<p>${variantLabel}</p>`}<div className="shopping-prices"><strong>${confirmed&&amount!=null?format(amount):syncing&&line.price>0?`Estimate ${format(line.price*line.quantity)}`:'Not confirmed'}</strong>${confirmed&&amount!=null&&Number(serverLine(line)?.cost?.compareAtAmountPerQuantity?.amount)*line.quantity>amount&&html`<del>${format(Number(serverLine(line)?.cost?.compareAtAmountPerQuantity?.amount)*line.quantity)}</del>`}</div><button type="button" className="shopping-remove" disabled=${linePending||Boolean(error)} onClick=${()=>onRemove(line.key,line.product.title)}>Remove</button></div><fieldset className="shopping-cart-quantity" disabled=${linePending||Boolean(error)}><${Quantity} line=${line} onUpdate=${onUpdate} label=${line.product.title} pending=${linePending}/></fieldset></article>`;})}</div><section className="shopping-cart-note"><h2>Before you checkout</h2><p>Delivery availability, shipping charges and final taxes will be confirmed when checkout becomes available.</p></section></section><aside className="shopping-cart-summary"><section className="shopping-bill"><h2>Bill details</h2><div><span>${syncing?'Estimated items subtotal':'Items subtotal'}</span><strong>${confirmed?format(subtotal.amount):syncing?format(estimatedSubtotal):'Not confirmed'}</strong></div>${savings>0&&html`<div className="shopping-bill-savings"><span>Savings on items</span><strong>${format(savings)}</strong></div>`}<div><span>Shipping</span><span>Not calculated</span></div><div><span>Taxes</span><span>Final amount at checkout</span></div><div className="shopping-bill-total"><strong>${syncing?'Estimated item total':'Cart total'}</strong><strong>${confirmed?format(total.amount):syncing?format(estimatedSubtotal):'Not confirmed'}</strong></div><p>${syncing?'Estimates use current Shopify product prices. Final cart prices are confirmed after this change.':'Cart total is the current Shopify total. Final delivery charges and taxes may change at checkout.'}</p></section></aside></div>`:syncing?html`<div className="shopping-cart-loading" role="status" aria-label="Refreshing cart"><div className="shopping-cart-loading-row"><i></i><span><b></b><small></small></span></div><div className="shopping-cart-loading-row"><i></i><span><b></b><small></small></span></div></div>`:html`<${Empty} key="cart-empty" title=${error?'Cart confirmation needed':'Your cart is empty'} text=${error?'Retry to confirm your saved items.':'Explore the collections and add a favourite.'}/><button key="continue-shopping" type="button" className="shopping-primary" onClick=${onClose}>Continue shopping</button>`}</div><footer className="shopping-cart-checkout"><div><strong>${lines.length?confirmed?format(total.amount):syncing?format(estimatedSubtotal):'Not confirmed':error?'Not confirmed':format(0)}</strong><small>${confirmed?'CURRENT CART TOTAL':syncing?'ESTIMATED ITEM TOTAL':'CART TOTAL'}</small></div><button className="shopping-primary" disabled=${!canProceed||checkoutBusy} aria-busy=${checkoutBusy} onClick=${onCheckout}>${checkoutBusy?'Preparing checkout…':canProceed?'Proceed to Shopify checkout':'Checkout unavailable'}</button><small>${checkoutEnabled?'You’ll complete your order on Shopify.':'Checkout is disabled until merchant setup is approved.'}</small></footer></section></main>`;
}
export function ShoppingSharedCart({items=[],loading=false,error='',cartCount=0,cartSyncing=false,cartError='',onRetryVerification,onRetryCart,onAddItems,onNavigate,onOpenProduct}) {
 const [confirmMerge,setConfirmMerge]=useState(false),[adding,setAdding]=useState(false),[status,setStatus]=useState('');
 const available=items.filter(item=>item.status==='available'&&item.product&&item.variant);
 const currency=available[0]?.variant?.currencyCode||'INR';
 const subtotal=available.reduce((sum,item)=>sum+(Number(item.variant.price)||0)*item.quantity,0),totalQuantity=available.reduce((sum,item)=>sum+item.quantity,0);
 const formatMoney=(amount,code=currency)=>formatCurrencyAmount(amount,code,code==='INR'?0:2);
 const add=async()=>{if(adding||cartSyncing||cartError||!available.length)return;setAdding(true);setStatus('');try{const result=await onAddItems(available);if(result){setStatus(`${totalQuantity} ${totalQuantity===1?'item':'items'} added to your cart.`);return;}setStatus('Some items were not confirmed. Any successful additions are already in your cart.');}finally{setAdding(false);setConfirmMerge(false);}};
 const beginAdd=()=>{setStatus('');if(cartCount>0)setConfirmMerge(true);else void add();};
 return html`<main className="shopping-shared-cart"><header><button type="button" className="shopping-back" onClick=${()=>onNavigate('#home')}>← Back</button><span className="shopping-breadcrumb">CRYSTAL BAAZ</span><h1>Shared cart</h1><p>Review current prices and availability before adding these items to your cart.</p></header>${loading?html`<div className="shopping-skeleton-grid shopping-shared-skeleton" role="status" aria-label="Checking shared items"><div className="shopping-skeleton"></div><div className="shopping-skeleton"></div></div>`:error?html`<section className="shopping-shared-error" role="alert"><p>We couldn’t verify the shared cart. Please try again.</p>${onRetryVerification&&html`<button type="button" className="shopping-primary" onClick=${onRetryVerification}>Try again</button>`}</section>`:items.length?html`<section className="shopping-shared-items" aria-label="Shared products">${items.map((item,index)=>{const product=item.product;const variant=item.variant;const canAdd=item.status==='available'&&product&&variant;const label=customerVariantLabel(product,variant,item.variantTitle);const title=product?.title||'';const statusLabel=canAdd?'Available':item.status==='unavailable'?'No longer available or out of stock':'Could not verify in the approved catalog';return html`<article className=${`shopping-shared-item ${canAdd?'':'is-unavailable'}`} key=${item.variantId||index}><${ProductImage} src=${variant?.image||product?.image} alt=${title}/><div className="shopping-shared-item-copy">${title&&html`<h2>${title}</h2>`}${label&&html`<p>${label}</p>`}<p className="shopping-shared-availability">${statusLabel} · Quantity ${item.quantity}</p>${Number(variant?.price)>0&&html`<strong>${formatMoney(variant.price,variant.currencyCode||currency)}</strong>`}${product&&html`<button type="button" className="shopping-text-button" onClick=${()=>onOpenProduct?.(product,variant?.id)}>View product</button>`}</div></article>`;})}</section>`:html`<p className="shopping-shared-status" role="status">This shared cart has no valid items.</p>`}${cartError&&html`<section className="shopping-shared-error" role="alert"><p>Your cart could not be confirmed. Please retry the cart sync.</p><button type="button" className="shopping-primary" disabled=${cartSyncing} onClick=${onRetryCart}>Retry cart sync</button></section>`}${!loading&&!error&&available.length>0&&html`<section className="shopping-shared-summary"><div><span>${totalQuantity} available ${totalQuantity===1?'item':'items'}</span><strong>${formatMoney(subtotal)}</strong></div><p>Prices come from Shopify now. Shipping and taxes are not included.</p><button type="button" className="shopping-primary" disabled=${adding||cartSyncing||Boolean(cartError)} onClick=${beginAdd}>${adding?'Adding items…':`Add ${totalQuantity} ${totalQuantity===1?'item':'items'} to my cart`}</button>${confirmMerge&&cartCount>0&&html`<div className="shopping-shared-confirm" role="alertdialog" aria-label="Confirm adding shared items"><strong>Add these items to your current cart?</strong><p>Your existing ${cartCount} ${cartCount===1?'item will':'items will'} stay in your cart.</p><div><button type="button" className="shopping-secondary" disabled=${adding||cartSyncing||Boolean(cartError)} onClick=${()=>setConfirmMerge(false)}>Keep current cart</button><button type="button" className="shopping-primary" disabled=${adding||cartSyncing||Boolean(cartError)} onClick=${add}>Add to current cart</button></div></div>`}</section>`}${status&&html`<p className="shopping-shared-status" role="status">${status}</p>`}<footer><span>Unavailable items are shown above and will not be added.</span><button type="button" className="shopping-text-button" onClick=${()=>onNavigate('#home')}>Continue shopping</button></footer></main>`;
}

export function ShoppingFooter({onNavigate}) {
 const experience=useExperience();
 return html`<footer className="shopping-footer"><div className="shopping-footer-columns">
  <section className="shopping-footer-brand"><strong>Crystal Baaz<span>.</span></strong><p>Crystals, jewellery & spiritual essentials.</p>${experience.canInstall&&html`<button className="shopping-footer-install" onClick=${experience.openInstall}><${Icon} name="download" size=${16}/> Install Crystal Baaz</button>`}</section>
  <section className="shopping-footer-column"><h2>Useful links</h2><nav aria-label="Store information">${['about','contact','faq','policies'].map(page=>html`<button key=${page} onClick=${()=>onNavigate(`#${page}`)}>${({about:'About Crystal Baaz',contact:'Contact',faq:'FAQs',policies:'Shopping policies'})[page]}</button>`)}<button onClick=${()=>onNavigate('#wishlist')}>Your wishlist</button></nav></section>
  <section className="shopping-footer-category-column"><h2>Categories</h2><nav aria-label="Footer categories">${categoryParents.map(parent=>html`<button key=${parent.id} onClick=${()=>onNavigate(hierarchyHref(parent.id))}>${parent.label}</button>`)}</nav></section>
 </div><div className="shopping-footer-bottom"><small>© ${new Date().getFullYear()} Crystal Baaz</small><button onClick=${()=>window.scrollTo({top:0,behavior:'smooth'})}>Back to top ↑</button></div></footer>`;
}
export function ShoppingBottom({route,onNavigate,onCart,count}) {return html`<nav className="shopping-bottom-nav" aria-label="Bottom navigation">${[{label:'Home',icon:'homeTab',href:'#home',active:route.page==='home'},{label:'Categories',icon:'grid',href:hierarchyHref(),active:['collections','collection','group','nav','zodiac','crystals'].includes(route.page)},{label:'Saved',icon:'heart',href:'#wishlist',active:route.page==='wishlist'}].map(item=>html`<button key=${item.label} aria-current=${item.active?'page':undefined} onClick=${()=>onNavigate(item.href)}><${Icon} name=${item.icon} size=${19}/>${item.label}</button>`)}<button aria-current=${route.page==='cart'?'page':undefined} onClick=${onCart}><${Icon} name="bag" size=${19}/>Cart${count?` (${count})`:''}</button></nav>`;}

export function ShoppingInformation({page,onNavigate}) {
 const pages={account:['Your account','Customer sign-in is currently unavailable. You can still save products to your wishlist and browse the store.'],orders:['Your orders','Order lookup is currently unavailable.'],about:['About Crystal Baaz','Explore crystals, jewellery and spiritual essentials at Crystal Baaz.'],contact:['Contact us','Contact details will appear here once confirmed.'],faq:['Frequently asked questions','Answers will be added once the store’s shopping policies are confirmed.'],policies:['Shopping policies','Shipping, returns and privacy details are awaiting confirmation.'],copilot:['Crystal Copilot','The shopping assistant is currently unavailable. Browse categories or search to find a product.']};
 const [title,text]=pages[page]||pages.about;
 return html`<main className="shopping-results shopping-information"><h1>${title}</h1><p>${text}</p><div><button className="shopping-primary" onClick=${()=>onNavigate(hierarchyHref())}>Browse categories</button>${page==='account'&&html`<button className="shopping-text-button" onClick=${()=>onNavigate('#wishlist')}>View wishlist →</button>`}</div></main>`;
}
