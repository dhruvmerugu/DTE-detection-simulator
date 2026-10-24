// Run with:  node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./algorithms.js');

/* Independent reference: carry-less (GF(2)) polynomial remainder using BigInt,
   written differently from crcRemainder so the two cross-check each other. */
function refRemainder(bitsStr, genStr) {
  let n = BigInt('0b' + bitsStr);
  const g = BigInt('0b' + genStr);
  const gl = genStr.length;
  for (let shift = BigInt(bitsStr.length - gl); shift >= 0n; shift--) {
    if ((n >> (shift + BigInt(gl) - 1n)) & 1n) n ^= g << shift;
  }
  return n.toString(2).padStart(gl - 1, '0');
}
const asciiBits = (s) => [...s].map((c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join('');

test('input validation', () => {
  assert.equal(A.validateBinary('0101').ok, true);
  assert.equal(A.validateBinary('').ok, false);
  const bad = A.validateBinary('01a1');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /position 3/);
  assert.equal(A.validateBinary('0 1').ok, false);
  assert.equal(A.validateBinary(null).ok, false);
  assert.throws(() => A.parityEncode('', 'even'), /empty/);
  assert.throws(() => A.parityEncode('102', 'even'), /only 0 and 1/);
  assert.throws(() => A.parityEncode('101', 'mixed'), /even.*odd/);
});

test('generator validation', () => {
  for (const g of ['1101', '11', '1011', '100000111']) assert.equal(A.validateGenerator(g).ok, true, g);
  for (const g of ['', '1', '0', '0101', '1100', '10x1', '1'.repeat(40)]) assert.equal(A.validateGenerator(g).ok, false, g);
  assert.throws(() => A.crcEncode('1010', '1100'), /end with 1/);
  assert.equal(A.generatorToPolynomial('1101'), 'x^3 + x^2 + 1');
});

test('parity: no error (even and odd)', () => {
  const e = A.parityEncode('1011', 'even');          // three 1s -> parity bit 1
  assert.equal(e.frame, '10111');
  assert.equal(A.parityVerify(e.frame, 'even').detected, false);
  const o = A.parityEncode('1011', 'odd');           // three 1s already odd -> parity bit 0
  assert.equal(o.frame, '10110');
  assert.equal(A.parityVerify(o.frame, 'odd').detected, false);
  assert.equal(A.parityEncode('1001', 'even').parityBit, '0');
  assert.equal(A.parityEncode('1001', 'odd').parityBit, '1');
});

test('parity: single flip detected at every position, two flips can be missed', () => {
  const f = A.parityEncode('1011', 'even').frame;
  for (let p = 1; p <= f.length; p++) {
    assert.equal(A.parityVerify(A.flipBits(f, [p]), 'even').detected, true, 'pos ' + p);
  }
  const two = A.flipBits(f, [1, 2]);                 // 10111 -> 01111 (four 1s, still even)
  assert.equal(two, '01111');
  assert.equal(A.parityVerify(two, 'even').detected, false);
  assert.equal(A.runExperiment('parity', '1011', { parityType: 'even' }, [1, 2]).outcome, 'undetected');
  // three flips (odd weight) are detected again
  assert.equal(A.parityVerify(A.flipBits(f, [1, 2, 3]), 'even').detected, true);
});

test('checksum: end-around carry and repeated carry', () => {
  // 0xB5 + 0xCC = 0x181 -> 0x81 + 1 = 0x82 ; checksum = ~0x82 = 0x7D
  const e = A.checksumEncode('1011010111001100');
  assert.equal(e.sum, '10000010');
  assert.equal(e.checksum, '01111101');
  assert.equal(e.steps[1].carried, true);
  assert.equal(e.frame, '10110101' + '11001100' + '01111101');
  // repeated carry: 0x1FF folds to 0x100, which folds again to 0x01
  assert.equal(A.foldCarry(0x1FF, 8), 1);
  assert.equal(A.foldCarry(0xFF, 8), 0xFF);
  assert.equal(A.foldCarry(0x1FE, 8), 0xFF);
  // 0xFF + 0x01 = 0x100 -> 0x01
  assert.equal(A.onesComplementSum(['11111111', '00000001']).sum, 1);
});

test('checksum: padding of incomplete words (zeros on the right, not transmitted)', () => {
  const p = A.padToWords('101');
  assert.deepEqual(p.words, ['10100000']);
  assert.equal(p.padCount, 5);
  const e = A.checksumEncode('101');                 // word 10100000 = 0xA0, checksum ~0xA0 = 0x5F
  assert.equal(e.checksum, '01011111');
  assert.equal(e.frame, '101' + '01011111');          // padding is absent from the frame
  assert.equal(e.frame.length, 3 + 8);
  assert.equal(A.checksumVerify(e.frame).detected, false);
  assert.equal(A.checksumVerify(e.frame).padCount, 5);
  // 9 bits -> second word is 1 bit + 7 padding zeros
  assert.deepEqual(A.padToWords('111111111').words, ['11111111', '10000000']);
  // exact multiple: no padding
  assert.equal(A.padToWords('11110000').padCount, 0);
});

test('checksum: no error verifies to all ones; single flip detected', () => {
  const e = A.checksumEncode('1011010111001100');
  const v = A.checksumVerify(e.frame);
  assert.equal(v.verificationSum, '11111111');
  assert.equal(v.detected, false);
  assert.equal(v.calculatedChecksum, v.receivedChecksum);
  // any single flip anywhere (payload or checksum) must be detected
  for (let p = 1; p <= e.frame.length; p++) {
    assert.equal(A.checksumVerify(A.flipBits(e.frame, [p])).detected, true, 'pos ' + p);
  }
  const flipped = A.checksumVerify(A.flipBits(e.frame, [1]));
  assert.notEqual(flipped.verificationSum, '11111111');
  assert.notEqual(flipped.calculatedChecksum, flipped.receivedChecksum);
});

test('checksum: known undetected two-bit error (compensating flips in the same column)', () => {
  // words 00000001 00000000 -> flip pos 8 (1->0) and pos 16 (0->1): words 00000000 00000001, same sum
  const e = A.checksumEncode('0000000100000000');
  const r = A.flipBits(e.frame, [8, 16]);
  assert.notEqual(r, e.frame);
  assert.equal(A.checksumVerify(r).detected, false);
  assert.equal(A.runExperiment('checksum', '0000000100000000', {}, [8, 16]).outcome, 'undetected');
});

test('checksum: all-zero and all-one messages', () => {
  assert.equal(A.checksumEncode('00000000').checksum, '11111111');
  assert.equal(A.checksumEncode('11111111').checksum, '00000000');
  assert.equal(A.checksumVerify('0000000011111111').detected, false);
  assert.equal(A.checksumVerify('000000000').detected, true);   // payload 0, checksum 00000000 -> sum 0
  assert.throws(() => A.checksumVerify('11111111'), /at least 9/);
});

test('CRC: known example (Wikipedia, generator 1011)', () => {
  const e = A.crcEncode('11010011101100', '1011');
  assert.equal(e.remainder, '100');
  assert.equal(e.frame, '11010011101100100');
  assert.equal(A.crcVerify(e.frame, '1011').remainder, '000');
});

test('CRC: independent reference vector CRC-8 (poly 0x07) of "123456789" is 0xF4', () => {
  const e = A.crcEncode(asciiBits('123456789'), '100000111');
  assert.equal(e.remainder, '11110100');
  assert.equal(refRemainder(e.augmented, '100000111'), '11110100');
});

test('CRC: hand-worked example 1001 / 1101 -> 011', () => {
  const e = A.crcEncode('1001', '1101');
  assert.equal(e.augmented, '1001000');
  assert.equal(e.remainder, '011');
  assert.equal(e.frame, '1001011');
});

test('CRC: matches BigInt reference on many messages and generators', () => {
  const rng = A.makeRng(12345);
  const gens = ['11', '101', '1011', '1101', '10011', '100000111', '11000000000000101'];
  for (let i = 0; i < 300; i++) {
    const len = 1 + Math.floor(rng() * 40);
    let msg = '';
    for (let k = 0; k < len; k++) msg += rng() < 0.5 ? '0' : '1';
    const g = gens[i % gens.length];
    const e = A.crcEncode(msg, g);
    assert.equal(e.remainder, refRemainder(e.augmented, g), msg + ' / ' + g);
    assert.equal(A.crcVerify(e.frame, g).detected, false);
    assert.equal(refRemainder(e.frame, g), '0'.repeat(g.length - 1));
  }
});

test('CRC: every single-bit error is detected; sample two-bit behaviour', () => {
  const g = '1101';
  const f = A.crcEncode('10010', g).frame;          // length 8
  for (let p = 1; p <= f.length; p++) assert.equal(A.crcVerify(A.flipBits(f, [p]), g).detected, true, 'pos ' + p);
  // x^3+x^2+1 divides x^7+1, so two flips 7 apart (positions 1 and 8) cancel out: undetected
  const missed = A.flipBits(f, [1, 8]);
  assert.notEqual(missed, f);
  assert.equal(A.crcVerify(missed, g).detected, false);
  assert.equal(A.crcVerify(missed, g).remainder, '000');
  assert.equal(refRemainder(missed, g), '000');
  // neighbouring flips are detected
  assert.equal(A.crcVerify(A.flipBits(f, [1, 2]), g).detected, true);
  // burst no longer than the remainder (3 bits) is always detected
  assert.equal(A.crcVerify(A.flipBits(f, [3, 4, 5]), g).detected, true);
});

test('CRC: frame too short is rejected', () => {
  assert.throws(() => A.crcVerify('101', '1101'), /longer than 3/);
});

test('error injection: first and last positions, boundaries', () => {
  assert.equal(A.flipBits('0000', [1]), '1000');
  assert.equal(A.flipBits('0000', [4]), '0001');
  assert.equal(A.flipBits('0000', [1, 4]), '1001');
  assert.equal(A.flipBits('1010', []), '1010');
  assert.throws(() => A.flipBits('0000', [0]), /outside the frame/);
  assert.throws(() => A.flipBits('0000', [5]), /1 to 4/);
  assert.throws(() => A.flipBits('0000', [1.5]), /whole number/);
  assert.throws(() => A.flipBits('0000', [2, 2]), /more than once/);
  assert.deepEqual(A.diffPositions('1010', A.flipBits('1010', [2, 3])), [2, 3]);
});

test('position parsing', () => {
  assert.deepEqual(A.parsePositions('3, 1  7', 10), { positions: [1, 3, 7], error: null });
  assert.match(A.parsePositions('', 10).error, /at least one/);
  assert.match(A.parsePositions('0', 10).error, /outside/);
  assert.match(A.parsePositions('11', 10).error, /outside/);
  assert.match(A.parsePositions('2,2', 10).error, /more than once/);
  assert.match(A.parsePositions('a', 10).error, /not a valid/);
  assert.match(A.parsePositions('-3', 10).error, /not a valid/);
});

test('random injection: unique, in range, reproducible', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const p = A.randomPositions(20, 5, seed);
    assert.equal(p.length, 5);
    assert.equal(new Set(p).size, 5);
    assert.ok(p.every((x) => x >= 1 && x <= 20));
    assert.deepEqual(p, A.randomPositions(20, 5, seed));
  }
  assert.deepEqual(A.randomPositions(6, 6, 9), [1, 2, 3, 4, 5, 6]);   // count == length uses every bit
  assert.notDeepEqual(A.randomPositions(100, 5, 1), A.randomPositions(100, 5, 2));
  assert.throws(() => A.randomPositions(5, 6, 1), /cannot exceed/);
  assert.throws(() => A.randomPositions(5, 0, 1), /at least 1/);
});

