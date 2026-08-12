/** Lightweight healthcheck script for Docker HEALTHCHECK. */
const res = await fetch("http://localhost:8000/health");
Deno.exit(res.ok ? 0 : 1);
