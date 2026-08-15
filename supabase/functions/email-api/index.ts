import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

export default {
  fetch: withSupabase(
    { auth: ["publishable", "secret"] },
    async (req) => {
      try {
        if (!OPENAI_API_KEY) {
          return Response.json(
            {
              success: false,
              error: "OPENAI_API_KEY is not configured.",
            },
            { status: 500 }
          );
        }

        const body = await req.json().catch(() => ({}));

        const prompt =
          body.prompt ||
          "Say hello and confirm that the OpenAI connection is working.";

        const response = await fetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-5.6",
              input: prompt,
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          console.error("OpenAI error:", data);

          return Response.json(
            {
              success: false,
              error:
                data?.error?.message ||
                "OpenAI request failed.",
            },
            { status: response.status }
          );
        }

        return Response.json({
          success: true,
          reply: data.output_text || "",
        });
      } catch (error) {
        console.error("Function error:", error);

        return Response.json(
          {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Unknown error.",
          },
          { status: 500 }
        );
      }
    }
  ),
};