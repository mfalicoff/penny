import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './flows.mjs';
import { palettes, typeScale, spacing, components, screens, boards, resolved, box, rect, txt, icon, line } from './design.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
let measuredText={};
try { measuredText=JSON.parse(await fs.readFile(path.join(root,'text-layout.json'),'utf8')); } catch { /* First build uses conservative estimates until visual verification measures the font. */ }
const icons={};
for(const name of await fs.readdir(path.join(root,'assets/icons'))) icons[name.replace('.svg','')]=await fs.readFile(path.join(root,'assets/icons',name),'utf8');
const iconPaths=JSON.parse(await fs.readFile(path.join(root,'icon-paths.json'),'utf8'));
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cssColor=(value,theme)=>palettes[theme][value]||value||'none';
export function wrapText(text,width,size,weight=400,letterSpacing=0) {
  const measured=measuredText[JSON.stringify([text,width,size,weight,letterSpacing])];
  if(measured)return measured;
  const advance=character=> /[ilI1.,:;!'|]/.test(character)?0.27:/[MW@%]/.test(character)?0.84:/[0-9]/.test(character)?0.58:/[A-Z]/.test(character)?0.64:/\s/.test(character)?0.26:0.49;
  const measure=word=>[...word].reduce((sum,c)=>sum+advance(c)*size+letterSpacing,0)*(weight>=600?1.025:1);
  return String(text).split('\n').flatMap(paragraph=>{
    const result=[];let current='';
    for(const word of paragraph.split(' ')) {
      const next=current?`${current} ${word}`:word;
      if(current&&measure(next)>width){result.push(current);current=word;}else current=next;
    }
    result.push(current);return result;
  });
}
function render(raw,theme='light',links=false) {
  const n=resolved(raw),color=cssColor(n.color,theme),fill=cssColor(n.fill,theme);
  let inner='';
  if(n.kind==='text') {
    const lines=wrapText(n.text,n.w,n.size,n.weight,n.letterSpacing||0),anchor=n.align==='right'?'end':n.align==='center'?'middle':'start',x=n.align==='right'?n.w:n.align==='center'?n.w/2:0;
    inner=`<text fill="${color}" font-family="DM Sans, sans-serif" font-size="${n.size}" font-weight="${n.weight}" letter-spacing="${n.letterSpacing||0}" text-anchor="${anchor}">${lines.map((text,i)=>`<tspan x="${x}" y="${n.size*.96+i*n.size*n.lineHeight}">${xml(text)}</tspan>`).join('')}</text>`;
  } else if(n.kind==='icon') {
    const rawSvg=icons[n.icon];if(!rawSvg)throw new Error(`Missing source icon: ${n.icon}`);
    inner=rawSvg.replace(/<\?xml[^>]*>/g,'').replace(/<svg([^>]*)>/,(_,attributes)=>`<svg${attributes.replace(/\s(?:width|height)=["'][^"']*["']/g,'')} width="${n.w}" height="${n.h}" color="${color}"${/\bfill\s*=/.test(attributes)?'':` fill="${color}"`}>`).replaceAll('currentColor',color).replace(/#000000\b|#000\b|\bblack\b/g,color).replace(/<title>.*?<\/title>/g,'');
  } else if(n.kind==='rect'||n.kind==='board') {
    const glass=!!n.material,tinted=n.material==='glass-tinted',selected=n.material==='glass-selected',alpha=tinted?.96:selected?.76:.68;
    inner=`<rect width="${n.w}" height="${n.h}" rx="${n.radius||0}" fill="${fill}"${glass?` fill-opacity="${alpha}" stroke="${selected&&n.stroke?cssColor(n.stroke,theme):'#FFFFFF'}" stroke-opacity="${theme==='light'?.78:.3}" stroke-width=".9" style="filter:drop-shadow(0px ${selected?1:5}px ${selected?2:10}px #142C2020);backdrop-filter:blur(${selected?12:24}px)"`:n.stroke?` stroke="${cssColor(n.stroke,theme)}" stroke-width="${n.strokeWidth||1}"`:''}/>`;
    inner+=(n.children||[]).map(c=>render(c,theme,links)).join('');
  }
  const output=`<g transform="translate(${n.x},${n.y})" data-name="${xml(n.name)}" data-kind="${n.kind}" data-width="${n.w}" data-height="${n.h}"${n.opacity!==undefined?` opacity="${n.opacity}"`:''}>${inner}</g>`;
  return links&&n.target?`<a href="#${xml(n.target)}" data-target="${xml(n.target)}" aria-label="${xml(n.name)}">${output}<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="transparent"/></a>`:output;
}
function svg(screen,links=false,standalone=false) {
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${screen.w} ${screen.h}" width="${screen.w}" height="${screen.h}" role="img" aria-label="${xml(screen.name)}"><title>${xml(screen.name)}</title>${standalone?`<style>@font-face{font-family:'DM Sans';src:url('../assets/DM-Sans.ttf') format('truetype');font-weight:100 900}</style>`:''}${render({...screen,x:0,y:0},screen.theme||'light',links)}</svg>`;
}

// Document the proposed visual system with editable specimens.
const foundation=box('Penny / 00 Foundations',0,0,1440,1340,'bg',[
  txt('PENNY · DESIGN PROPOSAL',56,48,13,600,'accent',1300,{letterSpacing:2}),txt('A little more clarity.\nEverywhere.',56,91,58,600,'ink',1000,{lineHeight:1.12,h:150,letterSpacing:-2}),
  txt('One warm, legible system for everyday money, shared expenses and the trips in between.',56,273,20,400,'muted',1130),
  txt('01  Color with a purpose',56,359,24,600,'ink',1300),
  ...[['bg','Canvas'],['paper','Surface'],['ink','Text'],['green','Income / calm'],['accent','Primary action'],['blue','Investment']].map(([color,name],i)=>box(`Swatch/${name}`,56+i*222,413,204,157,null,[rect('Color',0,0,204,88,color,16,{stroke:'line'}),txt(name,0,105,14,600,'ink',204),txt(palettes.light[color],0,132,12,400,'muted',204)])),
  txt('02  Type that reads easily',56,626,24,600,'ink',1300),txt('DM Sans',56,682,44,600,'ink',460),txt('A proposed shared typeface for iOS, Android and web.\nUse tabular figures for money. Limit production font weights.',56,753,16,400,'muted',600,{h:60}),
  ...Object.entries(typeScale).map(([name,[size,lh,weight]],i)=>box(`Type/${name}`,782,668+i*60,590,60,null,[txt(name[0].toUpperCase()+name.slice(1),0,2,size,weight,'ink',350),txt(`${size} / ${lh} · ${weight}`,397,8,13,400,'muted',193,{align:'right'})])),
  txt('03  Rhythm & shape',56,1030,24,600,'ink',1300),txt('4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48',56,1086,24,500,'green',700),
  txt('24px gutters · 52px capsule actions · native Liquid Glass navigation · 20px cards',56,1136,16,400,'muted',1300),
  box('Accessibility rules',56,1204,1328,90,'mint',[txt('Built for thumbs and real content.',20,14,17,600,'green',1288),txt('Minimum 48px touch areas · visible labels · text + icon + color · Dynamic Type · opaque surfaces for reading',20,47,14,400,'green',1288)],18),
],0,{id:'foundations',category:'Design system',theme:'light'});
foundation.h=1720;
foundation.children.push(txt('04  iOS 26 Liquid Glass · required',56,1342,24,600,'ink',1328),txt('Floating native glass navigation and controls, tinted primary actions, and direct category selection.',56,1394,16,400,'muted',1328),box('Glass over scrolling content',56,1450,760,214,'pale',[
 rect('Income beneath glass',24,28,308,88,'mint',20),txt('Payday',44,47,15,600,'green',260),txt('+$3,200.00',44,77,25,600,'green',260),rect('Spending beneath glass',358,54,374,114,'orange',20),txt('Groceries',378,73,15,600,'accent',330),txt('−$48.90',378,106,28,600,'accent',330),{kind:'instance',name:'Navigation/Home',component:'Navigation/Home',x:201,y:124,w:358,h:64,overrides:{}},
],24),box('Required material behavior',840,1450,544,214,'paper',[
 txt('Native on iOS 26',24,22,20,600,'ink',496),txt('Regular glass adapts to scrolling content. Primary actions use tinted glass. Controls respond with the native optical and interaction effects.',24,65,15,400,'muted',496,{h:72}),txt('Penpot depicts a static material study with editable background blur, translucency, highlights and shadow.',24,150,12,400,'muted',496,{h:44}),
],24));
boards.push(foundation);
const componentSheet=box('Penny / 01 Components',0,0,1440,1290,'bg',[
 txt('A shared set of building blocks.',48,40,36,600,'ink',1344),txt(`${Object.keys(components).length} main components; repeated controls in the screen layouts are linked instances.`,48,102,16,400,'muted',1344),
]);
let col=0,y=174;
for(const [name,definition] of Object.entries(components)) {
 if(col===3){col=0;y+=240;}
 componentSheet.children.push(txt(name,48+col*458,y,13,600,'muted',400));
 componentSheet.children.push({kind:'instance',name,component:name,x:48+col*458,y:y+36,w:Math.min(definition.w,390),h:definition.h,overrides:{}});
 col++;
}
componentSheet.h=y+230;componentSheet.id='components';componentSheet.category='Design system';componentSheet.theme='light';boards.push(componentSheet);
const map=box('Penny / 02 Navigation & interaction rules',0,0,1440,1160,'bg',[
 txt('One app. A familiar way around.',56,48,38,600,'ink',1328),txt('Keep primary destinations stable and secondary controls predictable.',56,108,18,400,'muted',1328),
 ...[['Home','Recorded summary · Recent entries · Explore your month'],['Activity','Recorded entries · Search · Month/year · Filters'],['Shared','Households · Expenses · Monthly balances · People'],['Trips','Personal and shared trips · Expenses · People'],['More','Recurring · Accounts · Categories · Settings']].map(([name,desc],i)=>box(name,56,190+i*130,1328,106,'paper',[txt(`0${i+1}`,20,30,24,600,'accent',70),txt(name,100,21,22,600,'ink',280),txt(desc,100,60,16,400,'muted',1200)],20)),
 txt('Common behavior',56,907,24,600,'ink',1328),txt('iOS 26 Liquid Glass is required for floating navigation and controls. Use native material behavior.\nForms and Activity keep frequent category buttons visible; open the complete list only when needed.\nRoot pages: one global Add entry action. Detail pages: Back + one task. Forms: labels + sticky Save.\nScroll fields above the keyboard. Preserve drafts on failure, lock and navigation.',56,961,17,400,'muted',1328,{h:160,lineHeight:1.7}),
],0,{id:'navigation-rules',category:'Design system',theme:'light'});boards.push(map);

const all=[...boards,...screens];
const ids=new Set(all.map(s=>s.id)),missing=new Set(),boundViolations=[];
let nodes=0,instances=0,texts=0;
function inspect(raw,rootId,path=[]){
 const n=resolved(raw);nodes++;if(raw.kind==='instance')instances++;if(n.kind==='text')texts++;
 if(n.target&&!ids.has(n.target))missing.add(n.target);
 for(const child of n.children||[]){
  if(child.x<-.01||child.y<-.01||child.x+child.w>n.w+.1||child.y+child.h>n.h+.1) {
   // Back button deliberately includes an 8px touch-target expansion beyond the content gutter.
   if(!(child.name==='Back'&&child.x===-8))boundViolations.push({screen:rootId,parent:n.name,child:child.name,x:child.x,y:child.y,w:child.w,h:child.h,parentW:n.w,parentH:n.h});
  }
  inspect(child,rootId,[...path,n.name]);
 }
}
for(const s of all)inspect(s,s.id);
if(missing.size)throw new Error(`Broken flow destinations: ${[...missing].join(', ')}`);
const tokens={name:'Penny design proposal',version:2,fontFamily:'DM Sans',palettes,typeScale,spacing,radius:{control:26,card:20,sheet:28},controlHeight:52,minTouchTarget:48,gutter:24,materials:{requirement:'Native iOS 26 Liquid Glass',regular:{backgroundBlur:24,fillOpacity:.68},tinted:{backgroundBlur:24,fillOpacity:.96},selected:{backgroundBlur:12,fillOpacity:.76},note:'Static Penpot approximation. Use the native iOS 26 material and interaction behavior in the application.'}};
await fs.mkdir(path.join(root,'screens'),{recursive:true});
await fs.mkdir(path.join(root,'penpot'),{recursive:true});
await fs.writeFile(path.join(root,'tokens.json'),JSON.stringify(tokens,null,2)+'\n');
await fs.writeFile(path.join(root,'scene.json'),JSON.stringify({tokens,components,screens,boards,icons,iconPaths},null,2)+'\n');
await fs.writeFile(path.join(root,'screen-inventory.json'),JSON.stringify(screens.map(({id,name,category,w,h,theme,platform,note})=>({id,name,category,w,h,theme,platform,note})),null,2)+'\n');
for(const s of all)await fs.writeFile(path.join(root,'screens',`${s.id}.svg`),svg(s,false,true));
const byCategory=Object.groupBy(all,s=>s.category);
const gallery=Object.entries(byCategory).map(([category,items])=>`<section class="category" data-category="${xml(category)}"><h2>${xml(category)}</h2><div class="grid">${items.map(s=>`<article id="${s.id}" class="screen${s.w>500?' wide':''}"><div class="screen-title"><h3>${xml(s.name)}</h3><span>${s.theme||'light'} · ${xml(s.platform||'specimen')}</span></div><div class="artboard">${svg(s,true)}</div>${s.note?`<p class="note">${xml(s.note)}</p>`:''}</article>`).join('')}</div></section>`).join('');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Penny — Whole-app redesign proposal</title><style>
@font-face{font-family:'DM Sans';src:url('assets/DM-Sans.ttf') format('truetype');font-weight:100 900;font-style:normal;font-display:swap}*{box-sizing:border-box}body{margin:0;background:#EAEDE6;color:#223C32;font:15px/1.5 'DM Sans',sans-serif}a{color:inherit}header{padding:52px 40px 36px;background:#244B3B;color:#FFF}header small{color:#CFDED2;letter-spacing:2px}h1{font-size:clamp(32px,4vw,58px);line-height:1.1;letter-spacing:-2px;margin:18px 0}header p{max-width:800px;color:#DCE8DA;font-size:17px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:24px}nav a,button{border:1px solid #CFDED2;border-radius:10px;background:transparent;color:inherit;padding:10px 14px;font:inherit;cursor:pointer}nav a{text-decoration:none}nav a:hover{background:#365D47}main{padding:20px 40px 60px;max-width:1920px;margin:auto}.category{scroll-margin-top:24px;margin:32px 0 64px}h2{font-size:27px;letter-spacing:-.6px;margin-bottom:26px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(342px,390px));gap:44px 36px;align-items:start}.screen{scroll-margin-top:24px;min-width:0}.screen.wide{grid-column:1/-1;width:min(1440px,100%)}.screen-title{height:63px;padding:0 3px}h3{font-size:15px;margin:0 0 4px}.screen-title span{font-size:12px;color:#627369}.artboard{border:1px solid #CFD8CF;box-shadow:0 14px 30px #26372F0C;overflow:hidden;border-radius:4px;background:#F7F6F2}.artboard>svg{display:block;width:100%;height:auto}.note{font-size:12px;line-height:1.6;color:#536259;margin:14px 2px 0}.artboard a:hover{filter:brightness(.94)}.artboard a{cursor:pointer}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:20px 40px;background:#F7F6F2;color:#223C32}.toolbar button{border-color:#B9C8BC}.toolbar label{display:flex;gap:8px;align-items:center}.focus-view .category{display:none}.focus-view .category:has(.current){display:block}.focus-view .screen{display:none}.focus-view .screen.current{display:block}.focus-view .grid{justify-content:center}.focus-view .category>h2{display:none}.screen:target .artboard{outline:3px solid #B74F32;outline-offset:5px}footer{padding:24px 40px;background:#244B3B;color:#CFDED2} @media(max-width:520px){header{padding:32px 20px}.toolbar{padding:16px 20px}main{padding:8px 16px 40px}.grid{grid-template-columns:minmax(0,390px);gap:36px}.screen.wide{overflow:auto}.screen.wide .artboard{min-width:1000px}} @media print{header,nav,.toolbar,footer{display:none}main{padding:0}.category{break-before:page}.grid{grid-template-columns:390px 390px}.screen{break-inside:avoid}.artboard{box-shadow:none}.note{max-width:390px}}
</style></head><body><header><small>PENNY · DESIGN PROPOSAL · V1</small><h1>A little more clarity.<br>Everywhere.</h1><p>A cohesive mobile-first redesign covering ${screens.length} screens and states, ${Object.keys(components).length} reusable component definitions, four appearances, and desktop adaptation. All UI is editable vector, text and component data. This is a proposal; the application is unchanged.</p><nav>${Object.keys(byCategory).map(category=>`<a href="#category-${xml(category.replaceAll(' ','-'))}">${xml(category)}</a>`).join('')}</nav></header><div class="toolbar"><button id="all">View all screens</button><button id="flow">Open click-through flow</button><label><input type="checkbox" id="notes" checked> Show implementation notes</label><span>Example data · Click controls to follow screen links</span></div><main>${gallery}</main><footer>Penny redesign proposal · Local source of truth: scene.json + tokens.json · Ionicons (MIT) · DM Sans (OFL)</footer><script>
const sections=[...document.querySelectorAll('.category')];for(const section of sections)section.id='category-'+section.dataset.category.replaceAll(' ','-');let focus=false;function select(){const id=location.hash.slice(1);const screen=document.getElementById(id);if(screen?.classList.contains('screen')){for(const node of document.querySelectorAll('.current'))node.classList.remove('current');screen.classList.add('current');if(focus)window.scrollTo({top:document.querySelector('main').offsetTop,behavior:'instant'});}}document.getElementById('all').onclick=()=>{focus=false;document.body.classList.remove('focus-view')};document.getElementById('flow').onclick=()=>{focus=true;document.body.classList.add('focus-view');location.hash='home';select()};document.getElementById('notes').onchange=e=>{for(const note of document.querySelectorAll('.note'))note.hidden=!e.target.checked};window.addEventListener('hashchange',select);select();
</script></body></html>`;
await fs.writeFile(path.join(root,'preview.html'),html);
const reviewIds=['home','activity','add-expense','household','shared-trip','settings'];
const review=box('Penny / Core screen review',0,0,1266,1816,'#EAEDE6',reviewIds.map((id,i)=>{const screen=screens.find(s=>s.id===id);return {...structuredClone(screen),x:(i%3)*438,y:Math.floor(i/3)*908};}));
const reviewHtml=`<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:'DM Sans';src:url('assets/DM-Sans.ttf');font-weight:100 900}body{margin:0;background:#EAEDE6}svg{display:block}</style></head><body>${svg(review)}</body></html>`;
await fs.writeFile(path.join(root,'review.html'),reviewHtml);
const evidence={screens:screens.length,components:Object.keys(components).length,boards:boards.length,nodes,componentInstances:instances,textNodes:texts,brokenDestinations:[...missing],boundsViolations:boundViolations};
await fs.writeFile(path.join(root,'validation.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
