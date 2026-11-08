import { screens, box, rect, txt, icon, line, instance, button, field, menu, tx, badge, quickCategories, helpers } from './design.mjs';
const {label,title,copy,go,month,segments,section,info,bottomSave,screen}=helpers;

// Pickers and receipts reuse the same navigation and action placement.
screen('date-picker','17 · Choose date',[
  month(122),field('Date','November 7, 2026',198),info('Use the device date picker to choose a day. Entries can be dated before or after trip dates.',328,'mint','calendar-outline','green',112),bottomSave('Use date','add-expense'),
],{title:'Date',back:'add-expense',category:'Entry flows',note:'Use the platform date picker at implementation time. This screen specifies the selected value and save behavior, not a custom OS dialog.'});
screen('repeat-picker','18 · Repeat options',[
  copy('Choose how often to add this entry.',24,127),...['Just once','Weekly','Monthly','Yearly'].map((text,i)=>menu(text,['Selected','Every 7 days','Same date each month','Same date each year'][i],'repeat-outline',188+i*72,'entry-extras')),
  info('Pausing skips dates while paused. Previous entries stay in your history.',526,'mint','repeat-outline','green',104),bottomSave('Use repeat option','entry-extras'),
],{title:'Repeat',back:'entry-extras',category:'Entry flows'});
screen('trip-picker','19 · Choose trip',[
  menu('No trip','Keep this entry in your everyday spending','close-outline',128,'entry-extras'),menu('Montréal weekend','Personal · Oct 17–20, 2026','airplane-outline',207,'entry-extras'),
  info('To add a shared trip expense, open the shared trip. Its members will see their own shares.',315,'mint','people-outline','green',112),button('View trips',470,'trips','Secondary'),
],{title:'Trip',back:'entry-extras',category:'Entry flows'});
screen('receipt-upload','20 · Add receipt',[
  box('Receipt illustration',24,152,342,165,'mint',[icon('receipt-outline',137,25,68,'green'),txt('Keep the little details.',20,115,18,600,'green',302,{align:'center'})],22),
  copy('Attach a photo or PDF to this entry. Files can be up to 10 MB.',24,351),button('Choose photo',439,'receipt'),button('Choose file',507,'receipt','Secondary'),
  info('Receipt uploads need a connection. Your entry draft stays available if upload fails.',611,'pale','cloud-offline-outline','muted',112),
],{title:'Receipt',back:'entry-extras',category:'Entry flows'});
screen('receipt','21 · Receipt preview',[
  label('GROCERY-RECEIPT.PDF · 1 PAGE',24,122),box('Sample receipt',42,170,306,424,'paper',[
    txt('MAPLE MARKET',20,28,19,600,'ink',266,{align:'center'}),txt('November 7, 2026 · 12:42',20,66,12,400,'muted',266,{align:'center'}),line(24,103,258),
    ...[['Produce','$18.40'],['Pantry','$22.50'],['Household','$8.00']].flatMap(([a,b],i)=>[txt(a,24,129+i*44,14,400,'ink',160),txt(b,178,129+i*44,14,500,'ink',104,{align:'right'})]),
    line(24,275,258),txt('TOTAL',24,298,14,600,'ink',150),txt('$48.90',174,292,24,600,'ink',108,{align:'right'}),txt('Thank you for shopping local.',24,358,12,400,'muted',258,{align:'center'}),
  ],8,{stroke:'line'}),copy('Example receipt for the proposal.',24,618,342,'muted'),button('Open or share PDF',689,'receipt','Secondary'),
],{title:'Receipt',back:'entry-extras',category:'Entry flows',note:'The receipt content is clearly fictional. Native PDFs open/share through the system; web uses its paginated PDF viewer. Image receipts use an in-app image viewer.'});

