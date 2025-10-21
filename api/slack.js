import chatHandler from "./chat.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Slack sends data as form-encoded (not JSON)
  let text = "";
  let user_name = "";
  if (req.headers["content-type"]?.includes("application/x-www-form-urlencoded")) {
    const raw = await new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk.toString()));
      req.on("end", () => resolve(body));
    });
    const params = new URLSearchParams(raw);
    text = params.get("text") || "";
    user_name = params.get("user_name") || "";
  } else {
    const body = req.body || {};
    text = body.text || "";
    user_name = body.user_name || "";
  }

  // Build mock request to reuse chatHandler logic
  const mockReq = {
    method: "POST",
    body: {
      message: text,
      source: "slack",
      user: user_name,
    },
    headers: {
      authorization: `Bearer ${process.env.AUTH_TOKEN}`,
    },
  };

  // Capture chat.js response
  const resultData = await new Promise((resolve) => {
    const mockRes = {
      status: (code) => ({
        json: (data) => resolve({ code, data }),
      }),
    };
    chatHandler(mockReq, mockRes);
  });

  const result = resultData?.data || {};
  const reply = result.reply || result.response || "No response received.";

  return res.status(200).json({
    response_type: "in_channel",
    text: reply,
  });
}
