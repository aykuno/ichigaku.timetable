import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium,webkit} from 'playwright';
import {prepareContent,encryptHtml,renderPage} from '../tools/build-lib.mjs';
const password='public-timetable-feature-fixture-password';
// Exercise the presentation update against the old protected application shape.
const source=await readFile(new URL('./fixtures/features-legacy.html',import.meta.url),'utf8');
const content=prepareContent(source),html=await renderPage(content,await encryptHtml(content,password));
const server=createServer((req,res)=>{if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
try{
 for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
  const browser=await engine.launch();
  try{
   for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport,acceptDownloads:true});
    await context.addInitScript(()=>{
      Object.defineProperty(navigator,'canShare',{value:({files})=>files?.[0]?.type==='application/pdf'});
      Object.defineProperty(navigator,'share',{value:async({files})=>{window.sharedPdf={name:files[0].name,type:files[0].type,size:files[0].size};}});
    });
    const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    async function login(){await page.locator('#password').fill(password);await page.locator('#unlock').click();await page.frameLocator('#screen-1 iframe').locator('#favorite-toggle').waitFor();}
    const app=page.frameLocator('#screen-1 iframe');
    async function select(label){await app.locator('#q').fill(label);await app.locator('#results .result').first().click();await app.locator('#viewer .title').filter({hasText:label}).waitFor();}
    await page.clock.install({time:new Date('2026-10-04T23:40:00Z')});
    await page.goto(url);await login();await select('6-2');
    // The timetable must precede optional tools and fit near the top on phones.
    assert.equal(await app.locator('.layout + .feature-hub').count(),1);
    assert.equal(await app.locator('.controls #lessonSearchBox').count(),0);
    assert.equal(await app.locator('#quick-access').isVisible(),false);
    const initialTableTop=await app.locator('#viewer .table').evaluate(node=>node.getBoundingClientRect().top+scrollY);
    if(viewport.width<640)assert.ok(initialTableTop<460,'phone timetable starts at '+initialTableTop+'px');
    assert.ok((await app.locator('#now-text').textContent()).includes('現在：月曜1限'));
    // Thursday has a seventh period; the same time on Friday is outside lessons.
    await page.clock.setSystemTime(new Date('2026-10-08T06:20:00Z'));await select('6-2');
    assert.ok((await app.locator('#now-text').textContent()).includes('現在：木曜7限'));
    assert.equal(await app.locator('.cell.now-cell[data-period="6"][data-day="3"]').count(),1);
    await page.clock.setSystemTime(new Date('2026-10-09T06:20:00Z'));await select('6-2');
    assert.ok((await app.locator('#now-text').textContent()).includes('現在：授業時間外'));
    assert.equal(await app.locator('.cell.now-cell').count(),0);
    await page.clock.setSystemTime(new Date('2026-10-04T23:40:00Z'));await select('6-2');
    await app.locator('#viewer .cell[data-period="0"][data-day="0"]').click();
    assert.equal(await app.locator('#viewer .title').textContent(),'担任A');
    assert.ok((await app.locator('.teacher-profile').textContent()).includes('数学Ⅲ'));
    assert.equal(await app.locator('.teacher-profile').getAttribute('open'),null);
    await app.locator('#viewer .cell[data-period="0"][data-day="0"]').click();
    assert.equal(await app.locator('#viewer .title').textContent(),'6-2');

    await app.locator('#free-tools summary').click();
    await app.locator('#free-day').selectOption('1');await app.locator('#free-period').selectOption('2');await app.locator('#free-search').click();
    const free=app.locator('[data-free-group="free"]');
    const freeNames=await free.locator('button').allTextContents();
    assert.ok(freeNames.includes('担任A')&&freeNames.includes('副担任B'));
    assert.ok(!freeNames.some(x=>/授業C|指定休F|産休D/.test(x)));
    assert.ok((await app.locator('[data-free-group="rest"]').textContent()).includes('指定休F：指定休'));
    assert.ok((await app.locator('[data-free-group="unknown"]').textContent()).includes('産休D'));
    await app.locator('#free-subject').selectOption('英語');await app.locator('#free-grade').selectOption('6');await app.locator('#free-search').click();
    assert.deepEqual((await free.locator('button').allTextContents()).sort(),['休みE','副担任B'].sort());

    await app.locator('#common-tools summary').click();await app.locator('#common-homeroom').click();
    const grid=app.locator('.common-table tbody');
    assert.equal(await grid.locator('tr').nth(0).locator('td').nth(0).getAttribute('data-status'),'partial');
    assert.equal(await grid.locator('tr').nth(2).locator('td').nth(1).getAttribute('data-status'),'free');
    assert.equal(await grid.locator('tr').nth(1).locator('td').nth(4).getAttribute('data-status'),'busy');
    assert.equal(await grid.locator('tr').nth(0).locator('td').nth(5).getAttribute('data-status'),'rest');
    await app.locator('input[data-teacher="teacher:休みE"]').check();
    assert.equal(await grid.locator('tr').nth(1).locator('td').nth(4).getAttribute('data-status'),'partial');

    await page.locator('#compare').click();
    const other=page.frameLocator('#screen-2 iframe');
    await other.locator('#favorite-toggle').waitFor();
    await other.locator('#q').fill('担任A');await other.locator('#results .result').first().click();
    await app.locator('.cell[data-period="0"][data-day="0"][data-difference="related"]').waitFor();
    await page.locator('#differences').click();
    await app.locator('.cell[data-difference]').first().waitFor({state:'detached'});
    assert.equal(await app.locator('.cell[data-difference]').count(),0);
    await page.locator('#differences').click();
    await app.locator('.cell[data-difference="related"]').waitFor();
    await other.locator('#q').fill('副担任B');await other.locator('#results .result').first().click();
    await select('担任A');await app.locator('#common-comparison').click();
    assert.equal(await app.locator('#common-selected button').count(),2);
    await app.locator('#favorite-toggle').click();
    await other.locator('#favorite-toggle').click();
    await app.locator('#favorites-list button').filter({hasText:'副担任B'}).waitFor();
    await other.locator('#favorites-list button').filter({hasText:'担任A'}).waitFor();
    await page.waitForFunction(()=>{const raw=localStorage.getItem('ichigaku.timetable.preferences.v1');return raw&&JSON.parse(raw).ciphertext;});
    const saved=await page.evaluate(()=>localStorage.getItem('ichigaku.timetable.preferences.v1'));
    assert.ok(!saved.includes('担任A')&&!saved.includes('副担任B')&&!saved.includes('6-2'));
    await page.evaluate(()=>window.postMessage({type:'timetable-save',change:{type:'favorite',key:'teacher:forged',enabled:true}},'*'));

    // These are synthetic test bell times, not asserted school times.
    await page.clock.setSystemTime(new Date('2026-10-04T23:40:00Z'));
    await select('6-2');
    await app.locator('#clock-tools summary').click();
    await app.locator('#bell-mode').selectOption('high');
    const bells=[['08:30','09:20'],['09:30','10:20'],['10:30','11:20'],['11:30','12:20'],['13:10','14:00'],['14:10','15:00'],['15:10','16:00']];
    for(let p=0;p<7;p++){await app.locator('#bell-start-'+p).fill(bells[p][0]);await app.locator('#bell-end-'+p).fill(bells[p][1]);}
    await app.locator('#bell-save').click();
    try {await app.locator('#now-text').filter({hasText:'現在：月曜1限'}).waitFor();}
    catch(error){
      console.log('clock diagnostics',JSON.stringify({
        now:await app.locator('#now-text').textContent(),
        childDate:await app.locator('body').evaluate(()=>new Date().toISOString()),
        parentDate:await page.evaluate(()=>new Date().toISOString()),
        level:await app.locator('#clock-level').inputValue(),
        mode:await app.locator('#bell-mode').inputValue(),
        bellStatus:await app.locator('#bell-status').textContent(),
        starts:await app.locator('#bell-grid input').evaluateAll(nodes=>nodes.map(n=>n.value)),
        stored:await page.evaluate(async password=>{const raw=localStorage.getItem('ichigaku.timetable.preferences.v1');return (await preferenceCrypto.open(password,JSON.parse(raw))).preferences;},password),
        errors
      }));
      throw error;
    }
    assert.equal(await app.locator('.cell.now-cell').count(),1);
    assert.ok((await app.locator('#now-text').textContent()).includes('次の授業：水曜3限 家庭'));
    await page.waitForFunction(async password=>{
      try{
        const raw=localStorage.getItem('ichigaku.timetable.preferences.v1');
        const restored=await preferenceCrypto.open(password,JSON.parse(raw));
        return restored.preferences.bells.high?.[0]?.[0]==='08:30'&&restored.preferences.favorites.includes('teacher:担任A')&&restored.preferences.favorites.includes('teacher:副担任B')&&!restored.preferences.favorites.includes('teacher:forged');
      }catch{return false;}
    },password);
    await page.clock.fastForward(41*60*1000);
    // Idle logout intentionally follows the clock jump; log back in with saved preferences.
    await login();
    await app.locator('#favorites-list button').filter({hasText:'担任A'}).waitFor();
    await app.locator('#favorites-list button').filter({hasText:'副担任B'}).waitFor();
    await select('担任A');
    await app.locator('#timetable-pdf').click();await page.locator('#pdf-dialog').waitFor();
    await page.locator('#pdf-share').click();
    assert.equal((await page.evaluate(()=>window.sharedPdf)).type,'application/pdf');
    const downloadPromise=page.waitForEvent('download');await page.locator('#pdf-download').click();
    const download=await downloadPromise,buffer=await readFile(await download.path()),text=buffer.toString('latin1');
    assert.equal(text.slice(0,8),'%PDF-1.4');assert.ok(text.includes('/Count 1'));
    assert.ok(text.includes('/Width 1240 /Height 1754'));
    assert.ok(text.includes('/MediaBox [0 0 595.276 841.890]'));
    const xref=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(text.slice(xref,xref+4),'xref');
    const offsets=text.slice(xref).split('\n').slice(3,8);
    for(let n=1;n<=5;n++){const offset=Number(offsets[n-1].slice(0,10));assert.ok(text.slice(offset).startsWith(n+' 0 obj\n'));}
    await page.locator('#pdf-close').click();await page.locator('#compare').click();await other.locator('#favorite-toggle').waitFor();
    await app.locator('#timetable-pdf').click();await page.locator('#pdf-dialog').waitFor();
    await page.clock.fastForward(30*60*1000+1000);
    assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('#pdf-dialog').count(),0);
    assert.deepEqual(errors,[]);
    await context.close();console.log(name+' '+viewport.width+'px: free filters, leave exclusions, 2/3-person common slots, reverse links, profiles, differences, encrypted merged favorites, JST clock, PDF/share/download/xref and expiry passed');
   }
  }finally{await browser.close();}
 }
}finally{await new Promise(resolve=>server.close(resolve));}
