import { getGmail, getUnreadEmails } from "../email-agent.js";
import { decideAction } from "./decision-engine.js";
import { generateReply } from "../email-agent.js";
import { savePendingReply } from "./pending.js";
import { validateDraft } from "./draft-validator.js";
import { saveHumanReview } from "./human-review.js";

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

      let validation = validateDraft(draft, email);

      if (!validation.valid) {
        console.log("⚠️ Draft validation failed:");

        validation.problems.forEach((problem) => {
          console.log(`   - ${problem}`);
        });

        console.log("🔄 Regenerating draft...");

        draft = await generateReply(
  email,
  {
    ...analysis,
    ...decision,
  },
  `The previous draft failed validation for these reasons:
${validation.problems.map((problem) => `- ${problem}`).join("\n")}

Create a corrected version that fixes every problem above.`,
  draft
);

        validation = validateDraft(draft, email);
      }

      if (!validation.valid) {
        console.log("❌ Draft still failed validation.");
        console.log("   Problems:", validation.problems);
        console.log("⏭️ Draft will NOT be saved for approval.");

        draft = "";
      } else {
        console.log("✅ Reply generated and validated.");

        const pending = await savePendingReply({
          emailId: email.id,
          threadId: email.threadId,
          from: email.from,
          subject: email.subject,
          originalBody: email.body,
          category: decision.category,
          priority: decision.priority,
          draft,
        });

        console.log("📝 Saved for approval:", pending.id);
        console.log("----- DRAFT -----");
        console.log(draft);
        console.log("-----------------");
      }
    }

    if (decision.action === "FLAG_HUMAN") {
      const review = await saveHumanReview({
        emailId: email.id,
        threadId: email.threadId,
        from: email.from,
        subject: email.subject,
        originalBody: email.body,
        category: decision.category,
        priority: decision.priority,
        reason: decision.reason,
      });

      console.log("🚨 Saved for human review:", review.id);
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
