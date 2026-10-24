# Data Transmission Error Detection Simulator — Project Report

> Items marked **[STUDENT]** need your own details or your institution's format (title page, names, guide, department, certificates, acknowledgements).

**[STUDENT] Title page:** project title, name, roll no., class/section, guide, department, institution, academic year.

## 1. Abstract
This project implements an interactive simulator of three error-detection techniques — parity, the 1's-complement checksum, and the CRC — in HTML, CSS and JavaScript. Users build a frame, corrupt selected bits, and observe receiver verification and a three-method comparison. The algorithms are in a pure JavaScript module tested with Node's built-in test runner.

## 2. Problem statement
Physical channels can flip bits. Receivers need cheap redundancy to notice corruption, and students need a way to *see* why different schemes detect different error patterns, including patterns they miss.

## 3. Objectives
- Implement even/odd parity, 8-bit checksum and CRC correctly.
- Inject controlled and random errors into the actual transmitted frame.
- Verify at the receiver using only the received frame.
- Compare methods on the same message and show undetected errors honestly.
- Test the algorithms against independently known examples.

## 4. Existing system and limitations
Textbook worked examples and static calculators show one calculation at a time. They usually do not let the user corrupt the frame, do not apply errors to detection bits, and do not compare methods on one error pattern. **[STUDENT]** add any specific tools you reviewed.

## 5. Proposed system
A single-page, offline simulator with: message input → method configuration → frame generation → error injection → receiver verification → comparison. Undetected corruption is flagged using the simulator's knowledge of the sent frame (information a real receiver does not have).

## 6. Requirements
- Hardware: any computer.
- Software: modern web browser; Node.js 18+ for tests only.
- No network, server, framework, or API key.

## 7. Architecture and data flow
See the Mermaid diagram in [README.md](README.md). Modules: `algorithms.js` (pure logic), `app.js` (UI/state), `index.html` + `styles.css` (view), `algorithms.test.js` (tests). Data flow: message → `encode` → sender frame → `flipBits` → received frame → `verify` (received frame + configuration only) → status. `compareMethods` repeats this per method using `mapPositions`.

## 8. Algorithm design and pseudocode
Positions are one-based from the left. Check bits are appended on the right.

**Parity**
```
ones = count of 1s in payload
even: p = ones mod 2      odd: p = 1 - (ones mod 2)
frame = payload + p
receiver: ones' = count of 1s in frame; pass if parity rule holds
```
**Checksum (8-bit)**
```
pad payload with 0s on the right to a multiple of 8 (virtual, not sent)
sum = 0
for each word: sum += word; while sum > 255: sum = (sum & 255) + (sum >> 8)
checksum = ~sum & 255 ; frame = payload + checksum
receiver: payload = frame minus last 8 bits; pad; add all words + received checksum; pass if sum == 255
```
**CRC**
```
r = len(G) - 1 ; work = payload + r zeros
for i = 0 .. len(work) - len(G):
    if work[i] == 1: XOR work[i..i+len(G)-1] with G
remainder = last r bits of work ; frame = payload + remainder
receiver: same division on full frame; pass if remainder is all zeros
```
**Comparison mapping**: payload position p → p; check-field offset k → same offset k, or the last check bit if the target field is shorter; collisions dropped and reported.

## 9. Implementation details
Bit strings of `'0'/'1'` are used throughout for readability. Errors use a seeded PRNG (mulberry32) with a partial Fisher–Yates selection for unique positions. The UI renders bits as buttons (keyboard accessible) with distinct classes for payload, detection, selected and changed bits. Input validation covers empty/invalid messages, generators, positions, counts and seeds.

## 10. Test methodology and actual results
Node `node:test` unit tests cover validation, each algorithm, injection boundaries, mapping and comparison. Expected values come from hand calculation, a published CRC example (Wikipedia, generator 1011 → 100), the CRC-8 check value for `"123456789"` (0xF4), and an independent BigInt carry-less division. Actual run: **24 tests, 24 passed, 0 failed** (Node v24.14.1). A scripted headless-Chrome smoke check of the UI is described in [TEST_CASES.md](TEST_CASES.md). Full details there. **[STUDENT]** re-run `npm test` and paste your own output/screenshots.

## 11. Limitations
Only bit-flip errors; no burst-generation helper; no retransmission or framing; educational 8-bit checksum rather than the 16-bit Internet checksum; limited browser testing; no statistical measurement of detection rates (none are claimed).

## 12. Applications
Ethernet frame check sequence (CRC-32), IP/TCP/UDP header checksums, storage and serial links, teaching networks fundamentals.

## 13. Conclusion
The simulator shows that parity catches odd-weight errors only, the checksum catches all single-bit errors but can miss compensating changes, and CRC detects all single-bit errors and bursts up to its remainder length yet can still miss specific patterns. No method detects every possible error.

## 14. Future scope
Hamming-code correction, 16-bit checksum, standard CRC presets, burst injection, Monte-Carlo statistics, animation, browser automation tests.

## 15. References (standard sources; **[STUDENT]** verify edition/page and format per your institution)
- A. S. Tanenbaum, D. Wetherall, *Computer Networks* — chapter on the data link layer (error detection and correction).
- B. A. Forouzan, *Data Communications and Networking* — error detection chapter (parity, checksum, CRC).
- J. F. Kurose, K. W. Ross, *Computer Networking: A Top-Down Approach* — link layer, error detection.
- RFC 1071, *Computing the Internet Checksum*.
- W. W. Peterson, D. T. Brown, "Cyclic Codes for Error Detection", Proc. IRE, 1961.
