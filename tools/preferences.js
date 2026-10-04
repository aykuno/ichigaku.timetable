const preferenceCrypto = (() => {
  const to64=bytes=>{const values=new Uint8Array(bytes);let binary='';for(let i=0;i<values.length;i+=8192)binary+=String.fromCharCode(...values.subarray(i,i+8192));return btoa(binary);};
  const from64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  const empty=()=>({favorites:[],recent:[],bells:{}});
  async function open(password,envelope) {
    if(envelope && (envelope.version!==1||envelope.iterations!==600000||typeof envelope.salt!=='string'||typeof envelope.iv!=='string'||typeof envelope.ciphertext!=='string'))throw new Error('Invalid saved preferences');
    const salt=envelope?from64(envelope.salt):crypto.getRandomValues(new Uint8Array(16));
    if(salt.length!==16)throw new Error('Invalid saved salt');
    const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    let preferences=empty();
    if(envelope){
      const iv=from64(envelope.iv);if(iv.length!==12)throw new Error('Invalid saved nonce');
      const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,tagLength:128},key,from64(envelope.ciphertext));
      const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext));
      if(!Array.isArray(parsed.favorites)||!Array.isArray(parsed.recent)||!parsed.bells||typeof parsed.bells!=='object')throw new Error('Invalid saved contents');
      preferences={favorites:parsed.favorites.filter(x=>typeof x==='string'&&x.length<300).slice(0,500),recent:parsed.recent.filter(x=>typeof x==='string'&&x.length<300).slice(0,5),bells:parsed.bells};
    }
    return {key,salt:to64(salt),preferences};
  }
  async function seal(session,preferences) {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,tagLength:128},session.key,new TextEncoder().encode(JSON.stringify(preferences)));
    return {version:1,iterations:600000,salt:session.salt,iv:to64(iv),ciphertext:to64(ciphertext)};
  }
  function update(previous,change) {
    const preferences=structuredClone(previous);
    const key=typeof change?.key==='string'&&change.key.length<300&&/^(teacher|class):/.test(change.key)?change.key:null;
    if(change?.type==='favorite'&&key){
      preferences.favorites=preferences.favorites.filter(x=>x!==key);
      if(change.enabled&&preferences.favorites.length<500)preferences.favorites.push(key);
    }else if(change?.type==='recent'&&key)preferences.recent=[key,...preferences.recent.filter(x=>x!==key)].slice(0,5);
    else if(change?.type==='clear'){preferences.favorites=[];preferences.recent=[];}
    else if(change?.type==='bells'&&['high','middle','highSat','middleSat'].includes(change.mode)){
      if(change.value===null)delete preferences.bells[change.mode];
      else if(Array.isArray(change.value)&&change.value.length===7){
        let previousEnd=-1;
        for(const times of change.value){
          if(times===null)continue;
          if(!Array.isArray(times)||times.length!==2||!times.every(x=>typeof x==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(x)))return previous;
          const toMinute=x=>Number(x.slice(0,2))*60+Number(x.slice(3));
          const start=toMinute(times[0]),end=toMinute(times[1]);
          if(end<=start||start<previousEnd)return previous;
          previousEnd=end;
        }
        preferences.bells[change.mode]=change.value;
      }
    }
    return preferences;
  }
  return {open,seal,update,empty};
})();