// Shared households: settle recorded payments, never imply that Penny transfers money.
screen('shared','22 · Shared households',[
  txt('Shared',24,112,30,600),copy('Every person. A clearer share.',24,157),
  go(box('Household/Maple home',24,215,342,228,'paper',[
    rect('Household mark',20,20,48,48,'mint',16),icon('home-outline',32,32,24,'green'),txt('Maple home',84,24,19,600,'ink',238),txt('3 members · CAD',84,53,12,400,'muted',238),
    line(20,91,302),label('OCTOBER · STILL OUTSTANDING',20,112,302),txt('You’re owed $120.00',20,140,24,600,'green',302),txt('View expenses and monthly balances',20,184,13,400,'muted',281),icon('chevron-forward-outline',304,184,18,'muted'),
  ],20),'household'),button('Create household',475,'household-create'),button('Join with a code',543,'join-group','Secondary'),
  copy('Shared expenses appear once in your activity, with only your share in personal totals.',24,626),
],{root:true,nav:'Shared',category:'Shared money',add:'shared-expense',note:'Household balances remain separate by month. A previous unpaid month remains visible even after the calendar moves on.'});
screen('household','23 · Household / expenses',[
  txt('Maple home',24,118,29,600),label('3 members · CAD',24,159),month(190,'October 2026'),segments(['Expenses','Balances','People'],'Expenses',246,{Balances:'balances',People:'people'}),
  box('Shared summary',24,312,342,84,'mint',[label('GROUP TOTAL',18,15,147,'green'),txt('$420.00',18,38,24,600,'green',147),label('YOUR SHARE',190,15,134,'green'),txt('$140.00',190,38,24,600,'green',134)],18),
  tx('Groceries','Oct 30 · Paid by you','$120.00','basket-outline',420,'shared-expense-detail',{footnote:'You: $40.00'}),tx('Home supplies','Oct 26 · Paid by you','$140.00','home-outline',492,'shared-expense-detail',{footnote:'You: $46.67'}),tx('Internet','Oct 15 · Paid by Mira','$80.00','wifi-outline',564,'shared-expense-detail',{footnote:'You: $26.67'}),
  button('Add shared expense',690,'shared-expense'),
],{title:'Household',back:'shared',action:'menu',category:'Shared money'});
screen('balances','24 · Monthly balances',[
  txt('Maple home',24,118,29,600),month(168,'October 2026'),segments(['Expenses','Balances','People'],'Balances',226,{Expenses:'household',People:'people'}),
  badge('Pending',24,291,'Overdue'),copy('October is still outstanding.',127,295,239),
  box('Monthly balances',24,343,342,171,'paper',[
    ...[['You','+$120.00','green'],['Mira','−$60.00','ink'],['Alex','−$60.00','ink']].flatMap(([name,amount,color],i)=>[txt(name,20,17+i*51,15,500,'ink',178),txt(amount,188,17+i*51,17,600,color,134,{align:'right'}),...(i<2?[line(20,53+i*51,302)]:[])]),
  ],20),section('To settle',540),go(box('Monthly reimbursement',24,582,342,86,'mint',[txt('Mira pays you',18,15,15,600,'green',185),txt('$60.00',211,15,19,600,'green',113,{align:'right'}),txt('Record payment already made',18,47,12,400,'green',285),icon('chevron-forward-outline',311,48,16,'green')],16),'record-monthly'),
  copy('Each month settles separately. Payments reduce balances and leave spending totals unchanged.',24,700),
],{title:'Household',back:'shared',category:'Shared money',note:'Monthly recording is available from the last calendar day of the month. Current-month early payment is recorded on an individual expense share instead. The second $60 suggestion to Alex remains in the scrollable list.'});
screen('shared-expense','25 · Add shared expense',[
  box('Shared context',24,120,342,42,'mint',[icon('people-outline',14,11,20,'green'),txt('Maple home · 3 people',44,11,14,600,'green',284)],13),label('RECEIPT TOTAL · CAD',24,189),txt('120.00',24,213,45,500,'ink',342,{align:'center'}),
  field('What was it for?','Groceries',297),quickCategories(385,'Expense','shared-expense'),menu('Paid by','You','wallet-outline',501,'shared-payer'),menu('Split','Equally · $40.00 each','people-outline',565,'shared-split'),
  button('Nov 7 · Date',638,'date-picker','Secondary',24,165),button('More details',638,'entry-extras','Secondary',201,165),bottomSave('Add shared expense','household','Your share: $40.00 · Group total: $120.00'),
],{title:'Add shared expense',back:'household',category:'Shared money',note:'Only the payer can attach one of their private accounts. Members see the receipt, payer, total, shares, and history; the payer’s account details stay private.'});
screen('shared-split','26 · Split among members',[
  label('GROUP TOTAL · CAD',24,128),txt('$120.00',24,155,36,600),segments(['Equal','Amounts','Percent'],'Equal',226),
  box('Member allocations',24,300,342,220,'paper',[
    ...[['You','$40.00'],['Mira','$40.00'],['Alex','$40.00']].flatMap(([name,amount],i)=>[rect('Member avatar',20,18+i*66,38,38,'mint',13),txt(name[0],20,28+i*66,14,600,'green',38,{align:'center'}),txt(name,72,28+i*66,15,500,'ink',155),txt(amount,211,28+i*66,16,600,'ink',111,{align:'right'})]),
  ],20),info('All $120.00 is allocated. Your personal spending will include $40.00.',548,'mint','checkmark-circle-outline','green',103),bottomSave('Use this split','shared-expense'),
],{title:'Split expense',back:'shared-expense',category:'Shared money',note:'Amount and percent modes expose one field per eligible member, including zero shares. Show allocated and remaining totals; disable save until allocations equal the receipt.'});
screen('shared-payer','27 · Choose payer',[
  copy('Who paid the original expense?',24,130),...['You','Mira','Alex'].map((name,i)=>menu(name,i===0?'Selected · Private account available':'Personal account stays private','people-outline',196+i*76,'shared-expense')),
  info('If someone else paid, you can still record the group expense. Their private accounts are not shown.',487,'mint','lock-closed-outline','green',120),
],{title:'Paid by',back:'shared-expense',category:'Shared money'});
screen('shared-expense-detail','28 · Shared expense details',[
  badge('Shared',24,123),txt('Groceries',24,177,27,600),txt('$120.00',24,216,38,600),copy('Oct 30 · Paid by you · Maple home',24,273),
  section('Member shares',330),...['You','Mira','Alex'].map((name,i)=>go(box(`Share/${name}`,24,373+i*70,342,64,null,[txt(name,0,12,15,600,'ink',170),txt('$40.00',212,12,16,600,'ink',130,{align:'right'}),txt(i===0?'Payer':'Unpaid',0,36,12,400,'muted',180),...(i>0?[txt('Mark as paid',204,37,12,600,'accent',138,{align:'right'})]:[]),line(0,63,342)]),'record-share')),
  menu('Receipt','Visible to household members','receipt-outline',602,'receipt'),menu('Change history','Who changed what, and when','time-outline',666,'history'),
],{title:'Shared expense',back:'household',category:'Shared money',note:'Paid shares lock the payer, total, allocation, month and deletion. Details that do not affect the settled amount remain editable.'});
for(const [id,name,amount,back,recipient] of [['record-share','29 · Record paid share','$40.00','shared-expense-detail','Mira → You'],['record-monthly','30 · Record monthly payment','$60.00','balances','Mira → You']]) {
  screen(id,name,[
    rect('Payment icon',162,137,66,66,'mint',22),icon('checkmark-circle-outline',180,155,30,'green'),txt('Record a payment',24,237,27,600),copy('Confirm money that has already been sent.',24,282),
    box('Payment summary',24,354,342,140,'paper',[label(id==='record-share'?'GROCERIES · OCTOBER':'MAPLE HOME · OCTOBER',20,18,302),txt(recipient,20,48,18,600,'ink',302),txt(amount,20,81,31,600,'green',302)],20),
    info('This records a payment. Penny does not transfer money or add another spending entry.',525,'mint','checkmark-circle-outline','green',115),bottomSave('Confirm payment recorded',back),
  ],{title:'Record payment',back,category:'Shared money',note:id==='record-share'?'The full eligible share is confirmed. Either the repaying member or original payer may record it. Stale or ineligible payments require reopening the latest expense.':'Once a monthly reimbursement exists, individual payment recording closes for that month to prevent double counting.'});
}
screen('people','31 · People & household settings',[
  txt('Maple home',24,118,28,600),copy('3 active members',24,160),...['You','Mira','Alex'].map((name,i)=>menu(name,i===0?'Creator':'Member','people-outline',211+i*67,'people')),
  button('Invite a member',444,'invite'),menu('Recurring expenses','2 active schedules','repeat-outline',530,'recurring'),menu('Change history','Household activity','time-outline',594,'history'),
  go(txt('Archive household',24,696,14,600,'danger',342),'archive'),
],{title:'People & settings',back:'household',category:'Shared money',note:'Creator-only actions include invitation, rename, remove and archive. Remove or leave is blocked while monthly balances remain outstanding; past expenses stay unchanged.'});
screen('invite','32 · Invite with a code',[
  txt('A little more company.',24,133,27,600),copy('Invite someone with a Penny account to Maple home.',24,180),
  box('Invitation code',24,272,342,167,'mint',[label('INVITATION CODE',20,21,302,'green'),txt('MAPLE7K2',20,58,33,600,'green',302,{align:'center',letterSpacing:3}),txt('Expires in 10 minutes',20,123,13,400,'green',302,{align:'center'})],20),
  button('Copy code',477,'invite'),info('Everyone in a household uses the same currency. New members join future expenses.',581,'pale','people-outline','muted',116),
],{title:'Invite a member',back:'people',category:'Shared money'});
screen('household-create','33 · Create household',[
  copy('A shared home for everyday expenses.',24,127),field('Household name','Maple home',204),
  info('This household will use CAD, your personal ledger currency. Members must use CAD too.',325,'mint','people-outline','green',112),bottomSave('Create household','people'),
],{title:'Create household',back:'shared',category:'Shared money'});
screen('join-group','34 · Join with a code',[
  copy('Ask the creator for a household or trip invitation code.',24,130),field('Invitation code','MAPLE7K2',229),
  info('Codes expire after 10 minutes. If a code has expired, ask the creator for a new one.',351,'mint','key-outline','green',112),bottomSave('Join group','household'),
],{title:'Join with a code',back:'shared',category:'Shared money'});
screen('history','35 · Change history',[
  label('MAPLE HOME · GROCERIES',24,128),...[
    ['Mira’s share recorded as paid','You · Oct 31, 4:20 pm','$40.00 paid to you'],['Expense updated','Alex · Oct 30, 6:12 pm','Note changed: Weekly groceries'],['Expense added','You · Oct 30, 5:48 pm','Total $120.00 · Split equally'],
  ].map(([a,b,c],i)=>box(a,24,183+i*150,342,128,'paper',[txt(a,18,17,15,600,'ink',306),txt(b,18,47,12,400,'muted',306),txt(c,18,81,13,400,'ink',306)],18)),
],{title:'Change history',back:'shared-expense-detail',category:'Shared money'});
screen('archive','36 · Archive household / guard',[
  rect('Archive icon',162,148,66,66,'amberBg',22),icon('alert-circle-outline',180,166,30,'amber'),txt('Settle up first.',24,252,28,600),
  copy('Maple home has an outstanding October balance. Record the remaining payments before archiving.',24,304),
  info('Archiving keeps past expenses in personal reports. It stops future use of the group.',434,'pale','people-outline','muted',112),button('View outstanding balances',603,'balances'),button('Keep household',675,'people','Secondary'),
],{title:'Archive household',back:'people',category:'Shared money'});

