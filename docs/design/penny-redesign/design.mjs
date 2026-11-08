// Proposal data only. Nothing in this folder is imported by the Penny app.
export const palettes = {
  light: { bg:'#F7F6F2', paper:'#FFFFFF', ink:'#223C32', muted:'#627369', line:'#DCE3DC', accent:'#B74F32', onAccent:'#FFFFFF', mint:'#EDF3EC', pale:'#F0F1EB', green:'#28664F', blue:'#356986', orange:'#F9ECE4', danger:'#AE3939', dangerBg:'#FCECEC', amber:'#79531E', amberBg:'#FFF2D8', hero:'#244B3B', onHero:'#FFFFFF', heroMuted:'#CFDED2', overlay:'#26372F' },
  dark: { bg:'#171E1A', paper:'#222D26', ink:'#F1F5EE', muted:'#AFBFB1', line:'#435348', accent:'#F09B75', onAccent:'#2D1B12', mint:'#2C4033', pale:'#2B352D', green:'#A3D8B2', blue:'#A4CAE5', orange:'#49352A', danger:'#FFAEA6', dangerBg:'#492A2C', amber:'#F4CB82', amberBg:'#3E3423', hero:'#2A4736', onHero:'#F1F5EE', heroMuted:'#C8DBCC', overlay:'#000000' },
  amoled: { bg:'#000000', paper:'#101410', ink:'#F4F8F1', muted:'#AFBBAE', line:'#303A30', accent:'#F7A07A', onAccent:'#28170F', mint:'#172B1D', pale:'#161E17', green:'#A2DCB4', blue:'#A6CEEF', orange:'#302016', danger:'#FFAEA6', dangerBg:'#321719', amber:'#F4CB82', amberBg:'#2D2417', hero:'#14271B', onHero:'#F4F8F1', heroMuted:'#C4D8C6', overlay:'#000000' },
  catppuccin: { bg:'#1E1E2E', paper:'#272739', ink:'#CDD6F4', muted:'#BAC2DE', line:'#45475A', accent:'#CBA6F7', onAccent:'#1E1E2E', mint:'#303A39', pale:'#313244', green:'#A6E3A1', blue:'#89B4FA', orange:'#3D324D', danger:'#F38BA8', dangerBg:'#432B3A', amber:'#F9E2AF', amberBg:'#403A32', hero:'#303044', onHero:'#CDD6F4', heroMuted:'#BAC2DE', overlay:'#11111B' },
};
export const typeScale = { display:[40,48,600], title:[30,36,600], heading:[20,26,600], body:[15,21,400], label:[13,18,600], caption:[12,17,400] };
export const spacing = [4,8,12,16,20,24,32,40,48];
export const components = {};
export const screens = [];
export const boards = [];
const clone = value => structuredClone(value);
export function box(name,x,y,w,h,fill='paper',children=[],radius=0,extras={}) { return {kind:'board',name,x,y,w,h,fill,children,radius,...extras}; }
export function rect(name,x,y,w,h,fill='line',radius=0,extras={}) { return {kind:'rect',name,x,y,w,h,fill,radius,...extras}; }
export function txt(text,x,y,size=15,weight=400,color='ink',w=342,extras={}) { return {kind:'text',name:extras.name||text.slice(0,60),text,x,y,w,h:Math.ceil(size*1.4),size,weight,color,lineHeight:1.35,...extras}; }
export function icon(name,x,y,size=22,color='ink',extras={}) { return {kind:'icon',name:`Icon/${name}`,icon:name,x,y,w:size,h:size,color,...extras}; }
export function line(x,y,w) { return rect('Divider',x,y,w,1,'line'); }
export function instance(component,x,y,w,h,overrides={},extras={}) { return {kind:'instance',name:component,component,x,y,w,h,overrides,...extras}; }
export function resolved(node) {
  if(node.kind!=='instance') return clone(node);
  const definition=clone(components[node.component]);
  if(!definition) throw new Error(`Missing component ${node.component}`);
  const walk=n=>{Object.assign(n,node.overrides[n.name]||{});for(const child of n.children||[])walk(child);};
  walk(definition);
  const scaleX=node.w/definition.w,scaleY=node.h/definition.h;
  const scale=n=>{n.x*=scaleX;n.y*=scaleY;n.w*=scaleX;n.h*=scaleY;for(const c of n.children||[])scale(c);};
  for(const c of definition.children)scale(c);
  return {...definition,...node,kind:'board',fill:node.fill||definition.fill,children:definition.children};
}
const label=(text,x,y,w=342,color='muted')=>txt(text,x,y,12,500,color,w);
const title=(text,x,y,w=342)=>txt(text,x,y,20,600,'ink',w,{lineHeight:1.3});
const copy=(text,x,y,w=342,color='muted')=>txt(text,x,y,15,400,color,w,{lineHeight:1.45});
const go=(node,target)=>({...node,target});

