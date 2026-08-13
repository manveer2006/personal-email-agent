import { analyzeEmail } from "./email-agent.js";
import { runEmailAgent } from "./agent/agent.js";

try {
  console.log("=================================");
  console.log("🤖 PERSONAL EMAIL AGENT");
  console.log("=================================");

  const results = await runEmailAgent(analyzeEmail);

  console.log("\n📊 AGENT RESULTS");
  console.log("================");

  for (const result of results) {
    console.log("\nSubject:", result.email.subject || "No subject");
    console.log("Priority:", result.decision.priority);
    console.log("Category:", result.decision.category || "OTHER");
    console.log("Reply needed:", result.decision.reply_needed);
    console.log("Action:", result.decision.action);
    console.log("Approval required:", result.decision.requiresApproval);
  }

  console.log("\n✅ Agent run completed.");
} catch (error) {
  console.error("\n❌ Agent failed:");
  console.error(error);
  process.exit(1);
}
