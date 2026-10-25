import { runAlerts, sendTests, setAutoDrop, health, tokenInfo, cooldown, noteRateLimit, takeCalls } from './alerts.js';
import { saveBackup, listBackups, getBackup, latestBackups } from './backup.js';
import { updateOffers, updateOrder, logCalls } from './snapshots.js';

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

    // The Eldorado login token for the app, shared with the checks (one login for everyone):
    // { stale?, pc } -> { token, expiresAt }. 429 { until } while paused after a rate limit.
    if (url.pathname === "/alerts/token") {
      const body = await request.json().catch(() => ({}));
      const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
      const paused = await cooldown(env);
      if (paused) return reply(429, { error: "Paused after a rate limit.", until: paused.until });
      try {
        const info = await tokenInfo(env, { stale: body.stale });
        return reply(200, { token: info.value, expiresAt: info.expiresAt });
      } catch (err) {
        if (err.status === 429) return reply(429, { error: err.message, until: (await noteRateLimit(env, "login", body.pc || "app", err.retryAfter)).until });
        return reply(502, { error: err.message, status: err.status || null });
      } finally {
        const n = takeCalls(); // a login made for the app counts as the Worker's request
        if (n) await logCalls(env, "worker", n).catch(() => {});
      }
    }

    // What the 24/7 checks read from Eldorado, for the app to show instead of reading it again
    // (snapshots.js). lastRun says how fresh it is.
    if (url.pathname === "/alerts/orders") {
      const snap = await env.STATE.get("ordersLatest", "json");
      return json({ ...(snap || { at: null, orders: null }), lastRun: await env.STATE.get("lastRun", "json") });
    }
    if (url.pathname === "/alerts/history") {
      const snap = await env.STATE.get("orderHistory", "json");
      const crawl = await env.STATE.get("historyCrawl", "json");
      return json({ ...(snap || { at: null, orders: null, complete: false }), readingNow: crawl ? crawl.orders.length : null });
    }
    if (url.pathname === "/alerts/offers") {
      const snap = await env.STATE.get("offersCache", "json");
      return json(snap || { at: 0, offers: null });
    }
    // The app's own changes, so the next page load already shows them.
    if (url.pathname === "/alerts/offers/update") {
      const result = await updateOffers(env, await request.json().catch(() => ({})));
      return new Response(JSON.stringify(result), { status: result.status || 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/alerts/orders/update") {
      const result = await updateOrder(env, await request.json().catch(() => ({})));
      return new Response(JSON.stringify(result), { status: result.status || 200, headers: { "Content-Type": "application/json" } });
    }
    // The app's Eldorado request counts: { pc, counts: { "YYYY-MM-DDTHH:MM": n } } (5-minute blocks).
    if (url.pathname === "/alerts/calls") {
      const body = await request.json().catch(() => ({}));
      return json(await logCalls(env, body.pc || "app", body.counts));
    }

    // The app hit a rate limit itself: { what, pc, retryAfter? } -> pause everyone, log it. -> { until }
    if (url.pathname === "/alerts/ratelimit") {
      const body = await request.json().catch(() => ({}));
      return json(await noteRateLimit(env, body.what, body.pc || "app", body.retryAfter));
    }

    // The app's setup check (Settings page): last run, credentials, which channels are set, backups.
    if (url.pathname === "/alerts/health") return json(await health(env, await latestBackups(env)));

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
