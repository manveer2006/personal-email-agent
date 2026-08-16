
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

import {
  getGmail,
  getUnreadEmails,
  getAttentionEmails,
  analyzeEmail,
  analyzeEmailsBatch,
  generateReply,
  getEmailStatus,
  markAsIgnored,
  markAsAttention,
  isObviouslyLowPriority,
} from "./email-agent.js";

import {
  getPendingReplies,
  savePendingReply,
  updatePendingReply,
  removePendingReply,
} from "./agent/pending.js";

import {
  getHumanReviews,
  removeHumanReview,
} from "./agent/human-review\.js";

const app = express();

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// ============================================
// AUTHENTICATED GMAIL CONNECTION
// ============================================

function getRequestSupabaseClient(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Supabase authorization token.");
  }

  const accessToken = authHeader.substring("Bearer ".length).trim();

  if (!accessToken) {
    throw new Error("Invalid authorization token.");
  }

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  );
}

async function getAuthenticatedUser(req) {
  const userSupabase = getRequestSupabaseClient(req);

  const {
    data: { user },
    error,
  } = await userSupabase.auth.getUser();

  if (error || !user) {
    throw new Error("Invalid or expired Supabase session.");
  }

  return {
    user,
    supabase: userSupabase,
  };
}

async function getClient(req) {
  const { user, supabase: userSupabase } =
    await getAuthenticatedUser(req);

  const { data: connection, error } = await userSupabase
    .from("gmail_connections")
    .select(
      "google_email, access_token, refresh_token, token_expiry"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Gmail connection lookup error:", error);
    throw new Error("Failed to load Gmail connection.");
  }

  if (!connection) {
    throw new Error(
      "Gmail is not connected. Please sign in with Google again."
    );
  }

  const gmail = await getGmail(
    connection.access_token,
    connection.refresh_token
  );

  return {
    gmail,
    user,
  };
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
// GOOGLE AUTHENTICATION
// ============================================

app.post("/api/auth/google", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Missing Supabase authorization token.",
      });
    }

    const supabaseAccessToken =
      authHeader.substring("Bearer ".length).trim();

    if (!supabaseAccessToken) {
      return res.status(401).json({
        success: false,
        error: "Invalid Supabase authorization token.",
      });
    }

    const userSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${supabaseAccessToken}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await userSupabase.auth.getUser();

    if (userError || !user) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired Supabase session.",
      });
    }

    const { serverAuthCode } = req.body || {};

    if (!serverAuthCode) {
      return res.status(400).json({
        success: false,
        error: "serverAuthCode is required.",
      });
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({
        success: false,
        error: "Google OAuth credentials are not configured on Render.",
      });
    }

    console.log("Exchanging Google authorization code...");

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    );

    const { tokens } = await oauth2Client.getToken(serverAuthCode);

    if (!tokens.access_token) {
      return res.status(500).json({
        success: false,
        error: "Google did not return an access token.",
      });
    }

    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({
      version: "v1",
      auth: oauth2Client,
    });

    const profile = await gmail.users.getProfile({
      userId: "me",
    });

    const googleEmail = profile.data.emailAddress || "";

    if (!googleEmail) {
      return res.status(500).json({
        success: false,
        error: "Unable to determine Gmail address.",
      });
    }

    const connectionData = {
      user_id: user.id,
      google_email: googleEmail,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    };

    const { data: existing, error: lookupError } = await userSupabase
      .from("gmail_connections")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (lookupError) {
      console.error("Gmail connection lookup error:", lookupError);

      return res.status(500).json({
        success: false,
        error: "Failed to check Gmail connection.",
      });
    }

    let saveError = null;

    if (existing) {
      const result = await userSupabase
        .from("gmail_connections")
        .update(connectionData)
        .eq("id", existing.id);

      saveError = result.error;
    } else {
      const result = await userSupabase
        .from("gmail_connections")
        .insert(connectionData);

      saveError = result.error;
    }

    if (saveError) {
      console.error("Gmail connection save error:", saveError);

      return res.status(500).json({
        success: false,
        error: "Failed to save Gmail connection.",
      });
    }

    console.log(`Gmail connected for ${user.email}: ${googleEmail}`);

    return res.json({
      success: true,
      message: "Gmail connected successfully.",
      googleEmail,
    });
  } catch (error) {
    console.error("Google authentication error:", error);

    return res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Google authentication failed.",
    });
  }
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

    const client = await getClient(req);

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

    const client = await getClient(req);

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

    const client = await getClient(req);

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

    const client = await getClient(req);

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

// ============================================
// PROCESS EMAILS FOR DASHBOARD
// ============================================

