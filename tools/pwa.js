/* timetable-pwa-v7 */
;(() => {
  'use strict';
  let installPrompt=null;
  const buttons=[document.getElementById('install-login'),document.getElementById('install-app')].filter(Boolean);
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  function updateInstall(){for(const button of buttons)button.hidden=standalone();}
  updateInstall();
  matchMedia('(display-mode: standalone)').addEventListener?.('change',updateInstall);
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;updateInstall();});
  window.addEventListener('appinstalled',()=>{installPrompt=null;for(const button of buttons)button.hidden=true;document.getElementById('install-dialog')?.remove();});
  function guide(){
    if(document.getElementById('install-dialog'))return;
    const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const dialog=document.createElement('div');dialog.id='install-dialog';dialog.className='pdf-dialog';
    const section=document.createElement('section');section.className='pdf-card';section.setAttribute('role','dialog');section.setAttribute('aria-modal','true');section.setAttribute('aria-labelledby','install-title');
    const title=document.createElement('h2');title.id='install-title';title.textContent='ホーム画面に追加';
    const text=document.createElement('p');text.textContent=ios?'ブラウザの共有ボタン →「ホーム画面に追加」→「追加」を選んでください。':'ブラウザのメニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。';
    const note=document.createElement('p');note.textContent='一度オンラインで開くと、通信できないときも時間割を開けます。閲覧には毎回パスワードが必要です。';
    const close=document.createElement('button');close.className='secondary';close.textContent='閉じる';close.type='button';
    close.addEventListener('click',()=>dialog.remove());dialog.addEventListener('keydown',event=>{if(event.key==='Escape')dialog.remove();});
    section.append(title,text,note,close);dialog.append(section);document.body.append(dialog);close.focus();
  }
  for(const button of buttons)button.addEventListener('click',async()=>{
    document.getElementById('app-menu')?.removeAttribute('open');
    if(!installPrompt){guide();return;}
    const prompt=installPrompt;installPrompt=null;
    try{await prompt.prompt();const result=await prompt.userChoice;if(result?.outcome==='accepted')for(const b of buttons)b.hidden=true;}
    catch{guide();}
  });
  const offline=document.getElementById('offline-status');
  function connection(){offline.hidden=navigator.onLine;offline.textContent=navigator.onLine?'':'オフライン：この端末に保存した時間割を表示します。';}
  window.addEventListener('online',connection);window.addEventListener('offline',connection);connection();
  if(!('serviceWorker' in navigator)||!isSecureContext)return;
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})
    .then(()=>navigator.serviceWorker.ready)
    .then(()=>{const note=document.getElementById('offline-ready');if(note)note.textContent='通信できないときも、この端末で時間割を開けます。';})
    .catch(()=>{const note=document.getElementById('offline-ready');if(note)note.textContent='ホーム画面に追加すると、次回からすぐに開けます。';});
})();
