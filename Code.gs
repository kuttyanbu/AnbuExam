/**
 * AnbuExam backend - deploy ONCE as a Web App, then never touch it again.
 *   Execute as: Me      Who has access: Anyone
 * It stores exams + results in an auto-created Google Sheet, checks the exam
 * password, enforces one attempt per email, scores answers and emails the score.
 * The answer key never leaves this script.
 */
const ADMIN_KEY = 'CHANGE-THIS-SECRET';   // <-- set once; you type it on admin.html

/** Run once from the editor (authorises Sheets + Mail). */
function setup() { Logger.log('Data sheet: ' + db_().getUrl()); }

function db_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('SS');
  if (id) return SpreadsheetApp.openById(id);
  const s = SpreadsheetApp.create('AnbuExam Data');
  s.getSheets()[0].setName('Exams').appendRow(['code', 'json', 'updated']);
  s.insertSheet('Results').appendRow(['code', 'email', 'status', 'startTs', 'endTs', 'score', 'total', 'percent', 'violations', 'reason', 'answers', 'log']);
  p.setProperty('SS', s.getId());
  return s;
}
const sh_ = n => db_().getSheetByName(n);
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const bad_ = m => ({ ok: false, error: m });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function doGet() { return json_({ ok: true, service: 'AnbuExam' }); }

function doPost(e) {
  let p, res, lock;
  try { p = JSON.parse(e.postData.contents); } catch (x) { return json_(bad_('Bad request')); }
  try {
    if (p.action !== 'exam') { lock = LockService.getScriptLock(); lock.waitLock(30000); }
    res = route_(p);
  } catch (err) { res = bad_(String(err.message || err)); }
  finally { if (lock) lock.releaseLock(); }
  if (res && res._mail) {
    try { MailApp.sendEmail(res._mail.to, res._mail.subject, res._mail.body); } catch (x) { Logger.log('Mail failed: ' + x); }
    delete res._mail;
  }
  return json_(res);
}

function route_(p) {
  switch (p.action) {
    case 'exam': return { ok: true, exam: pub_(need_(p.code)) };
    case 'start': return start_(p);
    case 'submit': return submit_(p);
  }
  if (p.adminKey !== ADMIN_KEY) return bad_('Wrong admin key.');
  switch (p.action) {
    case 'save': return save_(p.exam);
    case 'list': return list_();
    case 'get': return { ok: true, exam: need_(p.code) };
    case 'results': return results_(p.code);
    case 'delete': return del_(p.code);
  }
  return bad_('Unknown action');
}