// Trips reuse the shared-expense model without mixing personal and group history.
screen('trips','37 · Trips',[
  txt('Trips',24,112,30,600),copy('Keep the memories. See the spending.',24,157),
  go(box('Shared trip/Lisbon',24,214,342,203,'paper',[
    box('Trip ribbon',0,0,342,66,'mint',[icon('airplane-outline',20,20,26,'green'),txt('LISBON · PORTUGAL',61,25,12,600,'green',261)]),txt('A week in Lisbon',20,87,22,600,'ink',302),txt('Nov 12–18, 2026 · 3 people',20,121,13,400,'muted',302),txt('Shared trip',20,165,12,500,'green',180),icon('chevron-forward-outline',302,165,18,'muted'),
  ],20),'shared-trip'),go(box('Personal trip/Montréal',24,438,342,150,'paper',[
    icon('airplane-outline',20,22,24,'blue'),txt('Montréal weekend',62,21,19,600,'ink',260),txt('Oct 17–20, 2026 · Personal',20,61,13,400,'muted',302),txt('$348.60',20,100,25,600,'ink',220),txt('6 expenses',235,110,12,400,'muted',87,{align:'right'}),
  ],20),'personal-trip'),button('Create trip',618,'trip-form','Secondary'),
],{root:true,nav:'Trips',category:'Trips',add:'trip-form'});
screen('shared-trip','38 · Shared trip',[
  txt('A week in Lisbon',24,118,28,600),copy('Nov 12–18, 2026 · 3 people · CAD',24,159),segments(['Expenses','Balances','People'],'Expenses',208,{Balances:'trip-balances',People:'trip-people'}),
  box('Trip totals',24,277,342,95,'mint',[label('GROUP TOTAL',20,17,140,'green'),txt('$1,260.00',20,44,24,600,'green',146),label('YOUR SHARE',190,17,132,'green'),txt('$420.00',190,44,24,600,'green',132)],20),
  tx('Apartment deposit','Nov 2 · Paid by Mira','$900.00','home-outline',391,'shared-expense-detail',{footnote:'You: $300.00'}),tx('Airport transfers','Nov 3 · Paid by you','$360.00','bus-outline',463,'shared-expense-detail',{footnote:'You: $120.00'}),
  go(box('Earlier private expenses',24,561,342,84,'pale',[icon('lock-closed-outline',16,21,22,'muted'),txt('Earlier personal expenses',50,17,14,600,'ink',276),txt('Only you can see these · $70.00',50,43,12,400,'muted',276)],16),'personal-trip'),button('Add trip expense',690,'shared-expense'),
],{title:'Trip',back:'trips',category:'Trips',note:'Trip totals span travel dates; reimbursements remain monthly. Expenses that predate sharing stay private. Bookings outside trip dates remain allowed.'});
screen('personal-trip','39 · Personal trip',[
  txt('Montréal weekend',24,118,28,600),copy('Oct 17–20, 2026 · Personal · CAD',24,160),
  box('Personal trip total',24,219,342,136,'hero',[label('YOUR SPENDING',20,19,302,'heroMuted'),txt('$348.60',20,48,36,600,'onHero',302),txt('6 expenses · Personal shares',20,103,12,400,'heroMuted',302)],20),
  tx('Train tickets','Oct 17 · Visa','−$156.00','bus-outline',385),tx('Dinner with friends','Oct 18 · Visa','−$24.80','cafe-outline',457),
  button('Add trip expense',566,'add-expense'),button('Invite people',634,'share-personal-trip','Secondary'),go(txt('Edit trip details',24,717,14,600,'accent',342,{align:'center'}),'trip-form'),
],{title:'Trip',back:'trips',category:'Trips'});
screen('trip-form','40 · Create trip',[
  field('Trip name','A week in Lisbon',128),segments(['Personal','Shared'],'Shared',246),field('Start date','November 12, 2026',319),field('End date','November 18, 2026',421),
  info('Invite people after creating a shared trip. Expenses can fall outside the travel dates.',544,'mint','airplane-outline','green',112),bottomSave('Create shared trip','trip-people'),
],{title:'Create trip',back:'trips',category:'Trips'});
screen('share-personal-trip','41 · Share a personal trip',[
  txt('Invite people to this trip?',24,132,27,600),copy('New shared expenses will be visible to everyone you invite.',24,184),
  info('Your earlier personal expenses stay private. Sharing does not change their amounts or splits.',310,'mint','lock-closed-outline','green',132),button('Create shared space',564,'trip-people'),button('Keep trip personal',632,'personal-trip','Secondary'),
],{title:'Share trip',back:'personal-trip',category:'Trips'});
screen('trip-people','42 · Trip people',[
  txt('A week in Lisbon',24,118,28,600),segments(['Expenses','Balances','People'],'People',179,{Expenses:'shared-trip',Balances:'trip-balances'}),...['You','Mira','Alex'].map((name,i)=>menu(name,i===0?'Creator':'Participant','people-outline',254+i*70,'trip-people')),button('Invite a person',509,'invite'),button('Join another trip',577,'join-group','Secondary'),
  copy('New expenses use the people currently in the trip. Earlier splits stay the same.',24,671),
],{title:'Trip people',back:'shared-trip',category:'Trips'});
screen('trip-balances','43 · Trip monthly balances',[
  txt('A week in Lisbon',24,118,28,600),segments(['Expenses','Balances','People'],'Balances',179,{Expenses:'shared-trip',People:'trip-people'}),month(249),
  box('Trip monthly amounts',24,316,342,128,'paper',[label('NOVEMBER · STILL IN PROGRESS',20,18,302),txt('You owe $60.00',20,48,25,600,'ink',302),txt('Mira is owed $480 · Alex owes $420',20,90,12,400,'muted',302)],20),
  info('Monthly reimbursements open on Nov 30. You can record an individual expense share as paid earlier.',477,'pale','calendar-outline','muted',132),button('View trip expenses',660,'shared-trip','Secondary'),
],{title:'Trip balances',back:'shared-trip',category:'Trips',note:'For $1,260 split three ways: you paid $360 and owe $60; Mira paid $900 and is owed $480; Alex paid $0 and owes $420. Individual examples preserve this accounting.'});