test('receiver uses only the received frame (not the original payload)', () => {
  const r = A.runExperiment('crc', '10010', { generator: '1101' }, [1]);
  assert.equal(r.check.payload, A.flipBits(r.sent.frame, [1]).slice(0, 5));
  assert.notEqual(r.check.payload, '10010');
  assert.equal(r.outcome, 'detected');
  assert.equal(A.runExperiment('crc', '10010', { generator: '1101' }, []).outcome, 'clean');
});

test('mapPositions: payload positions stay; check bits map by offset', () => {
  const parity = { payloadLen: 16, checkLen: 1 };
  const checksum = { payloadLen: 16, checkLen: 8 };
  const crc = { payloadLen: 16, checkLen: 3 };
  assert.deepEqual(A.mapPositions([3, 9], parity, checksum).positions, [3, 9]);
  assert.deepEqual(A.mapPositions([17], parity, checksum).positions, [17]);
  const down = A.mapPositions([17, 24], checksum, crc);          // check bits 1 and 8 -> 1 and 3
  assert.deepEqual(down.positions, [17, 19]);
  assert.equal(down.notes.length, 1);
  const collide = A.mapPositions([19, 20], checksum, crc);        // check bits 3,4 -> both 3
  assert.deepEqual(collide.positions, [19]);
  assert.match(collide.notes.join(' '), /dropped/);
});

