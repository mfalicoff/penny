# Changelog

## [3.0.0](https://github.com/mfalicoff/penny/compare/v2.0.0...v3.0.0) (2026-11-24)


### ⚠ BREAKING CHANGES

* **self-hosting:** upgrading to 3.0 needs the single database login (PENNY_DB_USER and PENNY_DB_PASSWORD) and no separate migrate step ([#204](https://github.com/mfalicoff/penny/issues/204))
* upload receipts as the raw file and record the legacy-compatibility review (MAZ-131) ([#87](https://github.com/mfalicoff/penny/issues/87))

### Features

* add the iOS hero glow, close the entry form gaps and fix glow contrast ([#105](https://github.com/mfalicoff/penny/issues/105)) ([534705f](https://github.com/mfalicoff/penny/commit/534705f4442fe0bb15cf9454d2932f4c72783816))
* **api:** add optional email delivery with a mail outbox ([8efa413](https://github.com/mfalicoff/penny/commit/8efa41365e86ee511e55f233d675e5e8513d1607))
* **backend:** delete receipts nothing links to after a retention (MAZ-165) ([91ab956](https://github.com/mfalicoff/penny/commit/91ab9568520da7eb89d033fee8c853c9f635d3d7))
* **backend:** migrate the database on API startup with one login ([8d6267d](https://github.com/mfalicoff/penny/commit/8d6267d3545033cd54252435acbf078eab2f2569))
* **backend:** say why a database migration failed ([a10285a](https://github.com/mfalicoff/penny/commit/a10285acf6f893481b64280ec095a0e8160728a8))
* change your password from Settings &gt; Profile ([2cd9181](https://github.com/mfalicoff/penny/commit/2cd91810ed5439cd4f9b71b11221ba4a03667bb5))
* delete an account and export all of a person's data, on the API and web ([#207](https://github.com/mfalicoff/penny/issues/207)) ([342ef29](https://github.com/mfalicoff/penny/commit/342ef2925e064a6b220f615a54d5b3ed22132f1d))
* **design:** add All households and the web trip rows to the sidebar cards (MAZ-240) ([#151](https://github.com/mfalicoff/penny/issues/151)) ([62add1b](https://github.com/mfalicoff/penny/commit/62add1b1082276c3c6684b85d1760c9a73029b42))
* **design:** pin the web demo link, add Display to iPhone Appearance and a plain sign-out card ([#167](https://github.com/mfalicoff/penny/issues/167)) ([dc6667f](https://github.com/mfalicoff/penny/commit/dc6667f7323d4ecac5bcb5c990e18478fce16d9d))
* display names and pictures for every account, shown instead of emails ([ea23430](https://github.com/mfalicoff/penny/commit/ea23430bfd40cebc92131662a00479ee35fc2232))
* email verification on the API and web ([#206](https://github.com/mfalicoff/penny/issues/206)) ([acfc369](https://github.com/mfalicoff/penny/commit/acfc3698a3309cad44cd8186ea241edb158c6952))
* **ios:** add Month at a glance and Lock Screen widgets (MAZ-135) ([fbbea39](https://github.com/mfalicoff/penny/commit/fbbea39ae65ea972d089ce067974c50fc0ab8dfb))
* **ios:** bring the iPad layouts to the redesign cards (MAZ-182) ([8d00968](https://github.com/mfalicoff/penny/commit/8d009687b857990d092c4317e813bbe8398b097e))
* **ios:** close the shared, trip and household card gaps (MAZ-181) ([65cb88d](https://github.com/mfalicoff/penny/commit/65cb88d063a3f1252169fe2bb6b936bf0b4eddcc))
* **ios:** email verification, the money flow table and iPad Home in portrait ([#208](https://github.com/mfalicoff/penny/issues/208)) ([387cfc4](https://github.com/mfalicoff/penny/commit/387cfc4832a08cdf6d55fca66709878eb5ab30d5))
* **ios:** Face ID lock delay setting (MAZ-133) ([2fbeb83](https://github.com/mfalicoff/penny/commit/2fbeb83229d726ea9d7a85197e7d3f2e4a438d20))
* **ios:** list shared schedules on Recurring with your share (MAZ-198) ([4b55548](https://github.com/mfalicoff/penny/commit/4b555485a69ec34642b09ab006b3a5c6281cfbc7))
* **ios:** local-first saving, server connect sheet and Settings match the cards ([#205](https://github.com/mfalicoff/penny/issues/205)) ([d56bb53](https://github.com/mfalicoff/penny/commit/d56bb532e5d9c267a6e450ed1fcdac3158cde674))
* **ios:** match Add entry's header, amount and rows to their cards (MAZ-247) ([#165](https://github.com/mfalicoff/penny/issues/165)) ([07c6bf2](https://github.com/mfalicoff/penny/commit/07c6bf2c9d61a75ea22a8605620cc252655de338))
* **ios:** match Home, Insights, the calendar and offline to their cards (MAZ-245) ([b313f66](https://github.com/mfalicoff/penny/commit/b313f664b2d15c0430a7233bdec35c45ce1e5dea))
* **ios:** match list headers, row subtitles and icon tiles to the cards (MAZ-244) ([416be1b](https://github.com/mfalicoff/penny/commit/416be1b066414d3efed9103e3cfb277ab8392d84))
* **ios:** match Recurring to its card: subtitle, labels, tags and category tiles (MAZ-198) ([63db2db](https://github.com/mfalicoff/penny/commit/63db2db5ad65e11ce15acdd4529773a9f527cac1))
* **ios:** match the Activity and entry form cards ([#193](https://github.com/mfalicoff/penny/issues/193)) ([fc943b9](https://github.com/mfalicoff/penny/commit/fc943b928928cfae1b037839d4007b42f6296410))
* **ios:** match the entry detail and empty search to their cards (MAZ-246) ([2446f69](https://github.com/mfalicoff/penny/commit/2446f69b1573168d48d810737232eebf46dd7772))
* **ios:** match the household and trip cards and record the approved invite card ([#195](https://github.com/mfalicoff/penny/issues/195)) ([ea99292](https://github.com/mfalicoff/penny/commit/ea992929f13e779e30179857e173211f7e745ea6))
* **ios:** match the shared household cards (MAZ-248) ([#172](https://github.com/mfalicoff/penny/issues/172)) ([d881926](https://github.com/mfalicoff/penny/commit/d88192639c089be8e3871d7949c92e2105789d6a))
* **ios:** password reset and invitations by email ([#202](https://github.com/mfalicoff/penny/issues/202)) ([8f74613](https://github.com/mfalicoff/penny/commit/8f746138bf5c6ac00faf9c463bd2cfafe8b9e5ef))
* **ios:** profiles with names and pictures, and privacy policy links ([a513b99](https://github.com/mfalicoff/penny/commit/a513b99e5dc7a2095d203f7baa9aae0efc1cda78))
* link the server's privacy policy on sign-in, sign-up and profile ([faaba6d](https://github.com/mfalicoff/penny/commit/faaba6d32fd387101d37f9e7559509e6e5bb598b))
* product page with Gaussian-splat scenes (apps/site) ([#76](https://github.com/mfalicoff/penny/issues/76)) ([e9e0373](https://github.com/mfalicoff/penny/commit/e9e0373070e511471472d4e17cc928eb50b33124))
* **test-env:** give each session its own HTTPS test environment and web ports (MAZ-265) ([95aeaa9](https://github.com/mfalicoff/penny/commit/95aeaa9854b3436b141cee1869d5a48cd0ef3a82))
* upload receipts as the raw file and record the legacy-compatibility review (MAZ-131) ([#87](https://github.com/mfalicoff/penny/issues/87)) ([5b419f9](https://github.com/mfalicoff/penny/commit/5b419f9ae85b6bb91a176b2b22973026b1db5ed1))
* **web:** a sample household in the demo, and no category reorder on the web card ([a6153de](https://github.com/mfalicoff/penny/commit/a6153de699c51ef33d09db117d48a8f22c3bd20d))
* **web:** add a calendar button beside the month control on iPad and web Home (MAZ-258) ([#169](https://github.com/mfalicoff/penny/issues/169)) ([40071ef](https://github.com/mfalicoff/penny/commit/40071efa5454cb5f8e62aefd62b8a3908b83f984))
* **web:** add Show cents and Week starts on to Settings › Appearance (MAZ-140) ([56b11bc](https://github.com/mfalicoff/penny/commit/56b11bc4d934129e2ae3875358bc83384712e88a))
* **web:** add the Household row and the web Note to the Add entry cards ([44ba7fb](https://github.com/mfalicoff/penny/commit/44ba7fb6b73255560ab9b4609a23a66468b4cbbc))
* **web:** add the Join a trip key and match the web trip screens' expense rows and settled tiles ([#175](https://github.com/mfalicoff/penny/issues/175)) ([69b9017](https://github.com/mfalicoff/penny/commit/69b90171720de7a06a8301709ed315259cb20df3))
* **web:** align Activity and the entry form with the redesign cards (MAZ-175) ([4191eed](https://github.com/mfalicoff/penny/commit/4191eedd3308461cb4bada09a5a4354e788587f6))
* **web:** always show a selected expense and the card's Balances rows on the iPad household ([c0bea46](https://github.com/mfalicoff/penny/commit/c0bea465e6cc3b0dc988b6ebfb77de67178e5472))
* **web:** category-colored tiles, list headings above solid cards, smaller hero cents and the cards' minus sign (MAZ-222) ([2bf8d6e](https://github.com/mfalicoff/penny/commit/2bf8d6e24578fa8e6bbdb7f5c54cd8dc05ab279b))
* **web:** close Home, Insights and money flow content gaps with the cards (MAZ-223) ([0b2008d](https://github.com/mfalicoff/penny/commit/0b2008d7d929b7857471c9cccbbbcb040055e75c))
* **web:** group Settings and Appearance as the cards do (MAZ-231) ([#159](https://github.com/mfalicoff/penny/issues/159)) ([24ffea9](https://github.com/mfalicoff/penny/commit/24ffea98109e752a7246002c51663ae8153729cf))
* **web:** household and trip navigation-bar icons, two-pane household and Upcoming/Past trips (MAZ-229) ([2c9c088](https://github.com/mfalicoff/penny/commit/2c9c088625781de2d9ae7c1f9894478cb7a27475))
* **web:** iPad glass search button, Settings sheet over Home, and the MAZ-239 design decisions ([aa2ab21](https://github.com/mfalicoff/penny/commit/aa2ab214d7b028bd932c35a7cbaff6f36d23d4b1))
* **web:** lead Add entry with the amount and match its cards (MAZ-226) ([#152](https://github.com/mfalicoff/penny/issues/152)) ([1ee9d29](https://github.com/mfalicoff/penny/commit/1ee9d29fab6ee715c837eba811c771487a159a71))
* **web:** lead Home and Insights with one number, as the redesign cards do (MAZ-174) ([#108](https://github.com/mfalicoff/penny/issues/108)) ([2659621](https://github.com/mfalicoff/penny/commit/265962186028cebcc6b6b5b10d6f22cc9089077c))
* **web:** lead trips with your share and match their cards (MAZ-230) ([51afaa6](https://github.com/mfalicoff/penny/commit/51afaa6e568b79a20c277713964dcf99488580d5))
* **web:** match Activity and the entry detail to their cards ([#150](https://github.com/mfalicoff/penny/issues/150)) ([954f40d](https://github.com/mfalicoff/penny/commit/954f40d0daeef48d68e1a1fe38703c950b881ef8))
* **web:** match Recurring, Accounts and Categories to their cards (MAZ-232) ([#161](https://github.com/mfalicoff/penny/issues/161)) ([56d9d92](https://github.com/mfalicoff/penny/commit/56d9d922c579c55c3a3ca35ed44cc15bfc87b402))
* **web:** match sign-in, create account, sign-out and the saved toast to their cards (MAZ-233) ([bc50342](https://github.com/mfalicoff/penny/commit/bc5034223e75dba94e77667b8344b900da4e8388))
* **web:** match sign-in, sign-out and sync feedback to the redesign cards ([#99](https://github.com/mfalicoff/penny/issues/99)) ([88bcbf6](https://github.com/mfalicoff/penny/commit/88bcbf690183b9ff33911d783c93e2ede5e03388))
* **web:** match the households list, shared expense, trip and Join with a code to their cards ([3217797](https://github.com/mfalicoff/penny/commit/321779778b355493d9c039be03c9be177a9c469e))
* **web:** match the Manage pages, Currency, New schedule, banners and tablet Home to their cards ([6a49df9](https://github.com/mfalicoff/penny/commit/6a49df9e165740017bd9f7167e54e1af8346c897))
* **web:** match the overspent Home, shared banner and iPad Add entry cards ([1049e18](https://github.com/mfalicoff/penny/commit/1049e18c90f96e0708045421e057724226091daa))
* **web:** match the phone header and four-tab bar, and list households and trips in the sidebar (MAZ-221) ([e25ca19](https://github.com/mfalicoff/penny/commit/e25ca19b744902e53d8402342cef0df67a56e2c5))
* **web:** match the saved toast's category tile and record the approved sign-in and sync differences (MAZ-237) ([#170](https://github.com/mfalicoff/penny/issues/170)) ([27aae45](https://github.com/mfalicoff/penny/commit/27aae451955f9a4721ab6fbca88de5ff444b351f))
* **web:** match the shared expense form and iPad Activity pane to their cards, and fix two flaky tests ([#179](https://github.com/mfalicoff/penny/issues/179)) ([8cccca9](https://github.com/mfalicoff/penny/commit/8cccca9eb4ac69a365fcabeacb6c9dc7f280ce74))
* **web:** match the shared household screens to their cards (MAZ-228) ([2125bbb](https://github.com/mfalicoff/penny/commit/2125bbb0e12952561530adc0da566c03c7afe8b4))
* **web:** money flow screen, calendar sheet and the cards' Home and Insights (MAZ-224) ([af6398b](https://github.com/mfalicoff/penny/commit/af6398b10c440520667a6a3ada76a2931d49df92))
* **web:** reset passwords and invite people by email ([4b5fc9d](https://github.com/mfalicoff/penny/commit/4b5fc9d2d1d306675111ccf75bc53fa5f88b0ce0))
* **web:** show the iPad household's selected expense as the card's short card ([5867f78](https://github.com/mfalicoff/penny/commit/5867f78a2d6bdc14cc27c9870b188ab8b4020da6))


### Bug Fixes

* **backend:** analyze the copied table after a large bulk copy, and re-enable the full-ledger test ([e3994d3](https://github.com/mfalicoff/penny/commit/e3994d3b4483ac9dcb554446fba4c7e98972de30))
* **backend:** copy full-ledger writes in batches and read the reported version in tests (MAZ-262) ([3aba8e8](https://github.com/mfalicoff/penny/commit/3aba8e8daefdc58746193afb5c4c283c23e5c5fd))
* **backend:** enforce the daily receipt-address cap under the rotation lock (MAZ-207) ([e6420cc](https://github.com/mfalicoff/penny/commit/e6420ccb62cbf2c7533433abe1116433187a8452))
* **backend:** let the request deadline bound the full-ledger bulk copy (MAZ-262) ([e521612](https://github.com/mfalicoff/penny/commit/e521612284d327564f11799569dd9faaaabeecb5))
* **backend:** record the running EF Core version when upgrading a pre-squash database (MAZ-243) ([72d57ae](https://github.com/mfalicoff/penny/commit/72d57ae15a9da4bc8be4ce9d5a79fd5708b14ca5))
* **backend:** serialize receipt-address rotations on the user's row lock (MAZ-193) ([6ed0064](https://github.com/mfalicoff/penny/commit/6ed00643123363e289611933676b4a39e5f8a549))
* **backend:** stop orphaned PostgreSQL statements after a command timeout ([a18a313](https://github.com/mfalicoff/penny/commit/a18a31303f50aee219ecc3540fd4139cd19e28c7))
* **deps:** dedupe playwright-core onto 1.64.1 ([68a17d3](https://github.com/mfalicoff/penny/commit/68a17d3014d03f665ab60fc2cee53f5067a56095))
* **deps:** hold Playwright at 1.64.1 ([c85fcfd](https://github.com/mfalicoff/penny/commit/c85fcfd25e78e8877618738a0dfba6a5065dddae))
* **deps:** make the grouped Renovate update pass CI ([47383b8](https://github.com/mfalicoff/penny/commit/47383b8c7a528377b7b1ea9324387f274f3b1105))
* **deps:** title Renovate PRs as Conventional Commits ([317c575](https://github.com/mfalicoff/penny/commit/317c57563d58486236cd01e9ef46dc6f1dba4b3f))
* **design:** add the household month pill to the shared cards and draw the kit's filled icon parts in the text color ([8c1af3c](https://github.com/mfalicoff/penny/commit/8c1af3c2e2f505f7f97575a1a29236a1e5f61fc3))
* **design:** draw the kit's server icon as an outline ([5413447](https://github.com/mfalicoff/penny/commit/541344795c9161a43cde41e87039b9de08678b2d))
* **design:** keep the monogram token in the design baseline ([ab721d5](https://github.com/mfalicoff/penny/commit/ab721d5b09dc4c7fbe8cd7d7e63afb0016edd42a))
* **design:** let glow-contrast.mjs use PENNY_DESIGN_CHROME as render.mjs does ([1bfb3e9](https://github.com/mfalicoff/penny/commit/1bfb3e9a770f91a34e8528e1d46b8594cdb8e6f8))
* **design:** re-sync the visual acceptance hash in the design baseline (MAZ-246) ([cae5aae](https://github.com/mfalicoff/penny/commit/cae5aaed4486d52a0e3af9d3f7c953cef82ec489))
* **design:** render every card baseline in CI's Playwright Chromium ([4ce662b](https://github.com/mfalicoff/penny/commit/4ce662b61d732cfac016f95c9518dba9bc4040f1))
* **dev:** answer HTTP in the email worker and add Mailpit to the AppHost ([#203](https://github.com/mfalicoff/penny/issues/203)) ([6f85588](https://github.com/mfalicoff/penny/commit/6f855886a41d23d1789cb5af33c362af7819a604))
* **ios:** draw income and investment entry tiles in their kind's color ([#156](https://github.com/mfalicoff/penny/issues/156)) ([288032b](https://github.com/mfalicoff/penny/commit/288032bf71bd1854831fbb2efb977b2a5dc2d7e8))
* **ios:** give a field 12 s to take keyboard focus before tapping it again ([945e6ee](https://github.com/mfalicoff/penny/commit/945e6ee8ca71553ff8536854dff48eb45b456535))
* **ios:** give each run its own simulators and stop UI tests stalling on the AutoFill keyboard (MAZ-212) ([267b66d](https://github.com/mfalicoff/penny/commit/267b66d91dc9f97478f2575497d4985e2982091c))
* **ios:** give Recurring rows the cards' compact metrics (MAZ-219) ([8d694de](https://github.com/mfalicoff/penny/commit/8d694de73373c4e77ef505a954cc05a7b4cef7a8))
* **ios:** keep sign-in and empty search clear of the keyboard (MAZ-179) ([f84167d](https://github.com/mfalicoff/penny/commit/f84167d0729e8140de329f1b4c657867491a1dc5))
* **ios:** keep the currency symbol in the Lock Screen amount for suffix locales (MAZ-135) ([6cd04ce](https://github.com/mfalicoff/penny/commit/6cd04cead608bc78161ab41a786e28d9916123ac))
* **ios:** keep the shared schedule row compact on Recurring (MAZ-198) ([3366040](https://github.com/mfalicoff/penny/commit/33660407efc969022c09ca86bc6e5781989d959d))
* **ios:** make UI test element lookups cheap enough for slow CI runners (MAZ-163) ([#100](https://github.com/mfalicoff/penny/issues/100)) ([da2ae34](https://github.com/mfalicoff/penny/commit/da2ae34b90cd93abb0c01fc70fb6bea2c9ee0091))
* **ios:** match Recurring's sections, tiles and icons to the card (MAZ-219) ([43a0901](https://github.com/mfalicoff/penny/commit/43a090167f5121f46e2ea64beaf51559033bf0d7))
* **ios:** match the Accounts, account form, category form and schedule detail cards, and move and remove in-use accounts and categories ([#183](https://github.com/mfalicoff/penny/issues/183)) ([15f4346](https://github.com/mfalicoff/penny/commit/15f43466ff17054aebafedb37aeb44319fa91e26))
* **ios:** match the cards on Add entry, Insights, the calendar and the Home header ([d6f9271](https://github.com/mfalicoff/penny/commit/d6f9271f483a6454f660e756f053d4cd575028ce))
* **ios:** match the Settings, Appearance and Face ID lock cards and add the Display preferences ([#182](https://github.com/mfalicoff/penny/issues/182)) ([93baa03](https://github.com/mfalicoff/penny/commit/93baa03897a89c673e13524ad1a0cfdda8e5af17))
* **ios:** match the sign-in, create account, server connect and save banner cards ([#187](https://github.com/mfalicoff/penny/issues/187)) ([aa763de](https://github.com/mfalicoff/penny/commit/aa763de3af6ed9ee0ef64763f9597fcffb903305))
* **ios:** match the trips cards' toolbar, featured trip, rows, trip hero and trip form ([#178](https://github.com/mfalicoff/penny/issues/178)) ([2d52789](https://github.com/mfalicoff/penny/commit/2d5278964196a78801674c1e39fb99db3ec286da))
* **ios:** re-sync the design baseline and make the projected test locale-independent ([a614465](https://github.com/mfalicoff/penny/commit/a61446545ff4f55e2b502138314ba1d63c825a39))
* **ios:** spell the profile update's encoder as any Encoder ([b8b1c38](https://github.com/mfalicoff/penny/commit/b8b1c387cd5aa92ce7582dc81d1b31308f3aa991))
* keep an offline save whose receipt the server already cleaned up ([dc92e71](https://github.com/mfalicoff/penny/commit/dc92e711b8e125b18ba103425145f1c0e80a18ac))
* save a shared expense without a receipt the server already cleaned up ([f59852f](https://github.com/mfalicoff/penny/commit/f59852f46183ec3272d7cd1b70609e7f9fb11e84))
* **test-env:** encode certificate serials as minimal DER integers ([1292858](https://github.com/mfalicoff/penny/commit/129285842904829bf436180ee5ddb6b2ca3293b1))
* **web:** bring the entry panel back when the entry being edited is deleted elsewhere ([f0b090c](https://github.com/mfalicoff/penny/commit/f0b090c7274e67f9d58f9df930bfa51706b9caee))
* **web:** download the ledger once when Activity opens ([a7cf2bb](https://github.com/mfalicoff/penny/commit/a7cf2bbc52c6b131e3f99d84098091c4ecfdac44))
* **web:** draw the grouped categories as "Other expenses" on the money flow chart ([24339a9](https://github.com/mfalicoff/penny/commit/24339a97147e5e3af0082024427ba501763a9540))
* **web:** drop the entry time from the Activity cards and match the edit-entry and searching cards ([cdc89cd](https://github.com/mfalicoff/penny/commit/cdc89cd24c93c71d8f6cded189c576445c4b54a3))
* **web:** give phone toasts the tab bar's slot so they never move the page (MAZ-166) ([#110](https://github.com/mfalicoff/penny/issues/110)) ([f74634d](https://github.com/mfalicoff/penny/commit/f74634d6ecc797d70bc583f1e28be338e9092de2))
* **web:** keep recurring rows intact at phone width and list shared schedules (MAZ-177) ([59041cd](https://github.com/mfalicoff/penny/commit/59041cd7ad15f20b515052cd51f3ab1f1609ee70))
* **web:** keep Settings on the web-demo card and poll Home's section order ([8396113](https://github.com/mfalicoff/penny/commit/8396113f057691a015856633ba8db32834a1fc6a))
* **web:** name the real cause of a stale payment and add Record payment to the household header (MAZ-176) ([#96](https://github.com/mfalicoff/penny/issues/96)) ([e89962d](https://github.com/mfalicoff/penny/commit/e89962d98c88251fd675cb33dbd72ba117e80155))
* **web:** put the attached toast's buttons on their own row on phones (MAZ-205) ([#114](https://github.com/mfalicoff/penny/issues/114)) ([956204b](https://github.com/mfalicoff/penny/commit/956204bd8d24ba3035b22c14a7c644b3fc60f3eb))
* **web:** read the ledger currency from the offline store on the trip and household dialogs ([63201fa](https://github.com/mfalicoff/penny/commit/63201fa0a8121d2c9aac539ff300573c29f4f1c9))
* **web:** sign expense and income amounts in Home and Activity rows (MAZ-202) ([84d4558](https://github.com/mfalicoff/penny/commit/84d455841e8b86f2911fc8cd1a332a1b6e952473))
* **web:** split the iPad household hero across the two panes and read the add button + Expense ([0e97cba](https://github.com/mfalicoff/penny/commit/0e97cba718dd1af5d626324916a2d17000d0271d))
* **web:** widen the attached toast to 560px from 768px up (MAZ-208) ([#118](https://github.com/mfalicoff/penny/issues/118)) ([c292e9c](https://github.com/mfalicoff/penny/commit/c292e9cd294f81a01c0f465f240aacfdece586eb))


### Documentation

* **self-hosting:** upgrading to 3.0 needs the single database login (PENNY_DB_USER and PENNY_DB_PASSWORD) and no separate migrate step ([#204](https://github.com/mfalicoff/penny/issues/204)) ([f479073](https://github.com/mfalicoff/penny/commit/f47907310389efff60aff4f49152f023edce12ba))

## [2.0.0](https://github.com/mfalicoff/penny/compare/v1.0.0...v2.0.0) (2026-11-17)


### ⚠ BREAKING CHANGES

* Version 2 change bump

### Features

* **apphost:** run emailed receipts locally under Aspire (MAZ-184) ([#75](https://github.com/mfalicoff/penny/issues/75)) ([aedae08](https://github.com/mfalicoff/penny/commit/aedae085d999a278aaa5f49c93ec1d37555ea520))
* emailed receipts (MAZ-184) ([#74](https://github.com/mfalicoff/penny/issues/74)) ([2f9ec6f](https://github.com/mfalicoff/penny/commit/2f9ec6ff9a6ea00cb0e8df79b4815bf86ef0e366))


### Bug Fixes

* **search:** require meaning hits to beat a per-query baseline (MAZ-167) ([56dae6d](https://github.com/mfalicoff/penny/commit/56dae6dbc81149e717f0a380e9c40a40b7352303))


### Code Refactoring

* Version 2 change bump ([5abc89e](https://github.com/mfalicoff/penny/commit/5abc89eaf62caae4c37533a19306c6d67c7c6265))

## 1.0.0 (2026-10-25)


### Bug Fixes

* **deps:** update all dependencies ([aa115b5](https://github.com/mfalicoff/penny/commit/aa115b58c7ec20e43f0f66b02efacf588a82f19b))
