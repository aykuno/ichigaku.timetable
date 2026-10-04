import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { prepareContent, encryptHtml, renderPage } from '../tools/build-lib.mjs';
const password = 'public-browser-fixture-password';
const source = '<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><h1>模擬時間割</h1><p id="ready"></p><input id="query" aria-label="検索"><p id="result"></p><script>document.getElementById("ready").textContent="表示できました";document.getElementById("query").addEventListener("input",e=>{document.getElementById("result").textContent=e.target.value;});</script></body></html>';
const content = prepareContent(source), payload = await encryptHtml(content,password);
const unprovisionedPage = await readFile(new URL('../index.html',import.meta.url),'utf8');
let servedPage = await renderPage(content,payload);
const server = createServer((req,res) => {
  if (req.url === '/favicon.ico') {res.writeHead(204);res.end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); res.end(req.url === '/empty' ? unprovisionedPage : servedPage);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const url = 'http://127.0.0.1:'+server.address().port;
try {
  for (const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({viewport:{width:390,height:844}});
      const page = await context.newPage(), errors = [];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url+'/empty');
      assert.equal(await page.locator('#unlock').isEnabled(),false);
      assert.equal(await page.locator('#password').isEnabled(),false);
      assert.equal(await page.locator('iframe').count(),0);
      await page.goto(url);
      assert.equal(await page.locator('iframe').count(),0);
      assert.equal(await page.locator('#app').isVisible(),false);
      assert.equal(await page.locator('#unlock').isEnabled(),true);
      await page.locator('#password').fill('wrong-password'); await page.locator('#unlock').click();
      await page.locator('#status').filter({hasText:'パスワードが違う'}).waitFor();
      assert.equal(await page.locator('iframe').count(),0);
      await page.locator('#password').fill(password); await page.locator('#unlock').click();
      const frame = page.frameLocator('iframe');
      await frame.locator('#ready').filter({hasText:'表示できました'}).waitFor();
      assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts');
      await frame.locator('#query').fill('6-2');
      assert.equal(await frame.locator('#result').textContent(),'6-2');
      assert.equal(await page.locator('#password').inputValue(),'');
      assert.deepEqual(await page.evaluate(() => ({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
      await page.reload(); assert.equal(await page.locator('iframe').count(),0);
      await page.locator('#password').fill(password); await page.locator('#unlock').click();
      await page.frameLocator('iframe').locator('#ready').filter({hasText:'表示できました'}).waitFor();
      await page.locator('#logout').click();
      assert.equal(await page.locator('iframe').count(),0); assert.equal(await page.locator('#login').isVisible(),true);
      await page.clock.install();
      await page.locator('#password').fill(password); await page.locator('#unlock').click();
      await page.frameLocator('iframe').locator('#ready').filter({hasText:'表示できました'}).waitFor();
      await page.clock.fastForward(30*60*1000+1000);
      assert.equal(await page.locator('iframe').count(),0);
      assert.ok((await page.locator('#status').textContent()).includes('30分間'));
      const changed=Buffer.from(payload.ciphertext,'base64');changed[0]^=1;
      servedPage=await renderPage(content,{...payload,ciphertext:changed.toString('base64')});
      await page.reload(); await page.locator('#password').fill(password); await page.locator('#unlock').click();
      await page.locator('#status').filter({hasText:'パスワードが違う'}).waitFor();
      assert.equal(await page.locator('iframe').count(),0);
      servedPage=await renderPage(content,payload);
      assert.deepEqual(errors,[]);
      await context.close();
      console.log(name+': login, rejection, CSP sandbox, search, reload, logout, expiry and tampering passed');
    } finally {await browser.close();}
  }
} finally {await new Promise(resolve => server.close(resolve));}
