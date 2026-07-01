export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const target = url.searchParams.get('url');
  if (!target) return new Response(JSON.stringify({ error: 'No URL' }), { status: 400 });

  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Commenteers/1.0)' }
    });
    const html = await res.text();

    const get = (property) => {
      const match = html.match(new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, 'i'));
      return match ? match[1] : null;
    };
    const getMeta = (name) => {
      const match = html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'));
      return match ? match[1] : null;
    };
    const getTitle = () => {
      const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      return match ? match[1].trim() : null;
    };

    const data = {
      title: get('og:title') || getMeta('twitter:title') || getTitle(),
      description: get('og:description') || getMeta('description'),
      image: get('og:image') || getMeta('twitter:image'),
      siteName: get('og:site_name'),
    };

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=3600'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
