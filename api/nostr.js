import { finalizeEvent, nip19, getPublicKey } from 'nostr-tools';

export const config = { runtime: 'nodejs18.x' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { content, battleUrl, battleTitle, username, sentiment } = req.body;
    const nsec = process.env.NOSTR_NSEC;
    if (!nsec) return res.status(500).json({ error: 'No nsec configured' });

    let privateKey;
    if (nsec.startsWith('nsec1')) {
      const decoded = nip19.decode(nsec);
      privateKey = decoded.data;
    } else {
      // treat as raw hex
      privateKey = Buffer.from(nsec, 'hex');
    }
    console.log('privkey length:', privateKey.length, 'pubkey will be:', nip19.npubEncode(getPublicKey(privateKey)));
    const sentimentLabel = sentiment === 'pos' ? '👍 Positive take' : '👎 Critical take';

    const event = finalizeEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['r', battleUrl],
        ['subject', battleTitle || battleUrl],
        ['t', 'commenteers'],
        ['t', sentiment === 'pos' ? 'positive' : 'critical'],
        ['client', 'Commenteers'],
      ],
      content: `${sentimentLabel} on "${battleTitle || battleUrl}"\n\n${content}\n\n— posted by ${username} on Commenteers\n${battleUrl}`,
    }, privateKey);

    const eventJson = JSON.stringify(['EVENT', event]);

    const relayUrls = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.primal.net',
      'wss://relay.nostr.band',
    ];

    const publishToRelay = (relayUrl) => new Promise((resolve) => {
      const ws = new (require('ws'))((relayUrl));
      const timeout = setTimeout(() => {
        ws.terminate();
        resolve({ relay: relayUrl, ok: false, reason: 'timeout' });
      }, 6000);
      ws.on('open', () => ws.send(eventJson));
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'OK') {
            clearTimeout(timeout);
            ws.terminate();
            resolve({ relay: relayUrl, ok: msg[2], reason: msg[3] });
          }
        } catch { resolve({ relay: relayUrl, ok: false, reason: 'parse error' }); }
      });
      ws.on('error', (e) => {
        clearTimeout(timeout);
        resolve({ relay: relayUrl, ok: false, reason: e.message });
      });
    });

    const results = await Promise.all(relayUrls.map(publishToRelay));
    const successCount = results.filter(r => r.ok).length;
    return res.status(200).json({ eventId: event.id, pubkey: event.pubkey, successCount, results });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
