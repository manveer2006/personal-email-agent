import express from "express";
import cors from "cors";

import {
  getGmail,
  getUnreadEmails,
  getAttentionEmails,
  analyzeEmail,
  generateReply,
} from "./email-agent.js";

import {
  getPendingReplies,
  updatePendingReply,
  removePendingReply,
} from "./agent/pending.js";

import {
  getHumanReviews,
  removeHumanReview,
} from "./agent/human-review.js";

const app = express();

app.use(cors());
app.use(express.json());

let gmail = null;

// ============================================
// GMAIL CONNECTION
// ============================================

async function getClient() {
  if (!gmail) {
    console.log("Connecting to Gmail...");

    gmail = await getGmail();

    console.log("Gmail connected.");
  }

  return gmail;
}

// ============================================
// HEALTH
// ============================================

app.get("/api/health", (req, res) => {
  console.log("✅ HEALTH ROUTE HIT");

  res.status(200).json({
    success: true,
    message: "Email Agent API is running",
  });
});

// ============================================
// CLEAN EMAIL BODY
// ============================================

function cleanEmailBody(body) {
  return String(body)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 5000);
}

// ============================================
// EXTRACT EMAIL ADDRESS
// ============================================

function extractEmailAddress(value) {
  if (!value) {
    return "";
  }

  const text = String(value);

  // Example:
  // John Smith <john@example.com>
  const bracketMatch = text.match(/<([^>]+)>/);

  if (bracketMatch) {
    return bracketMatch[1].trim();
  }

  // Example:
  // john@example.com
  const emailMatch = text.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  );

  if (emailMatch) {
    return emailMatch[0].trim();
  }

  return text.trim();
}

// ============================================
// UNREAD EMAILS
// ============================================

app.get("/api/emails", async (req, res) => {
  try {
    console.log("Fetching unread Gmail emails...");

    const client = await getClient();

    const emails = await getUnreadEmails(client);

    console.log(`Found ${emails.length} unread email(s).`);

    const cleanEmails = emails.map((email) => ({
      id: email.id || "",
      threadId: email.threadId || "",
      from: email.from || "",
      subject: email.subject || "",
      date: email.date || "",
      body: cleanEmailBody(email.body || ""),
    }));

    res.json({
      success: true,
      emails: cleanEmails,
    });
  } catch (error) {
    console.error("Email API error:", error);

    res.status(500).json({
      success: false,
      error: error.message || "Failed to load emails.",
    });
  }
});

// ============================================
// ATTENTION EMAILS
// ============================================

app.get("/api/attention", async (req, res) => {
  try {
    console.log("Fetching attention emails...");

    const client = await getClient();

    const emails = await getAttentionEmails(client);

    const cleanEmails = emails.map((email) => ({
      id: email.id || "",
      threadId: email.threadId || "",
      from: email.from || "",
      subject: email.subject || "",
      date: email.date || "",
      body: cleanEmailBody(email.body || ""),
    }));

    res.json({
      success: true,
      emails: cleanEmails,
    });
  } catch (error) {
    console.error("Attention API error:", error);

    res.status(500).json({
      success: false,
      error: error.message || "Failed to load attention emails.",
    });
  }
});

// ============================================
// AI EMAIL ANALYSIS
// ============================================

app.post("/api/analyze", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required.",
      });
    }

    console.log("Analyzing email with Qwen3...");

    const cleanedEmail = {
      ...email,
      body: cleanEmailBody(email.body || ""),
    };

    const analysis = await analyzeEmail(cleanedEmail);

    console.log("Email analysis completed.");

    return res.json({
      success: true,
      analysis,
    });
  } catch (error) {
    console.error("Analyze API error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Failed to analyze email.",
    });
  }
});

// ============================================
// GENERATE EMAIL REPLY
// ============================================

app.post("/api/reply", async (req, res) => {
  try {
    console.log("Generating email reply...");

    const {
      email,
      analysis,
      feedback = "",
    } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email data is required.",
      });
    }

    const cleanedEmail = {
      ...email,
      body: cleanEmailBody(email.body || ""),
    };

    const reply = await generateReply(
      cleanedEmail,
      analysis || {},
      feedback || ""
    );

    console.log("Email reply generated.");

    return res.json({
      success: true,
      reply,
    });
  } catch (error) {
    console.error("Reply API error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Failed to generate reply.",
    });
  }
});

// ============================================
// SEND EMAIL REPLY
// ============================================

