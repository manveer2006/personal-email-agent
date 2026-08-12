import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";

// ============================================
// CONFIGURATION
// ============================================

const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_MODEL = "qwen3:8b";
const MAX_EMAIL_BODY = 6000;
const MAX_UNREAD_EMAILS = 10;

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

const PERSONAL_STYLE_PATH = path.join(
  process.cwd(),
  "personal-style.txt"
);

// ============================================
// GMAIL HELPERS
// ============================================

function decodeBase64Url(data) {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function findHeader(headers, name) {
  const header = headers.find(
    (item) =>
      item.name?.toLowerCase() === name.toLowerCase()
  );

  return header ? header.value || "" : "";
}

function extractBody(payload) {
  if (!payload) {
    return "";
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
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

function extractSenderName(from) {
  if (!from) {
    return "";
  }

  const match = from.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);

  if (match) {
    return match[1].trim();
  }

  return "";
}

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
// READ EMAILS
// ============================================

async function getUnreadEmails(gmail) {
  console.log(
    "Searching Gmail for unread emails..."
  );

  const response =
    await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX", "UNREAD"],
      maxResults: MAX_UNREAD_EMAILS,
    });

  const messages =
    response.data.messages || [];

  console.log(
    `Gmail returned ${messages.length} unread email(s).`
  );

  const emails = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    console.log(
      `Reading email ${i + 1}/${messages.length}...`
    );

    try {
      const response =
        await gmail.users.messages.get({
          userId: "me",
          id: message.id,
          format: "full",
        });

      const fullMessage = response.data;
      const headers =
        fullMessage.payload?.headers || [];

      emails.push({
        id: fullMessage.id,
        threadId: fullMessage.threadId || "",
        internalDate:
          fullMessage.internalDate || "",
        from: findHeader(headers, "From"),
        subject: findHeader(headers, "Subject"),
        date: findHeader(headers, "Date"),
        body: extractBody(fullMessage.payload),
        payload: fullMessage.payload,
        labelIds: fullMessage.labelIds || [],
      });
    } catch (error) {
      console.log(
        `⚠️ Could not read email ${message.id}`
      );
      console.log(error.message);
    }
  }

  console.log(
    `Finished reading ${emails.length} email(s).`
  );

  return emails;
}

// ============================================
// PROCESSED EMAIL DATABASE
// ============================================

function emptyDatabase() {
  return {
    replied: [],
    ignored: [],
    attention: [],
    drafted: [],
  };
}

function normalizeDatabase(parsed) {
  const db = emptyDatabase();

  if (Array.isArray(parsed)) {
    db.replied = parsed;
    return db;
  }

  if (!parsed || typeof parsed !== "object") {
    return db;
  }

  for (const key of Object.keys(db)) {
    if (Array.isArray(parsed[key])) {
      db[key] = [...new Set(parsed[key])];
    }
  }

  return db;
}

async function getProcessedEmails() {
  try {
    const data = await fs.readFile(
      PROCESSED_EMAILS_PATH,
      "utf-8"
    );

    return normalizeDatabase(
      JSON.parse(data)
    );
  } catch {
    return emptyDatabase();
  }
}

async function saveProcessedEmails(data) {
  await fs.writeFile(
    PROCESSED_EMAILS_PATH,
    JSON.stringify(
      normalizeDatabase(data),
      null,
      2
    ) + "\n",
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

  if (data.drafted.includes(emailId)) {
    return "drafted";
  }

  return null;
}

async function moveToStatus(emailId, status) {
  const data = await getProcessedEmails();

  for (const key of Object.keys(data)) {
    data[key] = data[key].filter(
      (id) => id !== emailId
    );
  }

  if (!data[status].includes(emailId)) {
    data[status].push(emailId);
  }

  await saveProcessedEmails(data);
}

async function markAsReplied(emailId) {
  await moveToStatus(emailId, "replied");
}

async function markAsIgnored(emailId) {
  await moveToStatus(emailId, "ignored");
}

async function markAsAttention(emailId) {
  await moveToStatus(emailId, "attention");
}

async function markAsDrafted(emailId) {
  await moveToStatus(emailId, "drafted");
}

// ============================================
// GMAIL THREAD REPLY CHECK
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
      Number(email.internalDate || 0);

    for (const message of messages) {
      if (
        !(message.labelIds || []).includes(
          "SENT"
        )
      ) {
        continue;
      }

      const sentTime =
        Number(message.internalDate || 0);

      if (sentTime > incomingTime) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.log(
      "⚠️ Could not check Gmail conversation history."
    );
    console.log(error.message);
    return false;
  }
}

