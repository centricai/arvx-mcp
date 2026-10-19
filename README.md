# ARVX connector

Email for long-term client relationships: ARVX reads each person first and remembers every pair.

Building a CRM or an email tool? ARVX is the bridge between your product and the email client. It reads each person first, knows their normal, and remembers every pair.

This connector lets any MCP-compatible AI assistant or coding agent run ARVX Readings. It keeps nothing: your key travels with each request to ARVX and is never stored.

## What a Reading returns

Every Reading is on two people: the person you work for and a person they work with, read from the emails between them.

- Colors, area by area (clarity, cadence, responsiveness, bench strength, meaningful moments): how this exchange fits this person. Green on target, yellow drifting, red off.
- Up to three predictions: what ARVX expects next, each with what to do if it happens.
- What moved since the last Reading on the same pair.
- Up to two lines on what is acting on the other person this week: company news, severe weather, a U.S. holiday.
- A sealed record only ARVX can open. Save it and send it back with the next Reading on the same pair.

ARVX never returns a score, a trait rating or a personality label on a named person. Email addresses are never stored and never sent to an AI model.

## Tools

- `arvx_get_access`: the signup link to give the person, the price, and how to add the key. Needs no key.
- `arvx_run_reading`: runs a Reading on two people. The first 3 are free, then 43¢ each, prepaid.
- `arvx_record_summary`: when someone asks what is held about them, every item in a saved record in plain words.

## Get a key

A person must sign up at https://api.arvx.ai/account, accept the terms and create the key. An agent cannot. Before the first payment, Stripe checks a photo ID and a selfie, once.

## Connect

Add a remote MCP server at:

```
https://mcp.arvx.ai/mcp
```

with your key in the `x-arvx-key` header (or `Authorization: Bearer <key>`). Put the key in your client's settings, never in a chat. For example:

```json
{
  "mcpServers": {
    "arvx": {
      "type": "http",
      "url": "https://mcp.arvx.ai/mcp",
      "headers": { "x-arvx-key": "YOUR_ARVX_KEY" }
    }
  }
}
```

## More

- Docs: https://developer.arvx.ai/docs
- Sample Reading: https://developer.arvx.ai/sample
- Terms: https://developer.arvx.ai/terms
- Help: help@arvx.ai

ARVX is built by Centric AI, Inc.
