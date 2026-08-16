import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { google } from "googleapis";
import { loadMemory } from "./agent/memory.js";

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const OPENAI_MODEL = "gpt-5.6";

// ============================================
// GMAIL PERMISSIONS
// ============================================

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

// ============================================
// FILE PATHS
// ============================================




// ============================================
// GMAIL HELPERS
// ============================================

function decodeBase64Url(data) {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function findHeader(headers, name) {
  const header = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );

  return header ? header.value : "";
}

function extractBody(payload) {
  if (!payload) {
    return "";
  }

  if (
    payload.mimeType === "text/plain" &&
    payload.body?.data
  ) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const body = extractBody(part);

      if (body) {
        return body;
      }
    }
  }

  return "";
}

function extractEmailAddress(from) {
  if (!from) {
    return "";
  }

  const match = from.match(/<([^>]+)>/);

  if (match) {
    return match[1].trim();
  }

  return from.trim();
}

// ============================================
// GMAIL CONNECTION
// ============================================

export async function getGmail(accessToken, refreshToken) {
  if (!accessToken) {
    throw new Error("Google access token is missing.");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken || undefined,
  });

  return google.gmail({
    version: "v1",
    auth: oauth2Client,
  });
}

// ============================================
// GET ALL UNREAD EMAILS
// ============================================

export async function getUnreadEmails(gmail) {
  console.log("Searching Gmail for unread emails...");

  const response = await gmail.users.messages.list({
    userId: "me",
    labelIds: ["INBOX"],
    maxResults: 100,
  });

  const messages = response.data.messages || [];

  console.log(`Gmail returned ${messages.length} unread email(s).`);

  if (messages.length === 0) return [];

  const results = await Promise.all(
    messages.map(async (message, index) => {
      console.log(`Reading email ${index + 1}/${messages.length}...`);
      try {
        const messageResponse = await gmail.users.messages.get({
          userId: "me",
          id: message.id,
          format: "full",
        });

        const fullMessage = messageResponse.data;
        const headers = fullMessage.payload?.headers || [];

        return {
          id: fullMessage.id,
          threadId: fullMessage.threadId,
          internalDate: fullMessage.internalDate,
          from: findHeader(headers, "From"),
          subject: findHeader(headers, "Subject"),
          date: findHeader(headers, "Date"),
          body: extractBody(fullMessage.payload),
          payload: fullMessage.payload,
          labelIds: fullMessage.labelIds || [],
        };
      } catch (error) {
        console.log(`⚠️ Could not read email ${message.id}`);
        console.log(error.message);
        return null;
      }
    })
  );

  const emails = results.filter(Boolean);
  console.log(`Finished reading ${emails.length} email(s).`);
  return emails;
}

// ============================================
// GET LIGHTWEIGHT UNREAD EMAIL SUMMARIES
// ============================================
// Used by the desktop dashboard. Metadata only means
// the UI does not download full message bodies/payloads.

export async function getUnreadEmailSummaries(gmail) {
  console.log("Searching Gmail for lightweight unread emails...");

  const response = await gmail.users.messages.list({
    userId: "me",
    labelIds: ["INBOX"],
    maxResults: 100,
  });

  const messages = response.data.messages || [];
  if (messages.length === 0) return [];

  const results = await Promise.all(
    messages.map(async (message) => {
      try {
        const messageResponse = await gmail.users.messages.get({
          userId: "me",
          id: message.id,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });

        const data = messageResponse.data;
        const headers = data.payload?.headers || [];

        return {
          id: data.id || "",
          threadId: data.threadId || "",
          from: findHeader(headers, "From"),
          subject: findHeader(headers, "Subject"),
          date: findHeader(headers, "Date"),
          labelIds: data.labelIds || [],
        };
      } catch (error) {
        console.log(`⚠️ Could not read email summary ${message.id}`);
        console.log(error.message);
        return null;
      }
    })
  );

  return results.filter(Boolean);
}

// ============================================
// PROCESSED EMAIL DATABASE
// ============================================

export async function getProcessedEmails() {
  try {
    const data = await fs.readFile(
      PROCESSED_EMAILS_PATH,
      "utf-8"
    );

    const parsed = JSON.parse(data);

    if (Array.isArray(parsed)) {
      return {
        replied: parsed,
        ignored: [],
        attention: [],
      };
    }

    return {
      replied: Array.isArray(parsed.replied)
        ? parsed.replied
        : [],

      ignored: Array.isArray(parsed.ignored)
        ? parsed.ignored
        : [],

      attention: Array.isArray(parsed.attention)
        ? parsed.attention
        : [],
    };

  } catch {
    return {
      replied: [],
      ignored: [],
      attention: [],
    };
  }
}

