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

app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok", service: "arvx-mcp", version: VERSION }));

app.get("/", (_req, res) =>
  res.status(200).json({
    service: "ARVX connector",
    endpoint: "/mcp",
    signup: "https://api.arvx.ai/account",
    docs: "https://developer.arvx.ai/docs",
  })
);

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
app.get("/mcp", notAllowed);
app.delete("/mcp", notAllowed);

// A request too large or not JSON gets a plain answer, never a stack trace.
app.use((err, _req, res, _next) => {
  const status = err.type === "entity.too.large" ? 413 : 400;
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32700, message: status === 413 ? "Request too large." : "Request is not valid JSON." }, id: null });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.error(`arvx-mcp ${VERSION} on :${PORT}, POST /mcp`));