for(const variant of ['Primary','Secondary','Quiet','Danger','Disabled','Saving']) {
  const primary=['Primary','Saving'].includes(variant), disabled=variant==='Disabled';
  components[`Button/${variant}`]=box(`Button/${variant}`,0,0,342,52,primary?'accent':variant==='Danger'?'dangerBg':disabled?'line':variant==='Quiet'?'bg':'paper',[
    txt(variant==='Saving'?'Saving…':'Continue',16,15,15,600,primary?'onAccent':variant==='Danger'?'danger':disabled?'muted':'ink',310,{name:'Label',align:'center'}),
  ],26,{role:'button',...(!disabled&&variant!=='Quiet'?{material:primary?'glass-tinted':'glass'}:{}),layout:{dir:'row',alignItems:'center',justifyContent:'center',padding:16}});
}
for(const state of ['Default','Focused','Error']) {
  components[`Field/${state}`]=box(`Field/${state}`,0,0,342,state==='Error'?104:80,null,[
    txt('Label',0,0,13,500,'ink',342,{name:'Label'}),
    rect('Input',0,25,342,52,'paper',14,{stroke:state==='Error'?'danger':state==='Focused'?'accent':'line',strokeWidth:state==='Default'?1:2}),
    txt('Your value',16,41,15,400,'ink',310,{name:'Value'}),
    ...(state==='Error'?[txt('Enter a valid value.',0,84,12,400,'danger',342,{name:'Error'})]:[]),
  ]);
}
components['Row/Transaction']=box('Row/Transaction',0,0,342,72,null,[
  rect('Icon background',0,14,40,40,'mint',13),icon('basket-outline',9,23,22,'green',{name:'Icon'}),
  txt('Groceries',54,14,15,600,'ink',172,{name:'Title'}),
  txt('Groceries · Main chequing',54,38,12,400,'muted',180,{name:'Subtitle'}),
  txt('−$48.90',232,14,15,600,'ink',110,{name:'Amount',align:'right'}),
  txt('Your share',240,38,11,400,'muted',102,{name:'Footnote',align:'right'}),line(54,71,288),
]);
components['Row/Menu']=box('Row/Menu',0,0,342,64,null,[
  icon('wallet-outline',0,20,23,'green',{name:'Icon'}),txt('Accounts',38,12,15,600,'ink',266,{name:'Title'}),txt('Where you pay from',38,35,12,400,'muted',266,{name:'Subtitle'}),icon('chevron-forward-outline',322,23,18,'muted'),line(38,63,304),
]);
components['Search']=box('Search',0,0,342,48,'paper',[
  icon('search-outline',14,14,20,'muted'),txt('Search entries',44,14,15,400,'muted',282,{name:'Placeholder'}),
],24,{material:'glass'});
for(const selected of [false,true])components[`Category/${selected?'Selected':'Default'}`]=box(`Category/${selected?'Selected':'Default'}`,0,0,78,60,selected?'mint':'paper',[
  icon('basket-outline',29,8,20,selected?'green':'muted',{name:'Icon'}),
  txt('Groceries',6,36,12,selected?600:500,selected?'green':'ink',66,{name:'Label',align:'center'}),
],20,{stroke:selected?'green':'line',material:selected?'glass-selected':'glass'});
for(const [name,fill,color] of [['Scheduled','pale','muted'],['Shared','mint','green'],['Pending','amberBg','amber'],['Paid','mint','green']]) {
  components[`Badge/${name}`]=box(`Badge/${name}`,0,0,86,26,fill,[txt(name,6,5,11,600,color,74,{name:'Label',align:'center'})],8);
}
const destinations=[['Home','home-outline','home'],['Activity','list-outline','activity'],['Shared','people-outline','shared'],['Trips','airplane-outline','trips'],['More','ellipsis-horizontal','more']];
for(const [selected] of destinations) {
  const children=[];
  destinations.forEach(([name,glyph,target],i)=>{
    const active=name===selected;
    children.push(go(box(`Tab/${name}`,i*71.6,4,71.6,56,null,[...(active?[rect('Selected',5.8,2,60,48,'mint',24,{material:'glass-selected'})]:[]),icon(glyph,24.8,8,22,active?'green':'muted'),txt(name,2,36,11,active?600:400,active?'green':'muted',67.6,{align:'center'})]),target));
  });
  components[`Navigation/${selected}`]=box(`Navigation/${selected}`,0,0,358,64,'paper',children,32,{material:'glass'});
}
components['Banner/Offline']=box('Banner/Offline',0,0,342,74,'amberBg',[
  icon('cloud-offline-outline',14,15,22,'amber'),txt('Saved on this device',48,12,13,600,'amber',278,{name:'Title'}),txt('Waiting to sync. Your entries are safe.',48,35,12,400,'amber',278,{name:'Subtitle'}),
],14);
components['Banner/Error']=box('Banner/Error',0,0,342,74,'dangerBg',[
  icon('alert-circle-outline',14,15,22,'danger'),txt('Couldn’t save your changes',48,12,13,600,'danger',278,{name:'Title'}),txt('Your draft is still here. Try again.',48,35,12,400,'danger',278,{name:'Subtitle'}),
],14);
components['Toast/Saved']=box('Toast/Saved',0,0,342,52,'hero',[
  icon('checkmark-circle-outline',16,15,22,'onHero'),txt('Expense added',50,16,14,600,'onHero',276,{name:'Label'}),
],14);

