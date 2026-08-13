import {
  getPendingReplies,
  removePendingReply,
} from "./pending.js";

import {
  getGmail,
  sendEmail,
} from "../email-agent.js";

export async function showPendingReplies() {
  const pending = await getPendingReplies();

  console.log("\n==============================");
  console.log("📋 PENDING EMAIL APPROVALS");
  console.log("==============================");

  if (pending.length === 0) {
    console.log("No pending replies.");
    return;
  }

  pending.forEach((item, index) => {
    console.log(`\n[${index + 1}] ${item.subject}`);
    console.log(`From: ${item.from}`);
    console.log(`Category: ${item.category}`);
    console.log(`Priority: ${item.priority}`);
    console.log("----- DRAFT -----");
    console.log(item.draft);
    console.log("-----------------");
    console.log(`ID: ${item.id}`);
  });
}

export async function rejectPendingReply(id) {
  const removed = await removePendingReply(id);

  if (!removed) {
    console.log("❌ Pending reply not found.");
    return false;
  }

  console.log("🗑️ Reply rejected and removed.");
  return true;
}

export async function approvePendingReply(id) {
  const pending = await getPendingReplies();

  const item = pending.find(
    (reply) => reply.id === id
  );

  if (!item) {
    throw new Error("Pending reply not found.");
  }

  console.log("🔐 Connecting to Gmail...");

  const gmail = await getGmail();

  console.log("📤 Sending approved reply...");

  const originalEmail = {
    id: item.emailId,
    threadId: item.threadId,
    from: item.from,
    subject: item.subject,
    payload: {
      headers: [],
    },
  };

  const result = await sendEmail(
    gmail,
    item.from,
    item.subject,
    item.draft,
    originalEmail
  );

  await removePendingReply(id);

  console.log("✅ Reply sent successfully.");
  console.log(`📨 Gmail message ID: ${result.id}`);

  return result;
}
