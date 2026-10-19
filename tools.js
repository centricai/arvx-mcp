/**
 * ARVX connector: the tools an AI agent uses to call ARVX for Developers.
 *
 * The connector keeps nothing. Each request carries the developer's key in its
 * own headers; the key is passed to api.arvx.ai and never stored, logged or
 * returned. Refusals from ARVX are passed on word for word.
 */
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");

const VERSION = "1.0.0";
const API_URL = (process.env.ARVX_API_URL || "https://api.arvx.ai").replace(/\/+$/, "");
const SIGNUP_URL = "https://api.arvx.ai/account";
const DOCS_URL = "https://developer.arvx.ai/docs";
const TIMEOUT_MS = 120000;

// What the agent is told when it connects: how to use ARVX and how to explain a Reading.
const INSTRUCTIONS = [
  "ARVX reads two people from the emails between them: the person you work for (user) and a person they work with (other). It returns colors area by area, up to three predictions, what moved since the last Reading on the pair, and up to two lines on what is acting on the other person this week.",
  "",
  "Getting access: a person must sign up, accept the terms and create the key. You cannot do it for them. If there is no key, call arvx_get_access and give the person the signup link.",
  "",
  "Memory of a pair: every Reading returns a sealed record. Save it exactly as returned, with the two people it belongs to, and send it as record in the next Reading on the same two people. If it is lost, the next Reading starts the pair over and loses what ARVX learned about them. ARVX keeps nothing, so the record exists only where you save it.",
  "",
  "Explaining a Reading to the person:",
  "- Show the statement line with every Reading.",
  "- Say what each color means for this exchange: green on target, yellow drifting, red off. Name the area in plain words (clarity, cadence, responsiveness, bench strength, meaningful moments).",
  "- Predictions are what ARVX expects next, based on what it sees today. Present them as expectations, with what to do if they happen.",
  "- Never turn a Reading into a score, a rating, a trait or a personality label on the other person, and never guess at sensitive matters about anyone (health, money, family, beliefs and the like).",
  "- The person decides what to say and do. Offer advice; leave the final call to them.",
  "",
  "Refusals: a refused Reading costs nothing and counts nothing. Pass the refusal sentence to the person as it is.",
].join("\n");

// ---- Request shapes, matching https://developer.arvx.ai/openapi.json --------------------
const Trait = z.number().int().min(1).max(10);
const Scores = z
  .object({
    ocean: z
      .object({
        extraversion: Trait.optional(),
        agreeableness: Trait.optional(),
        conscientiousness: Trait.optional(),
        openness: Trait.optional(),
        emotional_stability: Trait.optional(),
      })
      .optional(),
    disc: z
      .object({
        dominance: Trait.optional(),
        influence: Trait.optional(),
        steadiness: Trait.optional(),
        calculativeness: Trait.optional().describe("DISC's C goes here."),
      })
      .optional(),
  })
  .describe(
    "Only results from a personality assessment the person agreed to. At least 5 of the 9 traits, each 1 to 10. Never results collected for a hiring decision, and never clinical tests. Leave this out to have the person read from their emails."
  );

const User = z
  .object({
    name: z.string().max(100),
    email: z.string().email().describe("Ties the record to this pair. Never stored, never sent to an AI model."),
    title: z.string().max(150).optional(),
    company: z.string().max(150).optional(),
    teamSize: z.number().int().min(1).optional().describe("People on the account, counting the user."),
    scores: Scores.optional(),
  })
  .describe("The person you work for.");

const Other = z
  .object({
    name: z.string().max(100),
    email: z.string().email().describe("Ties the record to this pair. Never stored, never sent to an AI model."),
    title: z.string().max(150).optional(),
    company: z.string().max(150).optional().describe("Switches on company news."),
    country: z.literal("US").optional().describe("ARVX reads people in the United States only. US switches on U.S. holidays."),
    city: z.string().optional().describe("With state, switches on severe weather warnings."),
    state: z.string().length(2).optional().describe("Two-letter code, such as MI."),
    scores: Scores.optional(),
  })
  .describe("The person the user works with.");

const Email = z.object({
  from: z.enum(["user", "other"]),
  body: z.string().max(20000),
  sentAt: z.string().optional().describe("Date and time sent, such as 2026-10-01T14:30:00Z."),
});

