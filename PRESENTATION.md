# Presentation Outline (10 slides)

**Slide 1 — Title.** *Data Transmission Error Detection Simulator.* Name, guide, institution **[STUDENT]**.
Visual: dashboard screenshot. Notes: introduce the goal: see how errors are detected, and missed.

**Slide 2 — Problem.** Channels flip bits; receiver needs a cheap check. Visual: frame with one red flipped bit. Notes: noise, interference; detection vs correction.

**Slide 3 — Idea: redundancy.** Frame = payload + extra bits. Visual: bar split payload/check. Notes: more redundancy, better detection, more overhead.

**Slide 4 — Parity.** 1 bit; even/odd; detects odd flips. Visual: `1011` → `10111`, flips 1,2 → `01111`. Notes: single flip detected; two flips missed.

**Slide 5 — Checksum.** 8-bit words, end-around carry, complement; receiver expects `11111111`. Visual: `B5 + CC` carry example. Notes: padding on the right, not transmitted; not security.

**Slide 6 — CRC.** Modulo-2 division by generator; append remainder; receiver expects zero. Visual: `1001000 ÷ 1101 → 011`. Notes: XOR = add = subtract in GF(2); zero ≠ proof.

**Slide 7 — Architecture.** `algorithms.js` pure + `app.js` UI + tests. Visual: Mermaid diagram from README. Notes: receiver uses only the received frame.

**Slide 8 — Simulator walkthrough.** Five sections: message, method, channel, receiver, comparison. Visual: annotated screenshot. Notes: one-based positions from the left; errors can hit check bits.

**Slide 9 — Testing.** 24 automated tests; known CRC vectors (Wikipedia `1011`→`100`, CRC-8 `"123456789"`=0xF4), independent BigInt check. Notes: report the actual run; UI smoke check was headless Chrome only.

**Slide 10 — Summary.** Parity: 1 bit, odd-weight errors. Checksum: 8 bits, all single-bit errors, can miss compensating flips. CRC: strongest here, burst-proof up to remainder length, still not perfect. Limitations and future scope: Hamming correction, 16-bit checksum, statistics.

## Live demo script (about 2.5 minutes)
| Time | Action | Say |
|---|---|---|
| 0:00 | Open `index.html`; preset **16-bit**; method **Parity**; Generate | "Message plus one parity bit, 17 bits; bit 1 is the leftmost." |
| 0:25 | Select position `1` → Transmit with errors | "One flip: error detected, parity can't say where." |
| 0:50 | Select `1, 2` → Transmit | "Two flips: *No error detected*, yet the frame changed — the warning shows it." |
| 1:15 | **Compare all three methods** | "Checksum and CRC catch this pattern; each frame length differs so positions were mapped." |
| 1:40 | Preset **Column-swap**, method Checksum, Generate, errors `8, 16`, Transmit, Compare | "Compensating flips fool the checksum; CRC with 1101 still detects." |
| 2:10 | Method CRC, generator `1100` | "Generator validation rejects it — it must end in 1." |
| 2:25 | Reset all | "Detection is never absolute; stronger codes lower the risk." |

Final message: parity = cheapest and weakest; checksum = simple additive check; CRC = polynomial division with the best burst protection of the three.
