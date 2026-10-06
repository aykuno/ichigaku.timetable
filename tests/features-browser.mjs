import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {inflateSync} from 'node:zlib';
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
    async function login(){await page.locator('#password').fill(password);await page.locator('#unlock').click();await page.frameLocator('#screen-1 iframe').locator('#viewer .title').filter({hasText:'時間割を選択してください'}).waitFor();}
    const app=page.frameLocator('#screen-1 iframe');
    async function select(label){await app.locator('#q').fill(label);await app.locator('#results .result').first().click();await app.locator('#viewer .title').filter({hasText:label}).waitFor();}
    await page.clock.install({time:new Date('2026-10-04T23:40:00Z')});
    await page.goto(url);await login();await select('6-2');
    // The timetable must precede optional tools and fit near the top on phones.
    assert.equal(await app.locator('.layout + .feature-hub').count(),1);
    assert.equal(await app.locator('.controls #lessonSearchBox').count(),0);
    assert.equal(await app.locator('#quick-access').isVisible(),false);
    assert.equal(await app.locator('.sidebar').isVisible(),false);
    assert.equal(await app.locator('#clock-tools, #recent-tools, #clock-edit').count(),0);
    await app.locator('#q').fill('担任');
    assert.equal(await app.locator('.sidebar').isVisible(),true);
    await select('6-2');
    assert.equal(await app.locator('.sidebar').isVisible(),false);
    const initialTableTop=await app.locator('#viewer .table').evaluate(node=>node.getBoundingClientRect().top+scrollY);
    if(viewport.width<640)assert.ok(initialTableTop<410,'phone timetable starts at '+initialTableTop+'px');
    async function assertFrameWidth(){
      const dimensions=await app.locator('body').evaluate(()=>{
        const table=document.querySelector('#viewer .table'),columns=[...table.tHead.rows[0].cells];
        return {viewport:innerWidth,page:document.documentElement.scrollWidth,
          tableRight:table.getBoundingClientRect().right,
          dayRights:columns.slice(1).map(node=>node.getBoundingClientRect().right)};
      });
      assert.ok(dimensions.page<=dimensions.viewport+1,'content overflow: '+JSON.stringify(dimensions));
      assert.ok(dimensions.tableRight<=dimensions.viewport+1,'timetable extends off screen');
      assert.equal(dimensions.dayRights.length,6);
      assert.ok(dimensions.dayRights.every(right=>right<=dimensions.viewport+1),'weekday columns are off screen');
    }
    await assertFrameWidth();
    assert.ok((await app.locator('#now-text').textContent()).includes('現在：月曜1限'));
    // Current and next lessons are separate rows; teacher-name separators do not collide with the subject.
    await app.locator('body').evaluate(()=>{
      const item=ITEMS.find(item=>item.key==='class:6-2');
      window.originalClockGrid=item.d.map(row=>row.map(cell=>[...cell]));
      const add=text=>{TEXTS.push(text);return TEXTS.length-1;};
      item.d[5][1]=[add('英コミュⅢ'),add('富永/中野靖'),0];
      item.d[0][2]=[add('芸術'),add('宮田/宇佐見'),0];
      const ghost=add('授業なし検証');
      for(const d of [0,1,2,4,5])item.d[6][d]=[ghost,0,0];
    });
    await page.clock.setSystemTime(new Date('2026-10-06T05:30:00Z'));await select('6-2');
    assert.equal(await app.locator('#now-text .now-entry').count(),2);
    assert.ok((await app.locator('.now-current .now-heading').textContent()).includes('現在：火曜6限 英コミュⅢ'));
    assert.equal(await app.locator('.now-current .now-detail').textContent(),'担当：富永・中野靖');
    assert.ok((await app.locator('.now-next .now-heading').textContent()).includes('次の授業：水曜1限 芸術'));
    assert.equal(await app.locator('.now-next .now-detail').textContent(),'担当：宮田・宇佐見');
    assert.ok(!(await app.locator('#now-text').textContent()).includes(' ／ '));
    for(const d of [0,1,2,4,5]){
      const cell=app.locator('.cell[data-period="6"][data-day="'+d+'"]');
      assert.equal(await cell.getAttribute('data-school-no-lesson'),'true');
      assert.equal((await cell.textContent()).trim(),'—');
      assert.ok((await cell.getAttribute('aria-label')).includes('授業なし'));
      assert.equal(await cell.locator('.cell-link').count(),0);
    }
    if(name==='Chromium'&&viewport.width===390)console.log('NOW_VISUAL:'+(await app.locator('.now-line').screenshot()).toString('base64'));
    await app.locator('body').evaluate(()=>{
      window.schoolPdfText=[];window.originalSchoolFill=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text){window.schoolPdfText.push(String(text));return window.originalSchoolFill.apply(this,arguments);};
    });
    await app.locator('#timetable-pdf').click();await page.locator('#pdf-dialog').waitFor({timeout:30000});
    assert.equal(await page.locator('#pdf-filename').textContent(),'2026クラス時間割_6-2_20261006_1430.pdf');
    const classPaint=await app.locator('body').evaluate(()=>window.schoolPdfText);
    assert.ok(!classPaint.includes('授業なし検証'));
    assert.equal(classPaint.filter(text=>text==='—').length,7);
    await page.locator('#pdf-close').click();
    await app.locator('body').evaluate(()=>{CanvasRenderingContext2D.prototype.fillText=window.originalSchoolFill;});
    for(const date of ['2026-10-05','2026-10-06','2026-10-07','2026-10-09']){
      await page.clock.setSystemTime(new Date(date+'T06:20:00Z'));await select('6-2');
      assert.ok((await app.locator('.now-current').textContent()).includes('現在：授業時間外'));
      assert.equal(await app.locator('.cell.now-cell').count(),0);
      assert.ok(!/(?:月|火|水|金|土)曜7限/.test(await app.locator('.now-next').textContent()));
    }
    await app.locator('body').evaluate(()=>{ITEMS.find(item=>item.key==='class:6-2').d=window.originalClockGrid;});

    // Thursday has a seventh period; the same time on Friday is outside lessons.
    await page.clock.setSystemTime(new Date('2026-10-08T06:20:00Z'));await select('6-2');
    assert.ok((await app.locator('#now-text').textContent()).includes('現在：木曜7限'));
    assert.equal(await app.locator('.cell.now-cell[data-period="6"][data-day="3"]').count(),1);
    await page.clock.setSystemTime(new Date('2026-10-09T06:20:00Z'));await select('6-2');
    assert.ok((await app.locator('#now-text').textContent()).includes('現在：授業時間外'));
    assert.equal(await app.locator('.cell.now-cell').count(),0);
    await page.clock.setSystemTime(new Date('2026-10-10T02:50:00Z'));await select('6-2');
    assert.ok((await app.locator('#now-text').textContent()).includes('現在：土曜4限'));
    await page.clock.setSystemTime(new Date('2026-10-10T04:20:00Z'));await select('6-2');
    assert.ok((await app.locator('#now-text').textContent()).includes('現在：授業時間外'));
    assert.equal(await app.locator('.cell.now-cell').count(),0);
    assert.ok(!/次の授業：土曜[567]限/.test(await app.locator('#now-text').textContent()));
    await page.clock.setSystemTime(new Date('2026-10-04T23:40:00Z'));await select('6-2');
    await app.locator('#viewer .cell[data-period="0"][data-day="0"]').click();
    assert.equal(await app.locator('#viewer .title').textContent(),'担任A');
    assert.ok((await app.locator('.teacher-profile').textContent()).includes('数学Ⅲ'));
    assert.equal(await app.locator('.teacher-profile summary').count(),0);
    assert.equal(await app.locator('.teacher-profile .profile-line').first().isVisible(),true);
    assert.equal(await app.locator('.teacher-profile h3').textContent(),'担当');
    assert.equal(await app.locator('.teacher-profile .profile-duties').count(),0);
    assert.ok((await app.locator('.teacher-affiliations').textContent()).includes('確認部 部長'));
    assert.ok(await app.locator('.teacher-affiliations').evaluate(node=>!!(node.compareDocumentPosition(document.querySelector('#viewer .restday'))&Node.DOCUMENT_POSITION_PRECEDING)));
    assert.equal(await app.locator('.subject-chip').first().textContent(),'数学Ⅲ');
    const profileBelow=await app.locator('.teacher-profile').evaluate(node=>node.compareDocumentPosition(document.querySelector('#viewer .tableWrap'))&Node.DOCUMENT_POSITION_PRECEDING);
    assert.ok(profileBelow,'profile should follow timetable');
    await app.locator('#viewer .cell[data-period="0"][data-day="0"]').click();
    assert.equal(await app.locator('#viewer .title').textContent(),'6-2');

    await app.locator('#free-tools summary').click();
    await app.locator('#free-day').selectOption('1');await app.locator('#free-period').selectOption('2');await app.locator('#free-search').click();
    const free=app.locator('[data-free-group="free"]');
    const freeNames=await free.locator('button').allTextContents();
    assert.ok(freeNames.includes('担任A')&&freeNames.includes('副担任B'));
    assert.ok(!freeNames.some(x=>/授業C|指定休F|産休D/.test(x)));
    assert.ok((await app.locator('[data-free-group="rest"]').textContent()).includes('指定休F：指定休'));
    assert.equal(await app.locator('[data-free-group="unknown"]').count(),0);
    assert.ok((await app.locator('[data-free-group="rest"]').textContent()).includes('産休D：産休'));
    assert.ok((await app.locator('[data-free-group="rest"]').textContent()).includes('育休H：育休'));
    assert.ok((await app.locator('[data-free-group="rest"]').textContent()).includes('山口：出勤時間外'));
    assert.ok(freeNames.includes('出勤日I'));
    // Seminar attendance is limited to Friday periods five and six.
    await app.locator('#free-day').selectOption('4');
    for(const period of ['0','3']){
      await app.locator('#free-period').selectOption(period);await app.locator('#free-search').click();
      assert.ok((await app.locator('[data-free-group="rest"]').textContent()).includes('山口：出勤時間外'));
      assert.ok(!(await free.textContent()).includes('山口'));
    }
    for(const period of ['4','5']){
      await app.locator('#free-period').selectOption(period);await app.locator('#free-search').click();
      assert.ok((await app.locator('[data-free-group="busy"]').textContent()).includes('山口'));
      assert.ok(!(await app.locator('[data-free-group="rest"]').textContent()).includes('山口'));
    }
    await app.locator('#free-day').selectOption('0');await app.locator('#free-period').selectOption('2');await app.locator('#free-search').click();
    assert.ok((await app.locator('[data-free-group="rest"]').textContent()).includes('出勤日I：出勤日外'));
    await app.locator('#free-day').selectOption('1');await app.locator('#free-search').click();
    // A slash inside a course name must remain inside one subject chip.
    await select('複合G');
    assert.deepEqual(await app.locator('.subject-chip').allTextContents(),['地理探究/公共','日本史探究']);
    await select('6-2');
    await app.locator('#free-subject').selectOption('英語');await app.locator('#free-grade').selectOption('6');await app.locator('#free-search').click();
    assert.deepEqual((await free.locator('button').allTextContents()).sort(),['休みE','副担任B'].sort());

    await app.locator('#common-tools summary').click();
    assert.equal(await app.locator('#common-options').isVisible(),false);
    assert.equal(await app.locator('#common-options [data-teacher]').count(),0);
    assert.equal(await app.locator('#common-current').isVisible(),false);
    assert.equal(await app.locator('#common-comparison').isVisible(),false);
    assert.equal(await app.locator('#common-homeroom').textContent(),'6-2の担任・副担任を選ぶ');
    // Search, add, and remove teachers without displaying all teachers at once.
    await app.locator('#common-query').fill('担任A');
    await app.locator('[data-teacher="teacher:担任A"]').click();
    assert.equal(await app.locator('#common-query').inputValue(),'');
    assert.equal(await app.locator('#common-message').textContent(),'あと1人追加してください。');
    await app.locator('#common-query').fill('副担任B');
    await app.locator('[data-teacher="teacher:副担任B"]').click();
    assert.equal(await app.locator('#common-count').textContent(),'選択中：2人');
    await app.locator('[data-remove="teacher:副担任B"]').click();
    assert.equal(await app.locator('#common-grid').textContent(),'');
    await app.locator('#common-homeroom').click();
    const grid=app.locator('.common-table tbody');
    assert.equal(await grid.locator('tr').nth(0).locator('td').nth(0).getAttribute('data-status'),'partial');
    assert.equal(await grid.locator('tr').nth(2).locator('td').nth(1).getAttribute('data-status'),'free');
    assert.equal(await grid.locator('tr').nth(1).locator('td').nth(4).getAttribute('data-status'),'busy');
    assert.equal(await grid.locator('tr').nth(0).locator('td').nth(5).getAttribute('data-status'),'rest');
    const mondayFirst=grid.locator('tr').nth(0).locator('td').nth(0);
    assert.equal(await mondayFirst.locator('[data-key="teacher:担任A"]').getAttribute('data-person-status'),'busy');
    assert.ok((await mondayFirst.locator('[data-key="teacher:担任A"]').textContent()).includes('授業'));
    assert.equal(await mondayFirst.locator('[data-key="teacher:副担任B"]').getAttribute('data-person-status'),'free');
    assert.ok((await mondayFirst.locator('[data-key="teacher:副担任B"]').textContent()).includes('空き'));
    const saturdayFirst=grid.locator('tr').nth(0).locator('td').nth(5);
    assert.ok((await saturdayFirst.locator('[data-key="teacher:担任A"]').textContent()).includes('指定休'));
    assert.ok((await saturdayFirst.locator('[data-key="teacher:副担任B"]').textContent()).includes('空き'));
    assert.ok(!/予定|1\/2|指定休・休みあり/.test(await grid.textContent()));
    await mondayFirst.click();
    assert.ok((await app.locator('#common-slot-detail').textContent()).includes('数学Ⅲ / 6-2'));
    await app.locator('[data-close-slot]').click();
    await assertFrameWidth();
    assert.equal(await grid.locator('tr').nth(4).locator('td').nth(5).getAttribute('data-status'),'no-lesson');
    assert.equal(await grid.locator('tr').nth(6).locator('td').nth(0).getAttribute('data-status'),'no-lesson');
    const commonRight=await app.locator('.common-table').evaluate(node=>node.getBoundingClientRect().right);
    const frameWidth=await app.locator('body').evaluate(()=>innerWidth);
    assert.ok(commonRight<=frameWidth+1,'common grid should fit on phones');
    await app.locator('#common-query').fill('休みE');
    await app.locator('[data-teacher="teacher:休みE"]').click();
    assert.equal(await grid.locator('tr').nth(1).locator('td').nth(4).getAttribute('data-status'),'partial');

    await app.locator('#common-query').fill('産休D');
    await app.locator('[data-teacher="teacher:産休D"]').click();
    assert.ok((await grid.locator('tr').nth(2).locator('td').nth(1).locator('[data-key="teacher:産休D"]').textContent()).includes('産休'));
    assert.equal(await grid.locator('tr').nth(2).locator('td').nth(1).getAttribute('data-status'),'rest');
    await app.locator('#common-query').fill('山口');
    await app.locator('[data-teacher="teacher:山口"]').click();
    assert.ok((await grid.locator('tr').nth(0).locator('td').nth(0).locator('[data-key="teacher:山口"]').textContent()).includes('出勤時間外'));
    assert.ok((await grid.locator('tr').nth(4).locator('td').nth(4).locator('[data-key="teacher:山口"]').textContent()).includes('授業'));
    await app.locator('#common-clear').click();await app.locator('#common-homeroom').click();
    await page.locator('#compare').click();
    const other=page.frameLocator('#screen-2 iframe');
    await other.locator('#q').waitFor();
    await other.locator('#q').fill('担任A');await other.locator('#results .result').first().click();
    await app.locator('.cell[data-period="0"][data-day="0"][data-difference="related"]').waitFor();
    await page.locator('#differences').click();
    await app.locator('.cell[data-difference]').first().waitFor({state:'detached'});
    assert.equal(await app.locator('.cell[data-difference]').count(),0);
    await page.locator('#differences').click();
    await app.locator('.cell[data-difference="related"]').waitFor();
    await other.locator('#q').fill('副担任B');await other.locator('#results .result').first().click();
    await select('担任A');
    const shared=page.frameLocator('#shared-tools iframe');
    if(!await shared.locator('#common-tools').evaluate(node=>node.open))await shared.locator('#common-tools summary').click();
    await shared.locator('#common-comparison').click();
    assert.equal(await shared.locator('#common-selected button').count(),2);
    assert.equal(await app.locator('#common-tools').isVisible(),false);
    assert.equal(await other.locator('#common-tools').isVisible(),false);
    await app.locator('#favorite-toggle').click();
    await other.locator('#favorite-toggle').click();
    await app.locator('#favorites-list button').filter({hasText:'副担任B'}).waitFor();
    await other.locator('#favorites-list button').filter({hasText:'担任A'}).waitFor({state:'attached'});
    await page.waitForFunction(()=>{const raw=localStorage.getItem('ichigaku.timetable.preferences.v1');return raw&&JSON.parse(raw).ciphertext;});
    const saved=await page.evaluate(()=>localStorage.getItem('ichigaku.timetable.preferences.v1'));
    assert.ok(!saved.includes('担任A')&&!saved.includes('副担任B')&&!saved.includes('6-2'));
    await page.evaluate(()=>window.postMessage({type:'timetable-save',change:{type:'favorite',key:'teacher:forged',enabled:true}},'*'));

    await page.clock.setSystemTime(new Date('2026-10-04T23:40:00Z'));
    await select('6-2');
    assert.equal(await app.locator('.cell.now-cell').count(),1);
    assert.ok((await app.locator('#now-text').textContent()).includes('現在：月曜1限'));
    assert.ok((await app.locator('#now-text').textContent()).includes('次の授業：水曜3限 家庭'));
    await page.waitForFunction(async password=>{
      try{
        const raw=localStorage.getItem('ichigaku.timetable.preferences.v1');
        const restored=await preferenceCrypto.open(password,JSON.parse(raw));
        return restored.preferences.favorites.includes('teacher:担任A')&&restored.preferences.favorites.includes('teacher:副担任B')&&!restored.preferences.favorites.includes('teacher:forged');
      }catch{return false;}
    },password);
    await page.clock.fastForward(41*60*1000);
    // Idle logout intentionally follows the clock jump; log back in with saved preferences.
    await login();
    await app.locator('#favorites-list button').filter({hasText:'担任A'}).waitFor();
    await app.locator('#favorites-list button').filter({hasText:'副担任B'}).waitFor();
    await page.clock.setSystemTime(new Date('2026-10-06T05:38:00Z'));
    await select('担任A');
    await app.locator('body').evaluate(()=>{
      window.pdfPaint=[];window.pdfRects=[];
      const originalFillText=CanvasRenderingContext2D.prototype.fillText;
      const originalFillRect=CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y){
        const m=this.getTransform();
        window.pdfPaint.push({text:String(text),x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f,color:this.fillStyle,font:this.font});
        return originalFillText.apply(this,arguments);
      };
      CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){
        const m=this.getTransform();
        window.pdfRects.push({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f,w:m.a*w,h:m.d*h,sourceW:w,sourceH:h});
        return originalFillRect.apply(this,arguments);
      };
    });
    const siteRole=await app.locator('.teacher-affiliations .green').evaluate(node=>({text:node.textContent.trim(),color:(()=>{const ctx=document.createElement('canvas').getContext('2d');ctx.fillStyle=getComputedStyle(node).color;return ctx.fillStyle;})()}));
    await app.locator('#timetable-pdf').click();await page.locator('#pdf-dialog').waitFor({timeout:30000});
    await page.locator('#pdf-share').click();
    assert.equal((await page.evaluate(()=>window.sharedPdf)).type,'application/pdf');
    assert.equal((await page.evaluate(()=>window.sharedPdf)).name,'2026教職員時間割_担任A_20261006_1438.pdf');
    const downloadPromise=page.waitForEvent('download');await page.locator('#pdf-download').click();
    const download=await downloadPromise;assert.equal(download.suggestedFilename(),'2026教職員時間割_担任A_20261006_1438.pdf');
    const buffer=await readFile(await download.path()),text=buffer.toString('latin1');
    assert.equal(text.slice(0,8),'%PDF-1.4');assert.ok(text.includes('/Count 1'));
    assert.ok(text.includes('/Width 2480 /Height 3508'));
    assert.ok(text.includes('/Filter /FlateDecode'));
    const imageStart=text.indexOf('/Subtype /Image'),streamStart=text.indexOf('stream\n',imageStart)+7;
    const imageLength=Number(text.slice(imageStart,streamStart).match(/\/Length (\d+)/)[1]);
    assert.equal(inflateSync(buffer.subarray(streamStart,streamStart+imageLength)).length,2480*3508*3);
    const painting=await app.locator('body').evaluate(()=>({text:window.pdfPaint,rects:window.pdfRects}));
    const rolePaint=painting.text.find(point=>point.text===siteRole.text);
    assert.equal(rolePaint.color,siteRole.color);
    assert.ok(painting.text.some(point=>point.text==='指定休：土'));
    const firstRow=painting.rects.find(rect=>rect.sourceW===56&&rect.sourceH===128);
    const periodOne=painting.text.find(point=>point.text==='1'&&/26px/.test(point.font));
    assert.ok(Math.abs(periodOne.y-(firstRow.y+firstRow.h/2))<.01,'period must be vertically centered');
    const subject=painting.text.find(point=>point.text==='数学Ⅲ'&&point.y>firstRow.y&&point.y<firstRow.y+firstRow.h);
    const className=painting.text.find(point=>point.text==='6-2'&&point.y>firstRow.y&&point.y<firstRow.y+firstRow.h);
    assert.ok(subject.y<periodOne.y&&className.y>periodOne.y,'subject and class must surround the cell center');
    const firstText=painting.text[0],lastText=painting.text.filter(point=>point.text.startsWith('教員別 ver')).at(-1);
    assert.ok(firstText.y>=120&&firstText.y<=180,'PDF starts near the top of the page: '+firstText.y);
    assert.ok((firstText.y+lastText.y)/2<3508/2-100,'page content shifts upward while cells remain centered');
    async function previewPdf(path,label){
      if(name!=='Chromium'||viewport.width!==390)return;
      const directory=await mkdtemp(join(tmpdir(),'timetable-pdf-'));
      const prefix=join(directory,label);
      execFileSync('pdftoppm',['-f','1','-singlefile','-scale-to','1400','-png',path,prefix]);
      const png=await readFile(prefix+'.png');
      console.log('PDF_VISUAL_'+label+':'+png.toString('base64'));
    }
    await previewPdf(await download.path(),'teacher');
    assert.ok(text.includes('/MediaBox [0 0 595.276 841.890]'));
    const xref=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(text.slice(xref,xref+4),'xref');
    const offsets=text.slice(xref).split('\n').slice(3,8);
    for(let n=1;n<=5;n++){const offset=Number(offsets[n-1].slice(0,10));assert.ok(text.slice(offset).startsWith(n+' 0 obj\n'));}
    await page.locator('#pdf-close').click();
    await app.locator('body').evaluate(()=>{
      DUTIES['複合G']=[{t:'6-2担任',c:'red'},{t:'地歴公民科主任',c:'blue'},{t:'教務部',c:'green'},{t:'なずな祭推進委員会',c:'black'}];
      REST_DAYS['複合G']='水';
      const teacher=ITEMS.find(item=>item.n==='複合G');teacher.d[2][0]=teacher.d[0][0];teacher.d[0][0]=[0,0,0];
      window.pdfPaint=[];window.pdfRects=[];
    });
    await select('複合G');
    if(name==='WebKit'&&viewport.width===1280)await app.locator('body').evaluate(()=>Object.defineProperty(window,'CompressionStream',{value:undefined,configurable:true}));
    const subjectInk=await app.locator('#viewer .cell:not(.empty) .toptext').first().evaluate(node=>{const ctx=document.createElement('canvas').getContext('2d');ctx.fillStyle=getComputedStyle(node).color;return ctx.fillStyle;});
    const roles=await app.locator('.teacher-affiliations .duty').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent.trim(),color:(()=>{const ctx=document.createElement('canvas').getContext('2d');ctx.fillStyle=getComputedStyle(node).color;return ctx.fillStyle;})()})));
    await app.locator('#timetable-pdf').click();await page.locator('#pdf-dialog').waitFor({timeout:30000});
    const compositeDownload=page.waitForEvent('download');await page.locator('#pdf-download').click();
    const composite=await compositeDownload;
    const compositeBytes=await readFile(await composite.path());
    assert.ok(compositeBytes.toString('latin1').includes('/Width 2480 /Height 3508'));
    if(name==='WebKit'&&viewport.width===1280)assert.ok(compositeBytes.toString('latin1').includes('/Filter /DCTDecode'),'JPEG fallback must work without CompressionStream');
    const compositePaint=await app.locator('body').evaluate(()=>window.pdfPaint);
    for(const role of roles)assert.equal(compositePaint.find(point=>point.text===role.text)?.color,role.color,'role color differs from website');
    assert.ok(compositePaint.some(point=>point.text==='地理探究/公共'),'composite course must remain a single chip');
    assert.equal(compositePaint.find(point=>point.text==='地理探究/公共').color,subjectInk,'an empty first cell must not gray all lesson text');
    assert.ok(compositePaint.some(point=>point.text==='指定休：水'));
    await previewPdf(await composite.path(),'composite');
    await page.locator('#pdf-close').click();await page.locator('#compare').click();await other.locator('#q').waitFor();
    assert.equal(await page.locator('#comparison-pdf').isDisabled(),true);
    await other.locator('#q').fill('副担任B');await other.locator('#results .result').first().click();
    await other.locator('#viewer .title').filter({hasText:'副担任B'}).waitFor();
    await page.locator('#comparison-pdf').waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.getElementById('comparison-pdf').disabled);
    await other.locator('body').evaluate(()=>{window.pairPaint=[];const old=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text){window.pairPaint.push(String(text));return old.apply(this,arguments);};});
    await page.locator('#comparison-pdf').click();await page.locator('#pdf-dialog').waitFor({timeout:30000});
    assert.equal(await page.locator('#pdf-filename').textContent(),'2026教職員時間割_複合G・副担任B_20261006_1438.pdf');
    await page.locator('#pdf-share').click();
    assert.equal((await page.evaluate(()=>window.sharedPdf)).name,'2026教職員時間割_複合G・副担任B_20261006_1438.pdf');
    const pairDownloadPromise=page.waitForEvent('download');await page.locator('#pdf-download').click();
    const pairDownload=await pairDownloadPromise,pairPath=await pairDownload.path();
    assert.equal(pairDownload.suggestedFilename(),'2026教職員時間割_複合G・副担任B_20261006_1438.pdf');
    const pairBytes=await readFile(pairPath),pairText=pairBytes.toString('latin1');
    assert.ok(pairText.includes('/Count 2'));
    const secondPainting=await other.locator('body').evaluate(()=>window.pairPaint);assert.ok(secondPainting.includes('副担任B'));assert.equal(secondPainting.at(-1),'2');
    assert.equal((pairText.match(/\/Subtype \/Image/g)||[]).length,2);
    const info=execFileSync('pdfinfo',[pairPath],{encoding:'utf8'});
    assert.match(info,/Pages:\s+2/);assert.ok(info.includes('2026教職員時間割_複合G・副担任B_20261006_1438'));
    if(name==='Chromium'&&viewport.width===390){
      const directory=await mkdtemp(join(tmpdir(),'timetable-pair-'));
      for(const n of [1,2]){
        const prefix=join(directory,'page-'+n);
        execFileSync('pdftoppm',['-f',String(n),'-singlefile','-scale-to','1000','-png',pairPath,prefix]);
        console.log('PAIR_VISUAL_'+n+':'+(await readFile(prefix+'.png')).toString('base64'));
      }
    }
    await page.clock.fastForward(30*60*1000+1000);
    assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('#pdf-dialog').count(),0);
    assert.deepEqual(errors,[]);
    await context.close();console.log(name+' '+viewport.width+'px: free filters, leave exclusions, 2/3-person common slots, reverse links, profiles, differences, encrypted merged favorites, JST clock, PDF/share/download/xref and expiry passed');
   }
  }finally{await browser.close();}
 }
}finally{await new Promise(resolve=>server.close(resolve));}

