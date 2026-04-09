# -*- coding: utf-8 -*-
"""Fix UTF-8 read as Windows-1252-style mojibake in src/events/interactionCreate.js."""
import codecs
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src" / "events" / "interactionCreate.js"


def byte_to_wrong_char(b: int) -> str:
    try:
        return codecs.decode(bytes([b]), "cp1252")
    except UnicodeDecodeError:
        return chr(b)


def build_inverse() -> dict[str, int]:
    inv: dict[str, int] = {}
    for b in range(256):
        ch = byte_to_wrong_char(b)
        inv[ch] = b
    return inv


INV = build_inverse()


def utf8_to_wrong_mojibake(good: str) -> str:
    """UTF-8 bytes of *good* mis-decoded per-byte as cp1252 (or Latin-1 fallback)."""
    return "".join(byte_to_wrong_char(b) for b in good.encode("utf-8"))


# Same triplets as scripts/fix-platformplay-mojibake.js (plus common variants).
TEXT_PAIRS: list[tuple[str, str]] = [
    ("\u00e2\u0153\u2026", "\u2705"),  # âœ… -> check
    ("\u00e2\u20ac\u201d", "\u2014"),  # â€" -> em dash
    ("\u00e2\u20ac\u201c", "\u2013"),  # â€“ -> en dash
    ("\u00e2\u20ac\u2122", "\u2019"),  # â€™ -> apostrophe
    ("\u00e2\u20ac\u0153", "\u201c"),  # â€œ -> left quote (variant)
    ("\u00e2\u20ac\u009d", "\u201d"),  # â€ -> right quote (if present)
    ("\u00e2\u20ac\u00a6", "\u2026"),  # â€¦ -> ellipsis
    ("\u00e2\u20ac\u00a2", "\u2022"),  # â€¢ -> bullet
    ("\u00c2\u00b7", "\u00b7"),  # Â· -> middle dot
    # UTF-8 U+00D7 (×) misread as Latin-1: U+00C3 + cp1252 byte 0x97 (U+2014).
    ("\u00c3\u2014", "\u00d7"),
    ("\u00e2\u2030\u00a4", "\u2264"),  # â‰¤ -> <= (if present)
]

# Symbols that appear as UTF-8 mojibake in this file (longest replacements first).
EMOJI_AND_SYMBOL_GOODS: list[str] = sorted(
    [
        "\u2694\ufe0f",  # ⚔️
        "\u26a0\ufe0f",  # ⚠️
        "\u23ed\ufe0f",  # ⏭️
        "\u270d\ufe0f",  # ✍️
        "\u274c",  # ❌
        "\u2728",  # ✨
        "\u2753",  # ❓
        "\u25c0",  # ◀
        "\u25b6",  # ▶
        "\u23f3",  # ⏳
        "\u23f0",  # ⏰ (3-byte UTF-8 mojibake â°)
        "\u26aa",  # ⚪ (âšª)
        "\u2713",  # ✓
        "\u2717",  # ✗
    ],
    key=lambda g: len(utf8_to_wrong_mojibake(g)),
    reverse=True,
)


def wrong_utf8_blob_to_string(blob: str) -> str | None:
    try:
        bs = bytes(INV[c] for c in blob)
        return bs.decode("utf-8")
    except (KeyError, UnicodeDecodeError):
        return None


def replace_emoji_mojibake(s: str) -> str:
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        if i + 1 < n and s[i] == "\u00f0" and s[i + 1] == "\u0178":
            replaced = False
            for length in (7, 6, 5, 4):
                if i + length > n:
                    continue
                chunk = s[i : i + length]
                if not (chunk[0] == "\u00f0" and chunk[1] == "\u0178"):
                    break
                dec = wrong_utf8_blob_to_string(chunk)
                if dec is None:
                    continue
                try:
                    dec.encode("utf-8")
                except UnicodeEncodeError:
                    continue
                # Accept only sensible grapheme clusters (emoji / pictographic + optional VS16/ZWJ tail).
                if dec.isascii():
                    continue
                out.append(dec)
                i += length
                replaced = True
                break
            if replaced:
                continue
        out.append(s[i])
        i += 1
    return "".join(out)


def main() -> int:
    with TARGET.open("r", encoding="utf-8", newline="") as f:
        raw = f.read()
    s = raw
    s = replace_emoji_mojibake(s)
    for bad, good in TEXT_PAIRS:
        s = s.replace(bad, good)
    for good in EMOJI_AND_SYMBOL_GOODS:
        bad = utf8_to_wrong_mojibake(good)
        if bad and bad != good:
            s = s.replace(bad, good)
    if s != raw:
        with TARGET.open("w", encoding="utf-8", newline="") as f:
            f.write(s)
        print("Wrote", TARGET)
    else:
        print("No changes", TARGET)
    return 0


if __name__ == "__main__":
    sys.exit(main())
