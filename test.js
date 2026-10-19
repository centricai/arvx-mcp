// Runs the connector against a stand-in ARVX service and checks every tool.
// node test.js  (no network, no real key, no Reading spent)
const http = require("http");
const { spawn } = require("child_process");
const assert = require("assert");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const KEY = "arvx_test_" + "k".repeat(30) + "ZZ9Q";
const seen = [];
const mock = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const body = JSON.parse(b || "{}");
    seen.push({ path: req.url, key: req.headers["x-arvx-key"], body });
    const send = (s, d, h = {}) => { res.writeHead(s, { "content-type": "application/json", ...h }); res.end(JSON.stringify(d)); };
    if (req.url === "/v1/records/summary") return send(200, { items: ["one item"] });
    if (body.user && body.user.name === "Broke") return send(402, { error: "Your balance is too low for a Reading. Add funds at https://api.arvx.ai/account to keep going. No Reading was counted.", reason: "add_funds" });
    if (body.user && body.user.name === "Fast") return send(429, { error: "Too many Readings from this key in the last minute. Try again in 12 seconds. No Reading was counted.", reason: "too_fast" }, { "retry-after": "12" });
    return send(200, { reading: "two_person_fit", statement: "S", areas: [{ area: "cadence", color: "green" }], record: "SEALED" });
  });
});

const reading = (name) => ({
  user: { name, email: "u@example.com" },
  other: { name: "Lee", email: "o@example.com", country: "US", state: "MI" },
  emails: [1, 2, 3].flatMap((i) => [{ from: "user", body: "hi " + i }, { from: "other", body: "hello " + i }]),
});

async function connect(port, headers) {
  const c = new Client({ name: "test", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers } }));
  return c;
}

(async () => {
  await new Promise((r) => mock.listen(0, r));
  const mockPort = mock.address().port;
  const port = 18000 + Math.floor(Math.random() * 1000);
  let logs = "";
  const srv = spawn(process.execPath, ["http.js"], { env: { ...process.env, PORT: String(port), ARVX_API_URL: `http://127.0.0.1:${mockPort}` } });
  srv.stderr.on("data", (d) => (logs += d));
  srv.stdout.on("data", (d) => (logs += d));
  await new Promise((r) => setTimeout(r, 800));
  let pass = 0;
  const ok = (name) => { pass++; console.log("  ok", name); };
  try {
    const anon = await connect(port, {});
    const tools = (await anon.listTools()).tools.map((t) => t.name).sort();
    assert.deepStrictEqual(tools, ["arvx_get_access", "arvx_record_summary", "arvx_run_reading"]); ok("three tools");
    assert.ok(/Save it exactly as returned/.test(anon.getInstructions() || "")); ok("instructions reach the agent");
    const acc = JSON.parse((await anon.callTool({ name: "arvx_get_access", arguments: {} })).content[0].text);
    assert.strictEqual(acc.signupLink, "https://api.arvx.ai/account"); assert.strictEqual(acc.keySet, false); ok("signup link with no key");
    const nk = await anon.callTool({ name: "arvx_run_reading", arguments: reading("Dana") });
    assert.strictEqual(nk.isError, true); assert.ok(/sign up at https:\/\/api\.arvx\.ai\/account/.test(nk.content[0].text)); assert.strictEqual(seen.length, 0); ok("no key: refused, ARVX never called");

    const c = await connect(port, { "x-arvx-key": KEY });
    const r = JSON.parse((await c.callTool({ name: "arvx_run_reading", arguments: reading("Dana") })).content[0].text);
    assert.strictEqual(r.record, "SEALED"); assert.ok(r.saveTheRecord); ok("Reading returned with the save-the-record line");
    assert.strictEqual(seen[0].key, KEY); assert.strictEqual(seen[0].path, "/v1/readings/two-person-fit"); assert.strictEqual(seen[0].body.emails.length, 6); ok("key and request passed to ARVX");
    const broke = await c.callTool({ name: "arvx_run_reading", arguments: reading("Broke") });
    assert.strictEqual(broke.isError, true); assert.strictEqual(broke.content[0].text, "Your balance is too low for a Reading. Add funds at https://api.arvx.ai/account to keep going. No Reading was counted."); ok("add-funds refusal passed on word for word");
    const fast = await c.callTool({ name: "arvx_run_reading", arguments: reading("Fast") });
    assert.ok(/Try again in 12 seconds\. No Reading was counted\.$/.test(fast.content[0].text)); ok("too-fast refusal passed on, seconds not repeated");
    const big = await c.callTool({ name: "arvx_run_reading", arguments: { ...reading("Dana"), emails: Array(201).fill({ from: "user", body: "x" }) } }).catch((e) => ({ isError: true, content: [{ text: e.message }] }));
    assert.strictEqual(big.isError, true); assert.strictEqual(seen.length, 3); ok("over 200 emails refused before ARVX is called");
    const sum = JSON.parse((await c.callTool({ name: "arvx_record_summary", arguments: { record: "SEALED", user: { email: "u@example.com" }, other: { email: "o@example.com" }, reason: "access_request" } })).content[0].text);
    assert.deepStrictEqual(sum.items, ["one item"]); ok("record summary");

    const b = await connect(port, { authorization: "Bearer " + KEY });
    await b.callTool({ name: "arvx_run_reading", arguments: reading("Dana") });
    assert.strictEqual(seen[seen.length - 1].key, KEY); ok("Authorization: Bearer works too");

    assert.strictEqual(logs.includes(KEY) || logs.includes("ZZ9Q"), false); assert.strictEqual(logs.includes("u@example.com"), false); ok("no key or email in the logs");
    console.log(`\n${pass} of 12 checks passed`);
    process.exitCode = pass === 12 ? 0 : 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    srv.kill();
    mock.close();
    setTimeout(() => process.exit(), 200);
  }
})();
