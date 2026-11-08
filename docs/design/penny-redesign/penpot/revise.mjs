// Updates the existing proposal while preserving screen IDs and incoming links.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPenpot } from './client.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const client=await connectPenpot();
const scene=JSON.parse(await fs.readFile(path.join(root,'scene.json'),'utf8'));
const textLayout=JSON.parse(await fs.readFile(path.join(root,'text-layout.json'),'utf8'));
const renderer=await fs.readFile(path.join(root,'penpot/renderer.js'),'utf8');
const state=JSON.parse(await fs.readFile(path.join(root,'penpot-state.json'),'utf8'));
const revision='ios26-liquid-glass-inline-categories-v2';
const phase=async(name,code)=>{
 const result=await client.code(`if(storage.pennyRedesign?.fileId!==penpot.currentFile?.id)throw new Error('Reconnect the original Penny proposal file');\n${code}`);
 const summary=name==='Read existing proposal model'?{screenCount:result.screens.length,componentCount:Object.keys(result.components).length}:result;
 state.steps.push({name,result:summary});
 await fs.writeFile(path.join(root,'penpot-state.json'),JSON.stringify(state,null,2)+'\n');
 console.log(name,JSON.stringify(summary));return result;
};
const data={tokens:scene.tokens,components:scene.components,screens:scene.screens,boards:scene.boards,textLayout};
let resume={components:[],screens:[]};
if(process.argv.includes('--continue')){
 resume=await phase('Resume revised proposal',`const current=storage.pennyRedesign;if(current.revision!==${JSON.stringify(revision)})throw new Error('Start the revision without --continue first');await (async(INPUT)=>{${renderer}})(current.data);return {revision:current.revision,components:Object.keys(current.revisedComponents||{}),screens:Object.keys(current.revisedScreens||{}),componentSheet:!!current.revisedComponentSheet,foundations:!!current.revisedFoundations};`);
}else{
const before=await phase('Read existing proposal model',`const S=storage.pennyRedesign,d=S.data;return {tokens:d.tokens,components:d.components,screens:d.screens,boards:d.boards,textLayout:d.textLayout,_revisionState:{revision:S.revision,components:Object.keys(S.revisedComponents||{}),screens:Object.keys(S.revisedScreens||{}),componentSheet:!!S.revisedComponentSheet,foundations:!!S.revisedFoundations}};`);
resume=before._revisionState?.revision===revision?before._revisionState:{components:[],screens:[]};delete before._revisionState;
// Send only changed data; the hosted endpoint limits request body size.
const patches=[];
const diff=(a,b,p=[])=>{
 if(JSON.stringify(a)===JSON.stringify(b))return;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b)){patches.push(['set',p,b]);return;}
 for(const key of Object.keys(b))diff(a[key],b[key],[...p,Array.isArray(b)?Number(key):key]);
 if(Array.isArray(b)){if(a.length!==b.length)patches.push(['length',p,b.length]);}
 else for(const key of Object.keys(a))if(!(key in b))patches.push(['delete',[...p,key]]);
};
diff(before,data);
const batches=[];let batch=[];
for(const patch of patches){if(JSON.stringify([...batch,patch]).length>55000&&batch.length){batches.push(batch);batch=[];}batch.push(patch);}if(batch.length)batches.push(batch);
if(!batches.length)batches.push([]);
for(let index=0;index<batches.length;index++)await phase(`Load revised proposal ${index+1}/${batches.length}`,`
 const current=storage.pennyRedesign;
 if(current.revision!==${JSON.stringify(revision)}){current.previousData=JSON.parse(JSON.stringify({components:current.data.components,screens:current.data.screens,boards:current.data.boards}));current.previousComponents=current.previousData.components;current.revision=${JSON.stringify(revision)};current.revisedScreens={};}
 for(const [op,path,value] of ${JSON.stringify(batches[index])}){let target=current.data;const keys=op==='length'?path:path.slice(0,-1);for(const key of keys)target=target[key];if(op==='length')target.length=value;else if(op==='delete')delete target[path[path.length-1]];else target[path[path.length-1]]=value;}
 ${index===batches.length-1?`return await (async(INPUT)=>{${renderer}})(current.data);`:'return {loaded:true};'}
`);
}
if(!process.argv.includes('--continue'))await phase('Revised type and geometry assets',`
 const S=storage.pennyRedesign,lib=penpot.library.local;
 for(const [key,style] of Object.entries(S.styles)){const [size,weight,lineHeight,letterSpacing]=key.split('/'),name=S.styleName({size,weight,lineHeight,letterSpacing});if(!S.sameName(style.path,'Penny/Type'))style.path='Penny/Type';if(style.name!==name)style.name=name;}
 let geometry=lib.tokens.sets.find(s=>S.sameName(s.name,'Penny/Geometry'));
 if(!geometry)geometry=lib.tokens.addSet({name:'Penny/Geometry'});
 const visit=n=>{
  if(n.radius&&!S.tokens['radius.r'+n.radius])S.tokens['radius.r'+n.radius]=geometry.addToken({type:'borderRadius',name:'radius.r'+n.radius,value:String(n.radius)});
  if(n.kind==='text'&&!S.styles[S.styleKey(n)]){const style=lib.createTypography();style.path='Penny/Type';style.name=S.styleName(n);style.setFont(S.font,S.font.variants.find(v=>v.fontWeight===String(n.weight)&&v.fontStyle==='normal'));style.fontSize=String(n.size);style.fontWeight=String(n.weight);style.lineHeight=String(n.lineHeight||1.35);style.letterSpacing=String(n.letterSpacing||0);S.styles[S.styleKey(n)]=style;}
  for(const c of n.children||[])visit(c);
 };
 for(const n of [...S.data.screens,...S.data.boards,...Object.values(S.data.components)])visit(n);
 return {typographies:Object.keys(S.styles).length,tokens:Object.keys(S.tokens).length};
`);
const componentKeys=Object.keys(scene.components);
for(let start=0;start<componentKeys.length;start+=6){
 const keys=componentKeys.slice(start,start+6);if(keys.every(key=>resume.components.includes(key)))continue;
 await phase(`Liquid Glass and category components ${start+1}–${Math.min(start+6,componentKeys.length)}`,`
 const S=storage.pennyRedesign,lib=penpot.library.local,page=await S.page('Penny · 01 Components');S.revisedComponents=S.revisedComponents||{};
 for(const key of ${JSON.stringify(keys)}){if(S.revisedComponents[key])continue;const spec=S.data.components[key],index=Object.keys(S.data.components).indexOf(key);
  let asset=S.components[key],shape;
  if(!asset){shape=S.make(spec,page.root);asset=lib.createComponent([shape]);const parts=key.split('/');asset.name=parts.pop();asset.path='Penny/'+parts.join('/');S.components[key]=asset;}
  else{shape=asset.mainInstance();S.reconcile(shape,S.previousComponents[key]||spec,spec,'light',undefined,true);}
  const x=48+(index%3)*458,y=140+Math.floor(index/3)*250;if(shape.x!==x)shape.x=x;if(shape.y!==y)shape.y=y;S.revisedComponents[key]=true;
 }
 return {componentCount:Object.keys(S.components).length,updated:Object.keys(S.revisedComponents).length};
`);}
if(!resume.componentSheet)await phase('Liquid Glass component specimens',`
 const S=storage.pennyRedesign,page=await S.page('Penny · 01 Components');
 const next=S.data.boards.find(b=>b.id==='components'),before=S.previousData.boards.find(b=>b.id==='components');
 const board=page.root.children.find(s=>s.name===next.name);S.reconcile(board,before,next,'light',undefined,true);
 S.revisedComponentSheet=true;return {componentCount:Object.keys(S.components).length};
`);
if(!resume.foundations)await phase('Liquid Glass foundations',`
 const S=storage.pennyRedesign,page=await S.page('Penny · 00 Start here');
 for(const id of ['foundations','navigation-rules']){const next=S.data.boards.find(b=>b.id===id),before=S.previousData.boards.find(b=>b.id===id),board=page.root.children.find(s=>s.name===next.name);S.reconcile(board,before,next,'light',undefined,true);}
 S.revisedFoundations=true;return {boards:2};
`);
// Bound execution time so the browser can keep its MCP heartbeat active.
const pending=scene.screens.filter(s=>!resume.screens.includes(s.id));
const categoryForms=new Set(['add-expense','add-income','add-investment','edit-entry','shared-expense','save-error']);
for(let start=0;start<pending.length;){
 const size=pending.slice(start,start+8).some(s=>categoryForms.has(s.id))?2:8;
 const ids=pending.slice(start,start+size).map(s=>s.id);start+=ids.length;
 await phase(`Revise ${ids.join(', ')}`,`
 const S=storage.pennyRedesign,page=await S.page('Penny · 02 Screens & flows');let updated=0;
 for(const id of ${JSON.stringify(ids)}){if(S.revisedScreens[id])continue;const next=S.data.screens.find(s=>s.id===id),before=S.previousData.screens.find(s=>s.id===id),shape=page.getShapeById(S.screens[id]);if(!shape)throw new Error('Missing existing screen '+id);S.reconcile(shape,before,next,next.theme,id,true);S.repairIcons(shape,next,next.theme);shape.clipContent=true;S.revisedScreens[id]=true;updated++;}
 return {updated,total:Object.keys(S.revisedScreens).length};
 `);
}
// Reuse the normal importer's idempotent prototype wiring and flow validation.
const sync=await fs.readFile(path.join(root,'penpot/sync.mjs'),'utf8');
const section=sync.slice(sync.indexOf(' const prototype=await phase('),sync.indexOf(" console.log('Editable Penpot layers created."));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
await new AsyncFunction('phase',section)(phase);
state.nativeVerification='pending visual verification';
await fs.writeFile(path.join(root,'penpot-state.json'),JSON.stringify(state,null,2)+'\n');