// Organization and preferences: a common list template, with full labels everywhere.
screen('more','44 · More',[
  txt('Your space',24,112,30,600),copy('A place for the everyday details.',24,158),
  menu('Recurring','Your regular ins and outs','repeat-outline',220,'recurring'),menu('Accounts','Bank, card, cash and other labels','wallet-outline',292,'accounts'),menu('Categories','Names, colors and icons','pricetag-outline',364,'categories'),menu('Settings','Appearance, security and your server','settings-outline',436,'settings'),
  box('Quiet sync status',24,554,342,82,'mint',[icon('cloud-done-outline',16,20,24,'green'),txt('Everything is synced',52,17,14,600,'green',272),txt('Your devices. Your server. Your money.',52,43,12,400,'green',272)],16),
],{root:true,nav:'More',category:'Organization'});
screen('recurring','45 · Recurring',[
  copy('Your regular ins and outs, in one place.',24,126),segments(['Active','Paused'],'Active',180,{Paused:'recurring-paused'}),label('NEXT UP',24,248),
  tx('Payday','Nov 15 · Monthly · Main chequing','+$2,250.00','arrow-down-outline',348,'schedule',{color:'green',footnote:'Expected income'}),
  tx('Transit pass','Nov 8 · Weekly · Visa','−$39.00','bus-outline',276,'schedule',{footnote:'Scheduled'}),tx('Rent','Dec 1 · Monthly · Main chequing','−$1,450.00','home-outline',420,'schedule',{footnote:'Scheduled'}),
  info('Scheduled expenses stay out of recorded spending until they are added. Expected income is labeled in projections.',527,'mint','repeat-outline','green',122),button('Add recurring entry',686,'add-expense'),
],{title:'Recurring',back:'more',category:'Organization',note:'Each schedule has one detail entry point. Pause, resume and remove live in the detail screen so they do not compete on every list row.'});
screen('recurring-paused','46 · Recurring / paused',[
  copy('Paused dates are skipped when you resume.',24,127),segments(['Active','Paused'],'Paused',180,{Active:'recurring'}),badge('Scheduled',24,250,'Paused'),tx('Music subscription','Monthly · Visa','−$12.99','repeat-outline',301,'schedule',{footnote:'Paused'}),
  info('Past entries stay in your history. Resume when this belongs in your routine again.',430,'pale','pause-outline','muted',112),
],{title:'Recurring',back:'more',category:'Organization'});
screen('schedule','47 · Schedule details',[
  icon('repeat-outline',24,130,36,'green'),txt('Transit pass',24,187,27,600),txt('−$39.00',24,228,37,600),
  box('Schedule properties',24,308,342,197,'paper',[
    ...[['Repeat','Weekly'],['Next occurrence','Nov 8, 2026'],['Account','Visa']].flatMap(([a,b],i)=>[txt(a,18,18+i*58,13,400,'muted',137),txt(b,161,18+i*58,13,500,'ink',163,{align:'right'}),...(i<2?[line(18,55+i*58,306)]:[])]),
  ],20),button('Edit schedule',539,'edit-schedule'),button('Pause schedule',607,'recurring-paused','Secondary'),go(txt('Remove schedule',24,706,14,600,'danger',342,{align:'center'}),'remove-schedule'),
],{title:'Recurring entry',back:'recurring',category:'Organization'});
screen('edit-schedule','48 · Edit recurring entry',[
  field('Amount (CAD)','39.00',127),field('Title','Transit pass',224),field('Next occurrence','November 8, 2026',321),segments(['Weekly','Monthly','Yearly'],'Weekly',430),menu('Account','Visa','card-outline',500,'account-picker'),
  copy('Changes apply to future occurrences. Recorded history stays the same.',24,599),bottomSave('Save schedule','schedule'),
],{title:'Edit schedule',back:'schedule',category:'Organization'});
screen('accounts','49 · Accounts',[
  copy('Give every entry a payment label.',24,128),menu('Main chequing','Bank account · 24 entries · 2 schedules','wallet-outline',199,'account-edit'),menu('Visa','Credit card · 16 entries · 1 schedule','card-outline',277,'account-edit'),menu('Cash','Cash wallet · 3 entries','cash-outline',355,'account-edit'),
  info('Manually tracked labels. No bank connection, account balances or reconciliation.',473,'mint','wallet-outline','green',112),button('Add account',658,'account-form'),
],{title:'Accounts',back:'more',category:'Organization'});
screen('account-form','50 · Add account',[
  field('Account name','Main chequing',127),label('ACCOUNT TYPE',24,251),...['Bank account','Credit card','Cash wallet','Other'].map((text,i)=>menu(text,i===0?'Selected':'',['wallet-outline','card-outline','cash-outline','ellipsis-horizontal'][i],277+i*65,'account-form')),
  copy('Accounts label how you pay. No bank connection is needed.',24,578),bottomSave('Save account','accounts'),
],{title:'Add account',back:'accounts',category:'Organization'});
screen('account-edit','51 · Edit account / in use',[
  field('Account name','Main chequing',127),menu('Account type','Bank account','wallet-outline',246,'account-edit'),
  info('This account is linked to 24 entries and 2 schedules. Reassign them before deleting it.',357,'pale','lock-closed-outline','muted',120),
  instance('Button/Disabled',24,534,342,52,{Label:{text:'Account is in use'}}),bottomSave('Save changes','accounts'),
],{title:'Edit account',back:'accounts',category:'Organization'});
screen('categories','52 · Categories',[
  copy('Make room for your kind of everyday.',24,127),segments(['Expense','Income','Investment'],'Expense',186),
  ...[['Groceries','basket-outline'],['Food & drinks','cafe-outline'],['Home','home-outline'],['Transport','bus-outline'],['Shopping','pricetag-outline']].map(([name,glyph],i)=>menu(name,'Edit name, color and icon',glyph,256+i*65,'category-form')),button('Create category',658,'category-form'),
],{title:'Categories',back:'more',category:'Organization'});
screen('category-form','53 · Edit category',[
  field('Category name','Groceries',127),segments(['Expense','Income','Investment'],'Expense',236),label('COLOR',24,312),
  box('Category color selection',24,347,342,48,null,['#467C58','#B74F32','#A77B38','#517C99','#8C5A82','#627369'].map((fill,i)=>rect(`Color ${fill}`,i*57,0,44,44,fill,14,{stroke:i===0?'ink':null,strokeWidth:3}))),
  label('ICON',24,428),box('Category icon selection',24,465,342,56,'paper',['basket-outline','cafe-outline','home-outline','bus-outline','pricetag-outline','airplane-outline'].map((glyph,i)=>box(`Icon option ${glyph}`,i*57,0,50,50,i===0?'mint':null,[icon(glyph,14,14,22,'green')],14)),16),
  copy('Color always appears with a category name and icon. It is never the only identifying cue.',24,562),bottomSave('Save category','categories'),
],{title:'Edit category',back:'categories',category:'Organization'});
screen('settings','54 · Settings',[
  box('Profile',24,127,342,88,'paper',[rect('Avatar',16,18,48,48,'mint',16),txt('M',16,30,20,600,'green',48,{align:'center'}),txt('Your personal space',80,19,16,600,'ink',244),txt('max@example.test',80,47,13,400,'muted',244)],18),
  menu('Appearance','Light','sunny-outline',245,'appearance'),menu('App lock','Face ID · This device','finger-print-outline',309,'app-lock-settings'),menu('Penny server','Connected · This device','server-outline',373,'server-info'),menu('Currency','CAD · Locked while entries exist','cash-outline',437,'currency'),
  info('Personal changes save on this device while offline. Shared actions and receipt uploads need a connection.',540,'mint','cloud-done-outline','green',112),button('Sign out',687,'sign-out','Secondary'),
],{title:'Settings',back:'more',category:'Settings & access',note:'App lock and server selection are native-only controls. On web omit them and use the current origin. Do not expose a server editor over an active workspace.'});
screen('appearance','55 · Appearance',[
  copy('The same Penny, in your favorite light.',24,127),...[
    ['Light','Warm and clear','sunny-outline','home'],['Dark','Soft contrast after hours','moon-outline','home-dark'],['AMOLED','True black surfaces','moon-outline','home-amoled'],['Catppuccin','The familiar Mocha palette','pricetag-outline','home-catppuccin'],
  ].map(([a,b,g,target],i)=>menu(a,b,g,207+i*85,target)),info('Typography, spacing and component behavior stay consistent across all four appearances.',595,'mint','checkmark-circle-outline','green',112),
],{title:'Appearance',back:'settings',category:'Settings & access'});
screen('app-lock-settings','56 · App lock settings',[
  icon('finger-print-outline',24,132,40,'green'),txt('A little more privacy.',24,195,28,600),copy('Require Face ID or your fingerprint when opening Penny or returning to the app.',24,245),
  go(box('Biometric setting',24,361,342,72,'paper',[txt('Biometric app lock',18,24,15,600,'ink',240),rect('Toggle track',270,21,54,30,'green',15),rect('Toggle thumb',295,24,24,24,'paper',12)],18),'lock'),
  info('Applies to this device only. Your device passcode can be used to unlock if needed.',471,'mint','lock-closed-outline','green',112),copy('Home screen widgets and notification previews are outside the app lock.',24,642),
],{title:'App lock',back:'settings',category:'Settings & access'});
screen('currency','57 · Currency / locked state',[
  txt('Canadian dollar',24,133,28,600),label('CAD · ACCOUNT CURRENCY',24,178),
  info('Your currency is locked because this ledger already contains entries. Shared households also require matching currencies.',279,'pale','lock-closed-outline','muted',144),
  copy('Choose a currency before adding your first entry. Penny keeps one currency per account.',24,485),button('Back to settings',654,'settings','Secondary'),
],{title:'Currency',back:'settings',category:'Settings & access'});
screen('server-info','58 · Connected server',[
  icon('server-outline',24,131,36,'green'),txt('Your Penny server',24,191,27,600),copy('https://penny.example.com',24,239),
  box('Server status',24,325,342,97,'mint',[icon('cloud-done-outline',17,20,24,'green'),txt('Connected',57,18,16,600,'green',265),txt('Saved on this device',57,51,13,400,'green',265)],18),
  info('To change servers, sync your entries and sign out first.',468,'pale','lock-closed-outline','muted',104),button('Back to settings',655,'settings','Secondary'),
],{title:'Penny server',back:'settings',category:'Settings & access'});
screen('server-connect','59 · Select server / signed out',[
  txt('Your devices. Your server.',24,133,26,600),copy('Connect to the Penny server you use.',24,178),field('Server URL','https://penny.example.com',264),
  info('Enter the base URL, without /api. This setting only affects this device.',378,'pale','server-outline','muted',104),button('Check server',530,'server-verified'),button('Cancel',598,'sign-in','Secondary'),
],{title:'Penny server',back:'sign-in',category:'Settings & access'});
screen('server-verified','60 · Server verified',[
  field('Server URL','https://penny.example.com',155),info('Server verified. You can use this Penny server on this device.',282,'mint','checkmark-circle-outline','green',105),button('Use this server',472,'sign-in'),button('Choose another server',540,'server-connect','Secondary'),
],{title:'Penny server',back:'server-connect',category:'Settings & access'});
function auth(id,name,register=false){
 screen(id,name,[
  rect('Brand tile',162,106,66,66,'accent',22),icon('leaf-outline',180,124,30,'onAccent'),txt('penny.',24,188,42,600,'ink',342,{align:'center',letterSpacing:-2}),txt(register?'Make yourself at home.':'A little clarity for your money.',24,252,20,500,'ink',342,{align:'center'}),
  go(box('Server label',24,306,342,40,'mint',[icon('server-outline',14,11,18,'green'),txt('penny.example.com',45,10,13,500,'green',252),icon('chevron-forward-outline',310,12,16,'green')],12),'server-connect'),
  field('Email','you@example.com',376,{placeholder:true}),field('Password',register?'At least 10 characters':'Your password',474,{placeholder:true}),button(register?'Create account':'Sign in',585,register?'empty-home':'home'),
  go(txt(register?'Already have an account? Sign in':'New here? Create an account',24,658,13,600,'accent',342,{align:'center'}),register?'sign-in':'create-account'),
  button('Explore sample data',714,'demo-home','Secondary'),
 ],{title:register?'Create account':'Welcome',back:'close',noHeader:true,category:'Settings & access',note:'Native server entry point is shown here. Web uses its own origin. Show the server’s OIDC action only when configured; the optional SSO specimen documents that variation.'});
}
auth('sign-in','61 · Sign in');auth('create-account','62 · Create account',true);
screen('sign-in-sso','63 · Sign in / server SSO',[
  rect('Brand tile',162,126,66,66,'accent',22),icon('leaf-outline',180,144,30,'onAccent'),txt('Welcome back.',24,233,30,600,'ink',342,{align:'center'}),copy('Sign in through your Penny server.',24,283,342),button('Continue with your server',366,'home'),txt('or use email',24,443,12,400,'muted',342,{align:'center'}),field('Email','you@example.com',488,{placeholder:true}),field('Password','Your password',585,{placeholder:true}),button('Sign in',703,'home','Secondary'),
],{title:'Sign in',back:'sign-in',category:'Settings & access'});
screen('lock','64 · Penny is locked',[
  rect('Lock symbol',151,204,88,88,'mint',29),icon('lock-closed-outline',177,230,36,'green'),txt('Penny is locked',24,337,30,600,'ink',342,{align:'center'}),txt('Unlock with Face ID, your fingerprint,\nor your device passcode.',24,389,15,400,'muted',342,{align:'center',h:60}),button('Unlock Penny',535,'home'),txt('Your unfinished draft will be here.',24,611,12,400,'muted',342,{align:'center'}),
],{title:'',back:'close',noHeader:true,category:'Settings & access',note:'While locked, hide all ledger content and open dialogs. Failed authentication keeps this screen visible; retry uses the same button. Do not replace the operating system biometric prompt with an app imitation.'});