async function saveProcessedEmails(data) {
  await fs.writeFile(
    PROCESSED_EMAILS_PATH,
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

async function getEmailStatus(emailId) {
  const data = await getProcessedEmails();

  if (data.replied.includes(emailId)) {
    return "replied";
  }

  if (data.ignored.includes(emailId)) {
    return "ignored";
  }

  if (data.attention.includes(emailId)) {
    return "attention";
  }

  return null;
}

async function markAsReplied(emailId) {
  const data = await getProcessedEmails();

  data.replied = data.replied.filter(
    (id) => id !== emailId
  );

  data.ignored = data.ignored.filter(
    (id) => id !== emailId
  );

  data.attention = data.attention.filter(
    (id) => id !== emailId
  );

  data.replied.push(emailId);

  await saveProcessedEmails(data);
}

async function markAsIgnored(emailId) {
  const data = await getProcessedEmails();

  data.replied = data.replied.filter(
    (id) => id !== emailId
  );

  data.ignored = data.ignored.filter(
    (id) => id !== emailId
  );

  data.attention = data.attention.filter(
    (id) => id !== emailId
  );

  data.ignored.push(emailId);

  await saveProcessedEmails(data);
}

async function markAsAttention(emailId) {
  const data = await getProcessedEmails();

  data.replied = data.replied.filter(
    (id) => id !== emailId
  );

  data.ignored = data.ignored.filter(
    (id) => id !== emailId
  );

  data.attention = data.attention.filter(
    (id) => id !== emailId
  );

  data.attention.push(emailId);

  await saveProcessedEmails(data);
}

// CHECK GMAIL CONVERSATION FOR EXISTING REPLY
// ============================================

async function hasReplyAlreadyBeenSent(
  gmail,
  email
) {
  if (!email.threadId) {
    return false;
  }

  try {
    const threadResponse =
      await gmail.users.threads.get({
        userId: "me",
        id: email.threadId,
        format: "full",
      });

    const messages =
      threadResponse.data.messages || [];

    const incomingTime =
      Number(
        email.internalDate || 0
      );

    for (const message of messages) {
      const labels =
        message.labelIds || [];

      if (!labels.includes("SENT")) {
        continue;
      }

      const sentTime =
        Number(
          message.internalDate || 0
        );

      if (sentTime > incomingTime) {
        return true;
      }
    }

    return false;

  } catch (error) {
    console.log(
      "Could not check Gmail conversation history."
    );

    console.log(
      error.message
    );

    return false;
  }
}

// ============================================
// PERSONAL WRITING STYLE
// ============================================

async function getPersonalStyle() {
  try {
    return await fs.readFile(
      path.join(
        process.cwd(),
        "personal-style.txt"
      ),
      "utf-8"
    );
  } catch {
    return "";
  }
}

// ============================================
// CLEAN EMAIL BODY
// ============================================

function cleanEmailBody(body) {
  if (!body) {
    return "";
  }

  let cleaned = body;

  // Remove HTML tags
  cleaned =
    cleaned.replace(
      /<[^>]*>/g,
      " "
    );

  // Remove URLs
  cleaned =
    cleaned.replace(
      /https?:\/\/\S+/gi,
      " "
    );

  // Remove excessive whitespace
  cleaned =
    cleaned.replace(
      /\s+/g,
      " "
    );

  // Limit email size
  const MAX_LENGTH = 6000;

  if (
    cleaned.length > MAX_LENGTH
  ) {
    cleaned =
      cleaned.substring(
        0,
        MAX_LENGTH
      ) +
      "\n[Email truncated]";
  }

  return cleaned.trim();
}

// ============================================
// FAST PROMOTIONAL FILTER
// ============================================

function isObviouslyLowPriority(email) {
  const from =
    email.from.toLowerCase();

  const subject =
    email.subject.toLowerCase();

  const promotionalWords = [
    "unsubscribe",
    "discount",
    "sale",
    "deal",
    "offer",
    "promotion",
    "newsletter",
    "special offer",
    "limited time",
    "% off",
    "shop now",
    "buy now",
    "rejoin",
    "save",
  ];

  const promotionalSenderWords = [
    "newsletter",
    "marketing",
    "store-news",
    "promo",
    "offers",
    "beehiiv",
  ];

  const subjectLooksPromotional =
    promotionalWords.some(
      (word) =>
        subject.includes(word)
    );

  const senderLooksPromotional =
    promotionalSenderWords.some(
      (word) =>
        from.includes(word)
    );

  return (
    subjectLooksPromotional ||
    senderLooksPromotional
  );
}



// ============================================
// AI ANALYSIS
// ============================================

export async function analyzeEmail(email) {
  const prompt = `
Analyze this email.

Return ONLY valid JSON. No markdown, no code fences, no <think> tags, no explanation.

Return exactly:
{
  "summary": "short summary",
  "priority": "LOW",
  "reply_needed": false
}

HIGH means personally relevant or requiring attention: personal emails, business/client messages, college communication, job/internship opportunities, payments, complaints, deadlines, security alerts, meeting requests, or anything where ignoring it could cause a problem.

LOW means promotional, marketing, newsletter, advertisement, automated notification, receipt, delivery notification, routine notification, or general FYI.

If a real person expects a response, reply_needed should be true.
Do not invent information.

EMAIL
From: ${email.from || ""}
Subject: ${email.subject || ""}
Date: ${email.date || ""}

Body:
${cleanEmailBody(email.body || "")}
`;

  console.log("Sending request to OpenAI...");

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    input: prompt,
  });

  let text = response.output_text;

  text = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.substring(firstBrace, lastBrace + 1);
  }

  try {
    const result = JSON.parse(text);

    return {
      summary:
        typeof result.summary === "string"
          ? result.summary.trim()
          : "No summary available.",
      priority:
        result.priority === "HIGH" ? "HIGH" : "LOW",
      reply_needed:
        result.reply_needed === true,
    };
  } catch (error) {
    console.error("OpenAI invalid JSON:", text);
    throw new Error("OpenAI returned invalid JSON.");
  }
}

