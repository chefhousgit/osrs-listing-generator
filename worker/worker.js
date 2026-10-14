import { runAlerts, sendTests, setAutoDrop } from './alerts.js';
import { saveBackup, listBackups, getBackup } from './backup.js';

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
    // /alerts/test posts one sample message to each webhook.
    const json = (data) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

    // For the app's Offers page: when the 24/7 checks first saw each offer, and the auto-drop plan.
    if (url.pathname === "/alerts/offers-age") {
      const firstSeen = (await env.STATE.get("offers", "json")) || {};
      const autodrop = (await env.STATE.get("autodrop", "json")) || {};
      return json({ firstSeen, autodrop });
    }

    // Opt an offer in/out of auto price drops: { offerId, enabled, base }.
    if (url.pathname === "/alerts/autodrop") {
      const body = await request.json().catch(() => ({}));
      if (!body.offerId || (body.enabled && !(Number(body.base) > 0))) return new Response("Bad request", { status: 400 });
      return json(await setAutoDrop(env, body));
    }

    // Account folder counts from the app, for the daily summary: { waiting, listed, sold }.
    if (url.pathname === "/alerts/stock") {
      const body = await request.json().catch(() => ({}));
      const stock = { waiting: Number(body.waiting) || 0, listed: Number(body.listed) || 0, sold: Number(body.sold) || 0, at: new Date().toISOString() };
      await env.STATE.put("stock", JSON.stringify(stock));
      return json({ ok: true, stock });
    }

    // Backups of the account folder records (backup.js): the app saves, scripts/backup.js lists / pulls.
    if (url.pathname === "/alerts/backup") {
      const result = await saveBackup(env, await request.json().catch(() => null));
      return new Response(JSON.stringify(result), { status: result.status || 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/alerts/backup/list") return json(await listBackups(env));
    if (url.pathname === "/alerts/backup/get") {
      const backup = await getBackup(env, url.searchParams.get("key"));
      return backup ? json(backup) : new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/alerts/run" || url.pathname === "/alerts/test") {
      try {
        const result = url.pathname === "/alerts/test"
          ? await sendTests(env, url.searchParams.get("only"))
          : await runAlerts(env, { forceSummary: url.searchParams.get("summary") === "1" });
        return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
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