// Reusable state examples preserve drafts and explain disabled actions.
screen('empty-home','65 · First entry / empty home',[
  txt('A little more clarity.',24,112,13,400,'muted'),txt('Your story starts here.',24,140,28,600),month(187),
  box('Empty state',24,258,342,319,'paper',[rect('Empty icon surface',130,34,82,82,'mint',28),icon('leaf-outline',154,58,34,'green'),txt('One little entry at a time.',20,151,22,600,'ink',302,{align:'center'}),txt('Add an expense, income or investment\nto start seeing your month.',20,197,15,400,'muted',302,{align:'center',h:60})],22),button('Add your first entry',610,'add-expense'),
],{root:true,category:'States',note:'A first-use state does not show meaningless zero-value charts. Currency can still be selected before the first entry.'});
screen('search-empty','66 · No matching activity',[
  txt('Activity',24,112,30,600),month(155),instance('Search',24,207,342,48,{Placeholder:{text:'Coffee on Mars',color:'ink'}}),segments(['All','Expenses','Income','Invested'],'All',275),
  box('No results',24,367,342,243,'paper',[icon('search-outline',144,34,54,'muted'),txt('No entries match.',20,121,23,600,'ink',302,{align:'center'}),txt('Try another word or clear your filters.',20,166,14,400,'muted',302,{align:'center'})],22),button('Clear search & filters',645,'activity','Secondary'),
],{root:true,nav:'Activity',category:'States'});
const home=screens.find(s=>s.id==='home');
for(const [id,name,theme] of [['home-dark','70 · Home / Dark','dark'],['home-amoled','71 · Home / AMOLED','amoled'],['home-catppuccin','72 · Home / Catppuccin','catppuccin']]) screens.push({...structuredClone(home),id,name,theme,category:'Themes & platforms'});
screens.push({...structuredClone(home),id:'demo-home',name:'67 · Demo / temporary sample data',category:'States',children:[...structuredClone(home.children).filter(n=>!(n.kind==='instance'&&n.component.startsWith('Navigation/'))&&n.name!=='Add entry'),go(box('Demo notice',24,682,342,60,'orange',[txt('Sample data · Changes are temporary',14,12,12,600,'accent',314),txt('Start my own tracker →',14,34,12,600,'accent',314)],14),'create-account'),instance('Navigation/Home',16,760,358,64)]});
screen('offline','68 · Saved offline',[
  txt('Your changes are safe.',24,132,28,600),instance('Banner/Offline',24,204,342,74),copy('Personal entries save on this device and sync when your server is reachable again.',24,315),
  box('Pending entry',24,414,342,109,'paper',[txt('Groceries',18,17,16,600,'ink',212),txt('−$48.90',211,17,16,600,'ink',113,{align:'right'}),txt('Saved locally · Nov 7',18,55,13,400,'muted',216),badge('Pending',238,59)],20),button('Try syncing now',566,'home','Secondary'),
  info('Shared changes and receipt uploads need a connection. Sign out stays unavailable until pending changes sync.',658,'pale','cloud-offline-outline','muted',128),
],{title:'Sync status',back:'home',category:'States'});
screen('save-error','69 · Save error / draft retained',[
  instance('Banner/Error',24,123,342,74),field('Amount (CAD)','48.90',229),field('What was it for?','Groceries',333),quickCategories(425,'Expense','save-error'),menu('Account','Main chequing','wallet-outline',543,'account-picker'),
  copy('Nothing was lost. Your amount, category and receipt selection stay in this draft.',24,627),bottomSave('Try saving again','saved'),
],{title:'Add expense',back:'add-expense',category:'States'});
screen('saved','73 · Expense saved',[
  icon('checkmark-circle-outline',159,190,72,'green'),txt('A little update, saved.',24,306,28,600,'ink',342,{align:'center'}),copy('Groceries · Your share: $48.90',24,360,342),instance('Toast/Saved',24,464,342,52),button('Back to your month',599,'home'),button('Add another entry',667,'add-expense','Secondary'),
],{title:'Expense added',back:'home',category:'States',note:'This expanded success specimen documents feedback. In normal use, return directly to the source screen with a brief save toast and native haptic rather than interrupting with a dedicated success screen.'});
for(const [id,name,what,back,destination] of [['delete-entry','74 · Delete entry','this entry','entry-detail','activity'],['remove-schedule','75 · Remove schedule','this schedule','schedule','recurring']]) {
 screen(id,name,[
  rect('Destructive icon',162,146,66,66,'dangerBg',22),icon('trash-outline',180,164,30,'danger'),txt(`Remove ${what}?`,24,258,27,600),copy(id==='delete-entry'?'This removes the entry from your recorded totals.':'Future occurrences will stop. Recorded entries stay in your history.',24,315),button(id==='delete-entry'?'Delete entry':'Remove schedule',532,destination,'Danger'),button(id==='delete-entry'?'Keep entry':'Keep schedule',600,back,'Secondary'),
 ],{title:'Confirm removal',back,category:'States'});
}
screen('payment-stale','76 · Payment changed / retry',[
  icon('alert-circle-outline',24,142,46,'amber'),txt('Review the latest expense.',24,219,27,600),copy('Someone changed this expense or its payment status. Reopen it before recording a payment.',24,278),
  instance('Button/Disabled',24,428,342,52,{Label:{text:'Recording unavailable'}}),button('Reopen expense',534,'shared-expense-detail'),button('Back to household',602,'household','Secondary'),
],{title:'Payment unavailable',back:'shared-expense-detail',category:'States'});
screen('sign-out','79 · Sign out / synced',[
  icon('log-out-outline',24,147,42,'green'),txt('Sign out of Penny?',24,227,28,600),copy('Your entries are synced with your server. Your device app-lock preference stays in place.',24,286),
  button('Sign out',527,'sign-in'),button('Keep using Penny',595,'settings','Secondary'),
],{title:'Sign out',back:'settings',category:'States',note:'When personal changes are pending, replace the sign-out action with a disabled action and an explanation linking to Sync status.'});

