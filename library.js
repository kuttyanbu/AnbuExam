/* Admin exam library: upload questions (XML/CSV/JSON), publish to the server, list, results */
(function () {
  const $ = id => document.getElementById(id);
  if (!$('xSave')) return;
  let questions = [], editCode = '';
  if (!SERVER_ON) $('noApi').classList.remove('hidden');
  $('adminKey').value = sessionStorage.getItem('anbu_key') || '';
  const key = () => { const k = $('adminKey').value; sessionStorage.setItem('anbu_key', k); return k; };
  const call = (a, p) => api(a, Object.assign({ adminKey: key() }, p)).then(r => { if (!r.ok) throw new Error(r.error); return r; });
  const toLocal = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const toIso = v => v ? new Date(v).toISOString() : '';
  const fail = (id, e) => { $(id).textContent = e.message === 'Failed to fetch' ? 'Cannot reach the server. Check config.js and that the Web App is deployed for "Anyone".' : e.message; };

  /* ----- parsing ----- */
  function toIndex(ans, opts) {
    ans = String(ans == null ? '' : ans).trim();
    if (/^[A-Za-z]$/.test(ans) && ans.toUpperCase().charCodeAt(0) - 65 < opts.length) return ans.toUpperCase().charCodeAt(0) - 65;
    const t = opts.indexOf(ans); if (t >= 0) return t;
    const n = parseInt(ans, 10); return n >= 1 && n <= opts.length ? n - 1 : -1;
  }
  function csvRows(t) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    row.push(f); rows.push(row);
    return rows.filter(r => r.some(x => x.trim()));
  }
  function parse(text, name) {
    const ext = name.split('.').pop().toLowerCase(); let raw = [];
    if (ext === 'json') { const j = JSON.parse(text); raw = (Array.isArray(j) ? j : j.questions).map(x => ({ q: x.q || x.question, options: x.options, answer: x.answer })); }
    else if (ext === 'xml') {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('This XML file is not well-formed.');
      raw = Array.from(doc.getElementsByTagName('question')).map(n => {
        const kid = t => { const e = n.getElementsByTagName(t)[0]; return e ? e.textContent.trim() : ''; };
        return { q: kid('text') || kid('q'), options: Array.from(n.getElementsByTagName('option')).map(o => o.textContent.trim()), answer: n.getAttribute('answer') || kid('answer') };
      });
    } else if (ext === 'csv') {
      let rows = csvRows(text);
      if (rows.length && /^question/i.test(rows[0][0].trim())) rows.shift();
      raw = rows.map(r => ({ q: r[0].trim(), options: r.slice(1, -1).map(x => x.trim()).filter(Boolean), answer: r[r.length - 1] }));
    } else throw new Error('Use a .xml, .csv or .json file.');
    return raw.map((r, i) => {
      const opts = (r.options || []).map(String);
      if (!r.q) throw new Error('Question ' + (i + 1) + ' has no text.');
      if (opts.length < 2) throw new Error('Question ' + (i + 1) + ' needs at least 2 options.');
      const a = toIndex(r.answer, opts);
      if (a < 0) throw new Error('Question ' + (i + 1) + ' has no valid correct answer (use A, B, C… or the option text).');
      return { q: r.q, options: opts, answer: a };
    });
  }
  $('qfile').addEventListener('change', async function () {
    $('xErr').textContent = ''; $('xPrev').textContent = ''; questions = [];
    const f = this.files[0]; if (!f) return;
    try {
      questions = parse(await f.text(), f.name);
      if (!questions.length) throw new Error('No questions found in the file.');
      $('xPrev').textContent = questions.length + ' questions ready. First: “' + questions[0].q.slice(0, 80) + '”';
      if (!$('xName').value) $('xName').value = f.name.replace(/\.[^.]+$/, '');
    } catch (e) { $('xErr').textContent = e.message; }
  });

  /* ----- templates ----- */
  const dl = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name; a.click(); };
  $('tXml').onclick = e => { e.preventDefault(); dl('questions-template.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<exam>\n  <question answer="C">\n    <text>What is 25% of 480?</text>\n    <option>100</option>\n    <option>110</option>\n    <option>120</option>\n    <option>140</option>\n  </question>\n</exam>\n', 'text/xml'); };
  $('tCsv').onclick = e => { e.preventDefault(); dl('questions-template.csv', 'question,A,B,C,D,answer\n"What is 25% of 480?",100,110,120,140,C\n', 'text/csv'); };
  $('tJson').onclick = e => { e.preventDefault(); dl('questions-template.json', JSON.stringify([{ q: 'What is 25% of 480?', options: ['100', '110', '120', '140'], answer: 'C' }], null, 2), 'application/json'); };

  /* ----- publish ----- */
  const examObj = () => ({
    code: editCode, name: $('xName').value.trim(), instructions: $('xInstr').value.trim(), password: $('xPw').value.trim(),
    duration: parseInt($('xDur').value, 10), graceSeconds: parseInt($('xGrace').value, 10), maxViolations: parseInt($('xMax').value, 10),
    start: toIso($('xStart').value), end: toIso($('xEnd').value), action: $('xAction').value,
    fullscreen: $('xFs').checked, tabDetect: $('xTab').checked, showScore: $('xShow').checked, emailScore: $('xMail').checked, active: $('xActive').checked,
    autoFinish: true, questions: questions
  });
  $('xSave').onclick = async function () {
    $('xErr2').textContent = ''; $('xOk').textContent = '';
    const x = examObj();
    if (!x.name) return $('xErr2').textContent = 'Enter an examination name.';
    if (!questions.length) return $('xErr2').textContent = 'Upload a questions file first.';
    if (!(x.duration >= 1) || !(x.maxViolations >= 1) || !(x.graceSeconds >= 0)) return $('xErr2').textContent = 'Check duration, grace period and maximum violations.';
    if (x.start && x.end && new Date(x.end) <= new Date(x.start)) return $('xErr2').textContent = 'Closing time must be after opening time.';
    if (!x.instructions) x.instructions = '1. Answer every question and press Submit exam before time ends.\n2. Do not refresh or close this page.';
    try {
      const r = await call('save', { exam: x }); editCode = r.code;
      const link = new URL('index.html?exam=' + r.code, location.href).href;
      $('xOk').innerHTML = 'Published. Student link: <a href="' + link + '" target="_blank" rel="noopener">' + link + '</a>';
      navigator.clipboard && navigator.clipboard.writeText(link).catch(() => {}); refresh();
    } catch (e) { fail('xErr2', e); }
  };
  $('xNew').onclick = () => { editCode = ''; questions = []; $('qfile').value = ''; ['xName', 'xPw', 'xInstr', 'xStart', 'xEnd'].forEach(i => $(i).value = ''); $('xPrev').textContent = ''; $('xOk').textContent = 'Ready for a new exam.'; };

  /* ----- list / edit / results ----- */
  const td = (tr, txt) => { const c = document.createElement('td'); c.textContent = txt; tr.appendChild(c); return c; };
  const btn = (c, txt, fn) => { const b = document.createElement('button'); b.className = 'link'; b.type = 'button'; b.textContent = txt; b.onclick = fn; c.appendChild(b); };
  async function refresh() {
    try {
      const r = await call('list', {}); const tb = $('xList').querySelector('tbody'); tb.innerHTML = '';
      if (!r.exams.length) { td(tb.insertRow(), 'No exams yet. Upload a questions file above.').className = 'meta'; return; }
      const h = tb.insertRow(); ['Exam', 'Code', 'Questions', 'Submitted', 'Actions'].forEach(t => { const c = document.createElement('th'); c.textContent = t; h.appendChild(c); });
      r.exams.forEach(x => {
        const tr = tb.insertRow(); td(tr, x.name + (x.active ? '' : ' (closed)')); td(tr, x.code); td(tr, x.questions); td(tr, x.submitted + ' / ' + x.started);
        const a = td(tr, ''); a.className = 'acts';
        btn(a, 'Copy link', () => navigator.clipboard.writeText(new URL('index.html?exam=' + x.code, location.href).href).then(() => $('xOk').textContent = 'Link copied.'));
        btn(a, 'Edit', async () => {
          try {
            const e = (await call('get', { code: x.code })).exam; editCode = e.code; questions = e.questions;
            $('xName').value = e.name; $('xInstr').value = e.instructions || ''; $('xPw').value = e.password || ''; $('xDur').value = e.duration; $('xGrace').value = e.graceSeconds; $('xMax').value = e.maxViolations;
            $('xStart').value = toLocal(e.start); $('xEnd').value = toLocal(e.end); $('xAction').value = e.action;
            $('xFs').checked = !!e.fullscreen; $('xTab').checked = !!e.tabDetect; $('xShow').checked = e.showScore !== false; $('xMail').checked = !!e.emailScore; $('xActive').checked = e.active !== false;
            $('xPrev').textContent = questions.length + ' questions loaded. Upload a new file to replace them.'; $('xOk').textContent = 'Editing ' + e.code; window.scrollTo({ top: 0, behavior: 'smooth' });
          } catch (er) { fail('xErr2', er); }
        });
        btn(a, 'Results CSV', async () => {
          try {
            const rs = (await call('results', { code: x.code })).results;
            const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
            const t = a => a ? new Date(Number(a)).toLocaleString() : '';
            dl(x.code + '-results.csv', 'Email,Status,Started,Ended,Score,Total,Percent,Violations,Reason\n' + rs.map(r => [r.email, r.status, t(r.startTs), t(r.endTs), r.score, r.total, r.percent, r.violations, r.reason].map(q).join(',')).join('\n'), 'text/csv');
          } catch (er) { fail('xErr2', er); }
        });
        btn(a, 'Delete', async () => { if (confirm('Delete exam ' + x.code + '? Results stay in the sheet.')) { try { await call('delete', { code: x.code }); refresh(); } catch (er) { fail('xErr2', er); } } });
      });
    } catch (e) { fail('xErr2', e); }
  }
  $('xRefresh').onclick = refresh;
})();
