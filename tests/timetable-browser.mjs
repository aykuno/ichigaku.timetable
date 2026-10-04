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
        page.on('pageerror',e=>{errors.push(e.message);console.log(name+' page error: '+e.message);});
        page.on('console',m=>{if(m.type()==='error')console.log(name+' console error: '+m.text());});
        await page.goto(url);
        assert.equal(await page.locator('iframe').count(),0);
        await page.locator('#password').fill(password);
        await page.locator('#unlock').click();
        const app=page.frameLocator('iframe');
        await app.locator('#q').waitFor();
        await app.locator('#viewer .title').waitFor();
        console.log(name+' ready: '+await app.locator('#viewer .title').textContent());
        await app.locator('#q').fill('6-2');
        console.log(name+' class results: '+JSON.stringify(await app.locator('#results .result .n').allTextContents()));
        await app.locator('#viewer .title').filter({hasText:'6-2'}).waitFor();
        assert.deepEqual(await app.locator('#results .result .n').allTextContents(),['6-2','担任A','副担任B']);
        assert.equal(await app.locator('.table tbody tr').count(),7);
        assert.equal(await app.locator('.table tbody td').count(),42);
        assert.ok((await app.locator('#viewer .duties').textContent()).includes('担任：担任A'));
        assert.ok((await app.locator('#viewer .duties').textContent()).includes('副担任：副担任B'));
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
        const sandboxed=await app.locator('body').evaluate(()=>{
          try {void parent.document.body;return false;}catch{return true;}
        });
        assert.equal(sandboxed,true);
        await page.locator('#logout').click();
        assert.equal(await page.locator('iframe').count(),0);
        assert.deepEqual(errors,[]);
        await context.close();
        console.log(name+' '+viewport.width+'px: timetable, class-first order, teacher, hiragana, duties, lesson search and sandbox passed');
      }
    } finally {await browser.close();}
  }
} finally {await new Promise(resolve=>server.close(resolve));}
