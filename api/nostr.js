
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { content, battleUrl, battleTitle, username, commentId, sentiment } = await req.json();
    const nsec = process.env.NOSTR_NSEC;
    if (!nsec) return new Response(JSON.stringify({ error: 'No nsec configured' }), { status: 500 });

    const { finalizeEvent, nip19 } = await import('https://esm.sh/nostr-tools@2.3.1');
    const { data: privateKey } = nip19.decode(nsec);

    const sentimentLabel = sentiment === 'pos' ? '👍 Positive take' : '👎 Critical take';
    const eventTemplate = {
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
    };

    const signedEvent = finalizeEvent(eventTemplate, privateKey);

    const relays = [
      'wss://relay.damus.io',
      'wss://relay.nostr.band',
      'wss://nos.lol',
      'wss://relay.primal.net',
      'wss://nostr.mom',
    ];

    const publishToRelay = (relayUrl) => {
      return new Promise((resolve) => {
        try {
          const ws = new WebSocket(relayUrl);
          const timeout = setTimeout(() => { ws.close(); resolve({ relay: relayUrl, ok: false, reason: 'timeout' }); }, 5000);
          ws.onopen = () => ws.send(JSON.stringify(['EVENT', signedEvent]));
          ws.onmessage = (e) => {
            try {
              const msg = JSON.parse(e.data);
              if (msg[0] === 'OK') {
                clearTimeout(timeout);
                ws.close();
                resolve({ relay: relayUrl, ok: msg[2], reason: msg[3] });
              }
            } catch { resolve({ relay: relayUrl, ok: false, reason: 'parse error' }); }
          };
          ws.onerror = () => { clearTimeout(timeout); resolve({ relay: relayUrl, ok: false, reason: 'ws error' }); };
        } catch (e) {
          resolve({ relay: relayUrl, ok: false, reason: e.message });
        }
      });
    };

    const results = await Promise.all(relays.map(publishToRelay));
    const successCount = results.filter(r => r.ok).length;

    return new Response(JSON.stringify({
      eventId: signedEvent.id,
      pubkey: signedEvent.pubkey,
      successCount,
      results,
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
