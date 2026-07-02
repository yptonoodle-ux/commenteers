export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { amount, recipientLightningAddress, commentId } = req.body;
    if (!amount || !recipientLightningAddress) {
      return res.status(400).json({ error: 'Missing amount or lightning address' });
    }

    const amountMsat = Math.floor(amount * 1000);
    const commenteersMsat = Math.floor(amountMsat * 0.10);
    const recipientMsat = Math.floor(amountMsat * 0.90);

    // Fetch LNURL-pay info for recipient
    const [recipientUser, recipientDomain] = recipientLightningAddress.split('@');
    const lnurlRes = await fetch(`https://${recipientDomain}/.well-known/lnurlp/${recipientUser}`);
    if (!lnurlRes.ok) return res.status(400).json({ error: 'Could not reach recipient Lightning address' });
    const lnurlData = await lnurlRes.json();

    if (recipientMsat < lnurlData.minSendable || recipientMsat > lnurlData.maxSendable) {
      return res.status(400).json({ error: `Amount out of range: min ${lnurlData.minSendable}msat max ${lnurlData.maxSendable}msat` });
    }

    // Get invoice for recipient
    const invoiceRes = await fetch(`${lnurlData.callback}?amount=${recipientMsat}`);
    if (!invoiceRes.ok) return res.status(400).json({ error: 'Could not get recipient invoice' });
    const invoiceData = await invoiceRes.json();

    // Get invoice for Commenteers cut
    const commentersMsat2 = Math.floor(amountMsat * 0.10);
    const [cUser, cDomain] = 'crudemoney474@walletofsatoshi.com'.split('@');
    const cLnurlRes = await fetch(`https://${cDomain}/.well-known/lnurlp/${cUser}`);
    let commenteersInvoice = null;
    if (cLnurlRes.ok) {
      const cLnurlData = await cLnurlRes.json();
      const cInvoiceRes = await fetch(`${cLnurlData.callback}?amount=${commentersMsat2}`);
      if (cInvoiceRes.ok) {
        const cInvoiceData = await cInvoiceRes.json();
        commenteersInvoice = cInvoiceData.pr;
      }
    }

    return res.status(200).json({
      recipientInvoice: invoiceData.pr,
      commenteersInvoice,
      recipientMsat,
      commenteersMsat: commentersMsat2,
      recipientAddress: recipientLightningAddress,
      verifyUrl: invoiceData.verify || null,
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
