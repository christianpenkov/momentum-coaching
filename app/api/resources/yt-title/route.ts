export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get('url');
  if (!url) return Response.json({ title: null });
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  if (!r.ok) return Response.json({ title: null });
  const data = await r.json();
  return Response.json({ title: data.title ?? null });
}
