import readline from "readline";
import {
  getPendingReplies,
  updatePendingReply,
  removePendingReply,
} from "./agent/pending.js";
import {
  approvePendingReply,
} from "./agent/approval.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function main() {
  const pending = await getPendingReplies();

  console.log("\n=================================");
  console.log("📬 EMAIL APPROVAL CENTER");
  console.log("=================================");

  if (pending.length === 0) {
    console.log("No pending replies.");
    rl.close();
    return;
  }

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];

    console.log(`\n[${i + 1}] ${item.subject}`);
    console.log(`From: ${item.from}`);
    console.log(`Category: ${item.category}`);
    console.log(`Priority: ${item.priority}`);

    console.log("\n----- DRAFT -----");
    console.log(item.draft);
    console.log("-----------------");

    console.log("\n1. Approve & Send");
    console.log("2. Edit");
    console.log("3. Reject");
    console.log("4. Skip");

    const choice = await ask("\nChoose an action: ");

    if (choice === "1") {
      console.log("\n📤 Sending approved email...");

      try {
        await approvePendingReply(item.id);
        console.log("✅ Email sent.");
      } catch (error) {
        console.error("❌ Failed to send:", error.message);
      }
    }

    else if (choice === "2") {
      console.log("\nCurrent draft:");
      console.log(item.draft);

      const edited = await ask(
        "\nPaste the new reply:\n"
      );

      if (!edited.trim()) {
        console.log("⚠️ Empty reply. Keeping original.");
        continue;
      }

      await updatePendingReply(item.id, {
        draft: edited.trim(),
      });

      console.log("✅ Draft updated.");
    }

    else if (choice === "3") {
      await removePendingReply(item.id);
      console.log("🗑️ Draft rejected.");
    }

    else {
      console.log("⏭️ Skipped.");
    }
  }

  rl.close();

  console.log("\n=================================");
  console.log("✅ APPROVAL SESSION COMPLETE");
  console.log("=================================");
}

main().catch((error) => {
  console.error("❌ Approval system error:", error);
  rl.close();
  process.exit(1);
});