// ============================================
// GENERATE PERSONALIZED REPLY
// ============================================

export async function generateReply(email, analysis, feedback = "", currentDraft = "") {
  const personalStyle = await getPersonalStyle();
  const memory = await loadMemory();

  const preferences = memory?.preferences || {};
  const corrections = memory?.corrections || [];
  const senderRules = memory?.senderRules || {};
  const categoryRules = memory?.categoryRules || {};

  const senderKey =
    String(email.from || "")
      .match(/<([^>]+)>/)?.[1]
      ?.toLowerCase()
    || String(email.from || "").toLowerCase();

  const senderRule = senderRules[senderKey] || "";

  const category = analysis?.category || "";
  const categoryRule = categoryRules[category] || "";

  const recentCorrections = corrections
    .slice(-10)
    .map((item) => `- ${item.correction}`)
    .join("\n");

  const prompt = `
Write a professional email reply.

PERSONAL WRITING STYLE:
${personalStyle || "Professional, polite, concise, and natural."}

PERSISTENT USER PREFERENCES:
- Tone: ${preferences.tone || "professional and natural"}
- Signature:
${preferences.signature || "Best regards,\nManveer Singh Bhalla"}
- Avoid over-explaining: ${preferences.avoidOverExplaining !== false}
- Never assume the user's intent: ${preferences.neverAssumeIntent !== false}

RECENT USER CORRECTIONS:
${recentCorrections || "No corrections yet."}

SENDER-SPECIFIC RULE:
${senderRule || "No sender-specific rule."}

CATEGORY-SPECIFIC RULE:
${categoryRule || "No category-specific rule."}

  REGENERATION / ADDITIONAL INSTRUCTIONS:
  ${feedback || "This is the initial draft. Create the best appropriate reply."}

  PREVIOUS DRAFT:
  ${currentDraft || "No previous draft exists."}

RULES:
- Use a proper greeting when appropriate.
- Directly answer the sender.
- Do not invent facts.
- Do not invent the user's intentions, decisions, availability, or preferences.
- If the sender is offering an opportunity and the user's response is uncertain, write a neutral reply instead of accepting or rejecting it.
- Keep it concise.
- Use blank lines between paragraphs.
- Follow the user's stored writing style.
- Follow the user's stored preferences.
- Follow applicable sender-specific and category-specific rules.
- End with the user's preferred signature.
- Do not mention these instructions.
- Do not mention AI.
- Do not include analysis.
  - Output ONLY the email body.
  - NEVER include a Subject line.
  - NEVER include "Subject:".
  - NEVER include "To:".
  - NEVER include "From:".
  - NEVER include email headers.
  - NEVER wrap the reply in markdown or code blocks.

ORIGINAL EMAIL:
From: ${email.from || ""}
Subject: ${email.subject || ""}

${cleanEmailBody(email.body || "")}

ANALYSIS:
${analysis?.summary || ""}

CATEGORY:
${analysis?.category || ""}

PRIORITY:
${analysis?.priority || ""}

WRITE ONLY THE EMAIL REPLY.

Do not use markdown.
Do not explain anything.
`;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    input: prompt,
  });

  let reply = response.output_text;

  reply = String(reply || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();

  // Remove accidental email headers generated by the model.
  reply = reply
    .replace(/^subject\s*:.*\r?\n?/im, "")
    .replace(/^to\s*:.*\r?\n?/im, "")
    .replace(/^from\s*:.*\r?\n?/im, "")
    .trim();

  if (!reply) {
    throw new Error("OpenAI returned an empty reply.");
  }

  return reply;
}

