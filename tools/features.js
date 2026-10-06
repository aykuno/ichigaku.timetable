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

/* timetable-refinements-v5 */
;(() => {
  'use strict';
  const byId=id=>document.getElementById(id),esc=escapeHtml;
  const teachers=ITEMS.filter(x=>x.kind==='teacher');
  const schoolSlot=(p,d)=>(p<6||d===3)&&(d!==5||p<4);
  const cellOf=(item,p,d)=>{
    const raw=item?.d?.[p]?.[d];
    return raw?{top:TEXTS[raw[0]]||'',bottom:TEXTS[raw[1]]||''}:null;
  };
  function slotState(item,p,d){
    const cell=cellOf(item,p,d),status=STATUS_TEXTS[item.n]||'';
    if(item.kind==='teacher'){
      if(/産休|育休|休職/.test(status))return {kind:'rest',label:/産休/.test(status)?'産休':/育休/.test(status)?'育休':'休職'};
      if(String(REST_DAYS[item.n]||'').includes(DAYS[d])||/[✕×]/.test(cell?.top||''))return {kind:'rest',label:'指定休'};
      if(/休み[：:]/.test(status)&&(/[全毎]日/.test(status)||status.includes(DAYS[d])))return {kind:'rest',label:'休み'};
      // LA seminar teachers attend only the two Friday seminar periods.
      if(item.n==='山口'||(/出勤日/.test(status)&&/LA|ＬＡ|ゼミ/.test(status))){
        if(d!==4||(p!==4&&p!==5))return {kind:'rest',label:'出勤時間外'};
      }else if(/出勤日/.test(status)){
        const days=(status.split(/出勤日[：:]?/)[1]||'').match(/[月火水木金土]/g);
        if(days?.length){if(!days.includes(DAYS[d]))return {kind:'rest',label:'出勤日外'};}
        else if(!cell?.top&&!cell?.bottom)return {kind:'rest',label:'出勤時間外'};
      }
    }
    if(!cell)return {kind:'unknown',label:'時間割未登録'};
    if(cell.top||cell.bottom){
      const label=/会議|部会/.test(cell.top)?'会議':/^(?:ICR|ＩＣＲ)$/.test(cell.top)?'ICR':/^(?:LHR|ＬＨＲ)$/.test(cell.top)?'LHR':'授業';
      return {kind:'busy',label,subject:cell.top,className:cell.bottom};
    }
    return {kind:'free',label:'空き'};
  }
  function subjectsOf(item){
    const subjects=new Set();
    for(let p=0;p<7;p++)for(let d=0;d<6;d++){
      const cell=cellOf(item,p,d);
      if(cell?.top&&!/^[✕×]$|ＩＣＲ|ICR|教科部会|主任会議|道徳|LHR/.test(cell.top))subjects.add(compactSubjectText(cell.top));
    }
    return [...subjects];
  }
  function classNamesOf(item){
    const names=new Set();
    for(let p=0;p<7;p++)for(let d=0;d<6;d++){
      const text=String(cellOf(item,p,d)?.bottom||'').replace(/([1-6])-(\d+(?:理|文)?(?:\/\d+(?:理|文)?)+)/g,(_,g,rest)=>rest.split('/').map(c=>g+'-'+c).join(' '));
      for(const token of text.match(/[1-6]-\d+(?:理|文)?/g)||[])names.add(token);
    }
    for(const c of ITEMS.filter(x=>x.kind==='class'))for(let p=0;p<7;p++)for(let d=0;d<6;d++){
      const tokens=String(cellOf(c,p,d)?.bottom||'').split(/[\s/／・、,&＆＋+]+/).map(normalize);
      if(tokens.includes(normalize(item.n)))names.add(c.n);
    }
    return [...names];
  }
  function groupState(items,p,d){
    const states=items.map(item=>slotState(item,p,d));
    if(states.some(x=>x.kind==='rest'))return 'rest';
    if(states.some(x=>x.kind==='unknown'))return 'unknown';
    const busy=states.filter(x=>x.kind==='busy').length;
    return busy===0?'free':busy===states.length?'busy':'partial';
  }
  function describe(item,p,d){
    const av=slotState(item,p,d);
    return item.n+'：'+av.label+(av.subject?'（'+[av.subject,av.className].filter(Boolean).join(' / ')+'）':'');
  }
  function renderFree(){
    const d=Number(byId('free-day').value),p=Number(byId('free-period').value);
    if(!schoolSlot(p,d)){byId('free-results').innerHTML='<p class="feature-note">'+DAYS[d]+'曜'+PERIODS[p]+'限は授業時間外です。</p>';return;}
    const subject=byId('free-subject').value,grade=byId('free-grade').value;
    const found=teachers.filter(t=>(!subject||subjectsOf(t).some(s=>subjectMatchesForLesson(s,subject)))&&(!grade||classNamesOf(t).some(c=>c.startsWith(grade+'-'))));
    const groups=[['free','空いている教員'],['rest','休み・出勤時間外'],['busy','授業・会議中'],['unknown','時間割未登録']];
    byId('free-results').innerHTML='<p class="feature-note">'+DAYS[d]+'曜'+PERIODS[p]+'限</p>'+groups.map(([kind,label])=>{
      const list=found.filter(t=>slotState(t,p,d).kind===kind);
      if(kind==='unknown'&&!list.length)return '';
      return '<section data-free-group="'+kind+'"><h3>'+label+'（'+list.length+'人）</h3><div class="feature-list">'+(list.length?list.map(t=>{
        const av=slotState(t,p,d);
        return '<button class="feature-btn status-'+kind+'" type="button" data-open="'+esc(t.key)+'">'+esc(t.n)+(kind==='rest'||kind==='unknown'?'：'+esc(av.label):'')+'</button>';
      }).join(''):'<span class="feature-note">該当なし</span>')+'</div></section>';
    }).join('');
  }
  byId('free-search').addEventListener('click',event=>{event.stopImmediatePropagation();renderFree();},true);
  function refineProfile(item){
    if(item?.kind!=='teacher')return;
    const section=viewerEl.querySelector('.teacher-profile');
    if(!section)return;
    section.querySelector('h3').textContent='担当';
    const subjectLine=section.querySelector('.profile-line');
    subjectLine.querySelector('span').innerHTML=subjectsOf(item).map(s=>'<span class="subject-chip">'+esc(s)+'</span>').join('')||'登録なし';
    subjectLine.classList.add('profile-subjects');
    const roleLine=section.querySelector('.profile-duties')?.closest('.profile-line');
    const duties=roleLine?.querySelector('.duties');
    if(roleLine&&roleLine.textContent.replace('所属・役職：','').trim()!=='登録なし'){
      const row=document.createElement('div');row.className='teacher-affiliations';
      row.innerHTML='<strong>所属・役職：</strong>';
      row.append(duties||roleLine.querySelector('.profile-duties'));
      const titleBlock=viewerEl.querySelector('.titleBlock');
      (titleBlock.querySelector('.restday')||titleBlock.querySelector('.title')).after(row);
    }
    roleLine?.remove();
  }
  const commonGrid=byId('common-grid');
  let commonObserver;
  function refineCommon(){
    const selected=[...byId('common-selected').querySelectorAll('[data-remove]')].map(node=>ITEMS.find(x=>x.key===node.dataset.remove)).filter(Boolean);
    const table=commonGrid.querySelector('.common-table');
    if(!table||selected.length<2)return;
    commonObserver?.disconnect();
    commonGrid.querySelector('.status-legend').innerHTML='<span class="status-free">緑：全員空き</span><span class="status-partial">黄：空き・授業が混在</span><span class="status-busy">赤：全員授業など</span><span class="status-rest">灰：休みの教員あり</span>';
    let freeCount=0;
    table.querySelectorAll('tbody tr').forEach((row,p)=>row.querySelectorAll('td').forEach((td,d)=>{
      if(!schoolSlot(p,d))return;
      const kind=groupState(selected,p,d);
      if(kind==='free')freeCount++;
      td.dataset.status=kind;td.className='status-'+kind;
      const detail=selected.map(t=>describe(t,p,d)).join('\n');
      td.title=detail;td.tabIndex=0;td.setAttribute('role','button');td.setAttribute('aria-label',DAYS[d]+'曜'+PERIODS[p]+'限 '+detail);
      td.innerHTML=selected.map(t=>{
        const av=slotState(t,p,d);
        return '<div class="common-person" data-key="'+esc(t.key)+'" data-person-status="'+av.kind+'"><span class="common-person-name">'+esc(t.n)+'</span><strong class="person-state state-'+av.kind+'">'+esc(av.label)+'</strong></div>';
      }).join('');
      td.onclick=()=>showDetail(p,d,selected);
      td.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showDetail(p,d,selected);}};
    }));
    byId('common-message').textContent=selected.map(t=>t.n).join('・')+'の共通空き：'+freeCount+'コマ。各コマに教員ごとの状態を表示しています。';
    let detail=byId('common-slot-detail');if(detail)detail.remove();
    detail=document.createElement('section');detail.id='common-slot-detail';detail.className='common-slot-detail';detail.hidden=true;commonGrid.append(detail);
    commonObserver?.observe(commonGrid,{childList:true});
  }
  function showDetail(p,d,selected){
    const panel=byId('common-slot-detail');if(!panel)return;
    panel.hidden=false;
    panel.innerHTML='<div class="common-detail-heading"><h3>'+DAYS[d]+'曜'+PERIODS[p]+'限</h3><button class="feature-btn" type="button" data-close-slot>閉じる</button></div>'+selected.map(t=>{
      const av=slotState(t,p,d);
      return '<div class="common-detail-person"><button class="feature-btn" type="button" data-open="'+esc(t.key)+'">'+esc(t.n)+'</button><strong class="state-'+av.kind+'">'+esc(av.label)+'</strong>'+(av.subject?'<span>'+esc([av.subject,av.className].filter(Boolean).join(' / '))+'</span>':'')+'</div>';
    }).join('');
    panel.querySelector('[data-close-slot]').onclick=()=>{panel.hidden=true;};
    panel.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  commonObserver=new MutationObserver(refineCommon);commonObserver.observe(commonGrid,{childList:true});
  let peer=null,enabled=false;
  function refineDifference(){
    const item=ITEMS.find(x=>x.key===state.currentKey);
    if(!item||!peer||!enabled)return;
    viewerEl.querySelectorAll('.table .cell').forEach(td=>{
      const p=Number(td.dataset.period),d=Number(td.dataset.day);
      const related=td.dataset.difference==='related'&&slotState(item,p,d).kind==='busy'&&slotState(peer,p,d).kind==='busy';
      const kind=related?'related':groupState([item,peer],p,d);
      td.classList.remove('diff-free','diff-partial','diff-busy','diff-related','diff-rest','diff-unknown');
      td.classList.add('diff-'+kind);td.dataset.difference=kind;td.title=describe(item,p,d)+'\n'+describe(peer,p,d);
    });
  }
  function refineLabels(){
    viewerEl.querySelectorAll('.status-legend span').forEach(node=>{node.textContent=node.textContent.replace(/一部に予定/g,'空き・授業が混在').replace(/全員に予定/g,'全員授業など');});
  }
  const previous=renderViewer;
  renderViewer=function(item){previous(item);refineProfile(item);refineLabels();refineDifference();};
  window.addEventListener('message',event=>{
    if(event.source!==parent||event.data?.type!=='timetable-comparison')return;
    peer=ITEMS.find(x=>x.key===event.data.key)||null;enabled=!!event.data.enabled;refineLabels();refineDifference();
  });
  const item=ITEMS.find(x=>x.key===state.currentKey);
  refineProfile(item);refineLabels();refineCommon();
})();

