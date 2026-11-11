// Checks the connector on MCP 2026-07-28 (stateless, server/discover) with a client
// pinned to that revision. test.js covers 2025-era clients against the same server.
// node test-modern.js  (no network, no real key, no Reading spent)
const http = require("http");
const { spawn } = require("child_process");
const assert = require("assert");
const { Client, StreamableHTTPClientTransport } = require("@modelcontextprotocol/client");

const KEY = "arvx_test_" + "k".repeat(30) + "ZZ9Q";
const seen = [];
const mock = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    seen.push({ path: req.url, key: req.headers["x-arvx-key"] });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ reading: "two_person_fit", statement: "S", record: "SEALED" }));
  });
});

const reading = {
  user: { name: "Dana", email: "u@example.com" },
  other: { name: "Lee", email: "o@example.com", country: "US", state: "MI" },
  emails: [1, 2, 3].flatMap((i) => [{ from: "user", body: "hi " + i }, { from: "other", body: "hello " + i }]),
};

async function connect(port, headers) {
  const c = new Client({ name: "test-modern", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers } }));
  return c;
}

(async () => {
  await new Promise((r) => mock.listen(0, r));
  const port = 19000 + Math.floor(Math.random() * 1000);
  const srv = spawn(process.execPath, ["http.js"], { env: { ...process.env, PORT: String(port), ARVX_API_URL: `http://127.0.0.1:${mock.address().port}` } });
  await new Promise((r) => setTimeout(r, 800));
  let pass = 0;
  const ok = (name) => { pass++; console.log("  ok", name); };
  try {
    // Raw probe, the same request Claude Code and other 2026 clients send first.
    const probe = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "probe", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } }),
    });
    assert.strictEqual(probe.status, 200);
    assert.strictEqual(probe.headers.get("mcp-session-id"), null);
    const found = await probe.json();
    assert.ok(found.result.supportedVersions.includes("2026-07-28")); ok("server/discover offers 2026-07-28, no session id");

    const anon = await connect(port, {});
    const tools = (await anon.listTools()).tools.map((t) => t.name).sort();
    assert.deepStrictEqual(tools, ["arvx_get_access", "arvx_record_summary", "arvx_run_reading"]); ok("three tools on 2026-07-28");
    const acc = JSON.parse((await anon.callTool({ name: "arvx_get_access", arguments: {} })).content[0].text);
    assert.strictEqual(acc.keySet, false); ok("no key: signup link");
    const nk = await anon.callTool({ name: "arvx_run_reading", arguments: reading });
    assert.strictEqual(nk.isError, true); assert.strictEqual(seen.length, 0); ok("no key: refused, ARVX never called");

    const c = await connect(port, { "x-arvx-key": KEY });
    const r = JSON.parse((await c.callTool({ name: "arvx_run_reading", arguments: reading })).content[0].text);
    assert.strictEqual(r.record, "SEALED"); assert.strictEqual(seen[0].key, KEY); ok("key from each request's own headers reaches ARVX");
    console.log(`\n${pass} of ${pass} modern checks passed`);
  } catch (e) {
    console.error("FAIL:", e.message); process.exitCode = 1;
  } finally {
    srv.kill(); mock.close();
  }
})();