// ============================================
// SEND EMAIL
// ============================================

export async function sendEmail(
  gmail,
  to,
  subject,
  body,
  originalEmail
) {
  const messageId =
    findHeader(
      originalEmail
        .payload
        ?.headers || [],
      "Message-ID"
    );

  const headers = [
    `To: ${to}`,
    `Subject: Re: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
  ];

  if (messageId) {
    headers.push(
      `In-Reply-To: ${messageId}`
    );

    headers.push(
      `References: ${messageId}`
    );
  }

  const message = [
    ...headers,
    "",
    body,
  ].join("\r\n");

  const encodedMessage =
    Buffer.from(message)
      .toString("base64url");

  const result =
    await gmail.users.messages.send({
      userId: "me",

      requestBody: {
        raw: encodedMessage,

        threadId:
          originalEmail.threadId,
      },
    });

  return result.data;
}

// ============================================
// ASK USER FOR APPROVAL
// ============================================

async function askForApproval() {
  const rl =
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  const answer =
    await rl.question(
      "\nSend this email? (y/n): "
    );

  rl.close();

  return answer
    .trim()
    .toLowerCase();
}

// ============================================
// PROCESS ONE EMAIL
// ============================================

async function processEmail(
  gmail,
  email,
  number,
  total
) {
  console.log(
    "\n\n================================="
  );

  console.log(
    `EMAIL ${number} OF ${total}`
  );

  console.log(
    "================================="
  );

  console.log(
    "From:",
    email.from
  );

  console.log(
    "Subject:",
    email.subject
  );

  console.log(
    "Date:",
    email.date
  );

  console.log(
    "Email ID:",
    email.id
  );

  // ------------------------------------------
  // LOCAL STATUS CHECK
  // ------------------------------------------

  const status =
    await getEmailStatus(
      email.id
    );

  if (status === "replied") {
    console.log(
      "\n⏭️ Already replied to."
    );

    console.log(
      "Skipping this email."
    );

    return;
  }

  if (status === "ignored") {
    console.log(
      "\n⏭️ Previously ignored."
    );

    console.log(
      "Skipping this email."
    );

    return;
  }

  if (status === "attention") {
    console.log(
      "\n📌 Previously marked for attention."
    );

    console.log(
      "Skipping this email."
    );

    return;
  }

  // ------------------------------------------
  // GMAIL REPLY CHECK
  // ------------------------------------------

  const alreadyReplied =
    await hasReplyAlreadyBeenSent(
      gmail,
      email
    );

  if (alreadyReplied) {
    console.log(
      "\n📧 Gmail shows that you already replied."
    );

    await markAsReplied(
      email.id
    );

    console.log(
      "Automatically marked as replied."
    );

    console.log(
      "⏭️ Skipping this email."
    );

    return;
  }

  // ------------------------------------------
  // FAST PROMOTIONAL FILTER
  // ------------------------------------------

  if (
    isObviouslyLowPriority(email)
  ) {
    console.log(
      "\n🟢 Obvious promotional/newsletter email."
    );

    console.log(
      "Skipping AI analysis."
    );

    console.log(
      "⏭️ No reply needed."
    );

    await markAsIgnored(
      email.id
    );

    return;
  }

  // ------------------------------------------
  // AI ANALYSIS
  // ------------------------------------------

  console.log(
    "\n🧠 Analyzing with OpenAI..."
  );

  let analysis;

  try {
    analysis =
      await analyzeEmail(
        email
      );

  } catch (error) {
    console.log(
      "\n❌ AI analysis failed."
    );

    console.log(
      error.message
    );

    console.log(
      "Email will NOT be marked as processed."
    );

    return;
  }

  console.log(
    "\nSummary:",
    analysis.summary
  );

  

 console.log(
  "Priority:",
  analysis.priority === "HIGH"
    ? "🔴 HIGH"
    : "🟢 LOW"
);

console.log(
  "Reply needed:",
  analysis.reply_needed ? "YES" : "NO"
);

 // ------------------------------------------
// NO REPLY
// ------------------------------------------

if (
  !analysis.reply_needed
) {
  console.log(
    "\n🔎 No reply is required."
  );

  if (analysis.priority === "HIGH") {
    console.log(
      "⚠️ HIGH PRIORITY — this email still needs your attention."
    );

    await markAsAttention(
      email.id
    );

    console.log(
      "📌 Saved under attention so it will not be processed repeatedly."
    );

  } else {
    await markAsIgnored(
      email.id
    );

    console.log(
      "⏭️ LOW PRIORITY email automatically marked as ignored."
    );
  }

  return;
}

  // ------------------------------------------
  // GENERATE PERSONALIZED REPLY
  // ------------------------------------------

  console.log(
    "\n✍️ Creating personalized reply..."
  );

  let reply;

  try {
    reply =
      await generateReply(
        email,
        analysis
      );

  } catch (error) {
    console.log(
      "\n❌ Reply generation failed."
    );

    console.log(
      error.message
    );

    console.log(
      "Email will NOT be marked as processed."
    );

    return;
  }

  if (!reply) {
    console.log(
      "\n❌ AI returned an empty reply."
    );

    return;
  }

  // ------------------------------------------
  // SHOW DRAFT
  // ------------------------------------------

  console.log(
    "\n---------------------------------"
  );

  console.log(
    "REPLY DRAFT"
  );

  console.log(
    "---------------------------------\n"
  );

  console.log(
    reply
  );

  console.log(
    "\n---------------------------------"
  );

  const recipient =
    extractEmailAddress(
      email.from
    );

  console.log(
    "Recipient:",
    recipient
  );

  // ------------------------------------------
  // APPROVAL
  // ------------------------------------------

  const answer =
    await askForApproval();

  if (
    answer !== "y"
  ) {
    console.log(
      "\n❌ Email not sent."
    );

    console.log(
      "This email remains unprocessed."
    );

    return;
  }

  // ------------------------------------------
  // SEND
  // ------------------------------------------

  console.log(
    "\n📤 Sending email..."
  );

  try {
    const sent =
      await sendEmail(
        gmail,
        recipient,
        email.subject,
        reply,
        email
      );

    console.log(
      "\n✅ EMAIL SENT SUCCESSFULLY!"
    );

    console.log(
      "Message ID:",
      sent.id
    );

    console.log(
      "Recipient:",
      recipient
    );

    await markAsReplied(
      email.id
    );

    console.log(
      "✅ Automatically marked as replied."
    );

  } catch (error) {
    console.log(
      "\n❌ EMAIL COULD NOT BE SENT."
    );

    console.log(
      error.message
    );

    console.log(
      "Email remains unprocessed."
    );
  }
}


// ============================================
// GET ATTENTION EMAILS
// ============================================

export async function getAttentionEmails(gmail) {
  const emails = await getUnreadEmails(gmail);
  const result = [];

  for (const email of emails) {
    const status = await getEmailStatus(email.id);

    if (status === "attention") {
      result.push(email);
    }
  }

  return result;
}


// ============================================
// MAIN
// ============================================

async function main() {
  console.log(
    "================================="
  );

  console.log(
    "      PERSONAL EMAIL AGENT"
  );

  console.log(
    "=================================\n"
  );

  console.log(
    "Connecting to Gmail..."
  );

  const gmail =
    await getGmail();

  console.log(
    "Gmail connected."
  );

  console.log(
    "\nChecking for unread emails..."
  );

  const emails =
    await getUnreadEmails(
      gmail
    );

  if (
    emails.length === 0
  ) {
    console.log(
      "\n✅ No unread emails."
    );

    return;
  }

  console.log(
    `\n📬 ${emails.length} unread email(s) found.`
  );

  // ------------------------------------------
  // PROCESS EACH EMAIL
  // ------------------------------------------

  for (
    let i = 0;
    i < emails.length;
    i++
  ) {
    await processEmail(
      gmail,
      emails[i],
      i + 1,
      emails.length
    );
  }

  // ------------------------------------------
  // FINISHED
  // ------------------------------------------

  console.log(
    "\n\n================================="
  );

  console.log(
    "ALL EMAILS PROCESSED"
  );

  console.log(
    "================================="
  );
}

// ============================================
// ERROR HANDLING
// ============================================

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error("\nERROR:");
    console.error(error);
  });
}
