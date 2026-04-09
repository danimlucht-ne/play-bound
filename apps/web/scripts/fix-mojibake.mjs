/**
 * Fix double-encoded UTF-8 (mojibake) in play-bound JS files.
 * 
 * The files have UTF-8 text where some characters were double-encoded:
 * original UTF-8 bytes -> interpreted as Windows-1252 -> re-encoded as UTF-8.
 * 
 * Strategy: map each Unicode code point back to its Windows-1252 byte value,
 * collect multi-byte sequences, decode as UTF-8.
 */
import { readFileSync, writeFileSync } from 'fs';

// Windows-1252 bytes 0x80-0x9F that differ from Latin-1
const WIN1252_MAP = new Map([
  [0x20AC, 0x80], // €
  [0x201A, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201E, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02C6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8A], // Š
  [0x2039, 0x8B], // ‹
  [0x0152, 0x8C], // Œ
  [0x017D, 0x8E], // Ž
  [0x2018, 0x91], // '
  [0x2019, 0x92], // '
  [0x201C, 0x93], // "
  [0x201D, 0x94], // "
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02DC, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9A], // š
  [0x203A, 0x9B], // ›
  [0x0153, 0x9C], // œ
  [0x017E, 0x9E], // ž
  [0x0178, 0x9F], // Ÿ
]);

function cpToWin1252Byte(cp) {
  if (cp < 0x80) return cp;                    // ASCII
  if (cp >= 0xA0 && cp <= 0xFF) return cp;     // Latin-1 supplement (same in Win-1252)
  // Undefined Win-1252 slots that map to control chars in Latin-1
  // These bytes (0x81, 0x8D, 0x8F, 0x90) have no Win-1252 mapping but
  // appear as their raw byte value when a file is read as Latin-1
  if (cp === 0x81 || cp === 0x8D || cp === 0x8F || cp === 0x90 || cp === 0x9D) return cp;
  return WIN1252_MAP.get(cp) ?? null;           // Win-1252 special range
}

function fixMojibake(str) {
  const out = [];
  let i = 0;
  while (i < str.length) {
    const cp = str.codePointAt(i);
    const step = cp > 0xFFFF ? 2 : 1;
    const b = cpToWin1252Byte(cp);

    // Check if this is a UTF-8 lead byte (0xC0+)
    if (b !== null && b >= 0xC2) {
      let need;
      if (b >= 0xF0) need = 4;
      else if (b >= 0xE0) need = 3;
      else need = 2;

      const bytes = [b];
      let j = i + step;
      let ok = true;
      for (let k = 1; k < need; k++) {
        if (j >= str.length) { ok = false; break; }
        const ncp = str.codePointAt(j);
        const nb = cpToWin1252Byte(ncp);
        if (nb === null || nb < 0x80 || nb > 0xBF) { ok = false; break; }
        bytes.push(nb);
        j += ncp > 0xFFFF ? 2 : 1;
      }

      if (ok && bytes.length === need) {
        const decoded = Buffer.from(bytes).toString('utf8');
        if (!decoded.includes('\uFFFD')) {
          out.push(decoded);
          i = j;
          continue;
        }
      }
    }

    out.push(String.fromCodePoint(cp));
    i += step;
  }
  return out.join('');
}

const files = ['onboarding-ui.js', 'dashboard.js'];
for (const f of files) {
  try {
    const src = readFileSync(f, 'utf8');
    const fixed = fixMojibake(src);
    if (fixed !== src) {
      writeFileSync(f, fixed, 'utf8');
      console.log(`${f}: fixed (${src.length} -> ${fixed.length} chars, delta ${src.length - fixed.length})`);
    } else {
      console.log(`${f}: clean`);
    }
  } catch (e) {
    console.log(`${f}: ${e.message}`);
  }
}
