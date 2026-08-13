import fs from "fs/promises";
import path from "path";

const FILE = path.join(process.cwd(), "human-review.json");

async function loadQueue() {
  try {
    const data = await fs.readFile(FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveQueue(queue) {
  await fs.writeFile(
    FILE,
    JSON.stringify(queue, null, 2),
    "utf8"
  );
}

export async function saveHumanReview(item) {
  const queue = await loadQueue();

  const review = {
    id: `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status: "PENDING",
    emailId: item.emailId,
    threadId: item.threadId,
    from: item.from,
    subject: item.subject,
    originalBody: item.originalBody,
    category: item.category,
    priority: item.priority,
    reason: item.reason,
  };

  queue.push(review);

  await saveQueue(queue);

  return review;
}

export async function getHumanReviews() {
  return await loadQueue();
}

export async function removeHumanReview(id) {
  const queue = await loadQueue();

  const updated = queue.filter(
    (item) => item.id !== id
  );

  if (updated.length === queue.length) {
    return false;
  }

  await saveQueue(updated);

  return true;
}

export async function showHumanReviews() {
  const queue = await loadQueue();

  console.log("\n==============================");
  console.log("🚨 HUMAN REVIEW QUEUE");
  console.log("==============================");

  if (queue.length === 0) {
    console.log("✅ No emails waiting for review.");
    return;
  }

  queue.forEach((item, index) => {
    console.log(`\n[${index + 1}] ${item.subject}`);
    console.log(`From: ${item.from}`);
    console.log(`Category: ${item.category}`);
    console.log(`Priority: ${item.priority}`);
    console.log(`Reason: ${item.reason}`);
    console.log(`ID: ${item.id}`);
  });
}