/* ---------- exams ---------- */
function exams_() {
  return sh_('Exams').getDataRange().getValues().slice(1).map((r, i) => ({ row: i + 2, code: String(r[0]), data: JSON.parse(r[1]) }));
}
function find_(code) { code = String(code || '').trim().toUpperCase(); return exams_().filter(x => x.code === code)[0]; }
function need_(code) { const x = find_(code); if (!x) throw new Error('Exam not found. Check the exam code.'); return x.data; }
function pub_(d) {
  const o = Object.assign({}, d);
  delete o.password;
  o.hasPassword = !!d.password;
  o.questions = (d.questions || []).map(q => ({ q: q.q, options: q.options }));
  return o;
}
function rand_() { let s = ''; for (let i = 0; i < 6; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.charAt(Math.floor(Math.random() * 32)); return s; }

function save_(x) {
  if (!x || !x.name) return bad_('Exam name is required.');
  if (!Array.isArray(x.questions) || !x.questions.length) return bad_('Upload at least one question.');
  x.code = String(x.code || rand_()).toUpperCase();
  const txt = JSON.stringify(x);
  if (txt.length > 49000) return bad_('Exam is too large for one sheet cell (~49,000 characters). Split it into two exams.');
  const ex = find_(x.code), row = [x.code, txt, new Date()];
  if (ex) sh_('Exams').getRange(ex.row, 1, 1, 3).setValues([row]); else sh_('Exams').appendRow(row);
  return { ok: true, code: x.code };
}
function list_() {
  const att = attempts_();
  return {
    ok: true, exams: exams_().map(x => ({
      code: x.code, name: x.data.name, active: x.data.active !== false, questions: (x.data.questions || []).length,
      started: att.filter(a => a.r[0] === x.code).length, submitted: att.filter(a => a.r[0] === x.code && a.r[2] === 'submitted').length
    }))
  };
}
function del_(code) { const x = find_(code); if (x) sh_('Exams').deleteRow(x.row); return { ok: true }; }

/* ---------- attempts ---------- */
function attempts_() { return sh_('Results').getDataRange().getValues().slice(1).map((r, i) => ({ row: i + 2, r: r })); }
function attempt_(code, email) { return attempts_().filter(a => a.r[0] === code && String(a.r[1]).toLowerCase() === email)[0]; }

function start_(p) {
  const x = find_(p.code);
  if (!x || x.data.active === false) return bad_('This examination was not found or is closed.');
  const d = x.data, email = String(p.email || '').trim().toLowerCase(), now = Date.now();
  if (!EMAIL_RE.test(email)) return bad_('Enter a valid email address.');
  if (d.password && String(p.password) !== String(d.password)) return { ok: false, field: 'password', error: 'Incorrect examination password.' };
  const a = attempt_(x.code, email);
  if (a && a.r[2] === 'submitted') return bad_('You have already completed this examination.');
  let startTs;
  if (a) startTs = Number(a.r[3]);
  else {
    if (d.start && now < new Date(d.start).getTime()) return bad_('This examination has not opened yet.');
    if (d.end && now >= new Date(d.end).getTime()) return bad_('This examination is closed.');
    startTs = now;
    sh_('Results').appendRow([x.code, email, 'started', startTs, '', '', '', '', '', '', '', '']);
  }
  let deadline = startTs + Number(d.duration || 60) * 60000;
  if (d.end) deadline = Math.min(deadline, new Date(d.end).getTime());
  return { ok: true, serverNow: now, deadline: deadline, resumed: !!a };
}

function submit_(p) {
  const d = need_(p.code), email = String(p.email || '').trim().toLowerCase();
  const a = attempt_(d.code, email);
  if (!a) return bad_('No attempt found for this email.');
  const show = d.showScore !== false;
  if (a.r[2] === 'submitted') return { ok: true, showScore: show, score: a.r[5], total: a.r[6], percent: a.r[7] };
  const ans = p.answers || {}; let score = 0;
  d.questions.forEach((q, i) => { if (ans[i] != null && Number(ans[i]) === q.answer) score++; });
  const total = d.questions.length, percent = Math.round(score / total * 100);
  sh_('Results').getRange(a.row, 3, 1, 10).setValues([['submitted', a.r[3], Date.now(), score, total, percent,
    Number(p.violations) || 0, String(p.reason || '').slice(0, 200), JSON.stringify(ans), JSON.stringify(p.log || []).slice(0, 40000)]]);
  const res = { ok: true, showScore: show, score: score, total: total, percent: percent };
  if (d.emailScore) res._mail = {
    to: email, subject: d.name + ' - Your Score',
    body: 'Hello,\n\nThank you for attending ' + d.name + '.\n\nYour Score: ' + score + ' / ' + total + ' (' + percent + '%)\n\nRegards,\nExam Team'
  };
  return res;
}

function results_(code) {
  code = String(code || '').toUpperCase();
  return {
    ok: true, results: attempts_().filter(a => a.r[0] === code).map(a => ({
      email: a.r[1], status: a.r[2], startTs: a.r[3], endTs: a.r[4], score: a.r[5], total: a.r[6], percent: a.r[7], violations: a.r[8], reason: a.r[9]
    }))
  };
}