// ============================================
// PERSONAL WRITING STYLE
// ============================================

async function getPersonalStyle() {
  try {
    return await fs.readFile(
      PERSONAL_STYLE_PATH,
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

  let cleaned = String(body);

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

  if (cleaned.length > MAX_EMAIL_BODY) {
    cleaned =
      cleaned.substring(0, MAX_EMAIL_BODY) +
      "\n[Email truncated]";
  }

  return cleaned.trim();
}

// ============================================
// FAST PROMOTIONAL FILTER
// ============================================

function isObviouslyLowPriority(email) {
  const from =
    (email.from || "").toLowerCase();

  const subject =
    (email.subject || "").toLowerCase();

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
    "we found something you might like",
  ];

  const promotionalSenderWords = [
    "newsletter",
    "marketing",
    "store-news",
    "promo",
    "offers",
    "beehiiv",
    "noreply",
    "no-reply",
  ];

  const subjectLooksPromotional =
    promotionalWords.some(
      (word) => subject.includes(word)
    );

  const senderLooksPromotional =
    promotionalSenderWords.some(
      (word) => from.includes(word)
    );

  return (
    subjectLooksPromotional ||
    senderLooksPromotional
  );
}

// ============================================
// OLLAMA REQUEST
// ============================================

async function askOllama({
  messages,
  format = undefined,
  numPredict = 500,
}) {
  let response;

  try {
    response = await fetch(
      OLLAMA_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          stream: false,
          think: false,
          format,
          options: {
            temperature: 0,
            num_predict: numPredict,
          },
          messages,
        }),
      }
    );
  } catch (error) {
    throw new Error(
      `Could not connect to Ollama: ${error.message}`
    );
  }

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Ollama returned HTTP ${response.status}: ${errorText}`
    );
  }

  return response.json();
}

// ============================================
// AI ANALYSIS
// ============================================

async function analyzeEmail(email) {
  const prompt = `
Analyze this email and classify it.

Return ONLY one valid JSON object.

Required JSON:
{
  "summary": "short summary",
  "priority": "LOW",
  "category": "OTHER"
}

ALLOWED PRIORITIES:
LOW
HIGH

ALLOWED CATEGORIES:
PERSONAL
BUSINESS
CLIENT
COLLEGE
INTERNSHIP
JOB
FINANCIAL
SECURITY
COMPLAINT
LEGAL
APPOINTMENT
MEETING
PROMOTION
NEWSLETTER
RECEIPT
AUTOMATED
OTHER

HIGH:
- Personal emails
- Emails from friends, family, or acquaintances
- Business emails
- Client/customer communication
- Quotations
- Business proposals
- Meeting requests
- Appointment requests
- Internship opportunities
- Job opportunities
- Important college administration
- Important work communication
- Financial/payment problems
- Complaints
- Legal matters
- Security alerts
- Important deadlines
- Anything where ignoring it could cause a problem or missed opportunity

LOW:
- Advertisements
- Promotions
- Discounts
- Newsletters
- Marketing emails
- Product recommendations
- Amazon promotional emails
- Netflix promotional emails
- Routine automated notifications
- Receipts
- Order confirmations
- Delivery notifications
- Routine account notifications
- General FYI information
- Routine college assignment notifications
- Routine academic reminders
- Social media notifications