export function button(text,y,target,variant='Primary',x=24,w=342) { return go(instance(`Button/${variant}`,x,y,w,52,{Label:{text}}),target); }
export function field(text,value,y,options={}) {
  return instance(`Field/${options.state||'Default'}`,24,y,342,options.state==='Error'?104:80,{Label:{text},Value:{text:value,color:options.placeholder?'muted':'ink'},Error:{text:options.error||'Enter a valid value.'}});
}
export function menu(text,sub,glyph,y,target,x=24,w=342) { return go(instance('Row/Menu',x,y,w,64,{Title:{text,...(sub===''?{y:22}:{})},Subtitle:{text:sub},Icon:{icon:glyph}}),target); }
export function tx(text,sub,amount,glyph,y,target='entry-detail',options={}) {
  return go(instance('Row/Transaction',options.x??24,y,options.w??342,72,{Title:{text},Subtitle:{text:sub},Amount:{text:amount,color:options.color||'ink'},Footnote:{text:options.footnote??'Your share'},Icon:{icon:glyph,color:options.color||'green'},'Icon background':{fill:options.tint||'mint'}}),target);
}
export function badge(name,x,y,text=name) { return instance(`Badge/${name}`,x,y,86,26,{Label:{text}}); }
export function categoryButton(text,glyph,x,y,w,selected=false,target){return go(instance(`Category/${selected?'Selected':'Default'}`,x,y,w,60,{Icon:{icon:glyph},Label:{text}}),target);}
export function quickCategories(y,kind='Expense',target='add-expense'){
 const options=kind==='Income'?[['Salary','cash-outline'],['Gift','wallet-outline'],['Other','list-outline']]:kind==='Investment'?[['Investments','trending-up-outline'],['Savings','wallet-outline'],['Other','list-outline']]:[['Groceries','basket-outline'],['Food & drinks','cafe-outline'],['Home','home-outline']];
 return box('Quick category selection',24,y,342,108,null,[
  txt('Category',0,14,13,500,'ink',180),go(box('All categories',208,0,134,48,null,[txt('All categories',0,15,12,600,'accent',110,{align:'right'}),icon('chevron-forward-outline',116,17,14,'accent')]),'category-picker'),
  ...options.map(([text,glyph],i)=>categoryButton(text,glyph,i*117,48,108,i===0,target)),
 ]);
}
function quickCategoryFilters(y,selected='All'){
 return box('Quick category filters',24,y,342,60,null,[
  ...[['All','list-outline','activity'],['Groceries','basket-outline','activity-expenses'],['Food','cafe-outline','activity-expenses'],['Filters','options-outline','filters']].map(([text,glyph,target],i)=>categoryButton(text,glyph,i*88,0,78,text===selected,target)),
 ]);
}
function status() { return box('System status',0,0,390,44,null,[txt('9:41',24,12,14,600,'ink',80),icon('wifi-outline',309,13,17,'ink'),icon('battery-full-outline',337,11,26,'ink')]); }
function brand() { return box('App bar',24,48,342,44,null,[rect('Brand tile',0,4,32,32,'accent',11),icon('leaf-outline',7,11,18,'onAccent'),txt('penny.',42,4,27,600,'ink',178,{letterSpacing:-1}),go(box('Settings control',298,0,44,44,'paper',[icon('settings-outline',11,11,22)],22,{material:'glass'}),'settings')]); }
function header(text,back='home',action='close') { return box('Navigation header',24,48,342,52,null,[go(box('Back',-8,0,44,44,'paper',[icon(back==='close'?'close-outline':'chevron-back-outline',11,11,22)],22,{material:'glass'}),back==='close'?'home':back),txt(text,50,8,20,600,'ink',action==='menu'?246:292),...(action==='menu'?[go(box('Menu control',298,0,44,44,'paper',[icon('ellipsis-horizontal',11,11,22)],22,{material:'glass'}),'people')]:[])]); }
function primaryAdd(target='add-expense') { return go(box('Add entry',238,700,128,48,'accent',[icon('add-outline',15,14,20,'onAccent'),txt('Add entry',42,14,14,600,'onAccent',79)],24,{material:'glass-tinted'}),target); }
function month(y=158,value='November 2026') { return box('Period selector',24,y,342,40,null,[go(icon('chevron-back-outline',0,10,20,'ink'),'calendar'),go(txt(value,34,8,15,600,'ink',238,{align:'center'}),'calendar'),go(icon('chevron-forward-outline',322,10,20,'ink'),'calendar')]); }
function segments(items,selected,y,targetMap={},x=24,w=342) {
  const itemWidth=w/items.length;
  return box('Segmented control',x,y,w,44,'paper',items.map((text,i)=>go(box(`Segment/${text}`,i*itemWidth+3,3,itemWidth-6,38,text===selected?'paper':null,[txt(text,2,10,13,text===selected?600:400,text===selected?'ink':'muted',itemWidth-10,{align:'center'})],19,{...(text===selected?{material:'glass-selected'}:{})}),targetMap[text])),22,{material:'glass'});
}
function section(text,y,target,action='See all') { return box(text,24,y,342,28,null,[title(text,0,0,250),...(target?[go(txt(action,250,4,12,600,'accent',92,{align:'right'}),target)]:[])]); }
function info(text,y,kind='mint',glyph='checkmark-circle-outline',color='green',h=74) { return box('Context',24,y,342,h,kind,[icon(glyph,16,18,21,color),txt(text,48,14,13,400,color,278,{lineHeight:1.45})],16); }
function bottomSave(text,target='home',hint) { return box('Sticky action',0,704,390,140,null,[...(hint?[txt(hint,24,8,12,400,'muted',342,{align:'center'})]:[]),button(text,42,target),rect('Home indicator',127,126,136,4,'ink',2)],0,{fixed:true}); }
function screen(id,name,children,options={}) {
  const result=box(name,0,0,options.w||390,options.h||844,'bg',[
    ...(options.w?[]:[status(),...(options.noHeader?[]:[options.root?brand():header(options.title||name,options.back||'home',options.action)])]),
    ...children,
    ...(options.root?[primaryAdd(options.add),instance(`Navigation/${options.nav||'Home'}`,16,760,358,64),rect('Home indicator',127,834,136,4,'ink',2)]:[]),
  ],0,{id,category:options.category||'Daily money',theme:options.theme||'light',platform:options.platform||'iOS',note:options.note||'',...options});
  screens.push(result);return result;
}

