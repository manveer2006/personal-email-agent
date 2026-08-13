import { removeHumanReview } from "./agent/human-review.js";

const id = process.argv[2];

if (!id) {
  console.log("Usage: npm run approve-human <ID>");
  process.exit(1);
}

const removed = await removeHumanReview(id);

if (removed) {
  console.log("✅ Human review approved and removed from queue.");
} else {
  console.log("❌ Review ID not found.");
}
