import {writeFile} from 'node:fs/promises';
export async function connectChrome(prefix='') {
 const tabs=await (await fetch('http://127.0.0.1:9223/json')).json();
 const tab=tabs.find(t=>t.type==='page'&&(!prefix||t.url.startsWith(prefix)))||tabs.find(t=>t.type==='page');
 const ws=new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const issues=[];const pending=new Map();ws.addEventListener('message',({data})=>{const p=JSON.parse(data);if(p.method==='Runtime.exceptionThrown')issues.push(p.params.exceptionDetails.exception?.description||p.params.exceptionDetails.text);if(p.method==='Runtime.consoleAPICalled'&&p.params.type==='error')issues.push(p.params.args.map(a=>a.value||a.description||'').join(' '));if(p.id&&pending.has(p.id)){const [res,rej]=pending.get(p.id);pending.delete(p.id);p.error?rej(Error(p.error.message)):res(p.result);}});
 const send=(method,params={})=>new Promise((res,rej)=>{const n=++id;pending.set(n,[res,rej]);ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const viewport=async(width,height=900)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<781});await wait(150);};
 const navigate=async url=>{if(url.startsWith('http://127.0.0.1:')){const fresh=new URL(url);fresh.searchParams.set('browser-audit',Date.now());url=fresh.toString();}await send('Page.navigate',{url});await wait(1700);};
 const screenshot=async path=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path,Buffer.from(r.data,'base64'));};
 return {send,evaluate,wait,viewport,navigate,screenshot,issues,close:()=>ws.close()};
}
if(process.argv.includes('--blinkit')){const b=await connectChrome();const rows=[];for(const w of [1440,400]){await b.viewport(w,900);await b.navigate('https://blinkit.com/');await b.wait(4500);await b.screenshot(`reports/redesign/blinkit-reference-${w}.png`);rows.push(await b.evaluate(`({width:innerWidth,title:document.title,elements:[...document.querySelectorAll('header,input,button')].filter(e=>e.getBoundingClientRect().width>0).slice(0,15).map(e=>({tag:e.tagName,text:(e.textContent||e.placeholder||'').trim().slice(0,70),width:Math.round(e.getBoundingClientRect().width),height:Math.round(e.getBoundingClientRect().height),font:getComputedStyle(e).fontSize}))})`));}await writeFile('reports/redesign/blinkit-reference-audit.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));b.close();}
