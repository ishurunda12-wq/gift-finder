export default async (req) => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing GEMINI_API_KEY in Netlify environment variables." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let payload = {};
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
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
You are GiftGenie, an India-first gifting expert.
Return ONLY valid JSON (no markdown) in this exact schema:

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

User inputs:
- Delivery preference: ${delivery || "either"}
- Occasion: ${occasion || "unspecified"}
- Recipient: ${recipient || "unspecified"}
- Gender (soft preference, avoid stereotypes): ${gender || "prefer-not"}
- Interests (comma separated): ${(interests || []).join(", ") || "open"}
- Budget: ${budgetHints[budget] || "₹1,000–₹2,000"}
- Vibe: ${vibe || "thoughtful"}

Rules:
- Give 10 gift ideas.
- Stay within the stated budget range.
- Make ideas specific and not generic.
- If vibe is "handmade", ensure at least 3 handmade/personalized ideas.
- If delivery preference is online, bias to items easy to order online in India.
- If offline, include locally-buyable ideas (experiences, artisan markets, bookstores, cafes).
- Avoid anything inappropriate, illegal, or adult content.
- Output must be valid JSON only.
`;

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" +
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

    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return new Response(
        JSON.stringify({
          error: "Gemini did not return valid JSON.",
          raw: text.slice(0, 2000)
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!parsed?.gifts || !Array.isArray(parsed.gifts)) {
      return new Response(
        JSON.stringify({ error: "Unexpected response format.", raw: parsed }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to call Gemini.", details: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
