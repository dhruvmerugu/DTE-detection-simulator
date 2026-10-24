# Test Cases

Run: `npm test` (or `node --test`). **Actual run (this project, Node v24.14.1): 24 tests, 24 pass, 0 fail.**
Positions are one-based from the left of the transmitted frame.

## A. Input validation
| ID | Scenario | Input | Expected | Actual |
|---|---|---|---|---|
| V1 | Valid binary | `0101` | accepted | Pass |
| V2 | Empty message | `` | rejected: "Message is empty…" | Pass |
| V3 | Invalid character | `01a1` | rejected, names `a` at position 3 | Pass |
| V4 | Space inside | `0 1` | rejected | Pass |
| V5 | Bad generators | `` `1` `0` `0101` `1100` `10x1`, 40×`1` | all rejected (too short / no leading 1 / no trailing 1 / bad char / too long) | Pass |
| V6 | Good generators | `11 101 1011 1101 100000111` | accepted | Pass |
| V7 | Positions | `0`, `11` of 10, `2,2`, `a`, `-3`, empty | each rejected with message | Pass |

## B. Parity
| ID | Scenario | Input | Errors | Expected | Actual |
|---|---|---|---|---|---|
| P1 | Even, no error | `1011` | none | frame `10111`, passes | Pass |
| P2 | Odd, no error | `1011` | none | frame `10110`, passes | Pass |
| P3 | Single flip, every position | `10111` | each of 1–5 | Error detected | Pass |
| P4 | **Parity miss** | `1011` even | 1, 2 | received `01111` (four 1s) → **no error detected**, outcome "undetected" | Pass |
| P5 | Three flips | `10111` | 1, 2, 3 | detected (odd weight) | Pass |
| P6 | Odd, zero payload | `000` | none | frame `0001` passes; `0000` fails | Pass |

## C. Checksum (8-bit words)
| ID | Scenario | Input | Errors | Expected | Actual |
|---|---|---|---|---|---|
| C1 | Carry & generation | `1011010111001100` | none | sum `10000010`, checksum `01111101`, frame `101101011100110001111101`; verification sum `11111111` | Pass |
| C2 | Repeated end-around carry | fold(0x1FF) | – | 1 (0x1FF → 0x100 → 0x01); 0xFF+0x01 → 1 | Pass |
| C3 | Padding | `101` | none | word `10100000`, 5 pad bits (not sent), checksum `01011111`, frame `10101011111`; passes | Pass |
| C4 | Padding, 9 bits | `111111111` | – | words `11111111`, `10000000` | Pass |
| C5 | Single flip anywhere (24-bit frame) | C1 frame | each of 1–24 | detected | Pass |
| C6 | **Checksum miss** | `0000000100000000` | 8, 16 | words `00000001 00000000` → `00000000 00000001`, same sum → **no error detected** | Pass |
| C7 | All-0 / all-1 | `00000000`, `11111111` | – | checksums `11111111`, `00000000` | Pass |
| C8 | Frame too short | `11111111` | – | rejected (needs ≥ 9 bits) | Pass |

## D. CRC
| ID | Scenario | Input | Errors | Expected | Actual |
|---|---|---|---|---|---|
| R1 | **Independent known example** (Wikipedia) | `11010011101100`, gen `1011` | none | remainder `100`, frame `11010011101100100`, receiver remainder `000` | Pass |
| R2 | **Independent known vector** CRC-8 poly 0x07 | ASCII `"123456789"`, gen `100000111` | none | remainder `11110100` (0xF4) | Pass |
| R3 | Hand-worked | `1001`, gen `1101` | none | augmented `1001000`, remainder `011`, frame `1001011` | Pass |
| R4 | Randomised cross-check | 300 messages × 7 generators | none | equals BigInt carry-less reference; receiver remainder 0 | Pass |
| R5 | Single flip | `10010` + `110` = `10010110`, gen `1101` | each of 1–8 | all detected | Pass |
| R6 | **Two-bit documented example** | same frame | 1, 8 | receiver remainder `000` → **undetected** (see below) | Pass |
| R7 | Adjacent two-bit | same frame | 1, 2 | detected | Pass |
| R8 | Burst of 3 | same frame | 3, 4, 5 | detected (burst ≤ remainder length) | Pass |
| R9 | Short frame | `101`, gen `1101` | – | rejected | Pass |

**Why R6 is undetected:** `1101` = x³+x²+1 divides x⁷+1. Flipping bits 7 positions apart adds the error polynomial x⁷+1 (shifted), which is a multiple of the generator, so the remainder stays zero.
**Why C6 is undetected:** one column loses 1 (−2ᵏ) and the same column in another word gains 1 (+2ᵏ); the 1's-complement sum is unchanged.
**Why P4 is undetected:** two flips change the count of 1s by an even amount.

## E. Error injection
| ID | Scenario | Expected | Actual |
|---|---|---|---|
| E1 | First/last position of `0000` | `1000` / `0001`; both `1001` | Pass |
| E2 | Out of range (0, 5 of 4), non-integer, duplicate | error thrown | Pass |
| E3 | Random 5 of 20, seeds 1–50 | 5 unique, in 1–20, same seed → same result | Pass |
| E4 | count = frame length (6 of 6) | `[1..6]` | Pass |
| E5 | count > length / count 0 | error | Pass |
| E6 | Check-bit error | flipping the last frame bit of each method is detected | Pass |

## F. Comparison and receiver
| ID | Scenario | Expected | Actual |
|---|---|---|---|
| X1 | Receiver independence | received payload used, not original | Pass |
| X2 | Position mapping | payload positions unchanged; check bits 1 and 8 of checksum → 1 and 3 of 3-bit CRC; collisions dropped with a note | Pass |
| X3 | No errors on all three | all "clean" | Pass |
| X4 | Payload bit 5 flipped (16-bit message) | all three detected | Pass |
| X5 | `0000000100000000`, errors 8, 16 chosen on parity frame | parity undetected, checksum undetected, CRC (`1101`) detected | Pass |

## G. Regression guards
Check-bit flips are applied to the full frame (E6); odd parity with all-zero payload (P6); unknown method rejected. No algorithm bugs were found during development, so these are preventive guards rather than fixes of past bugs.

## H. UI smoke check (headless Chrome, scripted via a scratch page; not part of `npm test`)
| Check | Observed |
|---|---|
| Generate parity frame for 16-bit preset | `10110101110011001` |
| Errors 1,2 on parity | "No error detected" with corruption warning |
| Compare | Parity undetected; Checksum, CRC detected |
| Switch to CRC | frame `1011010111001100100`; selection carried over |
| Bad generator `1100` | message "must end with 1" |
| Bad message `10a` | message names `a` at position 3 |
| Checksum with 8,16 on column-swap message | undetected + warning |
| Random pick | positions filled; position `99` rejected with range message |

Not executed: other browsers, mobile devices, screen-reader testing.
