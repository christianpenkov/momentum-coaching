export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return new Response('Bad request', { status: 400 });
  for (const res of ['maxresdefault', 'hqdefault', 'mqdefault']) {
    const r = await fetch(`https://img.youtube.com/vi/${id}/${res}.jpg`);
    if (r.ok) {
      const buf = await r.arrayBuffer();
      return new Response(buf, {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
      });
    }
  }
  return new Response('Not found', { status: 404 });
}
