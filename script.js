/* SmartExam shared helpers + registration page logic */
const KEYS = { cfg: 'smartexam_config', sess: 'smartexam_session', stu: 'smartexam_student', done: 'smartexam_done', srv: 'smartexam_server_exam' };
const DEFAULTS = {
  name: 'Basic Java Assessment',
  instructions: '1. Answer every question in the embedded form and press Submit before time ends.\n2. The exam runs in fullscreen. Leaving fullscreen or switching tabs is recorded as a violation.\n3. If you leave the exam screen you have 15 seconds to come back, or the exam is closed.\n4. After you press Submit in the form, the exam closes automatically.\n5. Do not refresh or close this page during the exam.',
  formUrl: 'https://docs.google.com/forms/d/1xowLDYRJgt_JugL9Ma3mOIZZmKYX0WNXbeUskRsplJU/viewform?embedded=true',
  duration: 60, start: '', end: '', password: '', graceSeconds: 15, autoFinish: true,
  fullscreen: true, tabDetect: true, maxViolations: 3, action: 'limit'
};
function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
function getConfig() {
  const srv = /admin/.test(location.pathname) ? null : load(KEYS.srv); // exam fetched from the server
  const cfg = Object.assign({}, DEFAULTS, load(KEYS.cfg) || {}, srv || {});
  delete cfg.students; // remove legacy per-student password lists from older builds
  return cfg;
}
function isGoogleFormUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'docs.google.com' && x.pathname.indexOf('/forms/') === 0; }
  catch (e) { return false; }
}
function embedUrl(u) { const x = new URL(u); x.searchParams.set('embedded', 'true'); return x.toString(); }
const SERVER_ON = typeof API_URL === 'string' && /^https:\/\//.test(API_URL);
async function api(action, payload) {
  const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action: action }, payload)) });
  return r.json();
}
function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(ts) { return new Date(ts).toLocaleString(); }

/* Returns an error string if the exam window is closed, else '' */
function windowError(cfg, now) {
  if (cfg.start && now < new Date(cfg.start).getTime()) return 'This examination opens on ' + fmtDate(cfg.start) + '.';
  if (cfg.end && now >= new Date(cfg.end).getTime()) return 'This examination closed on ' + fmtDate(cfg.end) + '.';
  return '';
}

/* ---- Student registration page (index.html) ---- */
(function () {
  const form = document.getElementById('regForm');
  if (!form) return;
  const $ = id => document.getElementById(id);
  const setErr = (id, msg) => { $('e-' + id).textContent = msg || ''; return !msg; };
  const params = new URLSearchParams(location.search);
  let pub = null;               // exam loaded from the server (server mode only)
  let cfg = getConfig();
  const sess = load(KEYS.sess);
  const banner = $('banner');
  if (sess && sess.status === 'active') {
    banner.classList.remove('hidden');
    banner.textContent = 'An examination is already in progress in this browser. Enter the same email address to resume it.';
  }
  $('examName').textContent = cfg.name;

  async function loadExam(code) {
    pub = null; setErr('code', '');
    if (!code) { $('examName').textContent = cfg.name; return; }
    try {
      const r = await api('exam', { code: code });
      if (!r.ok) throw new Error(r.error);
      pub = r.exam; $('examName').textContent = pub.name;
      $('pwWrap').classList.toggle('hidden', !pub.hasPassword);
    } catch (e) { setErr('code', e.message === 'Failed to fetch' ? 'Cannot reach the server. Check your connection.' : e.message); }
  }
  if (SERVER_ON) {
    $('codeWrap').classList.remove('hidden');
    $('code').value = (params.get('exam') || '').toUpperCase();
    if ($('code').value) loadExam($('code').value);
    $('code').addEventListener('change', () => loadExam($('code').value.trim().toUpperCase()));
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    const email = form.elements.email.value.trim().toLowerCase();
    const pw = form.elements.password.value;
    const code = SERVER_ON ? $('code').value.trim().toUpperCase() : '';
    const formErr = $('e-form'); formErr.textContent = '';
    let ok = setErr('email', /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? '' : 'Enter a valid email address.');
    const serverExam = SERVER_ON && code;
    if (!ok) return;

    /* ----- Server exam (uploaded questions, password checked by the server) ----- */
    if (serverExam) {
      if (!pub) await loadExam(code);
      if (!pub) return;
      if (pub.hasPassword && !pw) { setErr('password', 'Enter the examination password.'); return; }
      if (sess && sess.status === 'active' && sess.student.email.toLowerCase() === email && sess.student.code === code) { location.href = 'exam.html'; return; }
      if (sess && sess.status === 'active') { formErr.textContent = 'Another examination is in progress in this browser.'; return; }
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Checking…';
      try {
        const r = await api('start', { code: code, email: email, password: pw });
        if (!r.ok) { r.field === 'password' ? setErr('password', r.error) : formErr.textContent = r.error; return; }
        localStorage.removeItem(KEYS.sess);
        save(KEYS.srv, pub);
        save(KEYS.stu, { name: '', roll: '', email: email, code: code, at: Date.now(), deadlineAt: Date.now() + (r.deadline - r.serverNow) });
        location.href = 'exam.html';
      } catch (e) { formErr.textContent = 'Cannot reach the server. Check your connection and try again.'; }
      finally { btn.disabled = false; btn.textContent = 'Register and continue'; }
      return;
    }

    /* ----- Original single-exam mode (unchanged) ----- */
    localStorage.removeItem(KEYS.srv); cfg = getConfig();
    ok = setErr('password', pw ? '' : 'Enter the examination password.') && ok;
    if (!ok) return;
    if (!cfg.password) { formErr.textContent = 'The examination password is not configured. Contact your administrator.'; return; }
    if (pw !== cfg.password) { setErr('password', 'Incorrect examination password.'); return; }
    if (sess && sess.status === 'active') {
      if (sess.student.email.toLowerCase() === email) { location.href = 'exam.html'; return; }
      formErr.textContent = 'Another examination is in progress in this browser.'; return;
    }
    if ((load(KEYS.done) || []).indexOf(email) !== -1) { formErr.textContent = 'You have already completed this examination.'; return; }
    const we = windowError(cfg, Date.now());
    if (we) { formErr.textContent = we; return; }
    localStorage.removeItem(KEYS.sess);
    save(KEYS.stu, { name: '', roll: '', email: email, at: Date.now() });
    location.href = 'exam.html';
  });
})();