app.post("/api/send-reply", async (req, res) => {
  try {
    console.log("Preparing to send Gmail reply...");

    const {
      email,
      reply,
    } = req.body;

    // ----------------------------------------
    // VALIDATION
    // ----------------------------------------

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email data is required.",
      });
    }

    if (!reply || !String(reply).trim()) {
      return res.status(400).json({
        success: false,
        error: "Reply message is empty.",
      });
    }

    // ----------------------------------------
    // GET GMAIL CLIENT
    // ----------------------------------------

    const client = await getClient();

    // ----------------------------------------
    // GET RECIPIENT
    // ----------------------------------------

    const recipient = extractEmailAddress(email.from);

    if (!recipient) {
      return res.status(400).json({
        success: false,
        error: "Could not determine recipient email address.",
      });
    }

    console.log(`Reply recipient: ${recipient}`);

    // ----------------------------------------
    // SUBJECT
    // ----------------------------------------

    const originalSubject =
      email.subject || "No subject";

    const replySubject =
      /^re:/i.test(originalSubject)
        ? originalSubject
        : `Re: ${originalSubject}`;

    // ----------------------------------------
    // BUILD EMAIL
    // ----------------------------------------

    const emailLines = [
      `To: ${recipient}`,
      `Subject: ${replySubject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      String(reply).trim(),
    ];

    const rawEmail = emailLines.join("\r\n");

    // ----------------------------------------
    // ENCODE FOR GMAIL API
    // ----------------------------------------

    const encodedEmail = Buffer
      .from(rawEmail, "utf8")
      .toString("base64url");

    // ----------------------------------------
    // SEND THROUGH GMAIL
    // ----------------------------------------

    const sendRequest = {
      userId: "me",
      requestBody: {
        raw: encodedEmail,
      },
    };

    // Keep the reply in the same Gmail thread
    // when a threadId is available.
    if (email.threadId) {
      sendRequest.requestBody.threadId = email.threadId;
    }

    const result = await client.users.messages.send(
      sendRequest
    );

    console.log("Gmail reply sent successfully.");
    console.log("Message ID:", result.data.id);

    // ----------------------------------------
    // RESPONSE
    // ----------------------------------------

    return res.json({
      success: true,
      message: "Reply sent successfully.",
      messageId: result.data.id || "",
      threadId: result.data.threadId || email.threadId || "",
    });
  } catch (error) {
    console.error("Send reply error:", error);

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Failed to send Gmail reply.",
    });
  }
});


// ============================================
// DRAFT REPLY APIs
// ============================================

// Get all pending drafts
app.get("/api/drafts", async (req, res) => {
  try {
    const drafts = await getPendingReplies();

    res.json({
      success: true,
      drafts,
    });
  } catch (error) {
    console.error("Drafts API error:", error);

    res.status(500).json({
      success: false,
      error: error.message || "Failed to load drafts.",
    });
  }
});


// Update/edit a draft
app.patch("/api/drafts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { draft } = req.body;

    if (!draft || !String(draft).trim()) {
      return res.status(400).json({
        success: false,
        error: "Draft reply cannot be empty.",
      });
    }

    const updated = await updatePendingReply(id, {
      draft: String(draft).trim(),
    });

    res.json({
      success: true,
      draft: updated,
    });
  } catch (error) {
    console.error("Update draft error:", error);

    res.status(500).json({
      success: false,
      error: error.message || "Failed to update draft.",
    });
  }
});


// Regenerate AI reply
app.post("/api/drafts/:id/regenerate", async (req, res) => {
  try {
    const { id } = req.params;
    const { feedback = "" } = req.body || {};

    const drafts = await getPendingReplies();

    const pending = drafts.find(
      (item) => item.id === id
    );

    if (!pending) {
      return res.status(404).json({
        success: false,
        error: "Draft not found.",
      });
    }

    const email = {
      id: pending.emailId,
      threadId: pending.threadId,
      from: pending.from,
      subject: pending.subject,
      body: pending.originalBody,
    };

    const analysis = {
      category: pending.category,
      priority: pending.priority,
    };

    console.log(
      `Regenerating reply for draft ${id}...`
    );

    const reply = await generateReply(
      email,
      analysis,
      feedback
    );

    const updated = await updatePendingReply(id, {
      draft: reply,
    });

    res.json({
      success: true,
      draft: updated,
      reply,
    });
  } catch (error) {
    console.error(
      "Regenerate draft error:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "Failed to regenerate reply.",
    });
  }
});


// Approve and send draft
app.post("/api/drafts/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;

    const drafts = await getPendingReplies();

    const pending = drafts.find(
      (item) => item.id === id
    );

    if (!pending) {
      return res.status(404).json({
        success: false,
        error: "Draft not found.",
      });
    }

    if (!pending.draft || !pending.draft.trim()) {
      return res.status(400).json({
        success: false,
        error: "Draft reply is empty.",
      });
    }

    const client = await getClient();

    const recipient =
      extractEmailAddress(pending.from);

    if (!recipient) {
      return res.status(400).json({
        success: false,
        error:
          "Could not determine recipient email address.",
      });
    }

    const originalSubject =
      pending.subject || "No subject";

    const replySubject =
      /^re:/i.test(originalSubject)
        ? originalSubject
        : `Re: ${originalSubject}`;

    const rawEmail = [
      `To: ${recipient}`,
      `Subject: ${replySubject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      pending.draft.trim(),
    ].join("\r\n");

    const encodedEmail = Buffer
      .from(rawEmail, "utf8")
      .toString("base64url");

    const requestBody = {
      raw: encodedEmail,
    };

    if (pending.threadId) {
      requestBody.threadId = pending.threadId;
    }

    const result =
      await client.users.messages.send({
        userId: "me",
        requestBody,
      });

    // Only remove the draft AFTER Gmail confirms success.
    await removePendingReply(id);

    res.json({
      success: true,
      message: "Reply approved and sent.",
      messageId: result.data.id || "",
      threadId:
        result.data.threadId ||
        pending.threadId ||
        "",
    });
  } catch (error) {
    console.error(
      "Approve draft error:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "Failed to approve and send draft.",
    });
  }
});