// Daily money: recorded amounts and projections remain explicitly separate.
screen('home','01 · Home',[
  txt('A little more clarity.',24,108,13,400,'muted'),txt('Your month, in view.',24,132,28,600,'ink'),month(174),
  box('Monthly summary',24,222,342,182,'hero',[
    txt('Recorded cash remaining',20,18,13,500,'heroMuted',284),txt('$1,116.65',20,44,40,600,'onHero',302,{letterSpacing:-1.3}),
    line(20,105,302),txt('Projected remaining',20,122,12,400,'heroMuted',178),txt('$3,366.65',204,119,18,600,'onHero',118,{align:'right'}),
    txt('Includes $2,250 in expected income',20,147,11,400,'heroMuted',302),
  ],22),
  box('Recorded monthly totals',24,420,342,72,null,[
    box('Income',0,0,110,72,null,[label('Income',0,0,106),txt('$3,200.00',0,25,18,600,'green',110)]),
    box('Spent',120,0,110,72,null,[label('Spent · your share',0,0,110),txt('$1,883.35',0,25,18,600,'ink',110)]),
    box('Invested',240,0,102,72,null,[label('Invested',0,0,102),txt('$200.00',0,25,18,600,'blue',102)]),
  ]),
  go(box('Insights shortcut',24,496,342,48,'mint',[icon('pie-chart-outline',15,14,20,'green'),txt('Explore your month',47,14,14,600,'green',250),icon('chevron-forward-outline',310,16,16,'green')],14),'insights'),
  section('Recent activity',566,'activity'),tx('Groceries','Nov 7 · Main chequing','−$48.90','basket-outline',600),
],{root:true,note:'Home separates recorded remaining from projected remaining. Income and spending figures are not an account balance. Calendar and money-flow tools move into Explore your month.'});