// An Android specimen keeps the same information and sizing, adapting system chrome.
const android=structuredClone(home);android.id='home-android';android.name='77 · Home / Android';android.platform='Android';android.category='Themes & platforms';
android.children=android.children.map(n=>n.name==='System status'?box('Android system status',0,0,390,44,null,[txt('9:41',24,13,13,500,'ink',80),icon('wifi-outline',310,13,18),icon('battery-full-outline',338,10,26)]):n);
screens.push(android);

// Tablet and desktop share labels, hierarchy and entry actions with mobile.
screen('desktop','78 · Desktop overview',[
  box('Sidebar',16,16,224,968,'paper',[
    rect('Brand tile',28,32,34,34,'accent',12),icon('leaf-outline',36,40,18,'onAccent'),txt('penny.',74,32,29,600,'ink',130,{letterSpacing:-1}),label('YOUR EVERYDAY',28,115,170),
    ...[['Home','home-outline','home'],['Activity','list-outline','activity'],['Shared','people-outline','shared'],['Trips','airplane-outline','trips'],['Recurring','repeat-outline','recurring'],['Accounts','wallet-outline','accounts'],['Categories','pricetag-outline','categories']].map(([text,glyph,target],i)=>go(box(`Sidebar/${text}`,16,153+i*62,192,50,i===0?'mint':null,[icon(glyph,16,14,22,i===0?'green':'muted'),txt(text,52,15,14,i===0?600:400,i===0?'green':'muted',130)],14),target)),
    menu('Settings','Your personal space','settings-outline',899,'settings',28,170),
  ],28,{material:'glass'}),
  txt('A little more clarity.',264,44,14,400,'muted',700),txt('Your month, in view.',264,75,36,600,'ink',720),button('Add entry',56,'add-expense','Primary',1210,182),
  box('Desktop period',264,146,1128,54,null,[txt('November 2026',0,14,18,600,'ink',850),go(icon('calendar-outline',1102,15,22),'calendar')]),
  box('Recorded cash remaining',264,222,532,212,'hero',[label('RECORDED CASH REMAINING',24,23,484,'heroMuted'),txt('$1,116.65',24,53,47,600,'onHero',484,{letterSpacing:-1.4}),txt('Projected remaining: $3,366.65',24,131,16,500,'onHero',484),txt('Includes $2,250 in expected income',24,166,13,400,'heroMuted',484)],22),
  box('Recorded totals',820,222,572,212,'paper',[
    ...[['Income','$3,200.00','green'],['Spent · your share','$1,883.35','ink'],['Invested','$200.00','blue']].map(([name,amount,color],i)=>box(name,24+i*180,43,164,122,null,[label(name,0,0,164),txt(amount,0,41,25,600,color,164)])),
  ],22),
  box('Desktop activity',264,463,661,446,'paper',[
    title('Recent activity',24,25,430),go(txt('View all',491,30,14,600,'accent',146,{align:'right'}),'activity'),
    tx('Groceries','Nov 7 · Main chequing','−$48.90','basket-outline',91,'entry-detail',{x:24,w:613}),tx('Coffee with Mira','Nov 7 · Visa','−$6.40','cafe-outline',164,'entry-detail',{x:24,w:613}),tx('Investment transfer','Nov 6 · Main chequing','−$200.00','trending-up-outline',237,'entry-detail',{x:24,w:613,color:'blue'}),tx('Payday','Nov 1 · Main chequing','+$3,200.00','arrow-down-outline',310,'entry-detail',{x:24,w:613,color:'green',footnote:'Income'}),
  ],22),
  box('Desktop spending',949,463,443,446,'paper',[title('Spending by category',24,25,395),txt('$1,883.35',24,75,31,600,'ink',395),...helpers.spendingRows(24,141,395),go(txt('Explore your month →',24,393,14,600,'accent',395),'insights')],22),
  icon('cloud-done-outline',264,949,19,'green'),txt('Everything is synced',291,949,12,400,'muted',600),
],{w:1440,h:1000,category:'Themes & platforms',platform:'Desktop web',note:'At ≥1100px use the sidebar and a 12-column content area. At 768–1099px use a compact rail and two content columns. Below 768px keep the mobile navigation and one column. These are proposal breakpoints, subject to device testing.'});

// Stable order in the review gallery and Penpot page.
const categoryOrder=['Daily money','Entry flows','Shared money','Trips','Organization','Settings & access','States','Themes & platforms'];
screens.sort((a,b)=>categoryOrder.indexOf(a.category)-categoryOrder.indexOf(b.category)||a.name.localeCompare(b.name));