async function processDashboardEmails(gmail, emails) {
  const results = {
    promotions: [],
    attention: [],
    drafts: [],
    errors: [],
  };

  // ----------------------------------------
  // STEP 1 — CHECK STATUS + FAST FILTER
  // ----------------------------------------

  const emailsForAI = [];

  for (const email of emails) {
    try {
      const existingStatus = await getEmailStatus(email.id);

      if (
        existingStatus === "replied" ||
        existingStatus === "ignored" ||
        existingStatus === "attention"
      ) {
        continue;
      }

      // Fast promotional filter.
      if (isObviouslyLowPriority(email)) {
        await markAsIgnored(email.id);

        results.promotions.push(email);

        continue;
      }

      emailsForAI.push(email);

    } catch (error) {
      console.error(
        `Pre-processing failed for email ${email.id}:`,
        error
      );

      results.errors.push({
        emailId: email.id,
        subject: email.subject || "",
        error:
          error.message ||
          "Failed to prepare email for processing.",
      });
    }
  }

  // Nothing left for Gemini.
  if (emailsForAI.length === 0) {
    return results;
  }

  // ----------------------------------------
  // STEP 2 — ONE BATCH GEMINI ANALYSIS
  // ----------------------------------------

  console.log(
    `🧠 Starting Gemini batch analysis for ${emailsForAI.length} emails...`
  );

  let analyses;

  try {
    analyses = await analyzeEmailsBatch(
      emailsForAI
    );

    console.log(
      `✅ Gemini batch analysis completed for ${analyses.size} emails.`
    );

  } catch (error) {
    console.error(
      "❌ Gemini batch analysis failed:",
      error
    );

    for (const email of emailsForAI) {
      results.errors.push({
        emailId: email.id,
        subject: email.subject || "",
        error:
          error.message ||
          "Gemini batch analysis failed.",
      });
    }

    return results;
  }

  // ----------------------------------------
  // STEP 3 — PROCESS EACH ANALYSIS
  // ----------------------------------------

  for (const email of emailsForAI) {
    try {
      const analysis = analyses.get(email.id);

      if (!analysis) {
        throw new Error(
          "No Gemini analysis returned for this email."
        );
      }

      console.log(
        `Gemini result: ${email.subject || "(No subject)"} | ${analysis.priority} | reply=${analysis.reply_needed}`
      );

      // ----------------------------------------
      // LOW PRIORITY
      // ----------------------------------------

      if (analysis.priority !== "HIGH") {
        await markAsIgnored(email.id);

        results.promotions.push({
          ...email,
          analysis,
        });

        continue;
      }

      // ----------------------------------------
      // HIGH PRIORITY — NO REPLY
      // ----------------------------------------

      if (!analysis.reply_needed) {
        await markAsAttention(email.id);

        results.attention.push({
          ...email,
          analysis,
        });

        continue;
      }

      // ----------------------------------------
      // HIGH PRIORITY — REPLY NEEDED
      // ----------------------------------------

      console.log(
        `✍️ Generating Gemini draft: ${email.subject || "(No subject)"}`
      );

      const draft = await generateReply(
        email,
        analysis
      );

      if (!draft || !draft.trim()) {
        throw new Error(
          "Gemini generated an empty draft."
        );
      }

      // ----------------------------------------
      // SAVE DRAFT
      // ----------------------------------------

      const savedDraft = await savePendingReply({
        emailId: email.id,
        threadId: email.threadId || "",
        from: email.from || "",
        subject: email.subject || "",
        originalBody: email.body || "",
        category: analysis.category || "OTHER",
        priority: analysis.priority || "HIGH",
        draft: draft.trim(),
      });

      results.drafts.push(savedDraft);

      await markAsAttention(email.id);

    } catch (error) {
      console.error(
        `Dashboard processing failed for email ${email.id}:`,
        error
      );

      results.errors.push({
        emailId: email.id,
        subject: email.subject || "",
        error:
          error.message ||
          "Failed to process email.",
      });
    }
  }

  return results;
}

// ============================================
// DASHBOARD DATA
// ============================================

app.get("/api/dashboard", async (req, res) => {
  try {
    const { gmail } = await getClient(req);

    // Get unread inbox emails.
    const emails = await getUnreadEmails(gmail);

    // Process emails through the JABI/Gemini pipeline.
    const processed =
      await processDashboardEmails(
        gmail,
        emails
      );

    // Load the latest saved data after processing.
    const attention =
      await getAttentionEmails(gmail);

    const pendingReplies =
      await getPendingReplies();

    const humanReviews =
      await getHumanReviews();

    const ignoredCount =
      processed.promotions.length;

    const draftCount =
      pendingReplies.length;

    const attentionCount =
      attention.length +
      humanReviews.length;

    res.json({
      success: true,

      stats: {
        emailsProcessed: emails.length,

        automaticallyHandled:
          ignoredCount,

        needsAttention:
          attentionCount,

        draftsWaiting:
          draftCount,

        promotions:
          ignoredCount,
      },

      attention: [
        ...attention,
        ...humanReviews,
      ],

      drafts: pendingReplies,

      recentEmails:
        emails.slice(0, 10).map(
          (email) => ({
            id: email.id || "",
            threadId:
              email.threadId || "",
            from:
              email.from || "",
            subject:
              email.subject || "",
            date:
              email.date || "",
            body:
              cleanEmailBody(
                email.body || ""
              ),
          })
        ),

      processing: {
        promotions:
          processed.promotions.length,

        attention:
          processed.attention.length,

        drafts:
          processed.drafts.length,

        errors:
          processed.errors.length,
      },
    });

  } catch (error) {
    console.error(
      "Dashboard API error:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "Failed to load dashboard.",
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
