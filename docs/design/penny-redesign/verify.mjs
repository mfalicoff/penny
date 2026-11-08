import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const root=path.dirname(fileURLToPath(import.meta.url));
const runBuild=()=>execFileSync(process.execPath,[path.join(root,'build.mjs')],{stdio:'pipe'});
runBuild();
const data=JSON.parse(await fs.readFile(path.join(root,'scene.json'),'utf8'));
let executablePath=process.env.PENNY_DESIGN_CHROME;
if(!executablePath){
 try{
  const options=(await fs.readdir('/nix/store')).filter(n=>/google-chrome-.*\d/.test(n)).sort().reverse();
  for(const option of options){const candidate=`/nix/store/${option}/share/google/chrome/chrome`;try{await fs.access(candidate);executablePath=candidate;break;}catch{}}
 }catch{ /* Use Playwright's installed browser outside NixOS. */ }
}
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`file://${path.join(root,'preview.html')}`);await page.evaluate(()=>document.fonts.ready);
 const textNodes=[];
 const visit=node=>{
  if(node.kind==='text')textNodes.push(node);
  if(node.kind==='instance'){
   const definition=structuredClone(data.components[node.component]);
   function override(child){Object.assign(child,node.overrides[child.name]||{});for(const n of child.children||[])override(n);}
   override(definition);const sx=node.w/definition.w,sy=node.h/definition.h;
   function scale(child){child.x*=sx;child.y*=sy;child.w*=sx;child.h*=sy;for(const n of child.children||[])scale(n);}
   for(const child of definition.children)scale(child);
   for(const child of definition.children)visit(child);
  } else for(const child of node.children||[])visit(child);
 };
 for(const item of [...data.screens,...data.boards])visit(item);
 const layouts=await page.evaluate(nodes=>{
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d'),result={};
  for(const node of nodes){
   const key=JSON.stringify([node.text,node.w,node.size,node.weight,node.letterSpacing||0]);if(result[key])continue;
   context.font=`${node.weight} ${node.size}px "DM Sans"`;context.letterSpacing=`${node.letterSpacing||0}px`;
   result[key]=node.text.split('\n').flatMap(paragraph=>{const lines=[];let current='';for(const word of paragraph.split(' ')){const next=current?`${current} ${word}`:word;if(current&&context.measureText(next).width>node.w-.5){lines.push(current);current=word;}else current=next;}lines.push(current);return lines;});
  }
  return result;
 },textNodes);
 await fs.writeFile(path.join(root,'text-layout.json'),JSON.stringify(layouts,null,2)+'\n');
 runBuild();
 await page.reload();await page.evaluate(()=>document.fonts.ready);
 const overflows=await page.evaluate(()=>[...document.querySelectorAll('g[data-kind="text"]')].flatMap(g=>{const text=g.querySelector('text'),box=text.getBBox(),allowed=Number(g.dataset.width);return box.width>allowed+1?[{screen:g.closest('article')?.id,text:text.textContent,width:box.width,allowed}]:[]}));
 if(overflows.length)throw new Error(`Text outside its allowed width: ${JSON.stringify(overflows)}`);
 await page.getByRole('button',{name:'Open click-through flow'}).click();
 await page.locator('#home a[data-target="add-expense"]').click();
 await page.waitForFunction(()=>document.querySelector('article.current')?.id==='add-expense');
 if(await page.locator('article.current').getAttribute('id')!=='add-expense')throw new Error('Add entry flow did not navigate.');
 await page.locator('#add-expense a[data-target="saved"]').click();
 await page.waitForFunction(()=>document.querySelector('article.current')?.id==='saved');
 if(await page.locator('article.current').getAttribute('id')!=='saved')throw new Error('Save flow did not navigate.');
 await page.getByRole('button',{name:'View all screens'}).click();
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth)>390)throw new Error('Review gallery has horizontal overflow at phone width.');
 await fs.mkdir(path.join(root,'previews'),{recursive:true});
 await page.setViewportSize({width:1440,height:1000});
 for(const id of ['home','activity','add-expense','household','shared-trip','settings','home-dark','home-amoled','home-catppuccin','desktop','insights','components','foundations']){
  await page.locator(`#${id} .artboard`).screenshot({path:path.join(root,'previews',`${id}.png`)});
 }
 await page.goto(`file://${path.join(root,'review.html')}`);await page.evaluate(()=>document.fonts.ready);await page.setViewportSize({width:1266,height:1816});await page.screenshot({path:path.join(root,'previews','core-screens.png'),fullPage:true});
 const luminance=hex=>{const channels=hex.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
 const contrast=(a,b)=>{const l1=luminance(a),l2=luminance(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);};
 const contrastChecks=Object.entries(data.tokens.palettes).flatMap(([theme,p])=>[['ink','bg'],['muted','bg'],['ink','paper'],['muted','paper'],['onAccent','accent'],['onHero','hero'],['heroMuted','hero'],['green','mint'],['danger','dangerBg'],['amber','amberBg']].map(([fg,bg])=>({theme,foreground:fg,background:bg,ratio:Number(contrast(p[fg],p[bg]).toFixed(2))})));
 const blend=(fg,bg,alpha)=>'#'+[0,2,4].map(offset=>Math.round(parseInt(fg.slice(offset+1,offset+3),16)*alpha+parseInt(bg.slice(offset+1,offset+3),16)*(1-alpha)).toString(16).padStart(2,'0')).join('');
 const materialContrastChecks=Object.entries(data.tokens.palettes).flatMap(([theme,p])=>['bg','paper'].flatMap(background=>[['regular','paper',.68,'ink'],['regular-secondary','paper',.68,'muted'],['selected','mint',.76,'green'],['tinted','accent',.96,'onAccent']].map(([material,surface,alpha,foreground])=>({theme,material,foreground,background,ratio:Number(contrast(p[foreground],blend(p[surface],p[background],alpha)).toFixed(2))}))));
 if(materialContrastChecks.some(c=>c.ratio<4.5))throw new Error('Glass contrast below 4.5:1: '+JSON.stringify(materialContrastChecks.filter(c=>c.ratio<4.5)));
 const failedContrast=contrastChecks.filter(c=>c.ratio<4.5);if(failedContrast.length)throw new Error(`Contrast below 4.5:1: ${JSON.stringify(failedContrast)}`);
 if(errors.length)throw new Error(`Browser errors: ${errors.join('; ')}`);
 const validation=JSON.parse(await fs.readFile(path.join(root,'validation.json'),'utf8'));
 if(validation.boundsViolations.length)throw new Error(`Declared layout containment violations: ${JSON.stringify(validation.boundsViolations)}`);
 let nativePenpotVerification='Native verification has not been recorded';
 try{const native=JSON.parse(await fs.readFile(path.join(root,'native-validation.json'),'utf8'));validation.nativePenpotVerification=native;nativePenpotVerification=`${native.status} at ${native.verifiedAt}`;}catch{}
 Object.assign(validation,{visualVerification:{font:'DM Sans loaded',measuredTextBlocks:Object.keys(layouts).length,textWidthOverflows:overflows.length,browserErrors:errors,phoneGalleryWidth:390,clickThrough:'Home → Add expense → Saved passed',contrastChecks,materialContrastChecks,previewFiles:13,nativePenpotVerification}});
 await fs.writeFile(path.join(root,'validation.json'),JSON.stringify(validation,null,2)+'\n');
 console.log(JSON.stringify({screens:validation.screens,textWidthOverflows:overflows.length,browserErrors:errors.length,contrastChecks:contrastChecks.length,clickThrough:'passed',previews:13},null,2));
} finally {await browser.close();}
