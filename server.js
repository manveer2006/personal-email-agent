import express from "express";
import cors from "cors";

import {
  getGmail,
  getUnreadEmails,
  getAttentionEmails,
  analyzeEmail,
  generateReply,
} from "./email-agent.js";

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
  res.json({
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

app.listen(3000, "127.0.0.1", () => {
  console.log(
    "🚀 Email Agent API running on http://127.0.0.1:3000"
  );
});