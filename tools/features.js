/* timetable-enhancements-v1 */
;(() => {
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=escapeHtml;
  const TEACHERS=ITEMS.filter(x=>x.kind==='teacher').sort((a,b)=>normalize(a.reading||a.n).localeCompare(normalize(b.reading||b.n),'ja'));
  const CLASSES=ITEMS.filter(x=>x.kind==='class');
  const DEFAULT_BELLS=[['08:35','09:25'],['09:35','10:25'],['10:35','11:25'],['11:35','12:25'],['13:10','14:00'],['14:10','15:00'],['15:10','16:00']];
  const selected=new Set();
  let prefs={favorites:[],recent:[],bells:{}}, prefsReady=false;
  let peer=null, differenceEnabled=false;
  const profileCache=new Map(), referencesCache=new Map();
  const classRefs=text=>{
    const expanded=String(text||'').replace(/([1-6])-(\d+(?:理|文)?(?:\/\d+(?:理|文)?)+)/g,(_,g,rest)=>rest.split('/').map(c=>g+'-'+c).join(' '));
    const tokens=expanded.match(/[1-6]-\d+(?:理|文)?/g)||[];
    return CLASSES.filter(c=>tokens.includes(c.n) || tokens.some(t=>/理|文/.test(c.n)&&c.n.replace(/[理文]$/,'')===t));
  };
  function teacherRefs(text) {
    const s=normalize(text);
    const tokens=String(text||'').split(/[\s/／・、,&＆＋+]+/).map(normalize);
    const exact=TEACHERS.filter(t=>tokens.includes(normalize(t.n)));
    if(exact.length)return exact;
    const found=TEACHERS.filter(t=>s.includes(normalize(t.n))).sort((a,b)=>b.n.length-a.n.length);
    return found.filter(t=>!found.some(other=>other!==t&&other.n.length>t.n.length&&normalize(other.n).includes(normalize(t.n))));
  }
  function cellData(item,p,d) {
    const raw=item?.d?.[p]?.[d];
    return raw?{top:TEXTS[raw[0]]||'',bottom:TEXTS[raw[1]]||'',color:COLORS[raw[2]]||'#fff'}:null;
  }
  function refs(item,p,d) {
    const key=item.key+'|'+p+'|'+d;
    if(referencesCache.has(key))return referencesCache.get(key);
    const cell=cellData(item,p,d);
    const result=cell?(item.kind==='class'?teacherRefs(cell.bottom):classRefs(cell.bottom)):[];
    referencesCache.set(key,result);return result;
  }
  function availability(item,p,d) {
    const cell=cellData(item,p,d);
    if(!cell)return {kind:'unknown',label:'データなし'};
    if(item.kind==='teacher') {
      const status=STATUS_TEXTS[item.n]||'';
      if(String(REST_DAYS[item.n]||'').includes(DAYS[d]) || /[✕×]/.test(cell.top))
        return {kind:'rest',label:'指定休'};
      if(status.includes('休み：')&&status.includes(DAYS[d]))return {kind:'rest',label:'休み'};
      if(/産休|出勤日/.test(status)&&!cell.top&&!cell.bottom)return {kind:'unknown',label:status};
    }
    if(cell.top||cell.bottom)return {kind:'busy',label:'予定あり'};
    return {kind:'free',label:'空き'};
  }
  function profile(teacher) {
    if(profileCache.has(teacher.key))return profileCache.get(teacher.key);
    const subjects=new Set(), categories=new Set(), classes=new Set();
    for(let p=0;p<7;p++)for(let d=0;d<6;d++){
      const cell=cellData(teacher,p,d);if(!cell)continue;
      if(cell.top&&!/^[✕×]$|ＩＣＲ|ICR|教科部会|主任会議|道徳|LHR|ゼミ/.test(cell.top)){
        subjects.add(compactSubjectText(cell.top));
        subjectCategoriesFromText(cell.top).forEach(c=>categories.add(c));
      }
      refs(teacher,p,d).forEach(c=>classes.add(c.n));
    }
    for(const c of CLASSES)for(let p=0;p<7;p++)for(let d=0;d<6;d++){
      if(refs(c,p,d).some(t=>t.key===teacher.key))classes.add(c.n);
    }
    const result={subjects:[...subjects],categories:[...categories],classes:[...classes].sort((a,b)=>parseClassParts(a).g-parseClassParts(b).g||parseClassParts(a).c-parseClassParts(b).c||a.localeCompare(b,'ja'))};
    profileCache.set(teacher.key,result);return result;
  }
  function isRelated(a,b,p,d) {
    const sa=availability(a,p,d),sb=availability(b,p,d);
    if(sa.kind!=='busy'||sb.kind!=='busy')return false;
    if(a.kind!==b.kind)return refs(a,p,d).some(x=>x.key===b.key)||refs(b,p,d).some(x=>x.key===a.key);
    const ca=cellData(a,p,d),cb=cellData(b,p,d);
    return compactSubjectText(ca.top)===compactSubjectText(cb.top)&&refs(a,p,d).some(x=>refs(b,p,d).some(y=>y.key===x.key));
  }
  function compareStatus(items,p,d) {
    const states=items.map(x=>availability(x,p,d));
    if(states.some(x=>x.kind==='unknown'))return {kind:'unknown',label:'データ・勤務要確認'};
    if(states.some(x=>x.kind==='rest'))return {kind:'rest',label:'指定休・休みあり'};
    const busy=states.filter(x=>x.kind==='busy').length;
    if(!busy)return {kind:'free',label:'共通空き'};
    if(busy===items.length)return {kind:'busy',label:items.length===2?'両方予定あり':'全員予定あり'};
    return {kind:'partial',label:busy+'/'+items.length+'人に予定'};
  }
  const legend='<div class="status-legend"><span class="status-free">緑：共通空き</span><span class="status-partial">黄：一部に予定</span><span class="status-busy">赤：全員に予定</span><span class="status-related">青：同じ授業に関係</span><span class="status-rest">灰：指定休・休み等</span></div>';
  const hub=document.createElement('section');hub.className='feature-hub';
  hub.innerHTML='<details id="free-tools"><summary>空き教員検索</summary><div class="feature-body"><div class="feature-row"><label>曜日 <select id="free-day">'+DAYS.map((x,i)=>'<option value="'+i+'">'+x+'曜</option>').join('')+'</select></label><label>時限 <select id="free-period">'+PERIODS.map((x,i)=>'<option value="'+i+'">'+x+'限</option>').join('')+'</select></label><label>教科 <select id="free-subject"><option value="">全教科</option>'+['英語','数学','国語','理科','社会','保健体育','芸術','家庭','情報','技術'].map(x=>'<option value="'+x+'">'+x+'科</option>').join('')+'</select></label><label>担当学年 <select id="free-grade"><option value="">全学年</option>'+['中1','中2','中3','高1','高2','高3'].map((x,i)=>'<option value="'+(i+1)+'">'+x+'</option>').join('')+'</select></label><button id="free-search" class="feature-btn primary" type="button">空きを検索</button></div><div id="free-results" aria-live="polite"></div><div class="feature-note">時間割上の空きを表示します。教科・担当学年は授業データから集計しています。</div></div></details>'+
    '<details id="common-tools"><summary>共通の空き時間を探す</summary><div class="feature-body"><p class="common-help">教員名を入力して「追加」。2人以上選ぶと、共通の空き時間を表示します。</p><label class="common-search-label" for="common-query">教員を追加</label><input id="common-query" type="search" placeholder="教員名・ひらがなを入力" autocomplete="off" aria-describedby="common-message"><div id="common-options" class="common-options" aria-live="polite"></div><div class="feature-row common-shortcuts"><button id="common-current" class="feature-btn" type="button" hidden></button><button id="common-homeroom" class="feature-btn" type="button" hidden></button><button id="common-comparison" class="feature-btn" type="button" hidden>比較中の2人を選ぶ</button></div><div class="common-selection"><strong id="common-count">選択中：0人</strong><button id="common-clear" class="feature-btn" type="button" hidden>全員外す</button></div><div id="common-selected" class="feature-list"></div><div id="common-message" class="feature-note" role="status"></div><div id="common-grid"></div></div></details>';
  document.querySelector('.layout').after(hub);
  const lessonTools=byId('lessonSearchBox');if(lessonTools)hub.prepend(lessonTools);
  const quick=document.createElement('section');quick.className='quick-access';quick.id='quick-access';
  quick.innerHTML='<h2>お気に入り</h2><div id="favorites-list" class="feature-list"></div>';
  document.querySelector('.controls').after(quick);
  function compactFavorites(){
    const empty=!byId('favorites-list').querySelector('[data-open]');
    quick.hidden=empty;quick.classList.toggle('favorites-empty',empty);
  }
  new MutationObserver(compactFavorites).observe(byId('favorites-list'),{childList:true});compactFavorites();
  const searchPanel=document.querySelector('.sidebar');
  searchPanel.hidden=true;
  qEl.setAttribute('aria-controls','results');qEl.setAttribute('aria-expanded','false');
  function toggleSearch(open){searchPanel.hidden=!open;qEl.setAttribute('aria-expanded',String(open));}
  qEl.addEventListener('input',()=>toggleSearch(!!qEl.value.trim()));
  qEl.addEventListener('focus',()=>toggleSearch(!!qEl.value.trim()));
  qEl.addEventListener('keydown',event=>{if(event.key==='Escape')toggleSearch(false);});
  function current(){return ITEMS.find(x=>x.key===state.currentKey);}
  function post(message){parent.postMessage(message,'*');}
  function persist(change){if(prefsReady&&change)post({type:'timetable-save',change});}
  function itemButton(item){return '<button type="button" class="feature-btn" data-open="'+esc(item.key)+'">'+esc(item.n)+'</button>';}
  function renderQuick(){
    for(const [id,keys] of [['favorites-list',prefs.favorites]]){
      const items=keys.map(k=>ITEMS.find(x=>x.key===k)).filter(Boolean);
      byId(id).innerHTML=items.length?items.map(itemButton).join(''):'<span class="feature-note">'+(id==='favorites-list'?'時間割の★ボタンで登録できます。':'まだありません。')+'</span>';
    }
    const star=byId('favorite-toggle');
    if(star){const on=prefs.favorites.includes(state.currentKey);star.textContent=on?'★ 登録済み':'☆ お気に入り';star.setAttribute('aria-pressed',String(on));}
  }
  function renderFree(){
    const d=Number(byId('free-day').value),p=Number(byId('free-period').value);
    const subject=byId('free-subject').value,grade=byId('free-grade').value;
    const teachers=TEACHERS.filter(t=>{
      const pr=profile(t);
      return (!subject||pr.subjects.some(s=>subjectMatchesForLesson(s,subject)))&&(!grade||pr.classes.some(c=>c.startsWith(grade+'-')));
    });
    const groups=[['free','空いている教員'],['rest','指定休・休み'],['unknown','データ・勤務要確認'],['busy','授業・予定あり']];
    byId('free-results').innerHTML='<p class="feature-note">'+DAYS[d]+'曜'+PERIODS[p]+'限</p>'+groups.map(([kind,label])=>{
      const found=teachers.filter(t=>availability(t,p,d).kind===kind);
      return '<section data-free-group="'+kind+'"><h3 style="font-size:14px">'+label+'（'+found.length+'人）</h3><div class="feature-list">'+(found.length?found.map(t=>'<button class="feature-btn status-'+kind+'" type="button" data-open="'+esc(t.key)+'">'+esc(t.n)+(kind==='rest'||kind==='unknown'?'：'+esc(availability(t,p,d).label):'')+'</button>').join(''):'<span class="feature-note">該当なし</span>')+'</div></section>';
    }).join('');
  }
  function renderCommonOptions(){
    const query=normalize(byId('common-query').value);
    const matches=query?TEACHERS.filter(t=>t.search.includes(query)&&!selected.has(t.key)):[];
    byId('common-options').innerHTML=matches.length?matches.map(t=>'<button type="button" class="feature-btn common-add" data-teacher="'+esc(t.key)+'" aria-label="'+esc(t.n)+'を追加"><span>'+esc(t.n)+'</span><span>＋ 追加</span></button>').join(''):(query?'<p class="feature-note">追加できる教員が見つかりません。別の名前で検索してください。</p>':'');
    byId('common-options').hidden=!query;
    byId('common-selected').innerHTML=[...selected].map(k=>ITEMS.find(x=>x.key===k)).filter(Boolean).map(t=>'<button type="button" class="feature-btn" data-remove="'+esc(t.key)+'" aria-label="'+esc(t.n)+'を外す">'+esc(t.n)+' ×</button>').join('');
    byId('common-count').textContent='選択中：'+selected.size+'人';byId('common-clear').hidden=!selected.size;
    const item=current(),currentButton=byId('common-current'),homeroomButton=byId('common-homeroom');
    currentButton.hidden=item?.kind!=='teacher'||selected.has(item.key);currentButton.textContent=item?.n+'を追加';
    const className=item?.kind==='class'?item.n:Object.keys(HOMEROOMS).find(c=>HOMEROOMS[c]===item?.n);
    const pair=className?[HOMEROOMS[className],VICE_HOMEROOMS[className]].map(n=>TEACHERS.find(t=>t.n===n)).filter(Boolean):[];
    homeroomButton.hidden=new Set(pair.map(t=>t.key)).size<2;homeroomButton.textContent=(className||'')+'の担任・副担任を選ぶ';
    byId('common-comparison').hidden=current()?.kind!=='teacher'||peer?.kind!=='teacher'||current().key===peer.key;
  }
  function renderCommon(){
    renderCommonOptions();
    const teachers=[...selected].map(k=>ITEMS.find(x=>x.key===k)).filter(x=>x?.kind==='teacher');
    if(teachers.length<2){byId('common-grid').innerHTML='';byId('common-message').textContent=teachers.length?'あと1人追加してください。':'比較する教員を2人以上追加してください。';return;}
    let freeCount=0;
    for(let p=0;p<7;p++)for(let d=0;d<6;d++)if((p<6||d===3)&&(d!==5||p<4)&&compareStatus(teachers,p,d).kind==='free')freeCount++;
    byId('common-message').textContent=teachers.map(t=>t.n).join('・')+'の共通空き：'+freeCount+'コマ。緑の時間に全員空いています。';
    byId('common-grid').innerHTML='<div class="status-legend"><span class="status-free">緑：全員空き</span><span class="status-partial">黄：一部に予定</span><span class="status-busy">赤：全員に予定</span><span class="status-rest">灰：指定休など</span></div><div class="tableWrap"><table class="table common-table"><caption>共通空き時間（'+teachers.length+'人）</caption><thead><tr><th>限</th>'+DAYS.map(d=>'<th>'+d+'</th>').join('')+'</tr></thead><tbody>'+PERIODS.map((p,pi)=>'<tr><th>'+p+'</th>'+DAYS.map((day,di)=>{
      if((pi===6&&di!==3)||(di===5&&pi>=4))return '<td class="common-no-lesson" data-status="no-lesson" aria-label="授業なし">—</td>';
      const status=compareStatus(teachers,pi,di);
      const detail=teachers.map(t=>t.n+'：'+availability(t,pi,di).label).join('\n');
      return '<td data-status="'+status.kind+'" class="status-'+status.kind+'" title="'+esc(detail)+'">'+esc(status.label)+'</td>';
    }).join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function addTeachers(items){items.filter(x=>x?.kind==='teacher').forEach(t=>selected.add(t.key));renderCommon();}
  byId('free-search').addEventListener('click',renderFree);
  byId('common-query').addEventListener('input',renderCommonOptions);
  byId('common-options').addEventListener('click',event=>{
    const key=event.target.closest('[data-teacher]')?.dataset.teacher;if(!key)return;
    selected.add(key);byId('common-query').value='';renderCommon();byId('common-query').focus();
  });
  byId('common-selected').addEventListener('click',event=>{const key=event.target.closest('[data-remove]')?.dataset.remove;if(key){selected.delete(key);renderCommon();}});
  byId('common-current').addEventListener('click',()=>addTeachers([current()]));
  byId('common-comparison').addEventListener('click',()=>{
    const pair=[current(),peer].filter(x=>x?.kind==='teacher');
    if(pair.length<2){byId('common-message').textContent='2画面それぞれで教員を選んでください。';return;}
    selected.clear();addTeachers(pair);
  });
  byId('common-homeroom').addEventListener('click',()=>{
    const item=current();
    const className=item?.kind==='class'?item.n:Object.keys(HOMEROOMS).find(c=>HOMEROOMS[c]===item?.n);
    const names=className?[HOMEROOMS[className],VICE_HOMEROOMS[className]].filter(Boolean):[];
    const teachers=names.map(n=>TEACHERS.find(t=>t.n===n)).filter(Boolean);
    if(teachers.length<2){byId('common-message').textContent='担任・副担任の両方の時間割があるクラスを開いてください。';return;}
    selected.clear();addTeachers(teachers);
  });
  byId('common-clear').addEventListener('click',()=>{selected.clear();renderCommon();});
  document.addEventListener('click',event=>{
    const key=event.target.closest('[data-open]')?.dataset.open;if(key){openItem(key);viewerEl.scrollIntoView({block:'start'});}
  });
  renderQuick();renderCommon();

  function timeMinute(value){const m=String(value||'').match(/^([01]\d|2[0-3]):([0-5]\d)$/);return m?Number(m[1])*60+Number(m[2]):null;}
  function clockData() {
    const date=new Date(Date.now()+9*60*60*1000);
    const jsDay=date.getUTCDay(),d=jsDay-1;
    const minute=date.getUTCHours()*60+date.getUTCMinutes();
    const bells=DEFAULT_BELLS;
    const period=d>=0?bells.findIndex((x,p)=>x&&(jsDay!==6||p<4)&&(p<6||jsDay===4)&&timeMinute(x[0])<=minute&&minute<timeMinute(x[1])):-1;
    return {date,jsDay,d,minute,bells,period};
  }
  function refreshNow(){
    const item=current(),line=byId('now-text');if(!item||!line)return;
    document.querySelectorAll('.cell.now-cell').forEach(x=>x.classList.remove('now-cell'));
    const now=clockData(),configured=now.bells.some(Boolean);
    let currentLabel;
    if(!configured)currentLabel='現在：時刻未設定';
    else if(now.period<0)currentLabel='現在：授業時間外';
    else{
      const cell=cellData(item,now.period,now.d),av=availability(item,now.period,now.d);
      currentLabel='現在：'+DAYS[now.d]+'曜'+PERIODS[now.period]+'限 '+(av.kind==='busy'?[cell.top,cell.bottom].filter(Boolean).join(' / '):av.label);
      byId('viewer').querySelector('.cell[data-period="'+now.period+'"][data-day="'+now.d+'"]')?.classList.add('now-cell');
    }
    let next=null;
    for(let offset=0;offset<8&&!next;offset++){
      const jsDay=(now.jsDay+offset)%7;if(!jsDay)continue;
      const d=jsDay-1,bells=DEFAULT_BELLS;
      for(let p=0;p<7;p++){
        if((jsDay===6&&p>=4)||(p===6&&jsDay!==4)||!bells[p]||(offset===0&&timeMinute(bells[p][0])<=now.minute)||availability(item,p,d).kind!=='busy')continue;
        const cell=cellData(item,p,d);next=DAYS[d]+'曜'+PERIODS[p]+'限 '+[cell.top,cell.bottom].filter(Boolean).join(' / ');break;
      }
    }
    line.textContent=currentLabel+' ／ 次の授業：'+(next||'登録時刻内に見つかりません');
  }
  function refreshDifference(){
    const item=current();if(!item)return;
    const cells=[...viewerEl.querySelectorAll('.table .cell')];
    for(const cell of cells){
      cell.classList.remove('diff-free','diff-partial','diff-busy','diff-related','diff-rest','diff-unknown');
      delete cell.dataset.difference;
      if(!differenceEnabled||!peer)continue;
      const p=Number(cell.dataset.period),d=Number(cell.dataset.day);
      const status=isRelated(item,peer,p,d)?{kind:'related',label:'同じ授業に関係'}:compareStatus([item,peer],p,d);
      cell.classList.add('diff-'+status.kind);cell.dataset.difference=status.kind;
      cell.title=status.label+' / '+item.n+'：'+availability(item,p,d).label+' / '+peer.n+'：'+availability(peer,p,d).label;
    }
    const info=byId('difference-info');
    if(info){info.hidden=!differenceEnabled;info.innerHTML=peer?'比較相手：'+esc(peer.n)+legend:'もう一方の画面で時間割を選ぶと、差分を強調します。';}
  }
  function chooseReference(list){
    if(list.length===1){openItem(list[0].key);viewerEl.scrollIntoView({block:'start'});return;}
    document.querySelector('.reference-dialog')?.remove();
    const overlay=document.createElement('div');overlay.className='reference-dialog';
    overlay.innerHTML='<section class="reference-card" role="dialog" aria-modal="true" aria-label="移動先の時間割"><h2>開く時間割を選択</h2><div class="feature-list">'+list.map(itemButton).join('')+'</div><button class="feature-btn" type="button" data-close-reference>閉じる</button></section>';
    overlay.addEventListener('click',event=>{if(event.target===overlay||event.target.closest('[data-close-reference],[data-open]'))overlay.remove();});
    overlay.addEventListener('keydown',event=>{if(event.key==='Escape')overlay.remove();});
    document.body.append(overlay);overlay.querySelector('button').focus();
  }
  const baseRender=renderViewer;
  renderViewer=function(item){
    baseRender(item);
    toggleSearch(false);
    const actions=document.createElement('div');actions.className='viewer-actions';
    actions.innerHTML='<button id="favorite-toggle" class="feature-btn" type="button" aria-pressed="false">☆ お気に入り</button><button id="timetable-pdf" class="feature-btn" type="button">時間割をPDF保存</button><span id="pdf-status" class="feature-note" role="status"></span>';
    const now=document.createElement('div');now.className='now-line';
    now.innerHTML='<div id="now-text" aria-live="off"></div>';
    const diff=document.createElement('div');diff.className='diff-info';diff.id='difference-info';diff.hidden=true;
    const lessonLegend=viewerEl.querySelector('.viewerTop .legend');
    if(lessonLegend)viewerEl.querySelector('.tableWrap').after(lessonLegend);
    viewerEl.querySelector('.viewerTop').after(actions,now,diff);
    if(item.kind==='teacher'){
      const p=profile(item),section=document.createElement('section');section.className='teacher-profile';
      const homerooms=Object.keys(HOMEROOMS).filter(c=>HOMEROOMS[c]===item.n);
      const vice=Object.keys(VICE_HOMEROOMS).filter(c=>VICE_HOMEROOMS[c]===item.n);
      const links=names=>names.map(n=>{const c=CLASSES.find(x=>x.n===n);return c?itemButton(c):esc(n);}).join(' ');
      section.innerHTML='<h3>担当・所属</h3><div class="profile-line"><strong>担当科目：</strong><span>'+esc(p.subjects.join(' / ')||'データなし')+'</span></div><div class="profile-line"><strong>担当クラス：</strong>'+links(p.classes)+'</div>'+
        (homerooms.length?'<div class="profile-line"><strong>担任：</strong>'+links(homerooms)+'</div>':'')+
        (vice.length?'<div class="profile-line"><strong>副担任：</strong>'+links(vice)+'</div>':'')+
        '<div class="profile-line"><strong>所属・役職：</strong><span class="profile-duties">'+esc(dutyTextsOf(item.n).join(' / ')||'登録なし')+'</span></div>';
      const duties=viewerEl.querySelector('.duties');if(duties)section.querySelector('.profile-duties').replaceChildren(duties);
      viewerEl.querySelector('.tableWrap').after(section);
    }
    viewerEl.querySelectorAll('.table tbody tr').forEach((row,p)=>row.querySelectorAll('td').forEach((td,d)=>{
      td.dataset.period=String(p);td.dataset.day=String(d);
      const targets=refs(item,p,d);if(!targets.length)return;
      td.dataset.linked='true';td.tabIndex=0;
      const label=DAYS[d]+'曜'+PERIODS[p]+'限 '+targets.map(x=>x.n).join(' / ')+' の時間割を開く';
      const bottom=td.querySelector('.bottomtext');
      bottom.innerHTML='<button type="button" class="cell-link" aria-label="'+esc(label)+'">'+esc(cellData(item,p,d).bottom)+'</button>';
      td.addEventListener('click',()=>chooseReference(targets));
      td.addEventListener('keydown',event=>{if(event.target===td&&(event.key==='Enter'||event.key===' ')){event.preventDefault();chooseReference(targets);}});
    }));
    byId('favorite-toggle').addEventListener('click',()=>{
      prefs.favorites=prefs.favorites.includes(item.key)?prefs.favorites.filter(k=>k!==item.key):[...prefs.favorites,item.key];
      renderQuick();persist({type:'favorite',key:item.key,enabled:prefs.favorites.includes(item.key)});
    });
    byId('timetable-pdf').addEventListener('click',()=>exportTimetablePdf(item));
    refreshNow();refreshDifference();renderQuick();renderCommon();
    post({type:'timetable-selection',key:item.key});
  };
  function wrapCanvasText(ctx,text,maxWidth) {
    const lines=[];
    for(const paragraph of String(text||'').split('\n')){
      let line='';
      for(const char of paragraph){if(line&&ctx.measureText(line+char).width>maxWidth){lines.push(line);line='';}line+=char;}
      lines.push(line);
    }
    return lines;
  }
  async function exportTimetablePdf(item){
    const status=byId('pdf-status'),button=byId('timetable-pdf');
    button.disabled=true;status.textContent='PDFを作成しています…';
    try{
      if(document.fonts?.ready)await document.fonts.ready;
      const canvas=document.createElement('canvas');canvas.width=1240;canvas.height=1754;
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
      const font=(size,weight)=>{ctx.font=(weight||'400')+' '+size+'px -apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",Meiryo,"Noto Sans CJK JP",sans-serif';};
      ctx.fillStyle='#fff';ctx.fillRect(0,0,1240,1754);ctx.textBaseline='top';
      ctx.fillStyle='#1b2233';font(24,'700');ctx.fillText('2026年度 時間割',60,54);
      font(42,'700');ctx.fillText(item.n+(item.kind==='teacher'?' 先生':''),60,96);
      font(18);ctx.fillStyle='#5e6a85';ctx.fillText('教員別 ver2.1 / クラス別 ver3.2',60,154);
      const metadata=item.kind==='teacher'?['担当科目：'+profile(item).subjects.join(' / '),'担当クラス：'+profile(item).classes.join(' / '),'所属・役職：'+dutyTextsOf(item.n).join(' / '),(STATUS_TEXTS[item.n]|| (REST_DAYS[item.n]?'指定休：'+REST_DAYS[item.n]:''))]:['担任：'+(HOMEROOMS[item.n]||'未登録'),'副担任：'+(VICE_HOMEROOMS[item.n]||'未登録')];
      let metaY=190;font(18);
      for(const text of metadata){if(!text)continue;const lines=wrapCanvasText(ctx,text,1120).slice(0,2);for(const line of lines){if(metaY>330)break;ctx.fillText(line,60,metaY);metaY+=24;}}
      const x=60,y=390,periodWidth=70,colWidth=175,rowHeight=146,headerHeight=52;
      function box(bx,by,bw,bh,color){ctx.fillStyle=color;ctx.fillRect(bx,by,bw,bh);ctx.strokeStyle='#b8c0d6';ctx.lineWidth=1.5;ctx.strokeRect(bx,by,bw,bh);}
      box(x,y,periodWidth,headerHeight,'#eef2fa');
      font(24,'700');ctx.fillStyle='#1b2233';ctx.textAlign='center';ctx.fillText('限',x+periodWidth/2,y+12);
      for(let d=0;d<6;d++){box(x+periodWidth+d*colWidth,y,colWidth,headerHeight,'#eef2fa');ctx.fillStyle='#1b2233';ctx.fillText(DAYS[d],x+periodWidth+(d+.5)*colWidth,y+12);}
      function cellText(text,cx,cy,maxHeight,size,weight,color){
        let lines;
        do{font(size,weight);lines=wrapCanvasText(ctx,text,colWidth-16);if(lines.length*size*1.2<=maxHeight||size<=12)break;size--;}while(size>12);
        ctx.fillStyle=color;const lineHeight=size*1.2;
        lines.forEach((line,i)=>ctx.fillText(line,cx,cy+i*lineHeight));
      }
      for(let p=0;p<7;p++){
        const ry=y+headerHeight+p*rowHeight;
        box(x,ry,periodWidth,rowHeight,'#eef2fa');font(26,'700');ctx.fillStyle='#1b2233';ctx.fillText(PERIODS[p],x+periodWidth/2,ry+58);
        for(let d=0;d<6;d++){
          const cell=cellData(item,p,d)||{top:'',bottom:'',color:'#fff'},cx=x+periodWidth+d*colWidth;
          box(cx,ry,colWidth,rowHeight,normalizeCellColor(cell.top,cell.color));
          cellText(cell.top,cx+colWidth/2,ry+12,64,24,'700','#1b2233');
          cellText(cell.bottom,cx+colWidth/2,ry+82,54,20,'400','#374151');
        }
      }
      font(17);ctx.textAlign='left';ctx.fillStyle='#5e6a85';ctx.fillText('上段：科目等 / 下段：担当・クラス',60,1500);
      ctx.fillText('このPDFを外部に共有しないでください。',60,1530);
      ctx.textAlign='center';ctx.fillText('1',620,1674);
      const jpeg=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('JPEG encoding failed')),'image/jpeg',0.95));
      const bytes=await jpeg.arrayBuffer();
      post({type:'timetable-pdf',bytes,filename:'時間割_'+item.n.replace(/[\\/:*?"<>|]/g,'_')+'.pdf'});
      status.textContent='PDFの保存画面を開きました。';
    }catch{status.textContent='PDFを作成できませんでした。もう一度お試しください。';}
    finally{if(button.isConnected)button.disabled=false;}
  }
  window.addEventListener('message',event=>{
    if(event.source!==parent||!event.data)return;
    const data=event.data;
    if(data.type==='timetable-preferences'){
      prefs={favorites:Array.isArray(data.preferences?.favorites)?data.preferences.favorites:[],recent:Array.isArray(data.preferences?.recent)?data.preferences.recent:[],bells:data.preferences?.bells||{}};
      prefsReady=true;renderQuick();refreshNow();
    }
    if(data.type==='timetable-comparison'){
      peer=ITEMS.find(x=>x.key===data.key)||null;differenceEnabled=!!data.enabled;refreshDifference();renderCommonOptions();
    }
  });
  new MutationObserver(()=>{if(!current())post({type:'timetable-selection',key:''});}).observe(viewerEl,{childList:true});
  if(current())renderViewer(current());
  post({type:'timetable-feature-ready'});
  setInterval(refreshNow,30000);
})();