IMPORTANT:
1. HIGH means the email deserves the user's attention.
2. LOW means the email can normally be ignored.
3. An internship/job opportunity should normally be HIGH even if it was sent automatically.
4. Do not confuse a genuine opportunity with a generic advertisement.
5. Never invent information.
6. Do NOT decide whether the user should reply.
7. Do NOT include "reply_needed" in your JSON.
8. The user will decide whether to create and send a reply.
9. Return ONLY the JSON object.
10. Do not output reasoning.
11. Do not use markdown.
12. Do not use code fences.
13. Do not output <think> or <answer> tags.

EMAIL:
From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}

Body:
${cleanEmailBody(email.body)}
`;

  console.log("Sending request to Qwen3...");

  const data = await askOllama({
    messages: [
      {
        role: "user",
        content: `/no_think\n\n${prompt}`,
      },
    ],
    format: {
      type: "object",
      properties: {
        summary: {
          type: "string",
        },
        priority: {
          type: "string",
          enum: ["LOW", "HIGH"],
        },
        category: {
          type: "string",
          enum: [
            "PERSONAL",
            "BUSINESS",
            "CLIENT",
            "COLLEGE",
            "INTERNSHIP",
            "JOB",
            "FINANCIAL",
            "SECURITY",
            "COMPLAINT",
            "LEGAL",
            "APPOINTMENT",
            "MEETING",
            "PROMOTION",
            "NEWSLETTER",
            "RECEIPT",
            "AUTOMATED",
            "OTHER",
          ],
        },
      },
      required: [
        "summary",
        "priority",
        "category",
      ],
    },
    numPredict: 250,
  });

  console.log("Qwen3 response received.");
  console.log("Done reason:", data.done_reason || "unknown");

  const text =
    typeof data.message?.content === "string"
      ? data.message.content.trim()
      : "";

  if (!text) {
    console.log("\n⚠️ Qwen3 returned an empty response.");
    console.log("Full Ollama response:");
    console.log(data);
    throw new Error("Qwen3 returned an empty response.");
  }

  let cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<answer>/gi, "")
    .replace(/<\/answer>/gi, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    cleaned = cleaned.substring(
      firstBrace,
      lastBrace + 1
    );
  }

  try {
    const result = JSON.parse(cleaned);

    const categories = [
      "PERSONAL",
      "BUSINESS",
      "CLIENT",
      "COLLEGE",
      "INTERNSHIP",
      "JOB",
      "FINANCIAL",
      "SECURITY",
      "COMPLAINT",
      "LEGAL",
      "APPOINTMENT",
      "MEETING",
      "PROMOTION",
      "NEWSLETTER",
      "RECEIPT",
      "AUTOMATED",
      "OTHER",
    ];

    if (
      typeof result.summary !== "string" ||
      !result.summary.trim()
    ) {
      throw new Error(
        "summary must be a non-empty string."
      );
    }

    if (!["LOW", "HIGH"].includes(result.priority)) {
      throw new Error(
        "priority must be LOW or HIGH."
      );
    }

    if (!categories.includes(result.category)) {
      throw new Error("Invalid category.");
    }

    return {
      summary: result.summary.trim(),
      priority: result.priority,
      category: result.category,
    };
  } catch (error) {
    console.log("\n❌ AI returned invalid JSON.");
    console.log("Raw Qwen3 response:");
    console.log(text);
    console.log("\nCleaned response:");
    console.log(cleaned);

    throw new Error(
      "AI did not return valid JSON."
    );
  }
}

// ============================================
// GENERATE PERSONALIZED REPLY
// ============================================

async function generateReply(
  email,
  analysis
) {
  const personalStyle =
    await getPersonalStyle();

  const senderName =
    extractSenderName(email.from);

  const prompt = `
Write a professional email reply FROM the user TO the original sender.

