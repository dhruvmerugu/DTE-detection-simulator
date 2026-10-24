# Viva Q&A

**Error detection vs correction?** Detection only tells the receiver the data is wrong (then it asks for a resend). Correction adds more redundancy so the receiver can find and fix the bits (Hamming code). This project does detection only.

**What is redundancy? What is a transmitted frame?** Extra bits added to the message that carry no new information but allow a check. The frame is payload + those bits; here the detection bits are appended on the right.

**How does even/odd parity work?** Even parity picks the parity bit so the total number of 1s is even; odd parity makes it odd. The receiver counts the 1s in the received frame.

**Limits of parity?** It detects any odd number of flipped bits, but misses any even number. Example: `10111` with bits 1 and 2 flipped becomes `01111`, still four 1s. It also cannot locate the error.

**What is 1's-complement addition and end-around carry?** Add the words; any carry out of the top bit is added back to the bottom. It may need repeating (0x1FF → 0x100 → 0x01).

**How is the checksum generated and verified?** Sender adds the 8-bit words, complements the sum, appends it. Receiver adds all words including the checksum; correct frames give `11111111`.

**Why 8-bit words and how is padding handled?** For readable bit patterns. The real Internet checksum uses 16-bit words. A short last word is padded with zeros on the right in the calculation only; it is not transmitted, and the receiver pads the same way (it knows payload length = frame length − 8).

**What is CRC / modulo-2 division?** Treat bits as polynomial coefficients over GF(2). Append zeros, divide by the generator using XOR, and send the remainder. The receiver divides the full frame; zero remainder means no error detected.

**Generator, degree, remainder length?** `1101` = x³+x²+1; degree 3 (length − 1); remainder is 3 bits, and we append 3 zeros before dividing. Generator must start and end with 1.

**Why XOR instead of subtraction?** In modulo-2 arithmetic there are no carries or borrows, and addition = subtraction = XOR.

**Detectable vs undetectable errors?** Detectable: the corruption changes the check result. Undetectable: the corrupted frame still satisfies the check (e.g. parity with two flips, checksum with compensating flips, CRC with an error pattern divisible by the generator, such as flips 7 apart for `1101`).

**Why doesn't a zero CRC remainder prove no error?** Some error patterns are multiples of the generator and leave a zero remainder, so the receiver can only say "no error detected".

**Does the receiver cheat by using the original message?** No: `verify` takes only the received frame and the method settings. Only the UI uses the sent frame to show which bits changed and to warn about undetected corruption.

**How are bits numbered?** One-based from the left; position 1 is sent first. Errors can hit detection bits too.

**How does the comparison handle different frame lengths?** Payload positions stay the same; a flipped check bit maps to the check bit with the same offset (or the last one if the other field is shorter); collisions are dropped and shown.

**Architecture and tests?** `algorithms.js` pure functions; `app.js` UI; 24 Node tests with hand-computed values, the Wikipedia CRC example, CRC-8 `"123456789"` = 0xF4, and a BigInt reference division.

**Limitations and improvements?** Only bit flips; educational 8-bit checksum; no correction; limited browser testing. Future: Hamming code, 16-bit checksum, standard CRC presets, burst errors, statistics.