screen('activity','02 · Activity',[
  txt('Activity',24,112,30,600),month(155),go(instance('Search',24,207,286,48),'search-empty'),go(box('Filter',318,207,48,48,'paper',[icon('options-outline',13,13,22)],14,{stroke:'line'}),'filters'),
  segments(['All','Expenses','Income','Invested'],'All',271,{Expenses:'activity-expenses'}),
  quickCategoryFilters(327),label('Recorded entries · Your share · CAD',24,405),label('TODAY · NOV 7',24,441),
  tx('Groceries','Groceries · Main chequing','−$48.90','basket-outline',463),tx('Coffee with Mira','Food & drinks · Visa','−$6.40','cafe-outline',535),
  label('YESTERDAY · NOV 6',24,624),tx('Investment transfer','Investments · Main chequing','−$200.00','trending-up-outline',646,'entry-detail',{color:'blue',footnote:'Contribution'}),
],{root:true,nav:'Activity',note:'Keep category filtering directly on the list: All, frequent categories and Filters. Filters exposes the complete category list. Category buttons filter in place during implementation; this storyboard uses a representative filtered result. Filters never change the period totals.'});
screen('activity-expenses','03 · Activity / expenses',[
  txt('Activity',24,112,30,600),month(155),instance('Search',24,207,286,48),go(box('Filter',318,207,48,48,'mint',[icon('options-outline',13,13,22,'green')],14),'filters'),
  segments(['All','Expenses','Income','Invested'],'Expenses',271,{All:'activity'}),quickCategoryFilters(327,'Groceries'),label('Groceries · 2 entries · $158.77',24,409),
  tx('Groceries','Nov 7 · Main chequing','−$48.90','basket-outline',451),tx('Weekly shop','Nov 4 · Shared: Maple home','−$109.87','basket-outline',523,'shared-expense',{footnote:'Your share'}),
  info('Category, search, and type filters work together. Tap All to clear the category filter.',623,'mint','options-outline','green',104),
],{root:true,nav:'Activity'});
screen('filters','04 · Activity filters',[
  title('Show the entries you need.',24,122),segments(['Month','Year'],'Month',172),field('Period','November 2026',242),
  menu('Category','All categories','pricetag-outline',346,'category-picker'),menu('Account','All accounts','wallet-outline',410,'account-picker'),
  info('Period totals always include all recorded entries. Filters only change the list.',510,'mint','list-outline','green',96),
  button('Reset filters',635,'activity','Quiet'),bottomSave('Apply filters','activity-expenses'),
],{back:'activity',title:'Filters'});
screen('calendar','05 · Calendar',[
  month(116),label('YOUR MONTH',24,174),box('November calendar',24,208,342,310,'paper',[
    ...['M','T','W','T','F','S','S'].map((d,i)=>txt(d,15+i*47,18,11,500,'muted',30,{align:'center'})),
    ...Array.from({length:30},(_,i)=>{const p=i+6,x=14+(p%7)*47,y=52+Math.floor(p/7)*41;return box(`Day ${i+1}`,x,y,32,34,i===6?'accent':null,[txt(String(i+1),0,7,13,i===6?600:400,i===6?'onAccent':'ink',32,{align:'center'}),...([0,3,6,14,29].includes(i)?[rect('Entry indicator',14,28,4,4,i===6?'onAccent':'green',2)]:[])],10,{target:i===6?'activity':'calendar'});}),
  ],20),
  section('Saturday, Nov 7',542,'activity','View entries'),tx('Groceries','Main chequing','−$48.90','basket-outline',583),
  info('Scheduled entries use an outline indicator and stay outside recorded spending totals.',682,'pale','repeat-outline','muted',88),
],{title:'Calendar',back:'home',note:'Calendar selection filters the entry list. Scheduled previews have a named state and never look like recorded entries.'});

