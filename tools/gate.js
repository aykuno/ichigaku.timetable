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
  let payload, sessionHtml = '', frames = [], generation = 0, busy = false, timer = null;
  const selections = new Map();
  const SAVED_KEY = 'ichigaku.timetable.preferences.v1';
  let preferenceSession = null, preferences = preferenceCrypto.empty(), saveQueue = Promise.resolve(), differenceOn = true, activePdf = null;
  const IDLE_MS = 30 * 60 * 1000;

  const bar = document.querySelector('.app-bar');
  new ResizeObserver(() => document.documentElement.style.setProperty('--bar-height', Math.max(56,bar.offsetHeight)+'px')).observe(bar);
  function send(frame, message) { frame.contentWindow?.postMessage(message, '*'); }
  function broadcastPreferences() {
    for (const frame of frames) send(frame,{type:'timetable-preferences',preferences});
  }
  function broadcastComparison() {
    for (const frame of frames) {
      const other=frames.find(x=>x!==frame);
      send(frame,{type:'timetable-comparison',key:other?selections.get(other)||'':'',enabled:app.classList.contains('comparing')&&differenceOn});
    }
  }
  function storageStatus(message) {
    for (const frame of frames) send(frame,{type:'timetable-storage-status',message});
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
  function closePdf() {
    document.getElementById('pdf-dialog')?.remove();
    if(activePdf)URL.revokeObjectURL(activePdf.url);
    activePdf=null;
  }
  function showPdf(data) {
    if(!(data.bytes instanceof ArrayBuffer)||data.bytes.byteLength<100||data.bytes.byteLength>5000000)return;
    const jpeg=new Uint8Array(data.bytes);
    if(jpeg[0]!==255||jpeg[1]!==216||jpeg[jpeg.length-2]!==255||jpeg[jpeg.length-1]!==217)return;
    closePdf();
    const blob=makeTimetablePdf(jpeg);
    const filename=String(data.filename||'時間割.pdf').replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,180);
    activePdf={blob,filename,url:URL.createObjectURL(blob)};
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
    document.getElementById('pdf-open').addEventListener('click',()=>window.open(activePdf.url,'_blank','noopener'));
    document.getElementById('pdf-close').addEventListener('click',()=>{const frame=frames[0];closePdf();frame?.focus();});
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape')closePdf();});
    (share.hidden?download:share).focus();
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
    heading.textContent = '画面 ' + number;
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
    if (value && frames.length === 1) createScreen(2);
    const second = document.getElementById('screen-2');
    if (second) second.hidden = !value;
    app.classList.toggle('comparing', value);
    compare.setAttribute('aria-pressed', String(value));
    compare.textContent = value ? '1画面に戻す' : '2画面で比較';
    differences.hidden = !value;
    broadcastComparison();
  }
  function lock(message = '') {
    generation++;
    clearTimeout(timer);
    container.replaceChildren();
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
  differences.addEventListener('click',()=>{
    differenceOn=!differenceOn;
    differences.setAttribute('aria-pressed',String(differenceOn));
    broadcastComparison();
    resetTimer();
  });
  document.getElementById('logout').addEventListener('click', () => {
    lock('ログアウトしました。');
    input.focus();
  });
  window.addEventListener('message', event => {
    const frame=frames.find(frame=>event.source===frame.contentWindow);
    if(!frame||!event.data)return;
    const data=event.data;
    if(data.type==='timetable-activity')resetTimer();
    if(data.type==='timetable-feature-ready'){send(frame,{type:'timetable-preferences',preferences});broadcastComparison();}
    if(data.type==='timetable-selection'&&typeof data.key==='string'&&data.key.length<300){if(data.key==='')selections.delete(frame);else if(/^(teacher|class):/.test(data.key))selections.set(frame,data.key);else return;broadcastComparison();}
    if(data.type==='timetable-save')savePreferences(data.change);
    if(data.type==='timetable-pdf')showPdf(data);
  });
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => { if (frames.length) resetTimer(); }, {passive: true});
  }
  window.addEventListener('pagehide', () => lock());
  window.addEventListener('pageshow', event => { if (event.persisted) lock(); });
})();
