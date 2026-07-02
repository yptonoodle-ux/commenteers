import { finalizeEvent, nip19 } from 'nostr-tools';

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
    console.log('privkey length:', privateKey.length, 'pubkey will be:', nip19.npubEncode(require('nostr-tools').getPublicKey(privateKey)));
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

    const { Relay } = await import('nostr-tools/relay');
    const relayUrls = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.primal.net',
      'wss://relay.nostr.band',
    ];

    const results = await Promise.all(relayUrls.map(async (url) => {
      try {
        const relay = await Relay.connect(url);
        await relay.publish(event);
        relay.close();
        return { relay: url, ok: true };
      } catch(e) {
        return { relay: url, ok: false, reason: e.message };
      }
    }));

    const successCount = results.filter(r => r.ok).length;
    return res.status(200).json({ eventId: event.id, pubkey: event.pubkey, successCount, results });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