function spendingRows(x,y,w=302,step=58){
  return [['Home','$1,450.00',1450/1883.35,'#A77B38'],['Groceries','$158.77',158.77/1883.35,'#467C58'],['Transport','$156.00',156/1883.35,'#517C99'],['Food & drinks','$80.60',80.60/1883.35,'#B74F32']].flatMap(([name,amount,p,color],i)=>[txt(name,x,y+i*step,13,500,'ink',w-100),txt(amount,x+w-105,y+i*step,13,600,'ink',105,{align:'right'}),rect('Category track',x,y+27+i*step,w,5,'pale',3),rect(`Category bar/${name}`,x,y+27+i*step,Math.max(p*w,12),5,color,3)]);
}
screen('insights','06 · Month insights',[
  month(116),box('Spending breakdown',24,171,342,336,'paper',[label('SPENT · YOUR SHARE',20,18,302),txt('$1,883.35',20,44,32,600,'ink',302),...spendingRows(20,101,302,48),txt('Shopping & other · $37.98',20,298,12,400,'muted',302)],20),
  go(box('Money flow',24,523,342,70,'mint',[icon('trending-up-outline',16,22,24,'green'),txt('Follow your money',53,14,16,600,'green',250),txt('Income → spending, invested, remaining',53,39,12,400,'green',266),icon('chevron-forward-outline',311,28,16,'green')],16),'money-flow'),
  go(menu('Calendar','Recorded and scheduled entries','calendar-outline',610,'calendar'),'calendar'),
  copy('Spending uses your personal share. Investment contributions are shown separately.',24,706),
],{title:'Explore your month',back:'home'});
screen('money-flow','07 · Money flow',[
  month(116),title('Where November goes',24,182),copy('Based on your share of recorded entries.',24,219),
  box('Editable money flow',24,279,342,292,'paper',[
    label('RECORDED INCOME',20,20,180),txt('$3,200.00',20,48,26,600,'green',250),
    rect('Income total',20,99,302,20,'green',8),
    rect('Spent share',20,138,1883.35/3200*302,18,'accent',6),rect('Invested share',20+1883.35/3200*302,138,200/3200*302,18,'blue',5),rect('Remaining share',20+(1883.35+200)/3200*302,138,1116.65/3200*302,18,'green',6),
    txt('Spent',20,180,13,500,'ink',170),txt('$1,883.35',194,180,14,600,'ink',128,{align:'right'}),
    txt('Invested',20,211,13,500,'blue',170),txt('$200.00',194,211,14,600,'blue',128,{align:'right'}),
    txt('Remaining',20,242,13,500,'green',170),txt('$1,116.65',194,242,14,600,'green',128,{align:'right'}),
  ],20),
  info('Expected income: $2,250.00. Including it gives a projected remaining total of $3,366.65.',595,'mint','time-outline','green',106),
  copy('Remaining is income minus spending and contributions. It is not an account balance.',24,727),
],{title:'Money flow',back:'insights',note:'Replaces the phone-width horizontal Sankey with a readable stacked flow. Segment widths use exact amounts. A future expanded Sankey can remain available on desktop.'});