// ---- Calls to ARVX ----------------------------------------------------------------------
function text(obj) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}
function refusal(sentence) {
  return { isError: true, content: [{ type: "text", text: sentence }] };
}
const NO_KEY =
  `No ARVX key is set for this connector. A person must sign up at ${SIGNUP_URL}, accept the terms and create a key, then add it to this connector's settings as the x-arvx-key header (or Authorization: Bearer). An agent cannot sign up. No Reading was counted.`;

async function callArvx(key, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL + path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-arvx-key": key, "user-agent": `arvx-mcp/${VERSION}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (res.ok) return { ok: true, data };
    const sentence = data && typeof data.error === "string" ? data.error : `ARVX answered ${res.status}. No Reading was counted.`;
    const wait = res.headers.get("retry-after");
    return { ok: false, sentence: wait && /^\d+$/.test(wait) && sentence.includes(wait) === false ? `${sentence} (Try again in ${wait} seconds.)` : sentence };
  } catch (e) {
    console.error("[arvx-mcp] call failed:", e.name || "unknown");
    return { ok: false, sentence: e.name === "AbortError" ? "ARVX took too long to answer. No Reading was counted." : "ARVX could not be reached. No Reading was counted." };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A fresh server for one request. key is the developer's key from that request's
 * headers, or null.
 */
function buildServer(key) {
  const server = new McpServer({ name: "arvx", version: VERSION }, { instructions: INSTRUCTIONS });

  server.tool(
    "arvx_get_access",
    "How to get access to ARVX: the signup link to give the person, what they must do themselves, the price, and how to add their key to this connector. Call this when there is no key, or when the person asks how to start. Costs nothing.",
    {},
    { readOnlyHint: true, openWorldHint: false },
    async () =>
      text({
        signupLink: SIGNUP_URL,
        tellThePerson: `Sign up at ${SIGNUP_URL}. A person must accept the terms and create the key; an agent cannot. Before the first payment, Stripe checks a photo ID and a selfie, once.`,
        price: "The first 3 Readings are free. Then 43¢ per Reading, prepaid. A card is required at signup, verified without a charge.",
        addTheKey: "Add the key to this connector's settings as the x-arvx-key header (or Authorization: Bearer). Never paste it into a chat.",
        keySet: Boolean(key),
        docs: DOCS_URL,
        terms: "https://developer.arvx.ai/terms",
      })
  );

  server.tool(
    "arvx_run_reading",
    "Run a Reading on two people from the emails between them. Send at least 3 emails written by the user and 3 by the other person, oldest first. From the second Reading on a pair, send the record from the last Reading exactly as it was returned. Costs one Reading (the first 3 are free). Save the record from the answer with this pair.",
    {
      user: User,
      other: Other,
      emails: z.array(Email).min(1).max(200).describe("Oldest first. Each person is read from their own latest 20 emails, the first 3,000 characters of each."),
      record: z.string().optional().describe("The record from the last Reading on these same two people, unchanged. Leave out on the first Reading."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async (args) => {
      if (!key) return refusal(NO_KEY);
      const r = await callArvx(key, "/v1/readings/two-person-fit", args);
      if (r.ok === false) return refusal(r.sentence);
      return text({
        ...r.data,
        saveTheRecord: "Save record exactly as returned, with these two people, and send it as record in the next Reading on them. ARVX keeps nothing.",
      });
    }
  );

  server.tool(
    "arvx_record_summary",
    "When someone asks what is held about them: returns every item in a saved record in plain words. Needs the record and both people's emails. Never uses up a Reading; 10 a month per account.",
    {
      record: z.string(),
      user: z.object({ email: z.string().email() }),
      other: z.object({ email: z.string().email() }),
      reason: z.enum(["access_request", "correction", "deletion_check"]),
    },
    { readOnlyHint: true, openWorldHint: true },
    async (args) => {
      if (!key) return refusal(NO_KEY.replace("No Reading was counted.", "This summary was not counted."));
      const r = await callArvx(key, "/v1/records/summary", args);
      if (r.ok === false) return refusal(r.sentence);
      return text(r.data);
    }
  );

  return server;
}

// The key from a request's headers: x-arvx-key, or Authorization: Bearer.
function keyFrom(headers) {
  const direct = headers["x-arvx-key"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const auth = headers.authorization;
  if (typeof auth === "string") {
    const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (m) return m[1];
  }
  return null;
}

module.exports = { buildServer, keyFrom, INSTRUCTIONS, SIGNUP_URL, VERSION };
