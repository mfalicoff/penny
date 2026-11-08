import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPenpot } from './client.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const apply=process.argv.includes('--apply');
const client=await connectPenpot();
try {
 const probe=await client.code('const pages=penpot.currentFile?.pages||[];return {fileId:penpot.currentFile?.id,fileName:penpot.currentFile?.name,pages:penpotUtils.getPages(),fontAvailable:!!penpot.fonts.findByName("DM Sans"),cachedProposal:!!storage.pennyRedesign?.data,cachedComponentCount:Object.keys(storage.pennyRedesign?.components||{}).length,cachedScreens:Object.fromEntries(Object.entries(storage.pennyRedesign?.screens||{}).filter(([id,nodeId])=>pages.some(page=>!!page.getShapeById(nodeId))))};');
 if(!probe||typeof probe!=='object'||!probe.fileId)throw new Error(`Penpot did not expose an active design file: ${JSON.stringify(probe).slice(0,400)}`);
 console.log(JSON.stringify({connected:true,...probe},null,2));
 if(!apply)process.exit();
 if(!probe.fontAvailable)throw new Error('DM Sans is unavailable in this Penpot instance. The font is bundled in assets/DM-Sans.ttf.');
 const scene=JSON.parse(await fs.readFile(path.join(root,'scene.json'),'utf8'));
 scene.textLayout=JSON.parse(await fs.readFile(path.join(root,'text-layout.json'),'utf8'));
 const renderer=await fs.readFile(path.join(root,'penpot/renderer.js'),'utf8');
 if(process.argv.includes('--resume')){
  if(!probe.cachedProposal)throw new Error('The plugin has no cached proposal. Run --apply without --resume.');
  await client.code(`storage.pennyRedesign.data.iconPaths=${JSON.stringify(scene.iconPaths)};const INPUT=storage.pennyRedesign.data;\n${renderer}`);
 }else{
  // The hosted endpoint limits HTTP request bodies; transfer data in bounded chunks.
  const serialized=JSON.stringify(scene),chunkSize=20000;
  await client.code('storage.pennyTransfer=[];return {ready:true};');
  console.log(`Transferring editable layout data in ${Math.ceil(serialized.length/chunkSize)} chunks.`);
  for(let offset=0,index=0;offset<serialized.length;offset+=chunkSize,index++)await client.code(`storage.pennyTransfer[${index}]=${JSON.stringify(serialized.slice(offset,offset+chunkSize))};return {chunk:${index}};`);
  await client.code(`const INPUT=JSON.parse(storage.pennyTransfer.join(''));\n${renderer}`);
 }
 let state={fileId:probe.fileId,fileName:probe.fileName,pages:{},components:{},screens:{},steps:[],nativeVerification:'pending'};
 try{const saved=JSON.parse(await fs.readFile(path.join(root,'penpot-state.json'),'utf8'));if(saved.fileId===state.fileId)state=saved;}catch{}
 if(process.argv.includes('--resume'))Object.assign(state.screens,probe.cachedScreens);
 const save=()=>fs.writeFile(path.join(root,'penpot-state.json'),JSON.stringify(state,null,2)+'\n');
 const phase=async(name,code)=>{const started=Date.now(),result=await client.code(code);state.steps.push({name,result});await save();console.log(`Completed ${name} (${((Date.now()-started)/1000).toFixed(1)}s)`);return result;};

 const resumeAssets=process.argv.includes('--resume')&&probe.cachedComponentCount===Object.keys(scene.components).length+Object.keys(scene.icons).length;
 if(resumeAssets)console.log('Reusing existing foundations and component assets.');
 if(!resumeAssets){
 await phase('Foundations and tokens',`
 const S=storage.pennyRedesign,lib=penpot.library.local;
 const page=await S.page('Penny · 00 Start here');
 const catalog=lib.tokens;
 const setFor=name=>{let set=catalog.sets.find(s=>s.name===name);if(!set)set=catalog.addSet({name});if(!set.active)set.toggleActive();return set;};
 const primitive=setFor('Penny/Primitives');
 const makeToken=(set,type,name,value)=>{let token=set.tokens.find(t=>t.name===name);if(!token)token=set.addToken({type,name,value});S.tokens[name]=token;return token;};
 const allColors=new Set();
 for(const palette of Object.values(S.data.tokens.palettes))for(const hex of Object.values(palette))allColors.add(hex.toUpperCase());
 const walk=n=>{for(const value of [n.color,n.fill,n.stroke])if(typeof value==='string'&&/^#[A-Fa-f0-9]{6}$/.test(value))allColors.add(value.toUpperCase());for(const c of n.children||[])walk(c);};
 for(const n of [...S.data.screens,...S.data.boards,...Object.values(S.data.components)])walk(n);
 for(const hex of allColors)makeToken(primitive,'color','primitive.color.hex'+hex.slice(1),hex);
 for(const [theme,palette] of Object.entries(S.data.tokens.palettes)){
  const set=setFor('Penny/Appearance/'+theme);
  for(const [key,value] of Object.entries(palette)){
   makeToken(set,'color','color.'+theme+'.'+key,'{primitive.color.hex'+value.slice(1).toUpperCase()+'}');
   let color=S.colors[theme+'.'+key]||lib.colors.find(c=>S.sameName(c.path,'Penny/'+theme)&&c.name===key);
   if(!color){color=lib.createColor();color.path='Penny/'+theme;color.name=key;color.color=value;}
   S.colors[theme+'.'+key]=color;
  }
 }
 const geometry=setFor('Penny/Geometry');
 for(const value of S.data.tokens.spacing)makeToken(geometry,'spacing','spacing.s'+value,String(value));
 const radii=new Set(),styles=new Map();
 const collect=n=>{if(n.radius)radii.add(n.radius);if(n.kind==='text')styles.set(S.styleKey(n),n);for(const child of n.children||[])collect(child);};
 for(const n of [...S.data.screens,...S.data.boards,...Object.values(S.data.components)])collect(n);
 for(const value of radii)makeToken(geometry,'borderRadius','radius.r'+value,String(value));
 makeToken(geometry,'fontFamilies','font.family','DM Sans');
 for(const [key,n] of styles){
  let style=S.styles[key]||lib.typographies.find(t=>S.sameName(t.path,'Penny/Type')&&t.name===S.styleName(n));
  if(!style){style=lib.createTypography();style.path='Penny/Type';style.name=S.styleName(n);const variant=S.font.variants.find(v=>v.fontWeight===String(n.weight)&&v.fontStyle==='normal');style.setFont(S.font,variant);style.fontSize=String(n.size);style.fontWeight=String(n.weight);style.lineHeight=String(n.lineHeight||1.35);style.letterSpacing=String(n.letterSpacing||0);}
  S.styles[key]=style;
 }
 const created=[];
 for(const id of ['foundations','navigation-rules']){
  const spec=S.data.boards.find(b=>b.id===id);let shape=page.root.children.find(s=>s.name===spec.name);
  if(!shape){shape=S.make({...spec,x:48,y:id==='foundations'?48:S.data.boards.find(b=>b.id==='foundations').h+112},page.root);created.push(shape.id);}
 }
 return {pageId:page.id,tokenCount:Object.keys(S.tokens).length,colorCount:Object.keys(S.colors).length,typographyCount:Object.keys(S.styles).length,createdBoardIds:created};
 `);
 await phase('Icon and control components',`
 const S=storage.pennyRedesign,lib=penpot.library.local,page=await S.page('Penny · 01 Components');
 const output=[];let index=0;
 const createAsset=(key,shape)=>{const asset=lib.createComponent([shape]);const parts=key.split('/');asset.name=parts.pop();asset.path='Penny/'+parts.join('/');S.components[key]=asset;output.push({key,id:asset.id,mainId:asset.mainInstance().id});return asset;};
 for(const name of Object.keys(S.data.icons)){
  const key='Icon/'+name;let asset=S.components[key]||lib.components.find(c=>S.sameName(c.path,'Penny/Icon')&&c.name===name);
  if(!asset){const shape=penpot.createShapeFromSvg(S.svg(name,24,S.palette('ink','light')));if(!shape)throw new Error('Icon import failed: '+name);shape.name=key;shape.resize(24,24);shape.x=48+(index%12)*110;shape.y=2450+Math.floor(index/12)*92;S.tintIcon(shape,'ink','light',name);asset=createAsset(key,shape);}
  S.components[key]=asset;index++;
 }
 index=0;
 for(const [key,spec] of Object.entries(S.data.components)){
  const parts=key.split('/'),name=parts.pop(),folder='Penny/'+parts.join('/');let asset=S.components[key]||lib.components.find(c=>S.sameName(c.path,folder)&&c.name===name);
  if(!asset){const shape=S.make({...spec,x:48+(index%3)*458,y:140+Math.floor(index/3)*250},page.root);asset=createAsset(key,shape);}
  S.components[key]=asset;index++;
 }
 const specimen=S.data.boards.find(b=>b.id==='components');
 if(!page.root.children.some(s=>s.name===specimen.name))S.make({...specimen,x:1500,y:48},page.root);
 return {pageId:page.id,createdComponents:output,componentCount:Object.keys(S.components).length};
 `);
 }
 if(!resumeAssets)await phase('Screen page',`
 const S=storage.pennyRedesign;const page=await S.page('Penny · 02 Screens & flows');
 S.screenPageId=page.id;return {pageId:page.id};
 `);
 // Synchronization is handled before the next MCP execution. Returning IDs here
 // avoids an additional long wait while preserving a recoverable batch boundary.
 const positions={};let y=80;
 const categories=[...new Set(scene.screens.map(s=>s.category))];
 for(const category of categories){
  const group=scene.screens.filter(s=>s.category===category);let row=0,column=0;
  for(const s of group){if(s.w>500){if(column){row++;column=0;}positions[s.id]={x:48,y:y+row*960};row+=Math.ceil((s.h+80)/960);}else{positions[s.id]={x:48+column*454,y:y+row*960};column++;if(column===4){column=0;row++;}}}
  y+=(row+(column?1:0))*960+140;
 }
 const limitArg=process.argv.find(a=>a.startsWith('--limit='));
 const screenLimit=limitArg?Math.min(scene.screens.length,Number(limitArg.split('=')[1])):scene.screens.length;
 const batchArg=process.argv.find(a=>a.startsWith('--batch='));
 const batchSize=batchArg?Number(batchArg.split('=')[1]):6;
 for(let start=0;start<screenLimit;start+=batchSize){
  const items=scene.screens.slice(start,Math.min(start+batchSize,screenLimit)).filter(s=>!process.argv.includes('--resume')||!probe.cachedScreens[s.id]).map(s=>({id:s.id,...positions[s.id]}));
  if(!items.length)continue;
  const result=await phase(`Screens ${start+1}–${Math.min(start+batchSize,screenLimit)}`,`
   const S=storage.pennyRedesign,page=await S.page('Penny · 02 Screens & flows');const output=[];
   for(const item of ${JSON.stringify(items)}){
    const spec=S.data.screens.find(s=>s.id===item.id);let shape=page.root.children.find(s=>s.name===spec.name);
    if(shape&&!S.screens[spec.id])throw new Error('An incomplete board requires repair before resuming: '+spec.name+' ('+shape.id+')');
    if(!shape){shape=S.make({...spec,x:item.x,y:item.y},page.root,spec.theme,spec.id);shape.clipContent=true;}
    S.screens[spec.id]=shape.id;output.push({id:spec.id,nodeId:shape.id,name:shape.name,width:shape.width,height:shape.height});
   }
   return {screens:output};
  `);
  for(const s of result.screens||[])state.screens[s.id]=s.nodeId;
  await save();
 }
 if(screenLimit<scene.screens.length){await save();console.log(`Imported ${screenLimit} screen specimens for review; the remaining screens are pending.`);process.exit();}
 const prototype=await phase('Prototype map',`
 const S=storage.pennyRedesign,page=await S.page('Penny · 02 Screens & flows');
 S.pendingLinks=[];
 for(const spec of S.data.screens){const shape=page.getShapeById(S.screens[spec.id]);if(shape)S.collectLinks(shape,spec,spec.id);}
 const all=[...new Map(S.pendingLinks.map(l=>[l.shapeId+':'+l.target,l])).values()];
 S.prototypeLinks=all.filter(l=>l.source!==l.target);S.prototypeStaticLinks=all.filter(l=>l.source===l.target);
 for(const link of S.prototypeStaticLinks){const source=page.getShapeById(link.shapeId);if(source)for(const i of source.interactions)if(i.trigger==='click'&&i.action.type==='navigate-to'&&i.action.destination.id===S.screens[link.target])source.removeInteraction(i);}
 S.prototypeLinked=0;S.prototypeUnresolved=[];
 return {linkCount:S.prototypeLinks.length,staticControls:S.prototypeStaticLinks.length};
 `);
 for(let start=0;start<prototype.linkCount;start+=200)await phase(`Prototype connections ${start+1}–${Math.min(start+200,prototype.linkCount)}`,`
 const S=storage.pennyRedesign,page=await S.page('Penny · 02 Screens & flows');let linked=0;const unresolved=[];
 for(const link of S.prototypeLinks.slice(${start},${start+200})){
  const source=page.getShapeById(link.shapeId),destination=page.getShapeById(S.screens[link.target]);
  if(!source||!destination){unresolved.push(link);continue;}
  if(!source.interactions.some(i=>i.trigger==='click'&&i.action.type==='navigate-to'&&i.action.destination.id===destination.id))source.addInteraction('click',{type:'navigate-to',destination,preserveScrollPosition:false});linked++;
 }
 S.prototypeLinked+=linked;S.prototypeUnresolved.push(...unresolved);return {linked,unresolved};
 `);
 await phase('Prototype flow and validation',`
 const S=storage.pennyRedesign,page=await S.page('Penny · 02 Screens & flows');
 const home=page.getShapeById(S.screens.home);if(home){const flow=page.flows.find(f=>f.startingBoard.id===home.id);if(flow)flow.name='Penny · Start here';else page.createFlow('Penny · Start here',home);}
 for(const flow of page.flows){const spec=S.data.screens.find(s=>S.screens[s.id]===flow.startingBoard.id);if(spec&&spec.id!=='home')flow.name='Penny · '+spec.name;}
 return {fileId:S.fileId,pages:S.pages,screens:S.screens,linked:S.prototypeLinked,unresolved:S.prototypeUnresolved,validationErrors:penpot.currentFile.validate()};
 `);
 console.log('Editable Penpot layers created. Export and inspect representative boards before marking native verification complete.');
}catch(error){console.error(error.message);process.exitCode=1;}
