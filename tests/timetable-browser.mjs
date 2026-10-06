import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
import { prepareContent, encryptHtml, renderPage } from '../tools/build-lib.mjs';
const password = 'public-anonymous-timetable-test-password';
const source = await readFile(new URL('./fixtures/timetable.html',import.meta.url),'utf8');
const content = prepareContent(source);
const protectedPage = await renderPage(content,await encryptHtml(content,password));
const server = createServer((req,res)=>{
  if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(protectedPage);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
try {
  for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
    const browser=await engine.launch();
    try {
      for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
        const context=await browser.newContext({viewport});
        const page=await context.newPage();
        page.setDefaultTimeout(10000);
        const errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(url);
        assert.equal(await page.locator('iframe').count(),0);
        await page.locator('#password').fill(password);
        await page.locator('#unlock').click();
        const app=page.frameLocator('#screen-1 iframe');
        await app.locator('#q').waitFor();
        await app.locator('#viewer .title').filter({hasText:'時間割を選択してください'}).waitFor();
        assert.equal(await app.locator('#viewer .table').count(),0);
        assert.equal(await app.locator('#q').inputValue(),'');
        await app.locator('#q').fill('6-2');
        assert.deepEqual(await app.locator('#results .result .n').allTextContents(),['6-2','担任A','副担任B']);
        await app.locator('#results .result').first().click();
        await app.locator('#viewer .title').filter({hasText:'6-2'}).waitFor();
        assert.equal(await app.locator('.table tbody tr').count(),7);
        assert.equal(await app.locator('.table tbody td').count(),42);
        assert.ok((await app.locator('#viewer .duties').textContent()).includes('担任：担任A'));
        assert.ok((await app.locator('#viewer .duties').textContent()).includes('副担任：副担任B'));
        await app.locator('#q').focus();
        await app.locator('#results .result').nth(1).click();
        assert.equal(await app.locator('#viewer .title').textContent(),'担任A');
        assert.ok((await app.locator('#viewer .restday').textContent()).includes('土'));
        await app.locator('#q').fill('たんにんえー');
        assert.deepEqual(await app.locator('#results .result .n').allTextContents(),['担任A']);
        await app.locator('#q').fill('確認部');
        assert.deepEqual(await app.locator('#results .result .n').allTextContents(),['担任A','副担任B']);
        await app.locator('#lessonSearchBox summary').click();
        await app.locator('#lessonSearchBtn').click();
        assert.deepEqual(await app.locator('.lessonResult .className').allTextContents(),['6-2']);
        await app.locator('.lessonResult').click();
        assert.equal(await app.locator('#viewer .title').textContent(),'6-2');
        // The two panes select independently and retain both selections when toggled.
        assert.equal(await page.locator('iframe').count(),1);
        assert.equal(await page.locator('#compare').getAttribute('aria-pressed'),'false');
        await page.locator('#compare').click();
        assert.equal(await page.locator('#compare').getAttribute('aria-pressed'),'true');
        const second=page.frameLocator('#screen-2 iframe');
        const shared=page.frameLocator('#shared-tools iframe');
        await shared.locator('#common-tools').waitFor();
        assert.equal(await app.locator('#lessonSearchBox').isVisible(),false);
        assert.equal(await second.locator('#lessonSearchBox').isVisible(),false);
        assert.equal(await second.locator('#free-tools').isVisible(),false);
        assert.equal(await second.locator('#common-tools').isVisible(),false);
        await page.waitForFunction(()=>parseInt(document.querySelector('#screen-1 iframe').style.height)>500);
        await second.locator('#q').waitFor();
        await second.locator('#viewer .title').filter({hasText:'時間割を選択してください'}).waitFor();
        await second.locator('#q').fill('6-3');
        await second.locator('#results .result').first().click();
        await second.locator('#viewer .title').filter({hasText:'6-3'}).waitFor();
        assert.equal(await app.locator('#viewer .title').textContent(),'6-2');
        await app.locator('#q').fill('担任A');
        await app.locator('#results .result').first().click();
        await app.locator('#viewer .title').filter({hasText:'担任A'}).waitFor();
        assert.equal(await second.locator('#viewer .title').textContent(),'6-3');

        async function verifyLayout(width) {
          await page.setViewportSize({width,height:viewport.height});
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
          const toolsBox=await page.locator('#shared-tools').boundingBox();
          const firstBox=await page.locator('#screen-1').boundingBox();
          assert.ok(firstBox.y>=toolsBox.y+toolsBox.height-1,'shared tools precede both timetables');
          const secondBox=await page.locator('#screen-2').boundingBox();
          if(width>760) {
            assert.ok(secondBox.x>=firstBox.x+firstBox.width);
            assert.ok(Math.abs(firstBox.y-secondBox.y)<2);
          } else {
            assert.ok(secondBox.y>=firstBox.y+firstBox.height);
            assert.ok(Math.abs(firstBox.x-secondBox.x)<2);
          }
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        }
        await verifyLayout(viewport.width);
        await verifyLayout(viewport.width===390?1280:390);
        await verifyLayout(viewport.width);
        assert.equal(await app.locator('#viewer .title').textContent(),'担任A');
        assert.equal(await second.locator('#viewer .title').textContent(),'6-3');
        await page.locator('#compare').click();
        assert.equal(await page.locator('#screen-2').isVisible(),false);
        assert.equal(await page.locator('#compare').getAttribute('aria-pressed'),'false');
        assert.equal(await app.locator('#viewer .title').textContent(),'担任A');
        await page.locator('#compare').click();
        assert.equal(await second.locator('#viewer .title').textContent(),'6-3');
        assert.equal(await second.locator('#q').inputValue(),'6-3');
        assert.equal(await app.locator('#q').inputValue(),'担任A');
        const sandboxed=await app.locator('body').evaluate(()=>{
          try {void parent.document.body;return false;}catch{return true;}
        });
        assert.equal(sandboxed,true);
        if(name==='Chromium'&&viewport.width===390){
          await page.locator('#screen-2').scrollIntoViewIfNeeded();
          await second.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          console.log('UI_VISUAL_comparison:'+(await page.screenshot({fullPage:true})).toString('base64'));
        }
        for(const pane of [app,second]){
          const overflow=await pane.locator('body').evaluate(()=>document.documentElement.scrollHeight-innerHeight);
          assert.ok(overflow<=1,'comparison iframe should fit its full content: '+overflow);
        }
        // A shared lesson result opens the first timetable without changing the second.
        if(!await shared.locator('#lessonSearchBox').evaluate(node=>node.open))await shared.locator('#lessonSearchBox summary').click();
        await shared.locator('#lessonSearchBtn').click();
        await shared.locator('.lessonResult').first().click();
        await app.locator('#viewer .title').filter({hasText:'6-2'}).waitFor();
        assert.equal(await second.locator('#viewer .title').textContent(),'6-3');
        await page.locator('#home').click();
        await app.locator('#viewer .title').filter({hasText:'時間割を選択してください'}).waitFor();
        assert.equal(await page.locator('iframe').count(),1);
        assert.equal(await page.locator('#compare').getAttribute('aria-pressed'),'false');
        assert.equal(await app.locator('#q').inputValue(),'');
        assert.equal(await app.locator('.sidebar').isVisible(),false);
        assert.equal(await app.locator('.feature-hub details[open]').count(),0);
        assert.equal(await app.locator('#common-selected button').count(),0);
        assert.equal(await app.locator('.search-label').textContent(),'教員・クラスを検索');
        if(name==='Chromium'&&viewport.width===390){
          console.log('UI_VISUAL_home:'+(await page.screenshot()).toString('base64'));
        }
        await page.locator('#logout').click();
        assert.equal(await page.locator('iframe').count(),0);
        assert.deepEqual(errors,[]);
        await context.close();
        console.log(name+' '+viewport.width+'px: timetable, class-first order, teacher, hiragana, duties, lesson search, independent comparison, responsive layout, retained selections and sandbox passed');
      }
    } finally {await browser.close();}
  }
} finally {await new Promise(resolve=>server.close(resolve));}
