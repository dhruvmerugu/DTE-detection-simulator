/*
 * algorithms.js - pure error-detection algorithms (no DOM, no browser APIs).
 *
 * Conventions used everywhere in this project
 *   - A "bit string" is a JS string made only of '0' and '1'.
 *   - Bit positions are ONE-BASED and count from the LEFT: position 1 is the
 *     first bit sent on the wire, position N is the last bit of the frame.
 *   - Frame layouts (check bits are always appended on the RIGHT):
 *       Parity   : payload | 1 parity bit
 *       Checksum : payload | 8-bit checksum        (padding is NOT transmitted)
 *       CRC      : payload | (generator.length-1)-bit remainder
 *
 * Works in the browser (window.DTE) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DTE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORD_BITS = 8;            // checksum word size
  const DEFAULT_GENERATOR = '1101';
  const MAX_GENERATOR_LEN = 33;   // x^32 + ... (CRC-32 sized) is the largest we accept

  /* ------------------------------------------------------------------ */
  /* Input validation helpers                                            */
  /* ------------------------------------------------------------------ */

  /** Returns {ok, error}. Empty input and non-0/1 characters are rejected. */
  function validateBinary(str, label) {
    label = label || 'Input';
    if (typeof str !== 'string') return { ok: false, error: label + ' must be text.' };
    if (str.length === 0) return { ok: false, error: label + ' is empty. Enter at least one bit.' };
    const bad = str.search(/[^01]/);
    if (bad !== -1) {
      return { ok: false, error: label + ' may contain only 0 and 1 (found "' + str[bad] + '" at position ' + (bad + 1) + ').' };
    }
    return { ok: true, error: null };
  }

  function assertBinary(str, label) {
    const v = validateBinary(str, label);
    if (!v.ok) throw new Error(v.error);
  }

  /** A CRC generator needs only 0/1, length >= 2, and leading AND trailing 1. */
  function validateGenerator(gen) {
    const v = validateBinary(gen, 'Generator');
    if (!v.ok) return v;
    if (gen.length < 2) return { ok: false, error: 'Generator must have at least 2 bits (degree >= 1).' };
    if (gen.length > MAX_GENERATOR_LEN) return { ok: false, error: 'Generator may have at most ' + MAX_GENERATOR_LEN + ' bits.' };
    if (gen[0] !== '1') return { ok: false, error: 'Generator must start with 1 (the highest-degree term x^n must be present).' };
    if (gen[gen.length - 1] !== '1') return { ok: false, error: 'Generator must end with 1 (the constant term must be present).' };
    return { ok: true, error: null };
  }

  function assertGenerator(gen) {
    const v = validateGenerator(gen);
    if (!v.ok) throw new Error(v.error);
  }

  /** Human-readable polynomial, e.g. "1101" -> "x^3 + x^2 + 1". */
  function generatorToPolynomial(gen) {
    const deg = gen.length - 1;
    const terms = [];
    for (let i = 0; i < gen.length; i++) {
      if (gen[i] !== '1') continue;
      const p = deg - i;
      terms.push(p === 0 ? '1' : p === 1 ? 'x' : 'x^' + p);
    }
    return terms.join(' + ');
  }

  /* ------------------------------------------------------------------ */
  /* Error injection                                                     */
  /* ------------------------------------------------------------------ */

  /** Throws unless positions is a list of unique integers in 1..frameLength. */
  function validatePositions(positions, frameLength) {
    if (!Array.isArray(positions)) throw new Error('Positions must be a list.');
    const seen = new Set();
    for (const p of positions) {
      if (!Number.isInteger(p)) throw new Error('Bit position "' + p + '" is not a whole number.');
      if (p < 1 || p > frameLength) {
        throw new Error('Bit position ' + p + ' is outside the frame (valid range is 1 to ' + frameLength + ').');
      }
      if (seen.has(p)) throw new Error('Bit position ' + p + ' is listed more than once.');
      seen.add(p);
    }
  }

  /** Flip the given one-based positions in a frame and return the new frame. */
  function flipBits(frame, positions) {
    assertBinary(frame, 'Frame');
    validatePositions(positions, frame.length);
    const bits = frame.split('');
    for (const p of positions) bits[p - 1] = bits[p - 1] === '0' ? '1' : '0';
    return bits.join('');
  }

  /**
   * Parse user text such as "3, 7 12" into sorted unique positions.
   * Returns {positions, error}; never throws.
   */
  function parsePositions(text, frameLength) {
    const tokens = String(text).split(/[\s,;]+/).filter(Boolean);
    if (tokens.length === 0) return { positions: [], error: 'Enter at least one bit position.' };
    const positions = [];
    for (const t of tokens) {
      if (!/^\d+$/.test(t)) return { positions: [], error: '"' + t + '" is not a valid bit position (use whole numbers).' };
      positions.push(Number(t));
    }
    try {
      validatePositions(positions, frameLength);
    } catch (e) {
      return { positions: [], error: e.message };
    }
    return { positions: positions.slice().sort((a, b) => a - b), error: null };
  }

  /** Small seeded PRNG (mulberry32) so random experiments are reproducible. */
  function makeRng(seed) {
    let a = (Number(seed) >>> 0) || 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Pick `count` distinct positions in 1..frameLength (sorted), reproducible per seed. */
  function randomPositions(frameLength, count, seed) {
    if (!Number.isInteger(frameLength) || frameLength < 1) throw new Error('Frame length must be a positive integer.');
    if (!Number.isInteger(count) || count < 1) throw new Error('Error count must be a whole number of at least 1.');
    if (count > frameLength) throw new Error('Error count (' + count + ') cannot exceed the frame length (' + frameLength + ').');
    const rng = makeRng(seed);
    const pool = [];
    for (let i = 1; i <= frameLength; i++) pool.push(i);
    for (let i = 0; i < count; i++) {                  // partial Fisher-Yates shuffle
      const j = i + Math.floor(rng() * (frameLength - i));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, count).sort((a, b) => a - b);
  }

  /** Positions where two equal-length bit strings differ (one-based). */
  function diffPositions(a, b) {
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i + 1);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* A. Parity                                                           */
  /* ------------------------------------------------------------------ */

  function assertParityType(type) {
    if (type !== 'even' && type !== 'odd') throw new Error('Parity type must be "even" or "odd".');
  }

  function countOnes(bits) {
    let n = 0;
    for (const c of bits) if (c === '1') n++;
    return n;
  }

  /** Frame = payload + parity bit. Even: total 1s even. Odd: total 1s odd. */
  function parityEncode(message, type) {
    assertBinary(message, 'Message');
    assertParityType(type);
    const ones = countOnes(message);
    const parityBit = type === 'even' ? String(ones % 2) : String(1 - (ones % 2));
    return {
      method: 'parity',
      type,
      payload: message,
      payloadOnes: ones,
      parityBit,
      check: parityBit,
      frame: message + parityBit,
      layout: { payloadLen: message.length, checkLen: 1 }
    };
  }

  /** Receiver: count 1s in the whole received frame (needs >= 2 bits). */
  function parityVerify(frame, type) {
    assertBinary(frame, 'Received frame');
    assertParityType(type);
    if (frame.length < 2) throw new Error('A parity frame needs at least 2 bits (payload + parity bit).');
    const ones = countOnes(frame);
    const passes = type === 'even' ? ones % 2 === 0 : ones % 2 === 1;
    return {
      method: 'parity',
      type,
      payload: frame.slice(0, -1),
      receivedCheck: frame.slice(-1),
      onesCount: ones,
      expectedParity: type,
      passes,
      detected: !passes
    };
  }

  /* ------------------------------------------------------------------ */
  /* B. Internet-style 1's-complement checksum (8-bit words)             */
  /* ------------------------------------------------------------------ */

  /** Add any carry out of the top bit back into the low bits until none remains. */
  function foldCarry(value, width) {
    width = width || WORD_BITS;
    const mask = (1 << width) - 1;
    while (value > mask) value = (value & mask) + (value >>> width);   // repeats if the carry carries again
    return value;
  }

  /**
   * Split bits into 8-bit words. A short last word is padded with 0s on the
   * RIGHT. Padding is virtual: sender and receiver both add it, it is never sent.
   */
  function padToWords(bits) {
    assertBinary(bits, 'Bits');
    const padCount = (WORD_BITS - (bits.length % WORD_BITS)) % WORD_BITS;
    const padded = bits + '0'.repeat(padCount);
    const words = [];
    for (let i = 0; i < padded.length; i += WORD_BITS) words.push(padded.slice(i, i + WORD_BITS));
    return { words, padCount, padded };
  }

  const toWord = (n) => n.toString(2).padStart(WORD_BITS, '0');

  /**
   * 1's-complement sum of 8-bit word strings with end-around carry.
   * Returns {sum (number), sumBits, steps[]} where each step shows raw sum and carry.
   */
  function onesComplementSum(words) {
    let acc = 0;
    const steps = [];
    for (const w of words) {
      assertBinary(w, 'Word');
      if (w.length !== WORD_BITS) throw new Error('Each word must be exactly ' + WORD_BITS + ' bits.');
      const raw = acc + parseInt(w, 2);
      const result = foldCarry(raw, WORD_BITS);
      steps.push({ word: w, before: toWord(acc), raw, carried: raw > 0xFF, after: toWord(result) });
      acc = result;
    }
    return { sum: acc, sumBits: toWord(acc), steps };
  }

  /** Frame = payload + 8-bit checksum, where checksum = ~(1's-complement sum of payload words). */
  function checksumEncode(message) {
    assertBinary(message, 'Message');
    const { words, padCount, padded } = padToWords(message);
    const s = onesComplementSum(words);
    const checksum = toWord(~s.sum & 0xFF);
    return {
      method: 'checksum',
      payload: message,
      words,
      padCount,
      padded,
      steps: s.steps,
      sum: s.sumBits,
      checksum,
      check: checksum,
      frame: message + checksum,
      layout: { payloadLen: message.length, checkLen: WORD_BITS }
    };
  }

  /**
   * Receiver: last 8 bits = received checksum, the rest = payload. Pad the
   * payload the same way, add all words INCLUDING the checksum; pass iff the
   * result is 11111111.
   */
  function checksumVerify(frame) {
    assertBinary(frame, 'Received frame');
    if (frame.length < WORD_BITS + 1) {
      throw new Error('A checksum frame needs at least ' + (WORD_BITS + 1) + ' bits (1 payload bit + ' + WORD_BITS + ' checksum bits).');
    }
    const payload = frame.slice(0, -WORD_BITS);
    const receivedChecksum = frame.slice(-WORD_BITS);
    const { words, padCount } = padToWords(payload);
    const payloadSum = onesComplementSum(words);
    const calculatedChecksum = toWord(~payloadSum.sum & 0xFF);
    const total = onesComplementSum(words.concat([receivedChecksum]));
    const passes = total.sum === 0xFF;
    return {
      method: 'checksum',
      payload,
      words,
      padCount,
      receivedChecksum,
      calculatedChecksum,        // what the checksum SHOULD be for the received payload
      steps: total.steps,
      verificationSum: total.sumBits,
      expectedSum: '11111111',
      passes,
      detected: !passes
    };
  }

  /* ------------------------------------------------------------------ */
  /* C. CRC (modulo-2 division)                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Divide `bits` by `generator` using XOR (no borrows/carries).
   * Returns the remainder (generator.length-1 bits) and the XOR steps.
   */
  function crcRemainder(bits, generator) {
    assertBinary(bits, 'Bits');
    assertGenerator(generator);
    if (bits.length < generator.length) throw new Error('Bit string is shorter than the generator.');
    const work = bits.split('');
    const steps = [];
    for (let i = 0; i + generator.length <= work.length; i++) {
      if (work[i] === '0') continue;                         // leading 0: quotient bit is 0, skip
      const before = work.slice(i, i + generator.length).join('');
      for (let j = 0; j < generator.length; j++) {
        work[i + j] = work[i + j] === generator[j] ? '0' : '1';  // XOR
      }
      steps.push({ shift: i, before, generator, after: work.slice(i, i + generator.length).join('') });
    }
    return { remainder: work.slice(work.length - (generator.length - 1)).join(''), steps };
  }

  /** Frame = payload + remainder of (payload followed by r zeros) / generator. */
  function crcEncode(message, generator) {
    assertBinary(message, 'Message');
    assertGenerator(generator);
    const r = generator.length - 1;
    const augmented = message + '0'.repeat(r);
    const { remainder, steps } = crcRemainder(augmented, generator);
    return {
      method: 'crc',
      payload: message,
      generator,
      polynomial: generatorToPolynomial(generator),
      augmented,
      steps,
      remainder,
      check: remainder,
      frame: message + remainder,
      layout: { payloadLen: message.length, checkLen: r }
    };
  }

  /** Receiver: divide the entire received frame; remainder all-zero => "no error detected". */
  function crcVerify(frame, generator) {
    assertBinary(frame, 'Received frame');
    assertGenerator(generator);
    const r = generator.length - 1;
    if (frame.length <= r) {
      throw new Error('A CRC frame must be longer than ' + r + ' bits (generator degree) to hold a payload.');
    }
    const { remainder, steps } = crcRemainder(frame, generator);
    const passes = !remainder.includes('1');
    return {
      method: 'crc',
      generator,
      payload: frame.slice(0, frame.length - r),
      receivedCheck: frame.slice(frame.length - r),
      steps,
      remainder,
      passes,
      detected: !passes
    };
  }

  /* ------------------------------------------------------------------ */
  /* Generic dispatch + experiment helpers                               */
  /* ------------------------------------------------------------------ */

  const METHODS = ['parity', 'checksum', 'crc'];

  /** cfg = {parityType: 'even'|'odd', generator: '1101'} */
  function encode(method, message, cfg) {
    cfg = cfg || {};
    if (method === 'parity') return parityEncode(message, cfg.parityType || 'even');
    if (method === 'checksum') return checksumEncode(message);
    if (method === 'crc') return crcEncode(message, cfg.generator || DEFAULT_GENERATOR);
    throw new Error('Unknown method "' + method + '".');
  }

  /** Receiver side: uses ONLY the received frame and the method configuration. */
  function verify(method, frame, cfg) {
    cfg = cfg || {};
    if (method === 'parity') return parityVerify(frame, cfg.parityType || 'even');
    if (method === 'checksum') return checksumVerify(frame);
    if (method === 'crc') return crcVerify(frame, cfg.generator || DEFAULT_GENERATOR);
    throw new Error('Unknown method "' + method + '".');
  }

  /**
   * corrupted = received frame differs from the transmitted frame (known to the simulator only).
   * detected  = the receiver's check failed.
   */
  function classify(corrupted, detected) {
    if (!corrupted) return detected ? 'false-alarm' : 'clean';
    return detected ? 'detected' : 'undetected';
  }

  /** Encode -> inject -> verify in one call. */
  function runExperiment(method, message, cfg, positions) {
    const sent = encode(method, message, cfg);
    const received = flipBits(sent.frame, positions);
    const check = verify(method, received, cfg);
    const corrupted = received !== sent.frame;
    return {
      method, sent, received, positions: positions.slice(),
      check, corrupted, outcome: classify(corrupted, check.detected)
    };
  }

  /**
   * Map error positions from one frame layout to another so methods with
   * different frame lengths can be compared fairly.
   *   - Payload bits come first in every frame, so payload position p stays p.
   *   - A bit in the check field maps to the check bit with the same offset
   *     (k-th bit of the check field). If the target field is shorter, it maps
   *     to the target's last check bit; duplicates are dropped and reported.
   */
  function mapPositions(positions, fromLayout, toLayout) {
    const mapped = [];
    const notes = [];
    const taken = new Set();
    for (const p of positions) {
      let q;
      if (p <= fromLayout.payloadLen) {
        q = p;
      } else {
        const offset = p - fromLayout.payloadLen;                   // 1-based inside the check field
        const target = Math.min(offset, toLayout.checkLen);
        q = toLayout.payloadLen + target;
        if (target !== offset) {
          notes.push('Check bit ' + offset + ' has no counterpart; mapped to check bit ' + target + '.');
        }
      }
      if (taken.has(q)) {
        notes.push('Position ' + p + ' collapsed onto position ' + q + ' and was dropped.');
        continue;
      }
      taken.add(q);
      mapped.push(q);
    }
    return { positions: mapped.sort((a, b) => a - b), notes };
  }

  /**
   * Run parity, checksum and CRC on the same message. `sourceMethod` is the
   * method whose frame the user's `positions` refer to.
   */
  function compareMethods(message, cfg, sourceMethod, positions) {
    const sourceLayout = encode(sourceMethod, message, cfg).layout;
    return METHODS.map(function (m) {
      const layout = encode(m, message, cfg).layout;
      const map = m === sourceMethod
        ? { positions: positions.slice().sort((a, b) => a - b), notes: [] }
        : mapPositions(positions, sourceLayout, layout);
      const run = runExperiment(m, message, cfg, map.positions);
      run.mapNotes = map.notes;
      return run;
    });
  }

  return {
    WORD_BITS, DEFAULT_GENERATOR, MAX_GENERATOR_LEN, METHODS,
    validateBinary, validateGenerator, generatorToPolynomial,
    validatePositions, flipBits, parsePositions, randomPositions, makeRng, diffPositions,
    countOnes, parityEncode, parityVerify,
    foldCarry, padToWords, onesComplementSum, checksumEncode, checksumVerify,
    crcRemainder, crcEncode, crcVerify,
    encode, verify, classify, runExperiment, mapPositions, compareMethods
  };
});
