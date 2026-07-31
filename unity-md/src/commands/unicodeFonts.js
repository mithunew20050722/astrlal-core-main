// ── Unicode font mapping for toUnicodeFont ───────────────────
const UNICODE_FONTS = {
  bold: {
    upper: 0x1d5d4, lower: 0x1d5ce, digits: 0x1d7ec,
    map: s => s.split('').map(c => {
      const code = c.codePointAt(0);
      if (code >= 65 && code <= 90) return String.fromCodePoint(code + 0x1d5d4 - 65);
      if (code >= 97 && code <= 122) return String.fromCodePoint(code + 0x1d5ce - 97);
      if (code >= 48 && code <= 57) return String.fromCodePoint(code + 0x1d7ec - 48);
      return c;
    }).join(''),
  },
};

function toUnicodeFont(text, type) {
  if (!text) return text;
  const font = UNICODE_FONTS[type];
  return font ? font.map(text) : text;
}