function entryForm(id,name,kind='Expense',options={}) {
 const income=kind==='Income',investment=kind==='Investment';
 const children=[segments(['Expense','Income','Investment'],kind,117,{Expense:'add-expense',Income:'add-income',Investment:'add-investment'}),
   label(`AMOUNT · CAD`,24,186),txt(options.amount||'48.90',24,208,48,500,'ink',342,{align:'center',letterSpacing:-1.4}),
   field(income?'Where did it come from?':investment?'What are you investing in?':'What was it for?',options.description||(income?'Payday':investment?'Investment transfer':'Groceries'),288),
   quickCategories(378,kind,id),
   menu('Date','Today · Nov 7, 2026','calendar-outline',496,'date-picker'),
   menu('Account','Main chequing','wallet-outline',560,'account-picker'),
   menu('More details',income||investment?'Repeat · Note':'Split · Receipt · Repeat · Trip · Note','options-outline',624,'entry-extras'),
   bottomSave(options.edit?'Save changes':`Add ${kind.toLowerCase()}`,options.edit?'entry-detail':'saved',investment?'Contribution only · not portfolio value':income?'Recorded income · CAD':'Your share: $48.90'),
 ];
 return screen(id,name,children,{title:options.edit?'Edit entry':`Add ${kind.toLowerCase()}`,back:'close',category:'Entry flows',note:'Frequent categories are selected inline without a popup or page change. All categories opens the full list only when needed. Chips are static in this storyboard; implementation updates the selection in place and keeps the selected category visible even when it is not frequent. Keyboard scrolls above the save action. Failed saves preserve the draft.'});
}
entryForm('add-expense','08 · Add expense');entryForm('add-income','09 · Add income','Income');entryForm('add-investment','10 · Add investment','Investment');
screen('entry-extras','11 · Entry / more details',[
  menu('Your share','All mine · $48.90','people-outline',124,'split'),menu('Receipt','Add a photo or PDF','receipt-outline',188,'receipt-upload'),
  menu('Repeat','Just once','repeat-outline',252,'repeat-picker'),menu('Trip','None','airplane-outline',316,'trip-picker'),
  field('Note (optional)','Add a little context…',418,{placeholder:true}),info('Only your share counts toward your spending. Receipt uploads require a connection.',541,'mint','people-outline','green',104),
  bottomSave('Done','add-expense'),
],{title:'More details',back:'add-expense',category:'Entry flows'});
screen('split','12 · Personal split',[
  label('RECEIPT TOTAL',24,132),txt('$74.40',24,159,38,600,'ink'),copy('Dinner with friends',24,212),segments(['All mine','Equal','Amount','Percent'],'Equal',264),
  field('Number of people (including you)','3',344),box('Split preview',24,462,342,145,'mint',[label('YOUR SHARE',20,18,302,'green'),txt('$24.80',20,45,34,600,'green',302),txt('$74.40 ÷ 3 people',20,101,13,400,'green',302)],20),
  copy('The original receipt total stays attached. Only $24.80 counts toward your spending.',24,634),bottomSave('Use this split','add-expense'),
],{title:'Your share',back:'entry-extras',category:'Entry flows'});
screen('entry-detail','13 · Entry details',[
  box('Entry identity',24,127,342,157,null,[rect('Category icon',141,0,60,60,'mint',20),icon('basket-outline',157,16,28,'green'),txt('Groceries',0,76,22,600,'ink',342,{align:'center'}),txt('−$48.90',0,109,34,600,'ink',342,{align:'center'})]),
  box('Entry properties',24,323,342,243,'paper',[
    ...[['Date','Nov 7, 2026'],['Category','Groceries'],['Account','Main chequing'],['Your share','All mine · $48.90']].flatMap(([a,b],i)=>[txt(a,20,19+i*56,13,400,'muted',110),txt(b,132,19+i*56,13,500,'ink',190,{align:'right'}),...(i<3?[line(20,54+i*56,302)]:[])]),
  ],20),button('Edit entry',599,'edit-entry'),button('Delete entry',667,'delete-entry','Quiet'),
],{title:'Entry details',back:'activity',category:'Entry flows'});
entryForm('edit-entry','14 · Edit entry','Expense',{edit:true});
screen('category-picker','15 · Choose category',[
  instance('Search',24,122,342,48,{Placeholder:{text:'Search categories'}}),segments(['Expense','Income','Investment'],'Expense',188),
  ...[['Groceries','basket-outline'],['Food & drinks','cafe-outline'],['Home','home-outline'],['Transport','bus-outline'],['Shopping','pricetag-outline']].map(([name,glyph],i)=>menu(name,i===0?'Selected':'Expense category',glyph,256+i*64,'add-expense')),
  button('Create category',636,'category-form','Secondary'),
],{title:'Category',back:'add-expense',category:'Entry flows'});
screen('account-picker','16 · Choose account',[
  copy('Choose where this entry was paid from.',24,128),...['Main chequing','Visa','Cash','No account'].map((text,i)=>menu(text,['Bank account · Selected','Credit card','Cash wallet','Keep this entry unassigned'][i],['wallet-outline','card-outline','cash-outline','close-outline'][i],193+i*75,'add-expense')),
  button('Create account',551,'account-form','Secondary'),info('Accounts are labels you manage. Penny does not connect to your bank.',641,'mint','wallet-outline','green',96),
],{title:'Account',back:'add-expense',category:'Entry flows'});

export const helpers={label,title,copy,go,header,brand,month,segments,section,info,bottomSave,screen,spendingRows};
