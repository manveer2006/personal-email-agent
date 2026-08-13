import { getGmail, getUnreadEmails } from "../email-agent.js";
import { decideAction } from "./decision-engine.js";
import { generateReply } from "../email-agent.js";

export async function runEmailAgent(analyzeEmail) {
  console.log("🤖 Email Agent starting...");

  const gmail = await getGmail();
  const emails = await getUnreadEmails(gmail);

  console.log(`📬 Found ${emails.length} unread email(s).`);

  const results = [];

  for (const email of emails) {
    console.log(`\n📧 Processing: ${email.subject || "No subject"}`);

    const analysis = await analyzeEmail(email);
    console.log("🧠 Analysis:", analysis);

    const decision = decideAction(analysis, email);
    console.log("🎯 Decision:", decision);

    let draft = "";

    if (decision.action === "DRAFT_REPLY") {
      console.log("✍️ Generating reply...");

      draft = await generateReply(email, {
        ...analysis,
        ...decision,
      });

      console.log("✅ Reply generated.");
      console.log("----- DRAFT -----");
      console.log(draft);
      console.log("-----------------");
    }

    results.push({
      email,
      analysis,
      decision,
      draft,
    });
  }

  console.log("\n✅ Agent finished.");

  return results;
}
