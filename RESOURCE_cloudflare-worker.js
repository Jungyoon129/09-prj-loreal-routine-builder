// Cloudflare Worker: OpenAI 프록시 (키는 Secret로 저장)
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    try {
      const { messages, model = "gpt-4o-mini", temperature = 0.7 } = await request.json();

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          // 필요시 토큰 제한 추가:
          // max_completion_tokens: 500,
        }),
      });

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...cors, "Content-Type": "application/json" },
        status: res.status,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 500,
      });
    }
  }
}
