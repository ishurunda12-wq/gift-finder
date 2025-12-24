exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing GEMINI_API_KEY in Netlify environment variables." })
    };
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body." })
    };
  }

  const { delivery, occasion, recipient, gender, interests, budget, vibe } = payload;

  const budgetHints = {
    "under-500": "under ₹500",
    "500-1000": "₹500–₹1,000",
    "1000-2000": "₹1,000–₹2,000",
    "2000-5000": "₹2,000–₹5,000",
    "5000-plus": "₹5,000+"
  };

  const prompt = `
SYSTEM INSTRUCTION (follow strictly):
You must output ONLY valid JSON.
Do not include explanations, comments, markdown, or extra text.
Do not wrap the response in backticks.
Do not say anything before or after the JSON.

Return JSON in EXACTLY this schema:

{
  "gifts": [
    {
      "title": "string",
      "price_range_inr": "string",
      "why": "string",
      "buy_query": "string",
      "delivery_fit": "online|offline|either"
    }
  ]
}

USER INPUTS:
Delivery preference: ${delivery || "either"}
Occasion: ${occasion || "unspecified"}
Recipient: ${recipient || "unspecified"}
Gender (soft preference, avoid stereotypes): ${gender || "prefer-not"}
Interests: ${(interests || []).join(", ") || "open"}
Budget: ${budgetHints[budget] || "₹1,000–₹2,000"}
Vibe: ${vibe || "thoughtful"}

RULES:
- Output exactly 10 gift objects.
- Stay strictly within the budget.
- If vibe includes "handmade", include at least 3 handmade or personalized gifts.
- Bias suggestions for India availability.
- Output JSON ONLY. No other text.
`;

  const url =
  "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key="
  encodeURIComponent(apiKey);

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      topP: 0.9,
      maxOutputTokens: 1200
    }
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await r.json();

    // Gemini API can return errors in { error: { message } }
    if (!r.ok) {
      return {
        statusCode: r.status || 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: data?.error?.message || "Gemini request failed.",
          raw: data
        })
      };
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

    // Safe JSON extraction
    let parsed;
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("No JSON found");
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "AI response could not be parsed.",
          raw: text.slice(0, 2000)
        })
      };
    }

    if (!parsed?.gifts || !Array.isArray(parsed.gifts)) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unexpected response format.", raw: parsed })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to call Gemini.", details: String(err) })
    };
  }
};