/* timetable-pdf-v6 */
;(() => {
  'use strict';
  const PAGE_W=1240,PAGE_H=1754,RASTER_SCALE=2,MARGIN=60,BLOCK_W=1120;
  const byId=id=>document.getElementById(id);
  const current=()=>ITEMS.find(item=>item.key===state.currentKey);
  let busy=false;
  const style=(node,fallback)=>node?getComputedStyle(node):fallback;
  const color=(node,fallback)=>node?getComputedStyle(node).color:fallback;
  function wrap(ctx,text,width){
    if(!String(text||'').trim())return [];
    const result=[];
    for(const paragraph of String(text).split('\n')){
      let line='';
      for(const char of paragraph){
        if(line&&ctx.measureText(line+char).width>width){result.push(line);line='';}
        line+=char;
      }
      result.push(line);
    }
    return result;
  }
  function snapshot(item){
    const root=viewerEl,panel=root.querySelector('.teacher-profile');
    const subjectNode=panel?.querySelector('.subject-chip');
    const buttonNode=panel?.querySelector('.feature-btn');
    const appearance=node=>{
      const s=style(node,{backgroundColor:'#f7f8fc',borderColor:'#d7dbe7',color:'#1b2233'});
      return {background:s.backgroundColor,border:s.borderColor,color:s.color};
    };
    const fields=panel?[...panel.querySelectorAll('.profile-line')].map(line=>{
      const label=line.querySelector('strong')?.textContent||'';
      const chips=[...line.querySelectorAll('.subject-chip,.feature-btn')];
      return {label,boxed:true,values:chips.length?chips.map(node=>({text:node.textContent.trim(),...appearance(node)})):[{text:line.textContent.replace(label,'').trim(),...appearance(label.includes('科目')?subjectNode:buttonNode)}]};
    }):[];
    const dutyRoot=root.querySelector(item.kind==='teacher'?'.teacher-affiliations':'.titleBlock .duties');
    const duties=dutyRoot?[...dutyRoot.querySelectorAll('.duty')].map(node=>({text:node.textContent.trim(),color:color(node,'#1b2233')})):[];
    const rest=root.querySelector('.restday');
    const table=root.querySelector('.table');
    return {
      rest:rest?{text:rest.textContent.trim(),color:color(rest,'#1b2233')}:null,
      duties,fields,
      text:color(root.querySelector('.cell:not(.empty) .toptext')||root.querySelector('.title'),'#1b2233'),
      bottom:color(root.querySelector('.cell:not(.empty) .bottomtext'),'#374151'),
      border:style(table?.querySelector('td'),{borderColor:'#d7dbe7'}).borderColor,
      header:style(table?.querySelector('th'),{backgroundColor:'#eef2fa'}).backgroundColor
    };
  }
  function roundedRect(ctx,x,y,w,h,r){
    r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);
    ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
  }
  function richRow(ctx,font,field,width){
    font(22,'700');const labelWidth=ctx.measureText(field.label).width+12;
    let x=labelWidth,y=0,lineHeight=0;
    const commands=[];
    const values=field.boxed?field.values:field.values.flatMap((value,i)=>i?[{text:'/',color:'#5e6a85'},value]:[value]);
    for(const value of values){
      font(22,'400');
      const padding=field.boxed?8:0,available=Math.max(30,width-labelWidth);
      const lines=wrap(ctx,value.text,available-padding*2);
      if(!lines.length)continue;
      const w=Math.min(available,Math.max(...lines.map(line=>ctx.measureText(line).width))+padding*2);
      const h=lines.length*29+(field.boxed?8:0);
      if(x>labelWidth&&x+w>width){y+=lineHeight+6;x=labelWidth;lineHeight=0;}
      commands.push({...value,x,y,w,h,padding,lines,boxed:field.boxed});
      x+=w+7;lineHeight=Math.max(lineHeight,h);
    }
    const height=Math.max(34,y+lineHeight);
    return {height,draw(x0,y0){
      ctx.textAlign='left';font(22,'700');ctx.fillStyle='#1b2233';ctx.fillText(field.label,x0,y0+17);
      for(const command of commands){
        if(command.boxed){
          roundedRect(ctx,x0+command.x,y0+command.y,command.w,command.h,7);
          ctx.fillStyle=command.background==='rgba(0, 0, 0, 0)'?'#fff':command.background||'#fff';ctx.fill();
          ctx.strokeStyle=command.border||'#d7dbe7';ctx.lineWidth=1;ctx.stroke();
        }
        font(22,'400');ctx.fillStyle=command.color||'#1b2233';
        command.lines.forEach((line,i)=>ctx.fillText(line,x0+command.x+command.padding,y0+command.y+(command.boxed?4:0)+(i+.5)*29));
      }
    }};
  }
  async function encode(canvas,ctx){
    if(typeof CompressionStream==='function'){
      try{
        let y=0;
        const rows=new ReadableStream({pull(controller){
          if(y===canvas.height){controller.close();return;}
          const height=Math.min(64,canvas.height-y),rgba=ctx.getImageData(0,y,canvas.width,height).data;
          const rgb=new Uint8Array(canvas.width*height*3);
          for(let source=0,dest=0;source<rgba.length;source+=4){rgb[dest++]=rgba[source];rgb[dest++]=rgba[source+1];rgb[dest++]=rgba[source+2];}
          y+=height;controller.enqueue(rgb);
        }});
        const bytes=await new Response(rows.pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
        return {bytes,encoding:'rgb-deflate'};
      }catch{ /* Older browsers use a maximum-quality JPEG at the same resolution. */ }
    }
    const jpeg=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Image encoding failed')),'image/jpeg',1));
    return {bytes:await jpeg.arrayBuffer(),encoding:'jpeg'};
  }
  async function exportPdf(item,button){
    if(busy)return;busy=true;
    const status=byId('pdf-status');
    button.disabled=true;status.textContent='PDFを作成しています…';
    let canvas;
    try{
      if(document.fonts?.ready)await document.fonts.ready;
      const data=snapshot(item);
      canvas=document.createElement('canvas');canvas.width=PAGE_W*RASTER_SCALE;canvas.height=PAGE_H*RASTER_SCALE;
      const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('Canvas unavailable');
      ctx.scale(RASTER_SCALE,RASTER_SCALE);ctx.textBaseline='middle';
      const family=getComputedStyle(document.body).fontFamily;
      const font=(size,weight='400')=>{ctx.font=weight+' '+size+'px '+family;};
      ctx.fillStyle='#fff';ctx.fillRect(0,0,PAGE_W,PAGE_H);
      const roles=data.duties.length?richRow(ctx,font,{label:item.kind==='teacher'?'所属・役職：':'',boxed:false,values:data.duties},BLOCK_W):null;
      const fields=data.fields.map(field=>richRow(ctx,font,field,BLOCK_W-28));
      const headerHeight=82+(data.rest?32:0)+(roles?roles.height+8:0);
      const periodWidth=56,colWidth=(BLOCK_W-periodWidth)/6,rowHeight=128,tableHeader=48;
      const tableHeight=tableHeader+PERIODS.length*rowHeight;
      const profileHeight=fields.length?44+fields.reduce((sum,row)=>sum+row.height+8,0)+10:0;
      const notesHeight=62;
      const contentHeight=headerHeight+18+tableHeight+(profileHeight?14+profileHeight:0)+notesHeight;
      const scale=Math.min(1,(PAGE_H-144)/contentHeight),top=60;
      ctx.save();ctx.translate(PAGE_W/2,top);ctx.scale(scale,scale);ctx.translate(-PAGE_W/2,0);
      let y=0;
      ctx.textAlign='left';font(22,'700');ctx.fillStyle='#1b2233';ctx.fillText('2026年度 時間割',MARGIN,y+14);
      font(40,'700');ctx.fillText(item.n,MARGIN,y+55);y+=82;
      if(data.rest){font(22,'700');ctx.fillStyle=data.rest.color;ctx.fillText(data.rest.text,MARGIN,y+16);y+=32;}
      if(roles){roles.draw(MARGIN,y);y+=roles.height+8;}
      y+=18;
      function box(x0,y0,w,h,fill){
        ctx.fillStyle=fill;ctx.fillRect(x0,y0,w,h);ctx.strokeStyle=data.border;ctx.lineWidth=1.5;ctx.strokeRect(x0,y0,w,h);
      }
      box(MARGIN,y,periodWidth,tableHeader,data.header);
      ctx.textAlign='center';font(24,'700');ctx.fillStyle=data.text;ctx.fillText('限',MARGIN+periodWidth/2,y+tableHeader/2);
      DAYS.forEach((day,d)=>{
        const x=MARGIN+periodWidth+d*colWidth;box(x,y,colWidth,tableHeader,data.header);
        ctx.fillStyle=data.text;ctx.fillText(day,x+colWidth/2,y+tableHeader/2);
      });
      function cellText(topText,bottomText,cx,cy,linked){
        let topSize=24,bottomSize=20,topLines,bottomLines,total,gap;
        do{
          font(topSize,'700');topLines=wrap(ctx,topText,colWidth-16);
          font(bottomSize);bottomLines=wrap(ctx,bottomText,colWidth-16);
          gap=topLines.length&&bottomLines.length?10:0;
          total=topLines.length*topSize*1.35+bottomLines.length*bottomSize*1.35+gap;
          if(total<=rowHeight-20||topSize<=12)break;
          topSize--;bottomSize=Math.max(12,bottomSize-1);
        }while(true);
        let lineY=cy-total/2;ctx.textAlign='center';
        font(topSize,'700');ctx.fillStyle=data.text;
        topLines.forEach(line=>{ctx.fillText(line,cx,lineY+topSize*1.35/2);lineY+=topSize*1.35;});
        lineY+=gap;font(bottomSize);ctx.fillStyle=data.bottom;
        bottomLines.forEach(line=>{
          const baseline=lineY+bottomSize*1.35/2;ctx.fillText(line,cx,baseline);
          if(linked){const w=ctx.measureText(line).width;ctx.beginPath();ctx.strokeStyle='#8b94a5';ctx.lineWidth=.7;ctx.moveTo(cx-w/2,baseline+bottomSize*.55);ctx.lineTo(cx+w/2,baseline+bottomSize*.55);ctx.stroke();}
          lineY+=bottomSize*1.35;
        });
      }
      for(let p=0;p<PERIODS.length;p++){
        const rowY=y+tableHeader+p*rowHeight;
        box(MARGIN,rowY,periodWidth,rowHeight,data.header);
        ctx.textAlign='center';font(26,'700');ctx.fillStyle=data.text;ctx.fillText(PERIODS[p],MARGIN+periodWidth/2,rowY+rowHeight/2);
        for(let d=0;d<DAYS.length;d++){
          const raw=item.d[p]?.[d]||[0,0,0],topText=TEXTS[raw[0]]||'',bottomText=TEXTS[raw[1]]||'';
          const x=MARGIN+periodWidth+d*colWidth,fill=normalizeCellColor(topText,COLORS[raw[2]]||'#fff');
          box(x,rowY,colWidth,rowHeight,fill);
          const linked=!!viewerEl.querySelector('.cell[data-period="'+p+'"][data-day="'+d+'"][data-linked="true"]');
          cellText(topText,bottomText,x+colWidth/2,rowY+rowHeight/2,linked);
        }
      }
      y+=tableHeight;
      if(fields.length){
        y+=14;roundedRect(ctx,MARGIN,y,BLOCK_W,profileHeight,10);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle='#d7dbe7';ctx.lineWidth=1.2;ctx.stroke();
        ctx.textAlign='left';font(24,'700');ctx.fillStyle='#1b2233';ctx.fillText('担当',MARGIN+14,y+22);
        let fieldY=y+44;for(const field of fields){field.draw(MARGIN+14,fieldY);fieldY+=field.height+8;}
        y+=profileHeight;
      }
      ctx.textAlign='left';font(18);ctx.fillStyle='#5e6a85';
      ctx.fillText('上段：科目等 / 下段：担当・クラス',MARGIN,y+22);
      ctx.fillText('教員別 ver2.1 / クラス別 ver3.2',MARGIN,y+48);
      ctx.restore();
      font(17);ctx.fillStyle='#5e6a85';ctx.textAlign='center';ctx.fillText('1',PAGE_W/2,PAGE_H-36);
      const image=await encode(canvas,ctx);
      parent.postMessage({type:'timetable-pdf',...image,width:canvas.width,height:canvas.height,filename:'時間割_'+item.n.replace(/[\\/:*?"<>|]/g,'_')+'.pdf'},'*');
      status.textContent='PDFの保存画面を開きました。';
    }catch{status.textContent='PDFを作成できませんでした。もう一度お試しください。';}
    finally{
      if(canvas){canvas.width=1;canvas.height=1;}
      if(button.isConnected)button.disabled=false;
      busy=false;
    }
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('#timetable-pdf');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    const item=current();if(item)void exportPdf(item,button);
  },true);
})();

/* timetable-ui-v7 */
;(() => {
  'use strict';
  const byId=id=>document.getElementById(id);
  let mode='single',lastHeight=0,homePending=false;
  const label=document.createElement('label');
  label.className='search-label';label.htmlFor='q';label.textContent='教員・クラスを検索';
  qEl.before(label);
  qEl.placeholder='名前・クラス・所属を入力（例：原田、6-2）';
  qEl.setAttribute('aria-label','教員・クラスを検索');
  const post=data=>parent.postMessage(data,'*');
  function measure(){
    if(mode==='single')return;
    const wrap=document.querySelector('.wrap')||document.body;
    const height=Math.ceil(wrap.getBoundingClientRect().height+
      parseFloat(getComputedStyle(document.body).paddingTop)+parseFloat(getComputedStyle(document.body).paddingBottom));
    if(height!==lastHeight){lastHeight=height;post({type:'timetable-frame-height',height});}
  }
  const schedule=()=>requestAnimationFrame(measure);
  new ResizeObserver(schedule).observe(document.querySelector('.wrap')||document.body);
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','class']});
  window.addEventListener('resize',schedule);
  function toolState(){
    return {open:[...document.querySelectorAll('.feature-hub details[open]')].map(x=>x.id),
      common:[...document.querySelectorAll('#common-selected [data-remove]')].map(x=>x.dataset.remove),
      free:['free-day','free-period','free-subject','free-grade'].map(id=>[id,byId(id)?.value])};
  }
  function restoreTools(value){
    if(!value)return;
    document.querySelectorAll('.feature-hub details').forEach(x=>x.open=(value.open||[]).includes(x.id));
    for(const [id,v] of value.free||[])if(byId(id))byId(id).value=v;
    byId('common-clear')?.click();
    for(const key of value.common||[]){
      const item=ITEMS.find(x=>x.key===key);if(!item)continue;
      byId('common-query').value=item.n;
      byId('common-query').dispatchEvent(new Event('input',{bubbles:true}));
      [...document.querySelectorAll('#common-options [data-teacher]')].find(x=>x.dataset.teacher===key)?.click();
    }
    schedule();
  }
  function resetHome(){
    homePending=true;state.query='';state.currentKey='';qEl.value='';
    renderResults();renderEmpty();
    const meta=viewerEl.querySelector('.meta');
    if(meta)meta.textContent='上の検索欄に教員名やクラスを入力してください。';
    document.querySelector('.sidebar').hidden=true;qEl.setAttribute('aria-expanded','false');
    byId('common-clear')?.click();byId('common-query').value='';
    byId('common-query').dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelectorAll('.feature-hub details').forEach(x=>x.open=false);
    byId('free-results').replaceChildren();
    post({type:'timetable-selection',key:''});
    window.scrollTo(0,0);qEl.focus({preventScroll:true});homePending=false;schedule();
  }
  window.addEventListener('message',event=>{
    if(event.source!==parent||!event.data)return;
    const data=event.data;
    if(data.type==='timetable-display-mode'){
      const previous=mode;mode=data.mode||'single';document.body.dataset.mode=mode;
      label.textContent=mode==='comparison-secondary'?'時間割②を検索':mode==='comparison-primary'?'時間割①を検索':'教員・クラスを検索';
      qEl.setAttribute('aria-label',label.textContent);
      if(previous==='single'&&mode==='comparison-primary')post({type:'timetable-tool-state',state:toolState()});
      lastHeight=0;schedule();
    }
    if(data.type==='timetable-open-selection'&&ITEMS.some(x=>x.key===data.key)&&state.currentKey!==data.key)openItem(data.key);
    if(data.type==='timetable-restore-tools')restoreTools(data.state);
    if(data.type==='timetable-request-tools')post({type:'timetable-tool-state',state:toolState()});
    if(data.type==='timetable-home')resetHome();
  });
  document.addEventListener('click',event=>{
    if(mode!=='tools'||homePending)return;
    const button=event.target.closest('[data-open],.lessonResult');
    if(!button)return;
    setTimeout(()=>{if(state.currentKey)post({type:'timetable-tool-open',key:state.currentKey});},0);
  });
  post({type:'timetable-ui-ready'});
})();