CRITICAL:
- The user is Manveer Singh Bhalla.
- Manveer is the recipient of the original email.
- The reply must be written FROM Manveer.
- NEVER greet Manveer.
- NEVER write "Hi Manveer" unless the original sender explicitly addressed Manveer and the context genuinely requires repeating it.
- Address the original sender or organization.
- If the sender's personal name is known, you may use it.
- If only an organization/team is apparent, use a suitable greeting such as "Hello Team" or "Hello [Organization] Team".
- Do not invent the sender's name.
- Do not invent facts, dates, prices, commitments, approvals, or promises.
- Respond to what the original sender actually said.
- If the email is asking for information that Manveer does not have, politely acknowledge it without inventing an answer.
- Keep the reply natural, concise and professional.
- Output ONLY the email body.
- No markdown.
- No code fences.
- No explanation.
- Do not include a subject.
- End with:

Best regards,
Manveer Singh Bhalla

PERSONAL WRITING STYLE:
${personalStyle || "Natural, polite, professional and concise."}

SENDER:
${email.from}

SUBJECT:
${email.subject}

ORIGINAL EMAIL:
${cleanEmailBody(email.body)}

AI SUMMARY:
${analysis.summary}

CATEGORY:
${analysis.category}

Write the reply now.
`;

  console.log(
    "Sending reply-generation request to Qwen3..."
  );

  const data = await askOllama({
    messages: [
      {
        role: "user",
        content:
          `/no_think\n\n${prompt}`,
      },
    ],
    numPredict: 500,
  });

  console.log(
    "Reply-generation response received."
  );

  console.log(
    "Reply done reason:",
    data.done_reason || "unknown"
  );

  let reply =
    typeof data.message?.content ===
    "string"
      ? data.message.content.trim()
      : "";

  if (!reply) {
    console.log(
      "\n⚠️ Qwen3 did not return reply content."
    );
    console.log(data);

    throw new Error(
      "Qwen3 returned an empty reply."
    );
  }

  reply = reply
    .replace(
      /^```(?:text|email)?\s*/i,
      ""
    )
    .replace(/\s*```$/i, "")
    .replace(
      /^<answer>\s*/i,
      ""
    )
    .replace(
      /\s*<\/answer>$/i,
      ""
    )
    .trim();

  // Prevent the known self-greeting problem.
  const lowerReply =
    reply.toLowerCase();

  if (
    lowerReply.startsWith("hi manveer") ||
    lowerReply.startsWith("hello manveer") ||
    lowerReply.startsWith("dear manveer")
  ) {
    reply =
      "Hello,\n\n" +
      reply.substring(
        reply.indexOf("\n") + 1
      ).trim();
  }

  if (!reply) {
    throw new Error(
      "Qwen3 returned an empty cleaned reply."
    );
  }

  return reply;
}

// ============================================
// SEND EMAIL
// ============================================

async function sendEmail(
  gmail,
  to,
  subject,
  body,
  originalEmail
) {
  const messageId =
    findHeader(
      originalEmail.payload?.headers ||
        [],
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
// USER INPUT
// ============================================

async function askQuestion(
  question
) {
  const rl =
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  try {
    return (
      await rl.question(question)
    )
      .trim()
      .toLowerCase();
  } finally {
    rl.close();
  }
}

async function askYesNo(question) {
  while (true) {
    const answer =
      await askQuestion(question);

    if (
      answer === "y" ||
      answer === "yes"
    ) {
      return true;
    }

    if (
      answer === "n" ||
      answer === "no"
    ) {
      return false;
    }

    console.log(
      "Please enter y or n."
    );
  }
}

// ============================================
// EDIT REPLY
// ============================================

async function editReply(
  currentReply
) {
  console.log(
    "\nCurrent reply:"
  );
  console.log(
    "---------------------------------"
  );
  console.log(currentReply);
  console.log(
    "---------------------------------"
  );

  console.log(
    "\nEnter the edited reply."
  );
  console.log(
    "When finished, type a line containing only:"
  );
  console.log("END");

  const rl =
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  const lines = [];

  try {
    while (true) {
      const line =
        await rl.question("");

      if (
        line.trim() === "END"
      ) {
        break;
      }

      lines.push(line);
    }
  } finally {
    rl.close();
  }

  const edited =
    lines.join("\n").trim();

  if (!edited) {
    console.log(
      "⚠️ Empty edit. Keeping the previous draft."
    );
    return currentReply;
  }

  return edited;
}

// ============================================
// REPLY MENU
// ============================================

async function handleReplyDraft(
  gmail,
  email,
  analysis,
  initialReply
) {
  let reply = initialReply;

  while (true) {
    console.log(
      "\n================================="
    );
    console.log(
      "REPLY OPTIONS"
    );
    console.log(
      "================================="
    );
    console.log(
      "1. Send this reply"
    );
    console.log(
      "2. Edit reply"
    );
    console.log(
      "3. Regenerate reply"
    );
    console.log(
      "4. Cancel"
    );

    console.log(
      "\nCurrent draft:"
    );
    console.log(
      "---------------------------------"
    );
    console.log(reply);
    console.log(
      "---------------------------------"
    );

    const choice =
      await askQuestion(
        "\nChoose 1-4: "
      );

    if (choice === "1") {
      const confirm =
        await askYesNo(
          "\nSend this reply now? (y/n): "
        );

      if (!confirm) {
        console.log(
          "\n❌ Reply not sent."
        );
        await markAsAttention(
          email.id
        );
        return "cancelled";
      }

      const recipient =
        extractEmailAddress(
          email.from
        );

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

        return "sent";
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

        return "send_failed";
      }
    }

    if (choice === "2") {
      reply = await editReply(
        reply
      );

      console.log(
        "\n✏️ Updated draft:"
      );
      console.log(
        "---------------------------------"
      );
      console.log(reply);
      console.log(
        "---------------------------------"
      );

      continue;
    }

    if (choice === "3") {
      console.log(
        "\n🔄 Regenerating reply..."
      );

      try {
        reply =
          await generateReply(
            email,
            analysis
          );

        console.log(
          "\n✅ New draft generated."
        );
      } catch (error) {
        console.log(
          "\n❌ Regeneration failed."
        );
        console.log(
          error.message
        );
      }

      continue;
    }

    if (choice === "4") {
      console.log(
        "\n❌ Reply cancelled."
      );

      await markAsAttention(
        email.id
      );

      return "cancelled";
    }

    console.log(
      "Invalid choice. Please select 1, 2, 3, or 4."
    );
  }
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
  const skipAttention =
    options.skipAttention || false;

  console.log("\n\n=================================");
  console.log(`EMAIL ${number} OF ${total}`);
  console.log("=================================");

  console.log("From:", email.from);
  console.log("Subject:", email.subject);
  console.log("Date:", email.date);
  console.log("Email ID:", email.id);

  const status = await getEmailStatus(email.id);

  if (status === "replied") {
    console.log("\n⏭️ Already replied to.");
    console.log("Skipping this email.");
    return;
  }

  if (status === "ignored" && !options.force) {
    console.log("\n⏭️ Previously ignored.");
    console.log("Skipping this email.");
    return;
  }

  if (status === "attention" && !skipAttention) {
    console.log("\n📌 Previously marked for attention.");
    console.log("Use: node email-agent.js attention");
    console.log("Skipping this email.");
    return;
  }

  if (status === "drafted" && !options.force) {
    console.log("\n📌 A reply draft already exists for this email.");
    console.log("Skipping this email.");
    return;
  }

  const alreadyReplied =
    await hasReplyAlreadyBeenSent(gmail, email);

  if (alreadyReplied) {
    console.log("\n📧 Gmail shows that you already replied.");

    await markAsReplied(email.id);

    console.log("Automatically marked as replied.");
    return;
  }

  if (isObviouslyLowPriority(email)) {
    console.log("\n🟢 Obvious promotional/automated email.");
    console.log("Skipping Qwen3 analysis.");
    console.log("⏭️ LOW PRIORITY — no reply required.");

    await markAsIgnored(email.id);
    return;
  }

  console.log("\n🧠 Analyzing with Qwen3...");

  let analysis;

  try {
    analysis = await analyzeEmail(email);
  } catch (error) {
    console.log("\n❌ AI analysis failed.");
    console.log(error.message);
    console.log("Email will NOT be marked as processed.");
    return;
  }

  console.log("\nSummary:", analysis.summary);

  console.log(
    "Priority:",
    analysis.priority === "HIGH"
      ? "🔴 HIGH"
      : "🟢 LOW"
  );

  console.log("Category:", analysis.category);

  // IMPORTANT:
  // Qwen3 classifies the email, but it NEVER decides whether a reply
  // should be created. The user makes that decision below.
  if (analysis.priority === "LOW") {
    console.log("\n⏭️ LOW PRIORITY.");
    console.log("No reply will be created.");

    await markAsIgnored(email.id);
    return;
  }

  console.log(
    "\n📨 This email has been classified as HIGH PRIORITY."
  );

  const createReply = await askYesNo(
    "\nDo you want me to create a reply to this email? (y/n): "
  );

  if (!createReply) {
    console.log("\n❌ Reply was not created.");
    console.log("📌 Email remains under attention.");

    await markAsAttention(email.id);
    return;
  }

  console.log("\n✍️ Creating personalized reply...");

  let reply;

  try {
    reply = await generateReply(email, analysis);
  } catch (error) {
    console.log("\n❌ Reply generation failed.");
    console.log(error.message);

    await markAsAttention(email.id);
    return;
  }

  if (!reply) {
    console.log("\n❌ AI returned an empty reply.");

    await markAsAttention(email.id);
    return;
  }

  console.log("\n📨 PERSONALIZED REPLY DRAFT");
  console.log("---------------------------------");
  console.log(reply);
  console.log("---------------------------------");

  const recipient = extractEmailAddress(email.from);

  console.log("Recipient:", recipient);

  await markAsDrafted(email.id);

  const result = await handleReplyDraft(
    gmail,
    email,
    analysis,
    reply
  );

  if (result === "sent") {
    console.log("✅ Email workflow completed.");
  } else {
    console.log(
      "📌 Email remains available in attention."
    );
  }
}

// ============================================
// ATTENTION INBOX
// ============================================

async function getAttentionEmails(
  gmail
) {
  const data =
    await getProcessedEmails();

  const ids = [
    ...new Set(data.attention),
  ];

  if (ids.length === 0) {
    return [];
  }

  const emails = [];

  for (const id of ids) {
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
        threadId:
          full.threadId || "",
        internalDate:
          full.internalDate || "",
        from:
          findHeader(headers, "From"),
        subject:
          findHeader(headers, "Subject"),
        date:
          findHeader(headers, "Date"),
        body:
          extractBody(full.payload),
        payload:
          full.payload,
        labelIds:
          full.labelIds || [],
      });
    } catch (error) {
      console.log(
        `⚠️ Could not load attention email ${id}`
      );
      console.log(
        error.message
      );
    }
  }

  return emails;
}

async function showAttentionInbox(
  gmail
) {
  const emails =
    await getAttentionEmails(
      gmail
    );

  console.log(
    "\n\n================================="
  );
  console.log(
    "📌 ATTENTION INBOX"
  );
  console.log(
    "================================="
  );

  if (emails.length === 0) {
    console.log(
      "\nNo emails are currently waiting for your attention."
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

  console.log(
    "\nUse:"
  );
  console.log(
    "node email-agent.js attention"
  );
  console.log(
    "to process these emails."
  );
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

  if (emails.length === 0) {
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
    const email =
      emails[i];

    console.log(
      `\n[${i + 1}/${emails.length}]`
    );

    await processEmail(
      gmail,
      email,
      i + 1,
      emails.length,
      {
        skipAttention: true,
        force: false,
      }
    );
  }
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
    await showAttentionInbox(
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
      "Use:"
    );
    console.log(
      "  node email-agent.js"
    );
    console.log(
      "  node email-agent.js attention"
    );
    console.log(
      "  node email-agent.js list-attention"
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

main().catch((error) => {
  console.error(
    "\n❌ ERROR:"
  );
  console.error(
    error
  );
});
