export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const AUTH_TOKEN = process.env.AUTH_TOKEN;
  const { text, user_name } = req.body; // from Slack slash command

  try {
    const response = await fetch(`${process.env.BASE_URL}/api/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        query: text,
        source: "slack",
        user: user_name,
      }),
    });

    const data = await response.json();

    res.status(200).json({
      response_type: "in_channel",
      text: data.reply || "No response received from Copilot API.",
    });
  } catch (err) {
    console.error("Slack handler error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
