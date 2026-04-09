'use strict';
function fix(seg) {
    const b = Buffer.allocUnsafe(seg.length);
    for (let i = 0; i < seg.length; i++) b[i] = seg.charCodeAt(i) & 255;
    return b.toString('utf8');
}
const samples = ['ðŸ', 'ðŸŽ²', 'ðŸ"§', 'ðŸ†', 'ðŸ'¥'];
for (const s of samples) {
    console.log(JSON.stringify(s), 'len', s.length, '->', JSON.stringify(fix(s)));
}
