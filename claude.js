import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "ollama",
  baseURL: "http://localhost:31500/v1",
});

async function main() {
  console.log("Connecting to local AI...");

  const response = await client.chat.completions.create({
    model: "qwen3",
    messages: [
      {
        role: "user",
        content: "Hello! Reply with exactly: NODE JS AI WORKS",
      },
    ],
  });

  console.log("\nAI response:");
  console.log(response.choices[0].message.content);
}

main().catch((error) => {
  console.error("\nERROR:");
  console.error(error.message);
});