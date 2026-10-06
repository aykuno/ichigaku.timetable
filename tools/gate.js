(() => {
  'use strict';
  const form = document.getElementById('login-form');
  const input = document.getElementById('password');
  const submit = document.getElementById('unlock');
  const toggle = document.getElementById('show-password');
  const compare = document.getElementById('compare');
  const differences = document.getElementById('differences');
  const status = document.getElementById('status');
  const login = document.getElementById('login');
  const app = document.getElementById('app');
  const container = document.getElementById('frame-container');
  const toolsPanel=document.getElementById('shared-tools');
  let toolsFrame=null, toolsReady=false, pendingTools=null;
  const allFrames=()=>toolsFrame?[...frames,toolsFrame]:frames;
  let payload, sessionHtml = '', frames = [], generation = 0, busy = false, timer = null;
  const selections = new Map();
  const SAVED_KEY = 'ichigaku.timetable.preferences.v1';
  let preferenceSession = null, preferences = preferenceCrypto.empty(), saveQueue = Promise.resolve(), differenceOn = true, activePdf = null;
  const IDLE_MS = 30 * 60 * 1000;
  const pairButton=document.getElementById('comparison-pdf'),pairStatus=document.getElementById('comparison-pdf-status');
  let pairPdf=null,pairTimer=null;

  const bar = document.querySelector('.app-bar');
  new ResizeObserver(() => document.documentElement.style.setProperty('--bar-height', Math.max(56,bar.offsetHeight)+'px')).observe(bar);
  function send(frame, message) { frame.contentWindow?.postMessage(message, '*'); }
  function broadcastPreferences() {
    for (const frame of allFrames()) send(frame,{type:'timetable-preferences',preferences});
  }
  function broadcastComparison() {
    for (const frame of frames) {
      const other=frames.find(x=>x!==frame);
      send(frame,{type:'timetable-comparison',key:other?selections.get(other)||'':'',enabled:app.classList.contains('comparing')&&differenceOn});
    }
    syncTools();
    updatePairControl();
  }
  function updateDisplayModes(){
    const comparing=app.classList.contains('comparing');
    frames.forEach((frame,i)=>{
      if(!comparing)frame.style.height='';
      send(frame,{type:'timetable-display-mode',mode:comparing?(i?'comparison-secondary':'comparison-primary'):'single'});
    });
    if(toolsFrame)send(toolsFrame,{type:'timetable-display-mode',mode:'tools'});
  }
  function syncTools(){
    if(!toolsFrame)return;
    send(toolsFrame,{type:'timetable-comparison',key:selections.get(frames[1])||'',enabled:app.classList.contains('comparing')&&differenceOn});
    const key=selections.get(frames[0]);
    if(key)send(toolsFrame,{type:'timetable-open-selection',key});
  }
  function createTools(){
    if(toolsFrame||!sessionHtml.includes('timetable-ui-v7'))return;
    toolsFrame=document.createElement('iframe');
    toolsFrame.title='比較で共通の検索ツール';
    toolsFrame.setAttribute('sandbox','allow-scripts');
    toolsFrame.setAttribute('referrerpolicy','no-referrer');
    toolsFrame.srcdoc=sessionHtml;toolsPanel.append(toolsFrame);
  }
  function clearTools(){
    toolsPanel.replaceChildren();toolsPanel.hidden=true;
    toolsFrame=null;toolsReady=false;pendingTools=null;
  }
  function storageStatus(message) {
    for (const frame of allFrames()) send(frame,{type:'timetable-storage-status',message});
  }
  function savePreferences(change) {
    if (!preferenceSession) return;
    preferences=preferenceCrypto.update(preferences,change);
    broadcastPreferences();
    const snapshot=structuredClone(preferences),session=preferenceSession,attempt=generation;
    saveQueue=saveQueue.catch(()=>{}).then(async()=>{
      const sealed=await preferenceCrypto.seal(session,snapshot);
      if(attempt!==generation||session!==preferenceSession)return;
      try { localStorage.setItem(SAVED_KEY,JSON.stringify(sealed));storageStatus('この端末に暗号化して保存しました。'); }
      catch { storageStatus('このブラウザでは端末に保存できません。表示中のみ保持します。'); }
    }).catch(()=>{if(attempt===generation)storageStatus('端末への保存に失敗しました。');});
  }
  function pdfFilename(items,exportedAt){
    const date=new Date(exportedAt+9*60*60*1000),pad=value=>String(value).padStart(2,'0');
    const stamp=date.getUTCFullYear()+pad(date.getUTCMonth()+1)+pad(date.getUTCDate())+'_'+pad(date.getUTCHours())+pad(date.getUTCMinutes());
    const prefix=items.every(item=>item.kind==='teacher')?'2026教職員時間割':items.every(item=>item.kind==='class')?'2026クラス時間割':'2026時間割';
    return (prefix+'_'+items.map(item=>item.name).join('・')+'_'+stamp+'.pdf').replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,180);
  }
  function updatePairControl(){
    const comparing=app.classList.contains('comparing');
    document.getElementById('comparison-actions').hidden=!comparing;
    pairButton.disabled=!!pairPdf||!comparing||!selections.get(frames[0])||!selections.get(frames[1]);
    if(!pairPdf)pairStatus.textContent=pairButton.disabled&&comparing?'時間割①・②を選ぶと、まとめて保存できます。':'';
  }
  function cancelPair(message=''){
    clearTimeout(pairTimer);pairPdf=null;updatePairControl();if(message)pairStatus.textContent=message;
  }
  function requestPairPage(number){
    const job=pairPdf;if(!job)return;
    pairStatus.textContent=number+' / 2ページを作成しています…';
    send(frames[number-1],{type:'timetable-pdf-render',key:job.keys[number-1],requestId:job.id,pageNumber:number,exportedAt:job.exportedAt});
  }
  function validateRaster(data){
    if(!(data.bytes instanceof ArrayBuffer)||data.bytes.byteLength<100||data.bytes.byteLength>5000000)return null;
    const raster=new Uint8Array(data.bytes),width=data.width??1240,height=data.height??1754,encoding=data.encoding||'jpeg';
    if(!((width===1240&&height===1754)||(width===2480&&height===3508)))return null;
    if(encoding==='jpeg'){
      if(raster[0]!==255||raster[1]!==216||raster[raster.length-2]!==255||raster[raster.length-1]!==217)return null;
    }else if(encoding==='rgb-deflate'){
      if((raster[0]&15)!==8||((raster[0]<<8)|raster[1])%31!==0)return null;
    }else return null;
    return {raster,width,height,encoding};
  }
  function closePdf(){
    document.getElementById('pdf-dialog')?.remove();
    if(activePdf){
      URL.revokeObjectURL(activePdf.url);
      if(activePdf.namedUrl)navigator.serviceWorker?.controller?.postMessage({type:'timetable-release-pdf',url:activePdf.namedUrl});
    }
    activePdf=null;
  }
  function showPdf(data){
    const page=validateRaster(data);if(!page)return;
    const filename=data.item?pdfFilename([data.item],data.exportedAt||Date.now()):String(data.filename||'2026時間割.pdf').replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,180);
    const blob=makeTimetablePdf(page.raster,{...page,title:filename.replace(/\.pdf$/,'')});
    showPdfFile(blob,filename);
  }
  function showPdfFile(blob,filename) {
    closePdf();
    activePdf={blob,filename,url:URL.createObjectURL(new File([blob],filename,{type:'application/pdf'}))};
    const dialog=document.createElement('div');dialog.id='pdf-dialog';dialog.className='pdf-dialog';
    dialog.innerHTML='<section class="pdf-card" role="dialog" aria-modal="true" aria-labelledby="pdf-title"><h2 id="pdf-title">PDFの準備ができました</h2><p id="pdf-filename"></p><p class="pdf-guide">iPhoneでは「PDFを共有して保存」から「ファイルに保存」を選べます。</p><button id="pdf-share" type="button" class="secondary">PDFを共有して保存</button><a id="pdf-download">PDFをダウンロード</a><button id="pdf-open" type="button" class="secondary">PDFを開く</button><button id="pdf-close" type="button" class="secondary">閉じる</button><p id="pdf-message" role="status"></p></section>';
    document.body.append(dialog);
    document.getElementById('pdf-filename').textContent=filename;
    const download=document.getElementById('pdf-download');download.href=activePdf.url;download.download=filename;
    const file=new File([blob],filename,{type:'application/pdf'});
    const share=document.getElementById('pdf-share');
    share.hidden=!(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]}));
    share.addEventListener('click',async()=>{
      try {await navigator.share({files:[file],title:filename});}
      catch(error){const message=document.getElementById('pdf-message');if(message)message.textContent=error.name==='AbortError'?'共有を取り消しました。':'共有できませんでした。「PDFを開く」かダウンロードをご利用ください。';}
    });
    document.getElementById('pdf-open').addEventListener('click',()=>{if(activePdf.namedUrl)window.open(activePdf.namedUrl,'_blank','noopener');else document.getElementById('pdf-download').click();});
    document.getElementById('pdf-close').addEventListener('click',()=>{const frame=frames[0];closePdf();frame?.focus();});
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape')closePdf();});
    prepareNamedPdf(activePdf);
    (share.hidden?download:share).focus();
  }
  async function prepareNamedPdf(pdf){
    const worker=navigator.serviceWorker?.controller;if(!worker)return;
    const channel=new MessageChannel();
    const reply=new Promise(resolve=>{
      const timeout=setTimeout(()=>resolve(null),1500);
      channel.port1.onmessage=event=>{clearTimeout(timeout);resolve(event.data?.url||null);};
    });
    try{
      worker.postMessage({type:'timetable-hold-pdf',bytes:await pdf.blob.arrayBuffer(),filename:pdf.filename},[channel.port2]);
      const url=await reply;
      if(!url)return;
      const parsed=new URL(url),root=new URL('./',location.href);
      if(parsed.origin!==location.origin||!parsed.pathname.startsWith(root.pathname+'__pdf/'))return;
      if(activePdf!==pdf){worker.postMessage({type:'timetable-release-pdf',url});return;}
      pdf.namedUrl=url;const download=document.getElementById('pdf-download');
      if(download)download.href=url+'?download=1';
    }catch{}finally{channel.port1.close();}
  }
  function setBusy(value) {
    busy = value;
    input.disabled = value;
    toggle.disabled = value;
    submit.disabled = value;
    submit.textContent = value ? '確認しています…' : '時間割を開く';
    form.setAttribute('aria-busy', String(value));
  }
  function resetTimer() {
    clearTimeout(timer);
    if (frames.length) timer = setTimeout(() => lock('30分間操作がなかったため、ログアウトしました。'), IDLE_MS);
  }
  function createScreen(number) {
    const panel = document.createElement('section');
    panel.id = 'screen-' + number;
    panel.className = 'screen-panel';
    const heading = document.createElement('h2');
    heading.id = panel.id + '-heading';
    heading.className = 'screen-heading';
    heading.textContent = '時間割 ' + (number===1?'①':'②');
    panel.setAttribute('aria-labelledby', heading.id);
    const frame = document.createElement('iframe');
    frame.title = 'クラス・教員時間割検索（画面 ' + number + '）';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = sessionHtml;
    panel.append(heading, frame);
    container.append(panel);
    frames.push(frame);
    return panel;
  }
  function setComparing(value) {
    if(!value)cancelPair();
    if (value && frames.length === 1) createScreen(2);
    if(value)createTools();
    if(!value&&toolsFrame)send(toolsFrame,{type:'timetable-request-tools'});
    toolsPanel.hidden=!value||!toolsFrame;
    const second = document.getElementById('screen-2');
    if (second) second.hidden = !value;
    app.classList.toggle('comparing', value);
    compare.setAttribute('aria-pressed', String(value));
    compare.textContent = value ? '1画面に戻す' : '2画面で比較';
    differences.hidden = !value;
    broadcastComparison();
    updateDisplayModes();
  }
  function lock(message = '') {
    generation++;
    cancelPair();
    clearTimeout(timer);
    container.replaceChildren();
    clearTools();
    frames = [];
    selections.clear();
    sessionHtml = '';
    preferenceSession = null;
    preferences = preferenceCrypto.empty();
    saveQueue = Promise.resolve();
    differenceOn = true;
    differences.setAttribute('aria-pressed','true');
    closePdf();
    setComparing(false);
    app.hidden = true;
    login.hidden = false;
    form.reset();
    input.type = 'password';
    toggle.textContent = '表示';
    toggle.setAttribute('aria-pressed', 'false');
    input.removeAttribute('aria-invalid');
    status.textContent = message;
    setBusy(false);
  }
  try {
    payload = JSON.parse(document.getElementById('encrypted-payload').textContent);
    if (payload === null) {
      status.textContent = '現在準備中です。';
      input.disabled = true;
      toggle.disabled = true;
      submit.disabled = true;
      return;
    }
    if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
      throw new Error('Web Crypto unavailable');
    }
    input.disabled = false;
    toggle.disabled = false;
    submit.disabled = false;
  } catch {
    status.textContent = 'HTTPSで開き、最新のSafariまたはChromeをご利用ください。';
    submit.disabled = true;
    return;
  }
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? '隠す' : '表示';
    toggle.setAttribute('aria-pressed', String(show));
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const password = input.value;
    if (!password) {
      status.textContent = 'パスワードを入力してください。';
      input.focus();
      return;
    }
    const attempt = ++generation;
    input.value = '';
    input.removeAttribute('aria-invalid');
    status.textContent = '';
    setBusy(true);
    try {
      const html = await decryptHtml(payload, password);
      if (attempt !== generation) return;
      let stored = null;
      try {
        const value=localStorage.getItem(SAVED_KEY);
        if(value&&value.length<100000)stored=JSON.parse(value);
      } catch {}
      let restored;
      try {restored=await preferenceCrypto.open(password,stored);}
      catch {restored=await preferenceCrypto.open(password,null);}
      if(attempt!==generation)return;
      preferenceSession=restored;
      preferences=restored.preferences;
      sessionHtml = applyTimetablePresentation(html);
      container.replaceChildren();
      clearTools();
      selections.clear();
      frames = [];
      createScreen(1);
      setComparing(false);
      login.hidden = true;
      app.hidden = false;
      resetTimer();
    } catch {
      if (attempt === generation) {
        status.textContent = 'パスワードが違うか、ファイルが破損しています。';
        input.setAttribute('aria-invalid', 'true');
      }
    } finally {
      if (attempt === generation) {
        setBusy(false);
        if (!frames.length) input.focus();
      }
    }
  });
  compare.addEventListener('click', () => {
    if (!frames.length) return;
    setComparing(!app.classList.contains('comparing'));
    resetTimer();
  });
  pairButton.addEventListener('click',()=>{
    if(pairButton.disabled||pairPdf)return;
    pairPdf={id:crypto.randomUUID(),keys:frames.slice(0,2).map(frame=>selections.get(frame)),pages:[],items:[],exportedAt:Date.now()};
    updatePairControl();resetTimer();requestPairPage(1);
    pairTimer=setTimeout(()=>cancelPair('PDFを作成できませんでした。もう一度お試しください。'),45000);
  });
  differences.addEventListener('click',()=>{
    differenceOn=!differenceOn;
    differences.setAttribute('aria-pressed',String(differenceOn));
    broadcastComparison();
    resetTimer();
  });
  document.getElementById('home').addEventListener('click',()=>{
    if(!sessionHtml)return;
    cancelPair();closePdf();clearTools();container.replaceChildren();frames=[];selections.clear();
    differenceOn=true;differences.setAttribute('aria-pressed','true');
    const panel=createScreen(1);panel.querySelector('iframe').dataset.home='true';
    setComparing(false);window.scrollTo(0,0);resetTimer();
  });
  document.getElementById('logout').addEventListener('click', () => {
    lock('ログアウトしました。');
    input.focus();
  });
  window.addEventListener('message', event => {
    const frame=allFrames().find(frame=>event.source===frame.contentWindow);
    if(!frame||!event.data)return;
    const data=event.data;
    if(data.type==='timetable-activity')resetTimer();
    if(data.type==='timetable-feature-ready'){send(frame,{type:'timetable-preferences',preferences});broadcastComparison();}
    if(frame!==toolsFrame&&data.type==='timetable-selection'&&typeof data.key==='string'&&data.key.length<300){if(data.key==='')selections.delete(frame);else if(/^(teacher|class):/.test(data.key))selections.set(frame,data.key);else return;if(pairPdf&&selections.get(frame)!==pairPdf.keys[frames.indexOf(frame)])cancelPair('時間割が変わりました。もう一度PDF保存を押してください。');broadcastComparison();}
    if(data.type==='timetable-ui-ready'){
      if(frame===toolsFrame){
        toolsReady=true;send(frame,{type:'timetable-display-mode',mode:'tools'});
        if(pendingTools)send(frame,{type:'timetable-restore-tools',state:pendingTools});
        syncTools();
      }else{
        updateDisplayModes();
        if(frame.dataset.home==='true'){delete frame.dataset.home;send(frame,{type:'timetable-home'});}
      }
    }
    if(data.type==='timetable-frame-height'&&app.classList.contains('comparing')){
      const h=data.height;
      if(Number.isFinite(h)&&h>=0&&h<=12000)frame.style.height=Math.max(frame===toolsFrame?0:200,Math.ceil(h))+'px';
    }
    if(data.type==='timetable-tool-state'){
      if(frame===toolsFrame&&!app.classList.contains('comparing'))send(frames[0],{type:'timetable-restore-tools',state:data.state});
      if(frame===frames[0]&&app.classList.contains('comparing')){
        pendingTools=data.state;if(toolsReady)send(toolsFrame,{type:'timetable-restore-tools',state:pendingTools});
      }
    }
    if(frame===toolsFrame&&data.type==='timetable-tool-open'&&typeof data.key==='string'&&/^(teacher|class):/.test(data.key))send(frames[0],{type:'timetable-open-selection',key:data.key});
    if(data.type==='timetable-save')savePreferences(data.change);
    if(data.type==='timetable-pdf-error'&&pairPdf?.id===data.requestId)cancelPair('PDFを作成できませんでした。もう一度お試しください。');
    if(data.type==='timetable-pdf-page'&&pairPdf?.id===data.requestId){
      const number=pairPdf.pages.length+1,page=validateRaster(data);
      if(frame!==frames[number-1]||data.pageNumber!==number||data.item?.key!==pairPdf.keys[number-1])return;
      if(!page){cancelPair('PDFを作成できませんでした。もう一度お試しください。');return;}
      pairPdf.pages.push(page);pairPdf.items.push(data.item);
      if(number===1)requestPairPage(2);
      else{
        const job=pairPdf,filename=pdfFilename(job.items,job.exportedAt);
        cancelPair();showPdfFile(makeTimetablePdf(null,{pages:job.pages,title:filename.replace(/\.pdf$/,'')}),filename);
        pairStatus.textContent='2ページのPDFを作成しました。';
      }
    }
    if(data.type==='timetable-pdf'){cancelPair();showPdf(data);}
  });
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => { if (frames.length) resetTimer(); }, {passive: true});
  }
  window.addEventListener('pagehide', () => lock());
  window.addEventListener('pageshow', event => { if (event.persisted) lock(); });
})();
