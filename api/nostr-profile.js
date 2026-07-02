import { finalizeEvent, nip19, getPublicKey } from 'nostr-tools';
import WebSocket from 'ws';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const nsec = process.env.NOSTR_NSEC;
  if (!nsec) return res.status(500).json({ error: 'No nsec' });

  const { data: privateKey } = nip19.decode(nsec);

  const metadata = finalizeEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({
      name: 'Commenteers',
      about: 'Comment on anything on the internet. Battles between positive and critical takes, powered by Lightning zaps. Built on Nostr. commenteers.com',
      website: 'https://commenteers.com',
      picture: 'https://commenteers.com/icon.png',
      nip05: '_@commenteers.com',
    }),
  }, privateKey);

  const relayUrls = ['wss://relay.damus.io','wss://nos.lol','wss://relay.primal.net','wss://relay.nostr.band'];

  const publish = (url) => new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => { ws.terminate(); resolve({ url, ok: false }); }, 6000);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', metadata])));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg[0] === 'OK') { clearTimeout(timeout); ws.terminate(); resolve({ url, ok: msg[2] }); }
    });
    ws.on('error', () => { clearTimeout(timeout); resolve({ url, ok: false }); });
  });

  const results = await Promise.all(relayUrls.map(publish));
  return res.status(200).json({ results });
}
