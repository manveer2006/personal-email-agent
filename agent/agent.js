import { getGmail, getUnreadEmails } from "../email-agent.js";
import { decideAction } from "./decision-engine.js";

export async function runEmailAgent(analyzeEmail) {
  console.log("🤖 Email Agent starting...");

  const gmail = await getGmail();

  const emails = await getUnreadEmails(gmail);

  console.log(`📬 Found ${emails.length} unread email(s).`);

  const results = [];

  for (const email of emails) {
    console.log(`\n📧 Processing: ${email.subject || "No subject"}`);

    const analysis = await analyzeEmail(email);

    const decision = decideAction(analysis);

    console.log("🧠 Analysis:", analysis);
    console.log("🎯 Decision:", decision);

    results.push({
      email,
      analysis,
      decision,
    });
  }

  console.log("\n✅ Agent finished.");

  return results;
}
