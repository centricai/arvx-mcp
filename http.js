/**
 * ARVX connector: web entry point (Cloud Run).
 *
 * Serves the MCP Streamable HTTP transport on POST /mcp. Stateless: a fresh
 * server is built for each request with that request's key, so nothing is kept
 * between requests and one caller's key can never reach another's request.
 * Never logs a key, a request body or an answer.
 */
const express = require("express");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { buildServer, keyFrom, VERSION } = require("./tools.js");

const app = express();
app.disable("x-powered-by");
// A Reading can carry up to 200 emails of up to 20,000 characters each.
app.use(express.json({ limit: "5mb" }));

// Cloud Run keeps paths ending in "z" for itself, so the health address is /health.
app.get("/health", (_req, res) => res.status(200).json({ status: "ok", service: "arvx-mcp", version: VERSION }));

// A person who opens the address in a web browser gets a plain page saying what it is.
// Assistants never ask for a web page, so their requests are unaffected.
const wantsPage = (req) => {
  const accept = String(req.headers.accept || "");
  return accept.includes("text/html") && accept.includes("text/event-stream") === false;
};

const PAGE = `<\x21doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ARVX connector</title>
<style>
  :root { --purple:#5E17EB; --ink:#0F0F0F; --muted:#6B6B6B; --paper:#F7F7F5; --surface:#FFFFFF; --line:#E4E4E0; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family:Inter, system-ui, -apple-system, "Segoe UI", sans-serif; line-height:1.55; }
  main { max-width:640px; margin:0 auto; padding:56px 16px 64px; }
  .mark { font-weight:700; letter-spacing:.08em; color:var(--purple); font-size:14px; }
  h1 { font-size:28px; line-height:1.25; margin:12px 0 12px; }
  h2 { font-size:17px; margin:36px 0 8px; }
  p, li { font-size:16px; }
  .muted { color:var(--muted); }
  .address { display:block; background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:14px 16px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:15px; word-break:break-all; margin:20px 0 4px; }
  ol { padding-left:22px; }
  li { margin:6px 0; }
  a { color:var(--purple); }
  .links { margin-top:32px; display:flex; gap:12px; flex-wrap:wrap; }
  .btn { display:inline-block; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600; font-size:15px; border:1px solid var(--purple); }
  .btn.primary { background:var(--purple); color:#fff; }
  footer { margin-top:56px; font-size:13px; color:var(--muted); }
</style>
</head>
<body>
<main>
  <div class="mark">ARVX</div>
  <h1>This is the ARVX connector address.</h1>
  <p>It is meant for AI assistants, not web browsers. Add it to your assistant as a connector and your assistant can run ARVX Readings.</p>
  <span class="address">https://mcp.arvx.ai/mcp</span>
  <p class="muted">Copy this address into your assistant's connector settings.</p>
  <h2>To connect</h2>
  <ol>
    <li>Create an ARVX account and a key at <a href="https://api.arvx.ai/account">api.arvx.ai/account</a>. A person has to do this step; an assistant can't.</li>
    <li>In your assistant, add a custom connector with the address above.</li>
    <li>Add your ARVX key the way the docs describe for your assistant.</li>
  </ol>
  <div class="links">
    <a class="btn primary" href="https://api.arvx.ai/account">Get a key</a>
    <a class="btn" href="https://developer.arvx.ai/docs">Read the docs</a>
  </div>
  <footer>ARVX is run by Centric AI, Inc. U.S. accounts only.</footer>
</main>
</body>
</html>`;

const sendPage = (res) =>
  res
    .status(200)
    .set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    .set("Cache-Control", "public, max-age=300")
    .type("html")
    .send(PAGE);

app.get("/", (req, res) => {
  if (wantsPage(req)) return sendPage(res);
  return res.status(200).json({
    service: "ARVX connector",
    endpoint: "/mcp",
    signup: "https://api.arvx.ai/account",
    docs: "https://developer.arvx.ai/docs",
  });
});

app.post("/mcp", async (req, res) => {
  const server = buildServer(keyFrom(req.headers));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[arvx-mcp] request error:", err.name || "unknown");
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

const notAllowed = (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
app.get("/mcp", (req, res) => (wantsPage(req) ? sendPage(res) : notAllowed(req, res)));
app.delete("/mcp", notAllowed);

// A request too large or not JSON gets a plain answer, never a stack trace.
app.use((err, _req, res, _next) => {
  const status = err.type === "entity.too.large" ? 413 : 400;
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32700, message: status === 413 ? "Request too large." : "Request is not valid JSON." }, id: null });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.error(`arvx-mcp ${VERSION} on :${PORT}, POST /mcp`));
