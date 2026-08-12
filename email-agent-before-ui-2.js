import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import OpenAI from "openai";

// ============================================
// CONFIGURATION
// ============================================

const OLLAMA_MODEL = "qwen3:8b";
const OLLAMA_BASE_URL = "http://localhost:11434/v1";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

const CREDENTIALS_PATH = path.join(
  process.cwd(),
  "credentials.json"
);

const PROCESSED_EMAILS_PATH = path.join(
  process.cwd(),
  "processed-emails.json"
);

const ai = new OpenAI({
  apiKey: "ollama",
  baseURL: OLLAMA_BASE_URL,
});

// ============================================
// FILE / DATABASE HELPERS
// ============================================

function emptyDatabase() {
  return {
    replied: [],
    ignored: [],
    attention: [],
  };
}

async function getProcessedEmails() {
  try {
    const data = await fs.readFile(
      PROCESSED_EMAILS_PATH,
      "utf8"
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
    return emptyDatabase();
  }
}

async function saveProcessedEmails(data) {
  await fs.writeFile(
    PROCESSED_EMAILS_PATH,
    JSON.stringify(data, null, 2),
    "utf8"
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

// ============================================
// GMAIL HELPERS
// ============================================

function decodeBase64Url(data) {
  return Buffer
    .from(data, "base64url")
    .toString("utf8");
}

function findHeader(headers, name) {
  const header = headers.find(
    (item) =>
      item.name?.toLowerCase() ===
      name.toLowerCase()
  );

  return header?.value || "";
}

function extractBody(payload) {
  if (!payload) {
    return "";
  }

  if (payload.body?.data) {
    return decodeBase64Url(
      payload.body.data
    );
  }

  if (Array.isArray(payload.parts)) {
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

function cleanEmailBody(body) {
  if (!body) {
    return "";
  }

  let cleaned = body;

  cleaned = cleaned.replace(
    /<[^>]*>/g,
    " "
  );

  cleaned = cleaned.replace(
    /https?:\/\/\S+/gi,
    " "
  );

  cleaned = cleaned.replace(
    /\s+/g,
    " "
  );

  if (cleaned.length > 6000) {
    cleaned =
      cleaned.substring(0, 6000) +
      "\n[Email truncated]";
  }

  return cleaned.trim();
}

// ============================================
// GMAIL CONNECTION
// ============================================

async function getGmail() {
  const auth = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  return google.gmail({
    version: "v1",
    auth,
  });
}

// ============================================
// GET UNREAD EMAILS
// ============================================

async function getUnreadEmails(gmail) {
  const response =
    await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX", "UNREAD"],
      maxResults: 10,
    });

  const messages =
    response.data.messages || [];

  const emails = [];

  for (const message of messages) {
    try {
      const response =
        await gmail.users.messages.get({
          userId: "me",
          id: message.id,
          format: "full",
        });

      const full =
        response.data;

      const headers =
        full.payload?.headers || [];

      emails.push({
        id: full.id,
        threadId: full.threadId || "",
        internalDate:
          full.internalDate || "",
        from: findHeader(
          headers,
          "From"
        ),
        subject: findHeader(
          headers,
          "Subject"
        ),
        date: findHeader(
          headers,
          "Date"
        ),
        body: extractBody(
          full.payload
        ),
        payload: full.payload,
        labelIds:
          full.labelIds || [],
      });
    } catch (error) {
      console.log(
        `Could not read email ${message.id}:`,
        error.message
      );
    }
  }

  return emails;
}

// ============================================
// GET ATTENTION EMAILS
// ============================================

async function getAttentionEmails(gmail) {
  const database =
    await getProcessedEmails();

  const emails = [];

  for (const id of database.attention) {
    try {
      const response =
        await gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });

      const full =
        response.data;

      const headers =
        full.payload?.headers || [];

      emails.push({
        id: full.id,
        threadId: full.threadId || "",
        internalDate:
          full.internalDate || "",
        from: findHeader(
          headers,
          "From"
        ),
        subject: findHeader(
          headers,
          "Subject"
        ),
        date: findHeader(
          headers,
          "Date"
        ),
        body: extractBody(
          full.payload
        ),
        payload: full.payload,
        labelIds:
          full.labelIds || [],
      });
    } catch (error) {
      console.log(
        `Could not load attention email ${id}:`,
        error.message
      );
    }
  }

  return emails;
}

// ============================================
// FAST PROMOTIONAL FILTER
// ============================================

function isObviouslyLowPriority(email) {
  const from =
    email.from.toLowerCase();

  const subject =
    email.subject.toLowerCase();

  const words = [
    "unsubscribe",
    "discount",
    "sale",
    "deal",
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

  const senderWords = [
    "newsletter",
    "marketing",
    "store-news",
    "promo",
    "offers",
    "beehiiv",
  ];

  return (
    words.some((word) =>
      subject.includes(word)
    ) ||
    senderWords.some((word) =>
      from.includes(word)
    )
  );
}

// ============================================
// AI ANALYSIS
// ============================================

async function analyzeEmail(email) {
  const prompt = `
Analyze this email.

Return ONLY valid JSON.

Do not explain anything.
Do not use markdown.
Do not use code fences.
Do not use <think> tags.
Do not use <answer> tags.
Do not include reasoning.

Return exactly:

{
  "summary": "short summary",
  "priority": "LOW"
}

PRIORITY RULES

HIGH:
- Personal emails
- Important business emails
- Client/customer communication
- Internship/job opportunities
- College administration
- Financial problems
- Complaints
- Legal matters
- Security alerts
- Important deadlines
- Anything that deserves the user's attention

LOW:
- Advertisements
- Promotions
- Discounts
- Newsletters
- Marketing
- Product recommendations
- Receipts
- Order confirmations
- Delivery notifications
- Routine automated notifications
- General FYI information

IMPORTANT:

The AI must NOT decide whether a reply should be created.

The user will decide that separately.

Return ONLY JSON.

EMAIL

From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}

Body:
${cleanEmailBody(email.body)}
`;

  console.log(
    "Sending request to Qwen3..."
  );

  const response =
    await ai.chat.completions.create({
      model: OLLAMA_MODEL,

      messages: [
        {
          role: "user",
          content:
            `/no_think\n\n${prompt}`,
        },
      ],

      temperature: 0,
      max_tokens: 500,

      response_format: {
        type: "json_object",
      },

      extra_body: {
        think: false,
      },
    });

  console.log(
    "Qwen3 response received."
  );

  const message =
    response.choices?.[0]?.message;

  let text =
    typeof message?.content === "string"
      ? message.content.trim()
      : "";

  if (!text) {
    throw new Error(
      "Qwen3 returned an empty response."
    );
  }

  text = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(
      /<think>[\s\S]*?<\/think>/gi,
      ""
    )
    .trim();

  const firstBrace =
    text.indexOf("{");

  const lastBrace =
    text.lastIndexOf("}");

  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    text = text.substring(
      firstBrace,
      lastBrace + 1
    );
  }

  const result =
    JSON.parse(text);

  if (
    typeof result.summary !==
    "string"
  ) {
    throw new Error(
      "Invalid summary."
    );
  }

  if (
    !["LOW", "HIGH"].includes(
      result.priority
    )
  ) {
    throw new Error(
      "Invalid priority."
    );
  }

  return {
    summary:
      result.summary.trim(),
    priority:
      result.priority,
  };
}

// ============================================
// PERSONAL STYLE
// ============================================

async function getPersonalStyle() {
  try {
    return await fs.readFile(
      path.join(
        process.cwd(),
        "personal-style.txt"
      ),
      "utf8"
    );
  } catch {
    return "";
  }
}

// ============================================
// GENERATE REPLY
// ============================================

async function generateReply(
  email,
  analysis
) {
  const style =
    await getPersonalStyle();

  const prompt = `
Write a professional email reply.

Personal writing style:

${style}

Rules:

- Be polite.
- Be professional.
- Use a natural greeting.
- Directly respond to the original email.
- Do not invent facts.
- Keep it concise.
- Do not mention AI.
- End with:

Best regards,
Manveer Singh Bhalla

Original email:

From: ${email.from}
Subject: ${email.subject}

${cleanEmailBody(email.body)}

Analysis:

${analysis.summary}

Write ONLY the email reply.
`;

  console.log(
    "Sending reply-generation request to Qwen3..."
  );

  const response =
    await ai.chat.completions.create({
      model: OLLAMA_MODEL,

      messages: [
        {
          role: "user",
          content:
            `/no_think\n\n${prompt}`,
        },
      ],

      temperature: 0.2,
      max_tokens: 300,

      extra_body: {
        think: false,
      },
    });

  console.log(
    "Reply-generation response received."
  );

  return (
    response.choices?.[0]?.message
      ?.content?.trim() || ""
  );
}

// ============================================
// CHECK EXISTING REPLY
// ============================================

async function hasReplyAlreadyBeenSent(
  gmail,
  email
) {
  if (!email.threadId) {
    return false;
  }

  try {
    const response =
      await gmail.users.threads.get({
        userId: "me",
        id: email.threadId,
        format: "full",
      });

    const messages =
      response.data.messages || [];

    const incomingTime =
      Number(
        email.internalDate || 0
      );

    for (const message of messages) {
      if (
        !(message.labelIds || [])
          .includes("SENT")
      ) {
        continue;
      }

      const sentTime =
        Number(
          message.internalDate || 0
        );

      if (
        sentTime > incomingTime
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

// ============================================
// SEND EMAIL
// ============================================

async function sendEmail(
  gmail,
  email,
  reply
) {
  const to =
    extractEmailAddress(
      email.from
    );

  const messageId =
    findHeader(
      email.payload?.headers || [],
      "Message-ID"
    );

  const headers = [
    `To: ${to}`,
    `Subject: Re: ${email.subject}`,
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

  const rawMessage = [
    ...headers,
    "",
    reply,
  ].join("\r\n");

  const encoded =
    Buffer.from(rawMessage)
      .toString("base64url");

  const response =
    await gmail.users.messages.send({
      userId: "me",

      requestBody: {
        raw: encoded,
        threadId:
          email.threadId,
      },
    });

  return response.data;
}

// ============================================
// ASK YES / NO
// ============================================

async function askYesNo(question) {
  const rl =
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  const answer =
    await rl.question(question);

  rl.close();

  return (
    answer.trim().toLowerCase() ===
    "y"
  );
}

// ============================================
// PROCESS EMAIL
// ============================================

async function processEmail(
  gmail,
  email,
  number,
  total,
  options = {}
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

  const status =
    await getEmailStatus(
      email.id
    );

  if (
    status === "replied"
  ) {
    console.log(
      "\n⏭️ Already replied to."
    );
    return;
  }

  if (
    status === "ignored" &&
    !options.force
  ) {
    console.log(
      "\n⏭️ Previously ignored."
    );
    return;
  }

  if (
    status === "attention" &&
    !options.force
  ) {
    console.log(
      "\n📌 Previously marked for attention."
    );

    console.log(
      "Use: node email-agent.js attention"
    );

    return;
  }

  if (
    await hasReplyAlreadyBeenSent(
      gmail,
      email
    )
  ) {
    await markAsReplied(
      email.id
    );

    console.log(
      "\n📧 Gmail shows you already replied."
    );

    return;
  }

  if (
    isObviouslyLowPriority(email)
  ) {
    console.log(
      "\n🟢 Promotional/automated email."
    );

    console.log(
      "Skipping AI analysis."
    );

    await markAsIgnored(
      email.id
    );

    return;
  }

  console.log(
    "\n🧠 Analyzing with Qwen3..."
  );

  let analysis;

  try {
    analysis =
      await analyzeEmail(email);
  } catch (error) {
    console.log(
      "\n❌ AI analysis failed."
    );

    console.log(
      error.message
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

  if (
    analysis.priority === "LOW"
  ) {
    console.log(
      "\n⏭️ LOW PRIORITY."
    );

    await markAsIgnored(
      email.id
    );

    return;
  }

  console.log(
    "\n📨 HIGH PRIORITY EMAIL"
  );

  // ==========================================
  // USER DECIDES WHETHER TO CREATE REPLY
  // ==========================================

  const createReply =
    await askYesNo(
      "\nDo you want me to create a reply to this email? (y/n): "
    );

  if (!createReply) {
    console.log(
      "\n📌 Reply not created."
    );

    await markAsAttention(
      email.id
    );

    return;
  }

  // ==========================================
  // GENERATE REPLY
  // ==========================================

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

    await markAsAttention(
      email.id
    );

    return;
  }

  if (!reply) {
    console.log(
      "\n❌ AI returned an empty reply."
    );

    await markAsAttention(
      email.id
    );

    return;
  }

  console.log(
    "\n================================="
  );

  console.log(
    "PERSONALIZED REPLY"
  );

  console.log(
    "=================================\n"
  );

  console.log(reply);

  console.log(
    "\n================================="
  );

  // ==========================================
  // USER DECIDES WHETHER TO SEND
  // ==========================================

  const send =
    await askYesNo(
      "\nSend this reply? (y/n): "
    );

  if (!send) {
    console.log(
      "\n❌ Reply not sent."
    );

    await markAsAttention(
      email.id
    );

    return;
  }

  console.log(
    "\n📤 Sending reply..."
  );

  try {
    const sent =
      await sendEmail(
        gmail,
        email,
        reply
      );

    console.log(
      "\n✅ EMAIL SENT SUCCESSFULLY!"
    );

    console.log(
      "Message ID:",
      sent.id
    );

    await markAsReplied(
      email.id
    );

  } catch (error) {
    console.log(
      "\n❌ EMAIL COULD NOT BE SENT."
    );

    console.log(
      error.message
    );

    await markAsAttention(
      email.id
    );
  }
}

// ============================================
// PROCESS ATTENTION EMAILS
// ============================================

async function processAttentionEmails(
  gmail
) {
  const emails =
    await getAttentionEmails(
      gmail
    );

  if (
    emails.length === 0
  ) {
    console.log(
      "\n📌 No attention emails."
    );

    return;
  }

  console.log(
    `\n📌 ${emails.length} email(s) require attention.`
  );

  for (
    let i = 0;
    i < emails.length;
    i++
  ) {
    await processEmail(
      gmail,
      emails[i],
      i + 1,
      emails.length,
      {
        force: true,
      }
    );
  }
}

// ============================================
// LIST ATTENTION EMAILS
// ============================================

async function listAttentionEmails(
  gmail
) {
  const emails =
    await getAttentionEmails(
      gmail
    );

  console.log(
    "\n================================="
  );

  console.log(
    "📌 ATTENTION INBOX"
  );

  console.log(
    "================================="
  );

  if (
    emails.length === 0
  ) {
    console.log(
      "\nNo emails require attention."
    );

    return;
  }

  for (
    let i = 0;
    i < emails.length;
    i++
  ) {
    const email =
      emails[i];

    console.log(
      `\n${i + 1}. ${email.subject}`
    );

    console.log(
      `   From: ${email.from}`
    );

    console.log(
      `   Date: ${email.date}`
    );

    console.log(
      `   ID: ${email.id}`
    );
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log(
    "\n================================="
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

  const command =
    process.argv[2] || "unread";

  if (
    command === "attention"
  ) {
    await processAttentionEmails(
      gmail
    );

    return;
  }

  if (
    command === "list-attention"
  ) {
    await listAttentionEmails(
      gmail
    );

    return;
  }

  if (
    command !== "unread"
  ) {
    console.log(
      "\nUnknown command."
    );

    console.log(
      "\nUse:"
    );

    console.log(
      "node email-agent.js"
    );

    console.log(
      "node email-agent.js attention"
    );

    console.log(
      "node email-agent.js list-attention"
    );

    return;
  }

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

  console.log(
    "\n================================="
  );

  console.log(
    "ALL EMAILS PROCESSED"
  );

  console.log(
    "================================="
  );
}

// ============================================
// RUN CLI ONLY WHEN FILE IS EXECUTED DIRECTLY
// ============================================

const currentFile =
  fileURLToPath(import.meta.url);

const executedFile =
  process.argv[1]
    ? path.resolve(process.argv[1])
    : "";

if (
  executedFile === currentFile
) {
  main().catch((error) => {
    console.error(
      "\n❌ ERROR:"
    );

    console.error(
      error
    );
  });
}

// ============================================
// EXPORTS FOR SERVER.JS
// ============================================

export {
  getGmail,
  getUnreadEmails,
  getAttentionEmails,
  analyzeEmail,
  generateReply,
  sendEmail,
  getEmailStatus,
  markAsReplied,
  markAsIgnored,
  markAsAttention,
  processEmail,
};
