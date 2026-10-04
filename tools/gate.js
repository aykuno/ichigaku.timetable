(() => {
  'use strict';
  const form = document.getElementById('login-form');
  const input = document.getElementById('password');
  const submit = document.getElementById('unlock');
  const toggle = document.getElementById('show-password');
  const compare = document.getElementById('compare');
  const status = document.getElementById('status');
  const login = document.getElementById('login');
  const app = document.getElementById('app');
  const container = document.getElementById('frame-container');
  let payload, sessionHtml = '', frames = [], generation = 0, busy = false, timer = null;
  const IDLE_MS = 30 * 60 * 1000;

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
  }
  function lock(message = '') {
    generation++;
    clearTimeout(timer);
    container.replaceChildren();
    frames = [];
    sessionHtml = '';
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
      sessionHtml = html;
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
  document.getElementById('logout').addEventListener('click', () => {
    lock('ログアウトしました。');
    input.focus();
  });
  window.addEventListener('message', event => {
    if (frames.some(frame => event.source === frame.contentWindow) &&
        event.data?.type === 'timetable-activity') resetTimer();
  });
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => { if (frames.length) resetTimer(); }, {passive: true});
  }
  window.addEventListener('pagehide', () => lock());
  window.addEventListener('pageshow', event => { if (event.persisted) lock(); });
})();
