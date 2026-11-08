// Installed as the body of one execute_code call, with INPUT supplied by the importer.
// Penpot's high_level_overview and API references define every API used here.
if(!penpot.currentFile||!penpot.currentPage)throw new Error('Open a Penpot file and connect File → MCP Server → Connect.');
const S=storage.pennyRedesign||{};
if(S.fileId&&S.fileId!==penpot.currentFile.id)throw new Error('The active Penpot file changed. Reconnect the intended proposal file.');
S.fileId=penpot.currentFile.id;S.schema=1;S.data=INPUT;
S.tokens=S.tokens||{};S.colors=S.colors||{};S.styles=S.styles||{};S.components=S.components||{};S.screens=S.screens||{};S.pages=S.pages||{};S.pendingLinks=S.pendingLinks||[];
S.ids=S.ids||[];
S.palette=(value,theme='light')=>INPUT.tokens.palettes[theme][value]||value;
S.page=async name=>{
 let page=penpotUtils.getPageByName(name);
 if(!page){page=penpot.createPage();page.name=name;S.ids.push(page.id);}
 S.pages[name]=page.id;if(penpot.currentPage.id!==page.id)await penpot.openPage(page);return page;
};
S.font=penpot.fonts.findByName(INPUT.tokens.fontFamily);
if(!S.font)throw new Error(`The proposed ${INPUT.tokens.fontFamily} font is unavailable in this Penpot file. Add it before importing.`);
S.tokenColor=(value,theme)=>INPUT.tokens.palettes[theme][value]?S.tokens[`color.${theme}.${value}`]:S.tokens[`primitive.color.hex${String(value).replace('#','').toUpperCase()}`];
S.fill=(shape,value,theme='light',property='fill')=>{
 if(!value){if(property==='fill')shape.fills=[];return;}
 const hex=S.palette(value,theme),token=S.tokenColor(value,theme);
 if(property==='fill')shape.fills=[{fillColor:hex,fillOpacity:1}];
 else shape.strokes=[{strokeColor:hex,strokeOpacity:1,strokeWidth:1,strokeStyle:'solid',strokeAlignment:'inner'}];
 if(token)shape.applyToken(token,[property]);
};
S.styleKey=n=>`${n.size}/${n.weight}/${n.lineHeight||1.35}/${n.letterSpacing||0}`;
S.styleName=n=>`${n.size}px · ${n.weight} · ${n.lineHeight||1.35} · ${n.letterSpacing||0}`;
S.lines=n=>INPUT.textLayout[JSON.stringify([n.text,n.w,n.size,n.weight,n.letterSpacing||0])]||String(n.text).split('\n');
S.text=(shape,n,theme)=>{
 const content=S.lines(n).join('\n'),paint=Array.isArray(shape.fills)?shape.fills[0]:null;
 if(shape.characters===(content||'\u00A0')&&shape.fontFamily===S.font.name&&String(shape.fontSize)===String(n.size)&&String(shape.fontWeight)===String(n.weight)&&String(shape.lineHeight)===String(n.lineHeight||1.35)&&String(shape.letterSpacing)===String(n.letterSpacing||0)&&shape.align===(n.align||'left')&&paint?.fillColor?.toLowerCase()===String(S.palette(n.color,theme)).toLowerCase())return;
 const style=S.styles[S.styleKey(n)];
 if(style)style.applyToText(shape);else{
  const variant=S.font.variants.find(v=>v.fontWeight===String(n.weight)&&v.fontStyle==='normal');S.font.applyToText(shape,variant);
 }
 shape.characters=content||'\u00A0';shape.hidden=false;shape.fontSize=String(n.size);shape.fontWeight=String(n.weight);shape.lineHeight=String(n.lineHeight||1.35);shape.letterSpacing=String(n.letterSpacing||0);shape.align=n.align||'left';shape.verticalAlign='top';
 const height=Math.max(n.h,n.size*(n.lineHeight||1.35)*S.lines(n).length);
 shape.resize(n.w,height);shape.growType='auto-height';S.fill(shape,n.color,theme);
};
S.radius=(shape,radius)=>{
 if(shape.borderRadius!==(radius||0))shape.borderRadius=radius||0;
 const token=S.tokens[`radius.r${radius}`];if(token&&shape.tokens.borderRadiusTopLeft!==token.name)shape.applyToken(token,['borderRadiusTopLeft','borderRadiusTopRight','borderRadiusBottomRight','borderRadiusBottomLeft']);
};
S.material=(shape,n,theme='light')=>{
 if(!n.material)return;
 const selected=n.material==='glass-selected',tinted=n.material==='glass-tinted',opacity=tinted?.96:selected?.76:.68;
 const blur=shape.backgroundBlur;if(blur?.value!==(selected?12:24)||blur?.hidden)shape.backgroundBlur={value:selected?12:24,hidden:false};
 if(Array.isArray(shape.fills)&&shape.fills.some(f=>f.fillOpacity!==opacity))shape.fills=shape.fills.map(f=>({...f,fillOpacity:opacity}));
 const strokes=[{strokeColor:selected&&n.stroke?S.palette(n.stroke,theme):'#FFFFFF',strokeOpacity:theme==='light'?.78:.3,strokeWidth:.9,strokeStyle:'solid',strokeAlignment:'inner'}];
 const strokeKey=s=>[s.strokeColor?.toLowerCase(),s.strokeOpacity,s.strokeWidth,s.strokeStyle,s.strokeAlignment];
 if(JSON.stringify(shape.strokes.map(strokeKey))!==JSON.stringify(strokes.map(strokeKey)))shape.strokes=strokes;
 const shadows=[{style:'drop-shadow',offsetX:0,offsetY:selected?1:5,blur:selected?3:18,spread:0,color:{color:'#142C20',opacity:selected?.08:.13}},{style:'inner-shadow',offsetX:0,offsetY:1,blur:1,spread:0,color:{color:'#FFFFFF',opacity:theme==='light'?.7:.2}}];
 const shadowKey=s=>[s.style,s.offsetX||0,s.offsetY||0,s.blur||0,s.spread||0,s.color?.color?.toLowerCase(),s.color?.opacity??1];
 if(JSON.stringify(shape.shadows.map(shadowKey))!==JSON.stringify(shadows.map(shadowKey)))shape.shadows=shadows;
};
S.svg=(name,size,color)=>{
 const source=INPUT.icons[name];if(!source)throw new Error(`Missing icon asset: ${name}`);
 return source.replace(/<\?xml[^>]*>/g,'').replace(/<svg([^>]*)>/,(_,attributes)=>`<svg${attributes.replace(/\s(?:width|height)=["'][^"']*["']/g,'')} width="${size}" height="${size}" color="${color}"${/\bfill\s*=/.test(attributes)?'':` fill="${color}"`}>`).replaceAll('currentColor',color).replace(/#000000\b|#000\b|\bblack\b/g,color).replace(/<title>.*?<\/title>/g,'');
};
S.tintIcon=(shape,color,theme,name)=>{
 const hex=S.palette(color,theme),token=S.tokenColor(color,theme),source=INPUT.iconPaths?.[name];
 if(!source)throw new Error('Missing SVG path metadata for '+name);
 const nodes=penpotUtils.findShapes(s=>['path','ellipse','rectangle'].includes(s.type)&&s.name!=='base-background',shape);
 if(nodes.length!==source.paths.length)throw new Error('SVG path count mismatch for '+name+': '+nodes.length+' vs '+source.paths.length);
 for(let i=0;i<nodes.length;i++){
  const item=nodes[i],style=source.paths[i];
  // Empty native fills inherit an imported SVG's fill attribute. An explicit
  // transparent paint preserves the source's fill="none" on open outlines.
  item.fills=[{fillColor:hex,fillOpacity:style.fill?style.fillOpacity:0}];
  if(style.fill&&token)item.applyToken(token,['fill']);
  item.strokes=style.stroke?[{strokeColor:hex,strokeOpacity:style.strokeOpacity,strokeStyle:'solid',strokeWidth:style.strokeWidth*shape.width/source.viewBox[2],strokeAlignment:'center',...(style.linecap==='round'?{strokeCapStart:'round',strokeCapEnd:'round'}:{})}]:[];
  if(style.stroke&&token)item.applyToken(token,['strokeColor']);
 }
};
S.link=(shape,spec,rootId)=>{if(spec.target&&rootId)S.pendingLinks.push({shapeId:shape.id,target:spec.target,source:rootId});};
S.sameName=(a,b)=>String(a).split('/').map(s=>s.trim()).join('/')===String(b).split('/').map(s=>s.trim()).join('/');
S.layerName=n=>n.kind==='instance'&&(n.overrides?.Title?.text||n.overrides?.Label?.text)?`${n.component} · ${n.overrides.Title?.text||n.overrides.Label.text}`:n.name||'Hidden text';
S.childPairs=(shape,children)=>{
 const unused=[...(shape.children||[])],pairs=[];
 for(const spec of children||[]){let index=unused.findIndex(s=>S.sameName(s.name,S.layerName(spec)));if(index<0)index=unused.findIndex(s=>S.sameName(s.name,spec.name));if(index<0&&spec.kind==='icon')index=unused.findIndex(s=>{const c=s.component();return c&&S.sameName(c.path,'Penny/Icon');});if(index>=0)pairs.push({shape:unused.splice(index,1)[0],spec});}
 return pairs;
};
S.instanceSpec=(key,w,h,overrides={},definitions=INPUT.components)=>{
 const definition=definitions[key]||INPUT.components[key];if(!definition)throw new Error('Missing component definition '+key);
 const spec=JSON.parse(JSON.stringify(definition)),sx=w/spec.w,sy=h/spec.h;
 const visit=(n,root=false)=>{Object.assign(n,overrides[n.name]||{});if(!root){n.x*=sx;n.y*=sy;}n.w*=sx;n.h*=sy;if(n.layout?.padding)n.layout.padding*=sx;if(n.layout?.gap)n.layout.gap*=sx;for(const child of n.children||[])visit(child);};
 visit(spec,true);return spec;
};
S.applyTree=(shape,spec,theme,overrides={},rootId)=>{
 const n={...spec,...(overrides[spec.name]||{})};
 if(n.kind==='instance'){shape.name=S.layerName(n);S.applyTree(shape,S.instanceSpec(n.component,n.w,n.h,n.overrides||{}),theme,{},rootId);S.link(shape,n,rootId);return;}
 if(n.kind==='text')S.text(shape,n,theme);
 else if(n.kind==='icon'){
  const component=S.components[`Icon/${n.icon}`];
  const currentComponent=shape.component();
  if(component&&currentComponent&&currentComponent.id!==component.id){const x=shape.x,y=shape.y;shape.swapComponent(component);shape.resize(n.w,n.h);shape.x=x;shape.y=y;}
  shape.name=S.layerName(n);
  S.tintIcon(shape,n.color,theme,n.icon);
 } else if(n.kind==='board'||n.kind==='rect'){
  S.fill(shape,n.fill,theme);S.radius(shape,n.radius);
  if(n.stroke){S.fill(shape,n.stroke,theme,'strokeColor');shape.strokes=shape.strokes.map(s=>({...s,strokeWidth:n.strokeWidth||1}));}
  if(n.layout&&shape.flex){shape.flex.horizontalPadding=n.layout.padding||0;shape.flex.rowGap=n.layout.gap||0;shape.flex.columnGap=n.layout.gap||0;}
  S.material(shape,n,theme);
 }
 S.link(shape,n,rootId);
 for(const {shape:match,spec:child} of S.childPairs(shape,n.children)){match.resize(child.w,child.h);match.x=shape.x+child.x;match.y=shape.y+child.y;S.applyTree(match,child,theme,overrides,rootId);}
};
S.repairIcons=(shape,n,theme)=>{
 if(n.kind==='instance'){S.repairIcons(shape,S.instanceSpec(n.component,n.w,n.h,n.overrides||{}),theme);return;}
 if(n.kind==='icon'){const actual=shape.component(),expected=S.components['Icon/'+n.icon];if(actual?.id!==expected?.id||!S.sameName(shape.name,S.layerName(n)))S.applyTree(shape,n,theme);return;}
 for(const child of S.childPairs(shape,n.children))S.repairIcons(child.shape,child.spec,theme);
};
S.collectLinks=(shape,n,rootId)=>{
 S.link(shape,n,rootId);
 if(n.kind==='instance'){S.collectLinks(shape,S.instanceSpec(n.component,n.w,n.h,n.overrides||{}),rootId);return;}
 for(const child of S.childPairs(shape,n.children))S.collectLinks(child.shape,child.spec,rootId);
};
S.make=(n,parent,theme='light',rootId)=>{
 let shape;
 if(n.kind==='instance'){
  const asset=S.components[n.component];if(!asset)throw new Error(`Missing component ${n.component}`);
  shape=asset.instance();shape.name=S.layerName(n);parent.appendChild(shape);shape.resize(n.w,n.h);shape.x=parent.x+n.x;shape.y=parent.y+n.y;
  S.applyTree(shape,S.instanceSpec(n.component,n.w,n.h,n.overrides||{}),theme,{},rootId);S.link(shape,n,rootId);
 } else if(n.kind==='icon'){
  const asset=S.components[`Icon/${n.icon}`];
  shape=asset?asset.instance():penpot.createShapeFromSvg(S.svg(n.icon,n.w,S.palette(n.color,theme)));
  if(!shape)throw new Error(`Could not import icon ${n.icon}`);
  parent.appendChild(shape);shape.resize(n.w,n.h);shape.x=parent.x+n.x;shape.y=parent.y+n.y;shape.name=n.name;S.tintIcon(shape,n.color,theme,n.icon);S.link(shape,n,rootId);
 } else {
  shape=n.kind==='text'?penpot.createText(n.text||'\u200B'):n.kind==='rect'?penpot.createRectangle():penpot.createBoard();
  if(!shape)throw new Error(`Could not create ${n.name}`);
  parent.appendChild(shape);shape.name=n.name||'Hidden text';shape.resize(n.w,n.h);shape.x=parent.x+n.x;shape.y=parent.y+n.y;
  if(n.kind==='text')S.text(shape,n,theme);
  else{S.fill(shape,n.fill,theme);S.radius(shape,n.radius);if(n.stroke){S.fill(shape,n.stroke,theme,'strokeColor');shape.strokes=shape.strokes.map(stroke=>({...stroke,strokeWidth:n.strokeWidth||1}));}}
  if(n.kind!=='text')S.material(shape,n,theme);
  if(n.opacity!==undefined)shape.opacity=n.opacity;
  if(n.fixed)shape.fixedWhenScrolling=true;
  if(n.kind==='board'){
   shape.clipContent=false;
   shape.showInViewMode=!!n.id;
   for(const child of n.children||[])S.make(child,shape,theme,rootId);
   if(n.layout){
    const flex=penpotUtils.addFlexLayout(shape,n.layout.dir||'row');flex.horizontalSizing='fix';flex.verticalSizing='fix';flex.alignItems=n.layout.alignItems||'start';flex.justifyContent=n.layout.justifyContent||'start';flex.horizontalPadding=n.layout.padding||0;flex.verticalPadding=0;flex.rowGap=n.layout.gap||0;flex.columnGap=n.layout.gap||0;
   }
  }
  S.link(shape,n,rootId);
 }
 S.ids.push(shape.id);return shape;
};
// Keep board IDs and incoming prototype links while updating generated layouts.
S.needsRevision=n=>n.kind==='instance'?JSON.stringify(S.previousComponents?.[n.component])!==JSON.stringify(INPUT.components[n.component]):(n.children||[]).some(S.needsRevision);
S.reconcile=(shape,before,after,theme='light',rootId,root=false)=>{
 if(JSON.stringify(before)===JSON.stringify(after)&&!S.needsRevision(after))return;
 if(!root){const x=shape.parent.x+after.x,y=shape.parent.y+after.y;if(Math.abs(shape.x-x)>.01)shape.x=x;if(Math.abs(shape.y-y)>.01)shape.y=y;}
 if(Math.abs(shape.width-after.w)>.01||Math.abs(shape.height-after.h)>.01)shape.resize(after.w,after.h);
 const name=S.layerName(after);if(!S.sameName(shape.name,name))shape.name=name;
 if(after.kind==='instance'){
  S.reconcile(shape,S.instanceSpec(before.component,before.w,before.h,before.overrides||{},S.previousComponents||INPUT.components),S.instanceSpec(after.component,after.w,after.h,after.overrides||{}),theme,rootId,true);
  shape.name=name;return;
 }
 if(after.kind==='text'){if(JSON.stringify(before)!==JSON.stringify(after))S.text(shape,after,theme);return;}
 if(after.kind==='icon'){S.repairIcons(shape,after,theme);return;}
 if(before.fill!==after.fill){const fills=shape.fills;if(after.fill?(!Array.isArray(fills)||fills[0]?.fillColor?.toLowerCase()!==String(S.palette(after.fill,theme)).toLowerCase()):fills.length)S.fill(shape,after.fill,theme);}
 if(before.radius!==after.radius)S.radius(shape,after.radius);
 if(after.material)S.material(shape,after,theme);
 else if(before.material){shape.backgroundBlur=undefined;shape.shadows=[];}
 const pairs=S.childPairs(shape,before.children),used=new Set();
 for(const next of after.children||[]){
  let pair=pairs.find(p=>!used.has(p.shape.id)&&S.sameName(S.layerName(p.spec),S.layerName(next))&&p.spec.kind===next.kind&&(next.kind!=='instance'||p.spec.component===next.component));
  if(pair){used.add(pair.shape.id);S.reconcile(pair.shape,pair.spec,next,theme,rootId);}
  else{const existing=(shape.children||[]).find(s=>!used.has(s.id)&&!pairs.some(p=>p.shape.id===s.id)&&S.sameName(s.name,S.layerName(next)));if(existing){used.add(existing.id);S.reconcile(existing,next,next,theme,rootId);}else S.make(next,shape,theme,rootId);}
 }
 for(const pair of pairs)if(!used.has(pair.shape.id))pair.shape.remove();
};
storage.pennyRedesign=S;
return {fileId:S.fileId,fileName:penpot.currentFile.name,font:{name:S.font.name,variants:S.font.variants.map(v=>({weight:v.fontWeight,style:v.fontStyle}))},installed:true};
