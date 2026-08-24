export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith("/webhooks/feishu/")) {
      return new Response("Not found", { status: 404 });
    }
    const headers = new Headers(request.headers);
    headers.set("x-bitworld-relay", "cloudflare-pages");
    return env.BITWORLD.fetch(new Request(`https://bitworld.internal${incoming.pathname}${incoming.search}`, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    }));
  },
};
