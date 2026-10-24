/* app.js - UI state, validation and rendering. All maths lives in algorithms.js (DTE). */
(function () {
  'use strict';

  const MAX_MESSAGE_BITS = 256;
  const PRESETS = [
    { label: '1011', bits: '1011' },
    { label: '16-bit', bits: '1011010111001100' },
    { label: '13-bit (padding)', bits: '1101001110110' },
    { label: 'Column-swap', bits: '0000000100000000' },
    { label: 'Wikipedia CRC', bits: '11010011101100' }
  ];
  const NAMES = { parity: 'Parity', checksum: 'Checksum', crc: 'CRC' };

  const state = {
    method: 'parity',
    sent: null,            // result of DTE.encode
    selected: [],          // one-based positions chosen for corruption
    run: null,             // result of DTE.runExperiment after transmit
    history: [],
    cfg: { parityType: 'even', generator: DTE.DEFAULT_GENERATOR }
  };

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  /* ---------------- input handling ---------------- */

  function readMessage() {
    const v = $('message').value.trim();
    const check = DTE.validateBinary(v, 'Message');
    if (check.ok && v.length > MAX_MESSAGE_BITS) return { ok: false, value: v, error: 'Message is limited to ' + MAX_MESSAGE_BITS + ' bits in this demo.' };
    return { ok: check.ok, value: v, error: check.error };
  }

  function showMessageState() {
    const m = readMessage();
    $('msg-error').textContent = m.ok ? '' : m.error;
    $('message').setAttribute('aria-invalid', String(!m.ok));
    $('msg-len').textContent = m.value.length + (m.value.length === 1 ? ' bit' : ' bits');
    return m;
  }

  function readGenerator() {
    const g = $('generator').value.trim();
    const v = DTE.validateGenerator(g);
    $('gen-error').textContent = v.ok ? '' : v.error;
    $('generator').setAttribute('aria-invalid', String(!v.ok));
    $('gen-info').textContent = v.ok ? 'degree ' + (g.length - 1) + ': ' + DTE.generatorToPolynomial(g) : 'invalid';
    return { ok: v.ok, value: g };
  }

  const METHOD_TEXT = {
    parity: '<b>Parity</b> adds one bit so the total number of 1s is even (or odd). It detects every <b>odd</b> number of flipped bits, but an <b>even</b> number of flips (like two) leaves the parity unchanged and goes unnoticed. It cannot locate or fix the error.',
    checksum: '<b>Checksum</b> adds the 8-bit words with end-around carry and sends the complement. The receiver adds everything, checksum included, and expects 11111111. It catches all single-bit errors but can miss compensating changes, and it is <b>not</b> a security feature.',
    crc: '<b>CRC</b> treats the bits as a polynomial and divides by the generator with XOR (modulo-2). The remainder is appended; the receiver expects a zero remainder. It is strong against bursts, but a zero remainder only means <b>no error detected</b>, not proof of error-free delivery.'
  };

  function updateMethodUI() {
    ['parity', 'checksum', 'crc'].forEach((m) => { $('cfg-' + m).hidden = m !== state.method; });
    $('method-info').innerHTML = METHOD_TEXT[state.method];
    if (state.method === 'crc') readGenerator();
  }

  /* ---------------- bit rendering ---------------- */

  /**
   * Render bits as cells. opts: layout{payloadLen}, selected(Set), changed(Set), clickable(fn)
   */
  function renderBits(container, bits, opts) {
    container.textContent = '';
    for (let i = 0; i < bits.length; i++) {
      const pos = i + 1;
      const isCheck = pos > opts.layout.payloadLen;
      const wrap = el('div', 'bit' + (isCheck ? ' check' : ' payload'));
      if (pos === opts.layout.payloadLen + 1) wrap.classList.add('gap');
      if (opts.selected && opts.selected.has(pos)) wrap.classList.add('selected');
      if (opts.changed && opts.changed.has(pos)) wrap.classList.add('changed');
      wrap.appendChild(el('span', 'idx', String(pos)));
      const kind = isCheck ? 'detection bit' : 'payload bit';
      let label = 'Bit ' + pos + ', value ' + bits[i] + ', ' + kind;
      if (opts.changed && opts.changed.has(pos)) label += ', changed by the channel';
      if (opts.selected && opts.selected.has(pos)) label += ', selected for corruption';
      let cell;
      if (opts.clickable) {
        cell = el('button', 'cell', bits[i]);
        cell.type = 'button';
        cell.setAttribute('aria-pressed', String(!!(opts.selected && opts.selected.has(pos))));
        cell.addEventListener('click', () => opts.clickable(pos));
      } else {
        cell = el('span', 'cell', bits[i]);
        cell.setAttribute('role', 'img');
      }
      cell.setAttribute('aria-label', label);
      cell.title = label;
      wrap.appendChild(cell);
      container.appendChild(wrap);
    }
  }

  /** Words (with right-padding shown as dashed cells) for checksum displays. */
  function renderWords(container, words, padCount, extraWord, extraLabel) {
    container.textContent = '';
    const row = el('div', 'word-row');
    words.forEach((w, wi) => {
      const wd = el('div', 'word');
      for (let i = 0; i < w.length; i++) {
        const isPad = wi === words.length - 1 && i >= w.length - padCount;
        const b = el('div', 'bit payload' + (isPad ? ' pad' : ''));
        b.appendChild(el('span', 'cell', w[i]));
        b.firstChild.title = isPad ? 'padding zero (not transmitted)' : 'payload bit';
        wd.appendChild(b);
      }
      row.appendChild(wd);
    });
    if (extraWord) {
      const wd = el('div', 'word');
      for (const c of extraWord) {
        const b = el('div', 'bit check');
        b.appendChild(el('span', 'cell', c));
        wd.appendChild(b);
      }
      wd.title = extraLabel;
      row.appendChild(wd);
    }
    container.appendChild(row);
  }

  /* ---------------- sender detail ---------------- */

  function senderDetail(s) {
    const box = $('sender-detail');
    box.textContent = '';
    if (s.method === 'parity') {
      box.appendChild(el('p', null, 'Payload has ' + s.payloadOnes + ' one(s). For ' + s.type + ' parity the parity bit is ' + s.parityBit +
        ', so the frame has ' + DTE.countOnes(s.frame) + ' ones in total. Frame = payload + parity bit (appended on the right).'));
    } else if (s.method === 'checksum') {
      box.appendChild(el('p', null, 'Payload split into ' + s.words.length + ' word(s) of 8 bits' +
        (s.padCount ? '; ' + s.padCount + ' zero(s) padded on the right (dashed cells, not transmitted)' : '; no padding needed') + '.'));
      const w = el('div'); renderWords(w, s.words, s.padCount, null); box.appendChild(w);
      const lines = s.steps.map((st, i) => 'word ' + (i + 1) + ': ' + st.before + ' + ' + st.word + ' = ' + st.raw.toString(2).padStart(8, '0') +
        (st.carried ? '  (carry wrapped around) -> ' + st.after : ''));
      lines.push('sum = ' + s.sum + '   checksum = complement = ' + s.checksum);
      box.appendChild(details('Show 1\'s-complement addition steps', lines.join('\n')));
    } else {
      box.appendChild(el('p', null, 'Generator ' + s.generator + ' (' + s.polynomial + '). Append ' + (s.generator.length - 1) +
        ' zeros -> ' + s.augmented + ', divide by the generator using XOR. Remainder = ' + s.remainder + ' is appended.'));
      box.appendChild(details('Show modulo-2 division steps', crcSteps(s.augmented, s.steps)));
    }
  }

  function crcSteps(start, steps) {
    if (!steps.length) return start + '\n(the first bits were all 0, so no XOR was needed)';
    return 'start: ' + start + '\n' + steps.map((st) => 'at bit ' + (st.shift + 1) + ': ' + st.before + ' XOR ' + st.generator + ' = ' + st.after).join('\n');
  }

  function details(summary, text) {
    const d = el('details');
    d.appendChild(el('summary', null, summary));
    d.appendChild(el('pre', null, text));
    return d;
  }

  /* ---------------- generate / select / transmit ---------------- */

  function generate(keepSelection) {
    const m = showMessageState();
    if (!m.ok) { $('message').focus(); return false; }
    if (state.method === 'crc' && !readGenerator().ok) { $('generator').focus(); return false; }
    state.cfg.parityType = $('parity-type').value;
    state.cfg.generator = $('generator').value.trim();
    state.sent = DTE.encode(state.method, m.value, state.cfg);
    state.run = null;
    state.selected = keepSelection ? state.selected.filter((p) => p <= state.sent.frame.length) : [];
    $('gen-status').textContent = NAMES[state.method] + ' frame generated (' + state.sent.frame.length + ' bits).';
    $('channel-empty').hidden = true;
    $('channel-body').hidden = false;
    $('received-wrap').hidden = true;
    $('receiver-body').hidden = true; $('receiver-empty').hidden = false;
    $('compare-body').hidden = true; $('compare-empty').hidden = false;
    $('pos-error').textContent = '';
    renderSender();
    return true;
  }

  function renderSender() {
    const s = state.sent;
    $('sent-len').textContent = s.frame.length + ' bits = ' + s.layout.payloadLen + ' payload + ' + s.layout.checkLen + ' detection';
    renderBits($('sent-frame'), s.frame, { layout: s.layout, selected: new Set(state.selected), clickable: toggleBit });
    senderDetail(s);
    $('positions').value = state.selected.join(', ');
    $('rand-count').max = s.frame.length;
    $('selection-summary').textContent = state.selected.length
      ? 'Selected for corruption: ' + state.selected.join(', ') + ' (' + state.selected.length + ' bit' + (state.selected.length > 1 ? 's' : '') + ').'
      : 'No bits selected. "Transmit with errors" needs at least one.';
  }

  function setSelection(list) {
    state.selected = list.slice().sort((a, b) => a - b);
    $('pos-error').textContent = '';
    renderSender();
  }

  function toggleBit(pos) {
    const i = state.selected.indexOf(pos);
    const next = state.selected.slice();
    if (i >= 0) next.splice(i, 1); else next.push(pos);
    setSelection(next);
    const btn = $('sent-frame').querySelectorAll('button.cell')[pos - 1];
    if (btn) btn.focus();                       // keep keyboard position after re-render
  }

  function applyPositions() {
    if (!state.sent) return;
    const r = DTE.parsePositions($('positions').value, state.sent.frame.length);
    if (r.error) { $('pos-error').textContent = r.error; $('positions').focus(); return; }
    setSelection(r.positions);
  }

  function randomPick() {
    if (!state.sent) return;
    const count = Number($('rand-count').value);
    const seed = Number($('rand-seed').value);
    try {
      if (!Number.isInteger(seed) || seed < 0) throw new Error('Seed must be a whole number, 0 or more.');
      setSelection(DTE.randomPositions(state.sent.frame.length, count, seed));
    } catch (e) {
      $('pos-error').textContent = e.message;
    }
  }

  function transmit(withErrors) {
    if (!state.sent) return;
    if (withErrors && state.selected.length === 0) {
      $('pos-error').textContent = 'Select at least one bit to corrupt (click a bit, type positions, or use Random pick), or use "Transmit without errors".';
      return;
    }
    const positions = withErrors ? state.selected : [];
    state.run = DTE.runExperiment(state.method, state.sent.payload, state.cfg, positions);
    renderReceived();
    state.history.unshift(historyLine(state.run));
    state.history = state.history.slice(0, 10);
    renderHistory();
    $('sec-receiver').scrollIntoView({ block: 'nearest' });
  }

  function historyLine(run) {
    const where = run.positions.length ? 'flipped ' + run.positions.join(',') : 'no errors';
    return NAMES[run.method] + ', message ' + run.sent.payload.slice(0, 24) + (run.sent.payload.length > 24 ? '...' : '') + ': ' + where + ' -> ' + OUTCOME[run.outcome].short;
  }

  function renderHistory() {
    const ol = $('history'); ol.textContent = '';
    state.history.forEach((h) => ol.appendChild(el('li', null, h)));
  }

  /* ---------------- receiver ---------------- */

  const OUTCOME = {
    clean: { cls: 'clean', title: 'No error detected', short: 'passed (no corruption)' },
    detected: { cls: 'detected', title: 'Error detected', short: 'error detected' },
    undetected: { cls: 'undetected', title: 'No error detected - but the frame was corrupted', short: 'UNDETECTED corruption' },
    'false-alarm': { cls: 'detected', title: 'Error reported on an uncorrupted frame (unexpected)', short: 'false alarm' }
  };

  function renderReceived() {
    const r = state.run;
    const changed = new Set(DTE.diffPositions(r.sent.frame, r.received));
    $('received-wrap').hidden = false;
    $('flip-summary').textContent = changed.size ? 'flipped positions: ' + [...changed].join(', ') : 'identical to sent frame';
    renderBits($('recv-frame'), r.received, { layout: r.sent.layout, changed });

    $('receiver-empty').hidden = true;
    $('receiver-body').hidden = false;

    const o = OUTCOME[r.outcome];
    const st = $('status');
    st.className = 'status ' + o.cls;
    st.textContent = '';
    st.appendChild(el('span', null, o.title));
    if (r.outcome === 'undetected') {
      st.appendChild(el('small', null, 'Warning: the received frame differs from the transmitted frame (bits ' + [...changed].join(', ') +
        ') even though the ' + NAMES[r.method] + ' check passed. This is a genuine limitation of the method.'));
    } else if (r.outcome === 'clean') {
      st.appendChild(el('small', null, 'The frame was not modified and the check passed.'));
    }
    renderValues(r);
    $('explanation').textContent = explain(r, changed);
  }

  function val(k, v, cls) {
    const d = el('div', 'val' + (cls ? ' ' + cls : ''));
    d.appendChild(el('div', 'k', k));
    d.appendChild(el('div', 'v', v));
    return d;
  }

  function renderValues(r) {
    const box = $('verify-values'); box.textContent = '';
    const c = r.check, s = r.sent;
    if (r.method === 'parity') {
      box.append(
        val('Parity type', c.type),
        val('Sender parity bit', s.parityBit),
        val('Received parity bit', c.receivedCheck),
        val('Ones in received frame', String(c.onesCount) + (c.onesCount % 2 ? ' (odd)' : ' (even)')),
        val('Required', c.type === 'even' ? 'even count' : 'odd count', c.passes ? 'good' : 'badv')
      );
    } else if (r.method === 'checksum') {
      box.append(
        val('Sender checksum', s.checksum),
        val('Received checksum', c.receivedChecksum, c.receivedChecksum === s.checksum ? '' : 'badv'),
        val('Checksum calculated from received payload', c.calculatedChecksum),
        val('Verification sum (payload + checksum)', c.verificationSum, c.passes ? 'good' : 'badv'),
        val('Expected sum', c.expectedSum)
      );
      const wrap = el('div', 'val'); wrap.style.gridColumn = '1 / -1';
      wrap.appendChild(el('div', 'k', 'Received words (dashed = receiver-side padding, solid yellow = received checksum)'));
      const holder = el('div'); renderWords(holder, c.words, c.padCount, c.receivedChecksum, 'received checksum');
      wrap.appendChild(holder);
      box.appendChild(wrap);
    } else {
      box.append(
        val('Generator', c.generator + '  (' + DTE.generatorToPolynomial(c.generator) + ')'),
        val('Sender remainder', s.remainder),
        val('Received remainder (CRC bits)', c.receivedCheck),
        val('Receiver remainder after division', c.remainder, c.passes ? 'good' : 'badv'),
        val('Required for "no error"', '0'.repeat(c.generator.length - 1))
      );
      const wrap = el('div', 'val'); wrap.style.gridColumn = '1 / -1';
      wrap.appendChild(details('Show receiver division steps', crcSteps(r.received, c.steps)));
      box.appendChild(wrap);
    }
  }

  function explain(r, changed) {
    const n = changed.size;
    const flips = n + ' bit' + (n === 1 ? ' was' : 's were') + ' flipped';
    const c = r.check;
    if (r.method === 'parity') {
      const base = 'The receiver counted ' + c.onesCount + ' ones; ' + c.type + ' parity needs an ' + (c.type === 'even' ? 'even' : 'odd') + ' count. ';
      if (r.outcome === 'detected') return base + flips + ', which changed the parity, so the error was detected. Parity cannot say which bit is wrong.';
      if (r.outcome === 'undetected') return base + flips + '. An even number of flips changes the count of ones by an even amount, so parity looks fine. Parity only catches odd-weight patterns.';
      return base + 'The frame arrived unchanged, so the check passes.';
    }
    if (r.method === 'checksum') {
      if (r.outcome === 'detected') return flips + '. The receiver added all words plus the checksum and got ' + c.verificationSum + ' instead of 11111111, so the error was detected.';
      if (r.outcome === 'undetected') return flips + ' but the changes cancelled out in the 1\'s-complement sum (for example +1 and -1 in the same bit column of two words), so the sum is still 11111111. Checksums are weaker than CRC and are not a security mechanism.';
      return 'The words plus the checksum add up to 11111111, as expected for an unchanged frame.';
    }
    if (r.outcome === 'detected') return flips + '. Dividing the received frame by ' + c.generator + ' left remainder ' + c.remainder + ' (not zero), so the error was detected.';
    if (r.outcome === 'undetected') return flips + ', but the error pattern happens to be exactly divisible by the generator, so the remainder is zero. A zero remainder means "no error detected", not "no error occurred".';
    return 'The remainder is zero. For an unchanged frame this is expected; in general a zero remainder only means no error was detected.';
  }

  /* ---------------- comparison ---------------- */

  function compare() {
    if (!state.run) return;
    const src = state.run;
    const runs = DTE.compareMethods(src.sent.payload, state.cfg, src.method, src.positions);
    const body = $('compare-table').querySelector('tbody');
    body.textContent = '';
    const notes = $('compare-notes'); notes.textContent = '';
    runs.forEach((r) => {
      const tr = el('tr');
      tr.appendChild(el('th', null, NAMES[r.method])); tr.firstChild.scope = 'row';
      const f = el('td'); f.appendChild(el('div', 'mono', r.sent.frame));
      f.appendChild(el('div', 'hint', r.sent.layout.payloadLen + ' payload + ' + r.sent.layout.checkLen + ' detection = ' + r.sent.frame.length + ' bits'));
      tr.appendChild(f);
      tr.appendChild(el('td', null, r.positions.length ? r.positions.join(', ') : 'none'));
      tr.appendChild(el('td', 'mono', checkSummary(r)));
      const oc = el('td'); const b = el('span', 'badge ' + OUTCOME[r.outcome].cls, OUTCOME[r.outcome].title.split(' - ')[0]);
      oc.appendChild(b);
      if (r.outcome === 'undetected') oc.appendChild(el('div', 'hint', 'Frame was corrupted but the check passed.'));
      tr.appendChild(oc);
      body.appendChild(tr);
      r.mapNotes.forEach((n) => notes.appendChild(el('p', null, NAMES[r.method] + ': ' + n)));
    });
    const mapInfo = el('p', null, 'Position mapping: errors were chosen on the ' + NAMES[src.method] + ' frame. Payload positions are identical in every frame (payload comes first). A flipped detection bit is mapped to the detection bit with the same offset in the other frame; if that frame has fewer detection bits it maps to its last one, and collisions are dropped.');
    notes.insertBefore(mapInfo, notes.firstChild);
    const det = runs.filter((r) => r.outcome === 'detected').map((r) => NAMES[r.method]);
    const mis = runs.filter((r) => r.outcome === 'undetected').map((r) => NAMES[r.method]);
    let s;
    if (!src.positions.length) s = 'No errors were injected, so every method passes. Try injecting errors to see differences.';
    else s = 'Detected by: ' + (det.join(', ') || 'none') + '. Missed (corruption passed the check): ' + (mis.join(', ') || 'none') +
      '. This is the result for this one error pattern only; it does not rank the methods in general.';
    $('compare-summary').textContent = s;
    $('compare-empty').hidden = true; $('compare-body').hidden = false;
    $('sec-results').scrollIntoView({ block: 'nearest' });
  }

  function checkSummary(r) {
    const c = r.check;
    if (r.method === 'parity') return 'ones = ' + c.onesCount + ' (' + c.type + ' required)';
    if (r.method === 'checksum') return 'sum = ' + c.verificationSum + ' (need 11111111)';
    return 'remainder = ' + c.remainder;
  }

  /* ---------------- reset & wiring ---------------- */

  function resetAll() {
    state.sent = null; state.run = null; state.selected = [];
    $('channel-empty').hidden = false; $('channel-body').hidden = true;
    $('receiver-empty').hidden = false; $('receiver-body').hidden = true;
    $('compare-empty').hidden = false; $('compare-body').hidden = true;
    $('gen-status').textContent = 'Reset. Edit the inputs and generate a new frame.';
    $('message').focus();
  }

  /** Switching method re-encodes the same message and maps the error selection across. */
  function switchMethod(newMethod) {
    const old = state.sent;
    state.method = newMethod;
    updateMethodUI();
    if (!old) return;
    const oldLayout = old.layout, oldSel = state.selected.slice();
    if (!generate(false)) return;
    if (oldSel.length) {
      const mapped = DTE.mapPositions(oldSel, oldLayout, state.sent.layout);
      setSelection(mapped.positions);
      if (mapped.notes.length) $('pos-error').textContent = 'Selection mapped to the new frame layout. ' + mapped.notes.join(' ');
    }
    $('gen-status').textContent += ' Same message, new method - transmit again to compare.';
  }

  function init() {
    PRESETS.forEach((p) => {
      const b = el('button', 'btn preset', p.label); b.type = 'button'; b.title = p.bits;
      b.addEventListener('click', () => { $('message').value = p.bits; showMessageState(); if (p.label === 'Wikipedia CRC') setMethod('crc', '1011'); if (state.sent) generate(false); });
      $('presets').appendChild(b);
    });
    $('message').addEventListener('input', () => { showMessageState(); });
    $('message').addEventListener('keydown', (e) => { if (e.key === 'Enter') generate(false); });
    document.querySelectorAll('input[name=method]').forEach((r) =>
      r.addEventListener('change', () => switchMethod(r.value)));
    $('parity-type').addEventListener('change', () => { if (state.sent) generate(true); });
    $('generator').addEventListener('input', readGenerator);
    $('generator').addEventListener('change', () => { if (state.sent && readGenerator().ok) generate(true); });
    $('btn-generate').addEventListener('click', () => generate(false));
    $('btn-apply-pos').addEventListener('click', applyPositions);
    $('positions').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyPositions(); });
    $('btn-random').addEventListener('click', randomPick);
    $('btn-send-err').addEventListener('click', () => transmit(true));
    $('btn-send-clean').addEventListener('click', () => transmit(false));
    $('btn-clear-sel').addEventListener('click', () => state.sent && setSelection([]));
    $('btn-reset').addEventListener('click', resetAll);
    $('btn-compare').addEventListener('click', compare);
    updateMethodUI();
    showMessageState();
  }

  function setMethod(m, generator) {
    document.querySelector('input[name=method][value=' + m + ']').checked = true;
    if (generator) $('generator').value = generator;
    switchMethod(m);
  }

  init();
})();
