export const config = { runtime: 'edge' };
async function sha256(data) {
const buf = await crypto.subtle.digest('SHA-256', data);
return new Uint8Array(buf);
}
function hexToBytes(hex) {
const bytes = new Uint8Array(hex.length / 2);
for (let i = 0; i < hex.length; i += 2) {
bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
}
return bytes;
}
function bytesToHex(bytes) {
return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function decodeNsec(nsec) {
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const str = nsec.toLowerCase();
const pos = str.lastIndexOf('1');
if (pos < 1) throw new Error('Invalid nsec');
const data = str.slice(pos + 1);
const decoded = [];
for (const c of data) {
const val = CHARSET.indexOf(c);
if (val === -1) throw new Error('Invalid char: ' + c);
decoded.push(val);
}
const trimmed = decoded.slice(0, -6);
const bytes = [];
let acc = 0, bits = 0;
for (const val of trimmed) {
acc = (acc << 5) | val;
bits += 5;
if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
}
return new Uint8Array(bytes.slice(1));
}
const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
function mod(a, b = P) { return ((a % b) + b) % b; }
function modPow(base, exp, m) {
let result = 1n;
base = base % m;
while (exp > 0n) {
if (exp % 2n === 1n) result = result * base % m;
exp = exp / 2n;
base = base * base % m;
}
return result;
}
function modInv(a, m = P) { return modPow(mod(a, m), m - 2n, m); }
function pointAdd(p1, p2) {
if (!p1) return p2;
if (!p2) return p1;
const [x1, y1] = p1, [x2, y2] = p2;
if (x1 === x2) {
if (y1 !== y2) return null;
const lam = mod(3n * x1 * x1 * modInv(2n * y1));
const x3 = mod(lam * lam - 2n * x1);
return [x3, mod(lam * (x1 - x3) - y1)];
}
const lam = mod((y2 - y1) * modInv(x2 - x1));
const x3 = mod(lam * lam - x1 - x2);
return [x3, mod(lam * (x1 - x3) - y1)];
}
function pointMul(p, n) {
let result = null, addend = p;
while (n > 0n) {
if (n & 1n) result = pointAdd(result, addend);
addend = pointAdd(addend, addend);
n >>= 1n;
}
return result;
}
function getPublicKey(privKeyBytes) {
const privKey = BigInt('0x' + bytesToHex(privKeyBytes));
const point = pointMul([Gx, Gy], privKey);
return hexToBytes(point[0].toString(16).padStart(64, '0'));
}
async function schnorrSign(privKeyBytes, msgBytes) {
const privKey = BigInt('0x' + bytesToHex(privKeyBytes));
const pubPoint = pointMul([Gx, Gy], privKey);
const px = hexToBytes(pubPoint[0].toString(16).padStart(64, '0'));
const combined = new Uint8Array([...privKeyBytes, ...msgBytes]);
const kBytes = await sha256(combined);
let k = mod(BigInt('0x' + bytesToHex(kBytes)), N);
if (k === 0n) k = 1n;
const R = pointMul([Gx, Gy], k);
if (!R) throw new Error('Invalid R point');
let kFinal = R[1] % 2n === 0n ? k : N - k;
const rx = hexToBytes(R[0].toString(16).padStart(64, '0'));
const eInput = new Uint8Array([...rx, ...px, ...msgBytes]);
const eBytes = await sha256(eInput);
const e = mod(BigInt('0x' + bytesToHex(eBytes)), N);
const s = mod(kFinal + e * privKey, N);
const sig = new Uint8Array([...rx, ...hexToBytes(s.toString(16).padStart(64, '0'))]);
return bytesToHex(sig);
}
async function createNostrEvent(privKeyBytes, template) {
const pubKeyBytes = getPublicKey(privKeyBytes);
const pubkey = bytesToHex(pubKeyBytes);
const eventData = JSON.stringify([0, pubkey, template.created_at, template.kind, template.tags, template.content]);
const encoder = new TextEncoder();
const idBytes = await sha256(encoder.encode(eventData));
const id = bytesToHex(idBytes);
const sig = await schnorrSign(privKeyBytes, idBytes);
return { id, pubkey, ...template, sig };
}
export default async function handler(req) {
if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
try {
const { content, battleUrl, battleTitle, username, sentiment } = await req.json();
const nsec = process.env.NOSTR_NSEC;
if (!nsec) return new Response(JSON.stringify({ error: 'No nsec configured' }), { status: 500 });
const privKeyBytes = decodeNsec(nsec);
const sentimentLabel = sentiment === 'pos' ? '👍 Positive take' : '👎 Critical take';
const template = {
kind: 1,
created_at: Math.floor(Date.now() / 1000),
tags: [
['r', battleUrl],
['subject', battleTitle || battleUrl],
['t', 'commenteers'],
['t', sentiment === 'pos' ? 'positive' : 'critical'],
['client', 'Commenteers'],
],
content: ${sentimentLabel} on "${battleTitle || battleUrl}"\n\n${content}\n\n— posted by ${username} on Commenteers\n${battleUrl},
};
const signedEvent = await createNostrEvent(privKeyBytes, template);
const wsRelays = ['wss://relay.damus.io','wss://nos.lol','wss://relay.primal.net','wss://relay.nostr.band'];
const publishToRelay = (relayUrl) => new Promise((resolve) => {
try {
const ws = new WebSocket(relayUrl);
const timeout = setTimeout(() => { try { ws.close(); } catch(e) {} resolve({ relay: relayUrl, ok: false, reason: 'timeout' }); }, 6000);
ws.onopen = () => ws.send(JSON.stringify(['EVENT', signedEvent]));
ws.onmessage = (e) => {
try {
const msg = JSON.parse(e.data);
if (msg[0] === 'OK') { clearTimeout(timeout); try { ws.close(); } catch(e) {} resolve({ relay: relayUrl, ok: msg[2], reason: msg[3] }); }
} catch { resolve({ relay: relayUrl, ok: false, reason: 'parse error' }); }
};
ws.onerror = () => { clearTimeout(timeout); resolve({ relay: relayUrl, ok: false, reason: 'ws error' }); };
} catch(e) { resolve({ relay: relayUrl, ok: false, reason: e.message }); }
});
const results = await Promise.all(wsRelays.map(publishToRelay));
const successCount = results.filter(r => r.ok).length;
return new Response(JSON.stringify({ eventId: signedEvent.id, pubkey: signedEvent.pubkey, successCount, results }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
} catch(e) {
return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
}
