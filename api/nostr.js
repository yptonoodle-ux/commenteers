export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { content, battleUrl, battleTitle, username, commentId, sentiment } = await req.json();
    const nsec = process.env.NOSTR_NSEC;
    if (!nsec) return new Response(JSON.stringify({ error: 'No nsec configured' }), { status: 500 });

    let finalizeEvent, nip19;
    try {
      const nostrTools = await import('https://esm.sh/nostr-tools@2.3.1/pure');
      finalizeEvent = nostrTools.finalizeEvent;
      nip19 = nostrTools.nip19;
    } catch(importErr) {
      return new Response(JSON.stringify({ error: 'Import failed: ' + importErr.message }), { status: 500 });
    }

    let privateKey;
    try {
      const decoded = nip19.decode(nsec);
      privateKey = decoded.data;
    } catch(decodeErr) {
      return new Response(JSON.stringify({ error: 'nsec decode failed: ' + decodeErr.message }), { status: 500 });
    }

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

    let signedEvent;
    try {
      signedEvent = finalizeEvent(eventTemplate, privateKey);
    } catch(signErr) {
      return new Response(JSON.stringify({ error: 'Sign failed: ' + signErr.message }), { status: 500 });
    }

    const wsRelays = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.primal.net',
    ];

    const publishToRelay = (relayUrl) => {
      return new Promise((resolve) => {
        try {
          const ws = new WebSocket(relayUrl);
          const timeout = setTimeout(() => {
            try { ws.close(); } catch(e) {}
            resolve({ relay: relayUrl, ok: false, reason: 'timeout' });
          }, 6000);
          ws.onopen = () => ws.send(JSON.stringify(['EVENT', signedEvent]));
          ws.onmessage = (e) => {
            try {
              const msg = JSON.parse(e.data);
              if (msg[0] === 'OK') {
                clearTimeout(timeout);
                try { ws.close(); } catch(e) {}
                resolve({ relay: relayUrl, ok: msg[2], reason: msg[3] });
              }
            } catch {
              resolve({ relay: relayUrl, ok: false, reason: 'parse error' });
            }
          };
          ws.onerror = () => {
            clearTimeout(timeout);
            resolve({ relay: relayUrl, ok: false, reason: 'ws error' });
          };
        } catch (e) {
          resolve({ relay: relayUrl, ok: false, reason: e.message });
        }
      });
    };

    const results = await Promise.all(wsRelays.map(publishToRelay));
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
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
