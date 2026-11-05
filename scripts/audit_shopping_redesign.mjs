import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {connectChrome} from './cdp-client.mjs';
import {categoryParents,hierarchyHref} from '../src/category-hierarchy.js';
const b=await connectChrome('http://127.0.0.1:4174');
const report={generatedAt:new Date().toISOString(),source:'live Shopify Storefront',reference:{url:'https://blinkit.com/',chromeResult:'Cloudflare Just a moment challenge; client screenshots used for shopping visuals'},categories:[],widths:[],screenshots:[],failures:[]};
const check=(value,message)=>{if(!value)report.failures.push(message);};
const route=async hash=>{await b.evaluate(`location.hash=${JSON.stringify(hash)}; true`);await b.wait(110);};
const until=async(expression,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await b.evaluate(`Boolean(${expression})`))return true;await b.wait(250);}throw Error('Timed out: '+expression);};
const capture=async name=>{const path=`reports/redesign/${name}.png`;await b.screenshot(path);report.screenshots.push(path);};
try {
 await b.viewport(390,844);await b.navigate('http://127.0.0.1:4174/');
 await until(`document.querySelector('.shopping-shell')?.dataset.catalogLoaded==='true'`);
 report.mapping=await b.evaluate(`(async()=>{const {catalogService}=await import('/src/catalog-service.js');const result=await catalogService.loadCatalog();window.__shoppingAuditProducts=result.products;return {...result.mapping,products:result.products.length,allShopify:result.products.every(p=>p.id.startsWith('gid://shopify/Product/')&&!p.previewOnly),placeholderImages:result.products.filter(p=>p.image?.includes('product-placeholder')).length};})()`);
 check(report.mapping.allShopify&&report.mapping.placeholderImages===0,'live source boundary');
 for(const parent of categoryParents){
  await route(hierarchyHref('all'));
  await b.evaluate(`([...document.querySelectorAll('.shopping-sidebar-item')].find(e=>e.textContent.trim()===${JSON.stringify(parent.label)}))?.click(); true`);await b.wait(120);
  const state=await b.evaluate(`({state:document.querySelector('.shopping-browse')?.dataset.browseState,parent:document.querySelector('.shopping-browse')?.dataset.parent,sidebar:document.querySelector('.shopping-sidebar')?.getBoundingClientRect().width,options:document.querySelectorAll('.shopping-subcategory-grid>button').length})`);
  check(state.parent===parent.id&&state.sidebar>0,`${parent.id} parent sidebar`);
  check(parent.items.length?state.state==='overview'&&state.options===parent.items.length:state.state==='products',`${parent.id} entry state`);
  const record={parent:parent.id,entry:state,childrenChecked:0,membershipFailures:0,backForward:false};
  const options=parent.items.length?parent.items:[parent];
  const expected=await b.evaluate(`(async()=>{const {resolveHierarchy,productsForCategory}=await import('/src/category-hierarchy.js');const {items,parent}=resolveHierarchy({page:'collections',group:${JSON.stringify(parent.id)}});return (items.length?items:[parent]).map(item=>({id:item.id,handles:productsForCategory(window.__shoppingAuditProducts,item).map(p=>p.handle)}));})()`);
  for(const item of options){
   await route(hierarchyHref(parent.id,parent.items.length?item.id:null));
   const rendered=await b.evaluate(`({title:document.querySelector('.shopping-list-heading h1')?.textContent,handles:[...document.querySelectorAll('.shopping-browse .shopping-product-card')].map(e=>e.dataset.productHandle),count:document.querySelector('.shopping-list-heading p')?.textContent,active:document.querySelector('.shopping-sidebar-item[aria-current=page]')?.textContent.trim(),parent:document.querySelector('.shopping-browse')?.dataset.parent})`);
   const match=expected.find(e=>e.id===item.id);const allowed=new Set(match?.handles||[]);
   const pass=rendered.parent===parent.id&&rendered.title===item.label&&rendered.count===`${allowed.size} products`&&rendered.handles.every(h=>allowed.has(h))&&rendered.handles.length===Math.min(24,allowed.size);
   if(!pass){record.membershipFailures++;report.failures.push({parent:parent.id,item:item.id,rendered,expected:allowed.size});}
   record.childrenChecked++;
  }
  if(parent.items.length>1){
   await route(hierarchyHref(parent.id,parent.items[0].id));
   await b.evaluate(`document.querySelectorAll('.shopping-sidebar-item')[1].click();true`);await b.wait(120);
   const selected=await b.evaluate('location.hash');check(selected.includes(encodeURIComponent(parent.items[1].id)),`${parent.id} sibling click`);
   await b.evaluate('history.back();true');await b.wait(160);const previous=await b.evaluate('location.hash');
   await b.evaluate('history.forward();true');await b.wait(160);record.backForward=previous.includes(encodeURIComponent(parent.items[0].id))&&(await b.evaluate('location.hash'))===selected;
   check(record.backForward,`${parent.id} history`);
  }
  report.categories.push(record);
 }
 console.log('Category audit:',report.categories.length,'parents,',report.categories.reduce((s,r)=>s+r.childrenChecked,0),'options');
 for(const width of [320,360,375,390,414,427,440,768,1024,1280,1366,1440,1600,1920]){
  await b.viewport(width,width<781?844:950);await route(hierarchyHref('crystals'));
  const overview=await b.evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,sidebar:Math.round(document.querySelector('.shopping-sidebar').getBoundingClientRect().width),content:Math.round(document.querySelector('.shopping-browse-content').getBoundingClientRect().width),columns:getComputedStyle(document.querySelector('.shopping-subcategory-grid')).gridTemplateColumns.split(' ').length,sidebarBottom:document.querySelector('.shopping-sidebar').getBoundingClientRect().bottom,bottomNavTop:document.querySelector('.shopping-bottom-nav').getBoundingClientRect().top})`);
  if([390,1440].includes(width))await capture(`category-overview-${width}`);
  await route('#collection/bracelets');
  const products=await b.evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,columns:getComputedStyle(document.querySelector('.shopping-product-grid')).gridTemplateColumns.split(' ').length,heights:[...document.querySelectorAll('.shopping-product-card')].slice(0,8).map(e=>Math.round(e.getBoundingClientRect().height)),images:[...document.querySelectorAll('.shopping-product-image img')].every(e=>!e.src.includes('product-placeholder')),sidebarVisible:document.querySelector('.shopping-sidebar').getBoundingClientRect().width>0,priceOverlap:[...document.querySelectorAll('.shopping-card-bottom')].some(e=>{const [a,c]=e.children;const x=a.getBoundingClientRect(),y=c.getBoundingClientRect();return x.right>y.left+1&&x.bottom>y.top+1&&x.left<y.right-1&&x.top<y.bottom-1;})})`);
  if([390,1440].includes(width))await capture(`subcategory-products-${width}`);
  check(!overview.overflow&&!products.overflow&&!products.priceOverlap&&products.sidebarVisible,`${width}px responsive geometry`);
  check(width<600?products.columns===2:width>=1024?products.columns>=4:true,`${width}px grid columns`);
  if(width<781)check(overview.sidebarBottom<=overview.bottomNavTop+3,`${width}px bottom navigation overlap`);
  await route('#home');
  const peek=await b.evaluate(`(()=>{const t=document.querySelector('.shopping-rail-track');if(!t)return null;const r=t.getBoundingClientRect();const p=[...t.children].map(e=>e.getBoundingClientRect()).find(e=>e.left<r.right&&e.right>r.right);return p?Math.round((r.right-p.left)/p.width*100):0;})()`);
  if(width<781)check(peek>15&&peek<90,`${width}px next product peek (${peek}%)`);
  if([390,1440].includes(width)){await capture(`home-${width}`);await b.evaluate(`document.querySelector('.shopping-rail').scrollIntoView({block:'start'});true`);await b.wait(120);await capture(`product-rail-${width}`);}
  report.widths.push({width,overview,products,nextCardPeekPercent:peek});
 }
 await b.viewport(390,844);await route('#collection/bracelets');
 await b.evaluate(`document.querySelector('select[aria-label="Sort products"]').value='price-low';document.querySelector('select[aria-label="Sort products"]').dispatchEvent(new Event('change',{bubbles:true}));true`);await b.wait(160);
 report.sort=await b.evaluate(`({url:location.hash,prices:[...document.querySelectorAll('.shopping-card-bottom .shopping-prices strong')].map(e=>Number(e.textContent.replace(/[^0-9.]/g,'')))})`);check(report.sort.prices.every((p,i,a)=>!i||p>=a[i-1]),'price sorting');
 await b.evaluate(`const input=document.querySelector('input[aria-label="Minimum price"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1000');input.dispatchEvent(new Event('input',{bubbles:true}));true`);await b.wait(160);
 report.filter=await b.evaluate(`[...document.querySelectorAll('.shopping-card-bottom .shopping-prices strong')].every(e=>Number(e.textContent.replace(/[^0-9.]/g,''))>=1000)`);check(report.filter,'price filtering');
 const direct='#collections?group=pooja&category=collection%3Ashaligram';await route(direct);await b.send('Page.reload',{ignoreCache:true});await until(`document.querySelector('.shopping-shell')?.dataset.catalogLoaded==='true'`);report.refresh=await b.evaluate(`({hash:location.hash,title:document.querySelector('.shopping-list-heading h1')?.textContent,sidebar:!!document.querySelector('.shopping-sidebar')})`);check(report.refresh.hash===direct&&report.refresh.title==='Shaligram','direct route refresh');
 const sample=await b.evaluate(`(()=>{const p=window.__shoppingAuditProducts?.find(p=>p.variantsComplete&&p.variants.length===1&&p.variants[0].canPurchase);return p?{handle:p.handle,title:p.title}:null;})()`);
 // A reload clears the audit helper; obtain a fresh in-memory catalog without altering app data.
 const selected=sample||await b.evaluate(`(async()=>{const r=await (await import('/src/catalog-service.js')).catalogService.loadCatalog();window.__shoppingAuditProducts=r.products;const p=r.products.find(p=>p.variantsComplete&&p.variants.length===1&&p.variants[0].canPurchase);return {handle:p.handle,title:p.title};})()`);
 await route(`#product/${selected.handle}`);await until(`!document.querySelector('.shopping-loading')&&document.querySelector('.shopping-detail-purchase .shopping-add')`);
 report.product={...selected,placeholderImages:await b.evaluate(`document.querySelectorAll('img[src*="product-placeholder"]').length`)};check(report.product.placeholderImages===0,'no substituted product artwork');
 await b.evaluate(`document.querySelector('.shopping-detail-copy .shopping-text-button').click();true`);await route('#wishlist');report.wishlist=await b.evaluate(`!!document.querySelector('.shopping-product-card[data-product-handle=${JSON.stringify(selected.handle)}]')`);check(report.wishlist,'wishlist');
 await route(`#search/${encodeURIComponent(selected.title)}`);await b.wait(150);report.search=await b.evaluate(`({cards:document.querySelectorAll('.shopping-results .shopping-product-card').length,title:document.querySelector('.shopping-list-heading h1')?.textContent})`);check(report.search.cards>0,'actual Shopify search');
 await route(`#product/${selected.handle}`);await until(`!document.querySelector('.shopping-loading')&&document.querySelector('.shopping-detail-purchase .shopping-add')`);await b.evaluate(`document.querySelector('.shopping-detail-purchase .shopping-add').click();true`);await b.wait(500);await b.evaluate(`document.querySelector('.shopping-cart-button').click();true`);
 await until(`document.querySelector('.shopping-bill strong')?.textContent.startsWith('₹')||!!document.querySelector('.shopping-cart-scroll .shopping-error')`,40000);
 report.cart={initial:await b.evaluate(`({lines:document.querySelectorAll('.shopping-cart-line').length,quantity:document.querySelector('.shopping-cart-line .shopping-quantity span')?.textContent,subtotal:document.querySelector('.shopping-bill strong')?.textContent,error:document.querySelector('.shopping-cart-scroll .shopping-error')?.textContent,checkoutDisabled:document.querySelector('.shopping-cart-panel footer button')?.disabled})`)};
 check(report.cart.initial.lines===1&&!report.cart.initial.error&&report.cart.initial.checkoutDisabled,'Shopify cart addition and confirmed subtotal');
 await capture('cart-mobile-390');await b.viewport(1440,950);await capture('cart-desktop-1440');
 await b.evaluate(`document.querySelector('.shopping-cart-line .shopping-quantity button:last-child').click();true`);await b.wait(400);await until(`document.querySelector('.shopping-bill strong')?.textContent.startsWith('₹')`,40000);report.cart.updated=await b.evaluate(`({quantity:document.querySelector('.shopping-cart-line .shopping-quantity span')?.textContent,subtotal:document.querySelector('.shopping-bill strong')?.textContent})`);check(report.cart.updated.quantity==='2','cart quantity');
 const number=s=>Number(s?.replace(/[^0-9.]/g,''));check(number(report.cart.updated.subtotal)===number(report.cart.initial.subtotal)*2,'Shopify cart quantity total');
 await b.send('Page.reload',{ignoreCache:true});await until(`document.querySelector('.shopping-cart-line')&&document.querySelector('.shopping-bill strong')?.textContent.startsWith('₹')`,40000);report.cart.persisted=await b.evaluate(`document.querySelector('.shopping-cart-line .shopping-quantity span')?.textContent`);check(report.cart.persisted==='2','cart persistence');
 await b.evaluate(`document.querySelector('.shopping-remove').click();true`);await b.wait(1800);report.cart.removed=await b.evaluate(`document.querySelectorAll('.shopping-cart-line').length===0`);check(report.cart.removed,'cart removal');
 await b.evaluate(`document.querySelector('[aria-label="Close cart"]').click();true`);
 await b.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});await b.wait(180);report.offline=await b.evaluate(`({message:document.querySelector('.shopping-error')?.textContent,productCards:document.querySelectorAll('.shopping-product-card').length})`);check(report.offline.message?.includes('offline')&&report.offline.productCards===0,'offline fail closed');
 await b.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
} catch(error){report.failures.push(error.stack||error.message);}finally{report.pass=report.failures.length===0;await writeFile('reports/redesign/browser-audit.json',JSON.stringify(report,null,2));b.close();}
console.log(JSON.stringify({pass:report.pass,parentCategories:report.categories.length,optionsChecked:report.categories.reduce((s,r)=>s+r.childrenChecked,0),widths:report.widths.length,mapping:report.mapping,cart:report.cart,failures:report.failures},null,2));
if(!report.pass)process.exitCode=1;
