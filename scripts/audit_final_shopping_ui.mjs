import {connectChrome} from './cdp-client.mjs';
import {writeFile} from 'node:fs/promises';
const b=await connectChrome();const result={accounts:[],modal:null};
await b.send('Network.setBypassServiceWorker',{bypass:true});await b.send('Network.setCacheDisabled',{cacheDisabled:true});await b.navigate('http://127.0.0.1:4175/#account');
result.buildScript=await b.evaluate(`document.querySelector('script[type=module]').src.split('/').pop()`);
for(const width of [390,1440]){await b.viewport(width,900);result.accounts.push(await b.evaluate(`({width:innerWidth,title:document.querySelector('.shopping-information h1')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth,oldPreviewWording:document.body.innerText.includes('client product workbook')})`));}
await b.viewport(390,844);await b.evaluate(`location.hash='#search/7%20Chakra%20Angel';true`);
for(let i=0;i<100;i++){if(await b.evaluate(`!!document.querySelector('.shopping-option-link')`))break;await b.wait(200);}
await b.evaluate(`document.querySelector('.shopping-option-link').click();true`);await b.wait(100);
result.modal=await b.evaluate(`({open:!!document.querySelector('.shopping-variant-sheet'),bodyLocked:document.body.style.overflow==='hidden',focusInside:document.querySelector('.shopping-variant-sheet').contains(document.activeElement)})`);
await b.evaluate(`(()=>{const c=[...document.querySelectorAll('.shopping-variant-sheet button:not(:disabled)')];c.at(-1).focus();return true;})()`);await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});result.modal.tabTrapped=await b.evaluate(`document.activeElement===document.querySelector('.shopping-variant-sheet button')`);
await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await b.wait(100);result.modal.closedAndUnlocked=await b.evaluate(`!document.querySelector('.shopping-variant-sheet')&&document.body.style.overflow!=='hidden'`);result.runtimeIssues=b.issues;
result.pass=result.accounts.every(r=>r.title==='Your account'&&!r.overflow&&!r.oldPreviewWording)&&Object.values(result.modal).every(Boolean)&&result.runtimeIssues.length===0;await writeFile('reports/redesign/final-ui-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));b.close();if(!result.pass)process.exitCode=1;
