/**
 * Demo Cloudflare Worker — sample input for XOR Shield.
 *
 * A tiny JSON API used by the README animation and as a ready-made file to
 * try the tool with: drop it into the app and press "Protect code".
 */
const ROUTES = { health: "/health", greet: "/greet", weather: "/weather" };
const API_VERSION = "demo-1.0.0";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-api-version": API_VERSION,
      "cache-control": "no-store"
    }
  });
}

function greet(name) {
  const safe = String(name || "world").slice(0, 40);
  return `Hello, ${safe}! Generated at ${new Date().toISOString()}`;
}

function weather(city) {
  const table = { london: "rainy", tokyo: "clear", berlin: "cloudy", paris: "sunny" };
  const key = String(city || "london").toLowerCase();
  const forecast = table[key] || "unknown";
  return { city: key, forecast, units: "metric", tip: "Remember an umbrella." };
}

export default {
  async fetch(request, env, ctx) {
    "use strict";
    const url = new URL(request.url);
    if (request.method !== "GET") {
      return json({ error: "method_not_allowed", detail: "Only GET is supported" }, 405);
    }
    switch (url.pathname) {
      case ROUTES.health:
        return json({ status: "healthy", version: API_VERSION });
      case ROUTES.greet:
        return json({ message: greet(url.searchParams.get("name")) });
      case ROUTES.weather:
        return json(weather(url.searchParams.get("city")));
      default:
        return json({ error: "not_found", routes: Object.values(ROUTES) }, 404);
    }
  }
};