// Reject/delete draft
app.delete("/api/drafts/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const removed = await removePendingReply(id);

    if (!removed) {
      return res.status(404).json({
        success: false,
        error: "Draft not found.",
      });
    }

    res.json({
      success: true,
      message: "Draft rejected.",
    });
  } catch (error) {
    console.error(
      "Reject draft error:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "Failed to reject draft.",
    });
  }
});



// ============================================
// HUMAN REVIEW APIs
// ============================================

// Get pending human reviews
app.get("/api/reviews", async (req, res) => {
  try {
    const reviews = await getHumanReviews();

    res.json({
      success: true,
      reviews,
    });
  } catch (error) {
    console.error(
      "Reviews API error:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "Failed to load reviews.",
    });
  }
});


// Resolve a human review
app.delete("/api/reviews/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const removed =
      await removeHumanReview(id);

    if (!removed) {
      return res.status(404).json({
        success: false,
        error: "Review item not found.",
      });
    }

    res.json({
      success: true,
      message: "Review resolved.",
    });
  } catch (error) {
    console.error(
      "Resolve review error:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "Failed to resolve review.",
    });
  }
});


// ============================================
// DASHBOARD DATA
// ============================================



app.get("/api/dashboard", async (req, res) => {
  try {
    const client = await getClient();

    const emails = await getUnreadEmails(client);
    const attention = await getAttentionEmails(client);
    const pendingReplies = await getPendingReplies();
    const humanReviews = await getHumanReviews();

    res.json({
      success: true,
      stats: {
        emailsProcessed: emails.length,
        automaticallyHandled:
          emails.length -
          attention.length -
          pendingReplies.length,
        needsAttention: humanReviews.length,
        draftsWaiting: pendingReplies.length,
      },

      attention: humanReviews,

      drafts: pendingReplies,

      recentEmails: emails.slice(0, 10).map((email) => ({
        id: email.id || "",
        threadId: email.threadId || "",
        from: email.from || "",
        subject: email.subject || "",
        date: email.date || "",
        body: cleanEmailBody(email.body || ""),
      })),
    });
  } catch (error) {
    console.error("Dashboard API error:", error);

    res.status(500).json({
      success: false,
      error: error.message || "Failed to load dashboard.",
    });
  }
});


// ============================================
// 404 API HANDLER
// ============================================

app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  res.status(500).json({
    success: false,
    error: error.message || "Internal server error.",
  });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Email Agent API running on http://127.0.0.1:${PORT}`);
});

server.on("error", (error) => {
  console.error("❌ Server error:", error);
});

server.on("close", () => {
  console.log("⚠️ HTTP server closed");
});