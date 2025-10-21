export const runtime = "nodejs";

export default async function handler(req, res) {
  const CYARA_API_URL =
    process.env.CYARA_API_URL ||
    "https://7jfvvi4m0g.execute-api.us-east-1.amazonaws.com/api/dev/external";
  const API_TOKEN = process.env.API_TOKEN;

  const payload = {
    query: "what is pulse 360",
    sessionAttributes: {
      auth_token: API_TOKEN,
      product: "voice_assure",
      request_source: "ui",
    },
  };

  console.log("🚀 TestFetch to", CYARA_API_URL);
  const start = Date.now();

  try {
    const response = await fetch(CYARA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    const elapsed = Date.now() - start;

    console.log(`✅ CYARA responded in ${elapsed}ms`);
    console.log("Response:", text.slice(0, 300));

    res.status(200).json({ status: response.status, elapsed, text });
  } catch (err) {
    console.error("🔥 Error calling Cyara:", err);
    res.status(500).json({ error: err.message });
  }
}
