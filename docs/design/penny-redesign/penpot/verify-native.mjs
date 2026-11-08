import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPenpot } from './client.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scene=JSON.parse(await fs.readFile(path.join(root,'scene.json'),'utf8'));
const client=await connectPenpot();
const audit=await client.code(`
 const S=storage.pennyRedesign;
 if(!S||S.fileId!==penpot.currentFile.id)throw new Error('Reconnect the imported Penny file.');
 const page=await S.page('Penny · 02 Screens & flows');
 const missing=[],duplicates=[],unmatched=[],wrongFonts=[],wrongIcons=[],wrongColors=[],overflow=[],unlinked=[],invalidMaterials=[];
 let textCount=0,linkedInstances=0,matchedNodes=0,tokenBindings=0,interactionCount=0,glassMaterialNodes=0;
 const screenIds=new Set(Object.values(S.screens)),visited=new Set(),materialSeen=new Set(),themeByScreen=Object.fromEntries(S.data.screens.map(s=>[s.id,s.theme]));
 for(const shape of page.findShapes({type:'board'})){const visible=screenIds.has(shape.id);if(shape.showInViewMode!==visible)shape.showInViewMode=visible;}
 const visit=(shape,n,id,board)=>{
  if(!visited.has(shape.id)){
   visited.add(shape.id);matchedNodes++;
   if(['instance','icon'].includes(n.kind)&&shape.isComponentCopyInstance())linkedInstances++;
   tokenBindings+=Object.values(shape.tokens||{}).filter(Boolean).length;
   interactionCount+=shape.interactions.length;
  }
  if(n.material&&!materialSeen.has(shape.id)){materialSeen.add(shape.id);glassMaterialNodes++;const blur=shape.backgroundBlur,paint=Array.isArray(shape.fills)?shape.fills[0]:null;if(!blur?.value||blur.hidden||!paint||paint.fillOpacity>=1)invalidMaterials.push({screen:id,layer:shape.name,material:n.material,blur,opacity:paint?.fillOpacity});}
  if(n.kind==='icon'&&shape.component()?.id!==S.components['Icon/'+n.icon]?.id)wrongIcons.push({screen:id,layer:shape.name,expected:n.icon});
  const paintValue=n.kind==='text'?n.color:['board','rect'].includes(n.kind)?n.fill:null;
  if(paintValue){const paint=Array.isArray(shape.fills)?shape.fills[0]:null,expected=S.palette(paintValue,themeByScreen[id]);if(paint?.fillColor?.toLowerCase()!==expected.toLowerCase())wrongColors.push({screen:id,nodeId:shape.id,layer:shape.name,expected,actual:paint?.fillColor,material:n.material});}
  if(n.target&&n.target!==id&&!shape.interactions.some(i=>i.trigger==='click'&&i.action.type==='navigate-to'&&i.action.destination.id===S.screens[n.target]))unlinked.push({screen:id,layer:shape.name,target:n.target});
  if(n.kind==='instance'){visit(shape,S.instanceSpec(n.component,n.w,n.h,n.overrides||{}),id,board);return;}
  if(n.kind==='text'&&!shape.hidden){
   textCount++;
   if(shape.fontFamily!=='DM Sans')wrongFonts.push({screen:id,layer:shape.name,font:shape.fontFamily});
   if(shape.x<board.x-1||shape.y<board.y-1||shape.x+shape.width>board.x+board.width+1||shape.y+shape.height>board.y+board.height+1)overflow.push({screen:id,layer:shape.name,x:shape.x-board.x,y:shape.y-board.y,width:shape.width,height:shape.height});
  }
  const pairs=S.childPairs(shape,n.children);
  if(pairs.length!==(n.children||[]).length)unmatched.push({screen:id,layer:shape.name,expected:(n.children||[]).length,actual:pairs.length});
  for(const p of pairs)visit(p.shape,p.spec,id,board);
 };
 for(const n of S.data.screens){
  const matches=page.root.children.filter(s=>s.name===n.name);
  if(matches.length>1)duplicates.push({screen:n.id,count:matches.length});
  const shape=S.screens[n.id]?page.getShapeById(S.screens[n.id]):null;
  if(!shape){missing.push(n.id);continue;}
  if(shape.getPluginData('penny-redesign-id')!==n.id)shape.setPluginData('penny-redesign-id',n.id);
  visit(shape,n,n.id,shape);
 }
 const lib=penpot.library.local;
 const assets=lib.components.filter(c=>String(c.path).split('/').map(x=>x.trim())[0]==='Penny');
 const colorCount=lib.colors.filter(c=>String(c.path).split('/').map(x=>x.trim())[0]==='Penny').length;
 const typographyCount=lib.typographies.filter(c=>S.sameName(c.path,'Penny/Type')).length;
 return {fileId:S.fileId,fileName:penpot.currentFile.name,pages:S.pages,screenCount:Object.keys(S.screens).length,viewerBoardCount:page.findShapes({type:'board'}).filter(s=>s.showInViewMode).length,componentCount:assets.length,componentIds:Object.fromEntries(Object.entries(S.components).map(([key,asset])=>[key,asset.id])),colorCount,typographyCount,matchedNodes,textCount,linkedInstances,tokenBindings,interactionCount,glassMaterialNodes,invalidMaterials,missing,duplicates,unmatched,wrongFonts,wrongIcons,wrongColors,overflow,unlinked,flows:page.flows.map(f=>({name:f.name,startingBoardId:f.startingBoard.id})),validationErrors:penpot.currentFile.validate()};
`);
const problems=['missing','duplicates','unmatched','wrongFonts','wrongIcons','wrongColors','overflow','unlinked','validationErrors','invalidMaterials'];
audit.status=audit.screenCount===scene.screens.length&&audit.viewerBoardCount===scene.screens.length&&audit.componentCount===Object.keys(scene.components).length+Object.keys(scene.icons).length&&audit.glassMaterialNodes>0&&audit.typographyCount>0&&!problems.some(key=>audit[key].length)?'passed':'failed';
audit.verifiedAt=new Date().toISOString();
await fs.writeFile(path.join(root,'native-validation.json'),JSON.stringify(audit,null,2)+'\n');
const validation=JSON.parse(await fs.readFile(path.join(root,'validation.json'),'utf8'));
validation.nativePenpotVerification=audit;
validation.visualVerification.nativePenpotVerification=audit.status;
await fs.writeFile(path.join(root,'validation.json'),JSON.stringify(validation,null,2)+'\n');
const state=JSON.parse(await fs.readFile(path.join(root,'penpot-state.json'),'utf8'));
state.pages=audit.pages;state.components=audit.componentIds;state.nativeVerification=audit.status;
await fs.writeFile(path.join(root,'penpot-state.json'),JSON.stringify(state,null,2)+'\n');
console.log(JSON.stringify(audit,null,2));
if(audit.status!=='passed')process.exitCode=1;
