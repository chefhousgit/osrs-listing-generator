import { runAlerts } from './alerts.js';

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const providedSecret = request.headers.get("X-Proxy-Secret");
    if (!providedSecret || providedSecret !== env.PROXY_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);

    // Manual run of the Discord alerts (same as the cron), ?summary=1 also sends the daily summary.
    if (url.pathname === "/alerts/run") {
      const result = await runAlerts(env, { forceSummary: url.searchParams.get("summary") === "1" });
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname !== "/generate") {
      return new Response("Not found", { status: 404 });
    }

    const body = await request.text();

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: body
    });

    const responseBody = await anthropicResponse.text();
    return new Response(responseBody, {
      status: anthropicResponse.status,
      headers: { "Content-Type": "application/json" }
    });
  },

  // Cron trigger (wrangler.toml): Eldorado orders -> Discord alerts, plus the daily summary.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlerts(env));
  }
};