test('compareMethods: consistent outcomes on the same message', () => {
  const msg = '1011010111001100';
  const cfg = { parityType: 'even', generator: '1101' };
  const none = A.compareMethods(msg, cfg, 'crc', []);
  assert.deepEqual(none.map((r) => r.method), ['parity', 'checksum', 'crc']);
  assert.ok(none.every((r) => r.outcome === 'clean' && !r.corrupted));
  // one payload flip: all three detect, all frames start with the same payload
  const one = A.compareMethods(msg, cfg, 'parity', [5]);
  assert.ok(one.every((r) => r.outcome === 'detected'));
  assert.ok(one.every((r) => r.received.slice(0, 16) === A.flipBits(msg, [5])));
  // two flips in the same column: parity and CRC? parity misses (even weight), checksum misses
  const two = A.compareMethods('0000000100000000', cfg, 'parity', [8, 16]);
  const byM = Object.fromEntries(two.map((r) => [r.method, r.outcome]));
  assert.equal(byM.parity, 'undetected');
  assert.equal(byM.checksum, 'undetected');
  assert.equal(byM.crc, 'detected');
  // every run's `corrupted` flag matches a real difference
  for (const r of two) assert.equal(r.corrupted, r.received !== r.sent.frame);
});

test('regression: flipping a check bit is applied to the frame and caught', () => {
  // error injected into detection bits must count (frame includes check field)
  for (const [m, cfg] of [['parity', { parityType: 'even' }], ['checksum', {}], ['crc', { generator: '1101' }]]) {
    const sent = A.encode(m, '10110011', cfg);
    const last = sent.frame.length;
    assert.equal(A.runExperiment(m, '10110011', cfg, [last]).outcome, 'detected', m);
  }
});

test('regression: odd parity with all-zero payload', () => {
  const e = A.parityEncode('000', 'odd');
  assert.equal(e.frame, '0001');
  assert.equal(A.parityVerify(e.frame, 'odd').detected, false);
  assert.equal(A.parityVerify('0000', 'odd').detected, true);
});

test('regression: encode/verify dispatch rejects unknown method', () => {
  assert.throws(() => A.encode('md5', '1', {}), /Unknown method/);
  assert.throws(() => A.verify('md5', '10', {}), /Unknown method/);
});
