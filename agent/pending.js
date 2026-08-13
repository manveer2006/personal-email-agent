import fs from "fs/promises";
import path from "path";

const FILE = path.join(process.cwd(), "pending-replies.json");

async function readPending() {
  try {
    const data = await fs.readFile(FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writePending(items) {
  await fs.writeFile(
    FILE,
    JSON.stringify(items, null, 2),
    "utf8"
  );
}

export async function savePendingReply(item) {
  const items = await readPending();

  const existing = items.find(
    (x) => x.emailId === item.emailId
  );

  if (existing) {
    return existing;
  }

  const pending = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    emailId: item.emailId,
    threadId: item.threadId || "",
    from: item.from || "",
    subject: item.subject || "",
    originalBody: item.originalBody || "",
    category: item.category || "OTHER",
    priority: item.priority || "LOW",
    draft: item.draft || "",
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };

  items.push(pending);

  await writePending(items);

  return pending;
}

export async function getPendingReplies() {
  return readPending();
}

export async function deletePendingReply(id) {
  const items = await readPending();

  const filtered = items.filter(
    (item) => item.id !== id
  );

  await writePending(filtered);
}

export async function updatePendingReply(id, updates) {
  const items = await readPending();

  const index = items.findIndex(
    (item) => item.id === id
  );

  if (index === -1) {
    throw new Error("Pending reply not found.");
  }

  items[index] = {
    ...items[index],
    ...updates,
  };

  await writePending(items);

  return items[index];
}

export async function removePendingReply(id) {
  const pending = await getPendingReplies();

  const updated = pending.filter((item) => item.id !== id);

  if (updated.length === pending.length) {
    return false;
  }

  await fs.writeFile(
    FILE,
    JSON.stringify(updated, null, 2),
    "utf8"
  );

  return true;
}
