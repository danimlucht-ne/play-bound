'use strict';

function parseCookies(header) {
    const out = {};
    if (!header || typeof header !== 'string') return out;
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        const k = part.slice(0, i).trim();
        try {
            out[k] = decodeURIComponent(part.slice(i + 1).trim());
        } catch {
            out[k] = part.slice(i + 1).trim();
        }
    }
    return out;
}

function buildSetCookie(name, value, opts = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
    if (opts.maxAge != null) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
    if (opts.httpOnly !== false) parts.push('HttpOnly');
    const sameSite = opts.sameSite != null ? opts.sameSite : 'Lax';
    parts.push(`SameSite=${sameSite}`);
    if (opts.secure || sameSite === 'None') parts.push('Secure');
    else if (process.env.NODE_ENV === 'production') parts.push('Secure');
    return parts.join('; ');
}

module.exports = { parseCookies, buildSetCookie };
