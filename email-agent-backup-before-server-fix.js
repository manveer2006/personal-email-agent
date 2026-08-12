import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import OpenAI from "openai";

// ============================================
// AI CONNECTION
// ============================================

const ai = new OpenAI({
  apiKey: "ollama",
  baseURL: "http://localhost:11434/v1",
});

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

const CREDENTIALS_PATH = path.join(
  process.cwd(),
  "credentials.json"
);

const PROCESSED_EMAILS_PATH = path.join(
  process.cwd(),
  "processed-emails.json"
);


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
// GET ALL UNREAD EMAILS
// ============================================

async function getUnreadEmails(gmail) {
  console.log(
    "Searching Gmail for unread emails..."
  );

  const response =
    await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX", "UNREAD"],
      maxResults: 10,
    });

  const messages =
    response.data.messages || [];

  console.log(
    `Gmail returned ${messages.length} unread email(s).`
  );

  if (messages.length === 0) {
    return [];
  }

  const emails = [];

  for (
    let i = 0;
    i < messages.length;
    i++
  ) {
    const message = messages[i];

    console.log(
      `Reading email ${i + 1}/${messages.length}...`
    );

    try {
      const messageResponse =
        await gmail.users.messages.get({
          userId: "me",
          id: message.id,
          format: "full",
        });

      const fullMessage =
        messageResponse.data;

      const headers =
        fullMessage.payload?.headers || [];

      emails.push({
        id: fullMessage.id,

        threadId:
          fullMessage.threadId,

        internalDate:
          fullMessage.internalDate,

        from:
          findHeader(headers, "From"),

        subject:
          findHeader(headers, "Subject"),

        date:
          findHeader(headers, "Date"),

        body:
          extractBody(
            fullMessage.payload
          ),

        payload:
          fullMessage.payload,

        labelIds:
          fullMessage.labelIds || [],
      });

    } catch (error) {
      console.log(
        `⚠️ Could not read email ${message.id}`
      );

      console.log(
        error.message
      );
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

async function getProcessedEmails() {
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

Return exactly this structure:

{
  "summary": "short summary",
  "priority": "LOW",
  "reply_needed": false
}

PRIORITY RULES

HIGH:
Use HIGH when the email is personally relevant or requires the user's attention.

Examples:
- Personal emails
- Emails from friends, family, or acquaintances
- Business emails
- Client/customer communication
- Quotations
- Business proposals
- Meeting requests
- Appointment requests
- Internship/job opportunities
- College administration or important college communication
- Important work communication
- Financial/payment problems
- Complaints
- Legal matters
- Security alerts
- Important deadlines
- Requests from another person that reasonably expect a response
- Any email where ignoring it could cause a problem or missed opportunity

LOW:
Use LOW when the email is mainly informational, promotional, automated, or does not require personal attention.

Examples:
- Advertisements
- Promotions
- Discounts
- Newsletters
- Marketing emails
- Product recommendations
- Amazon promotional emails
- Netflix promotional emails
- Automated notifications
- Receipts
- Order confirmations
- Delivery notifications
- Routine account notifications
- General FYI information
- Automated college assignment notifications that do not require a personal response
- Social media notifications

IMPORTANT:

1. HIGH means the email deserves the user's attention.
2. LOW means the email can normally be ignored.
3. If a real person is asking the user to do something or respond, normally use HIGH.
4. If the sender expects a response, set reply_needed to true.
5. If no response is reasonably needed, set reply_needed to false.
6. A HIGH email can have reply_needed = false.
7. A LOW email should normally have reply_needed = false.
8. Never invent information.
9. Do not decide to send an email.
10. Return the JSON immediately.
11. Do not explain your decision.
12. The response must contain ONLY the JSON object.

EMAIL

From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}

Body:
${cleanEmailBody(email.body)}
`;

  console.log("Sending request to Qwen3...");

  console.log("Sending request to Qwen3...");

  const response = await ai.chat.completions.create({
    model: "qwen3:8b",

    messages: [
      {
        role: "user",
        content: `/no_think

${prompt}`,
      },
    ],

    temperature: 0,
    max_tokens: 1000,

    response_format: {
      type: "json_object",
    },

    extra_body: {
      think: false,
    },
  });

  console.log("Qwen3 response received.");

  console.log(
    "Finish reason:",
    response.choices?.[0]?.finish_reason
  );

  // ============================================
  // GET AI RESPONSE
  // ============================================

  const message =
    response.choices?.[0]?.message;

  const text =
    typeof message?.content === "string"
      ? message.content.trim()
      : "";

  // ============================================
  // CHECK FOR EMPTY RESPONSE
  // ============================================

  if (!text) {
    console.log(
      "\n⚠️ Qwen3 returned an empty response."
    );

    console.log("Full AI message:");
    console.log(message);

    throw new Error(
      "Qwen3 returned an empty response."
    );
  }

  // ============================================
  // CLEAN AI RESPONSE
  // ============================================

  let cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<answer>/gi, "")
    .replace(/<\/answer>/gi, "")
    .trim();

  // ============================================
  // FIND JSON OBJECT
  // ============================================

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

  // ============================================
  // PARSE AND VALIDATE JSON
  // ============================================

  try {
    const result = JSON.parse(cleaned);

    if (
      typeof result.summary !== "string"
    ) {
      throw new Error(
        "summary must be a string."
      );
    }

    if (
      !["LOW", "HIGH"].includes(
        result.priority
      )
    ) {
      throw new Error(
        "priority must be LOW or HIGH."
      );
    }

    if (
      typeof result.reply_needed !== "boolean"
    ) {
      throw new Error(
        "reply_needed must be true or false."
      );
    }

    return {
      summary: result.summary.trim(),
      priority: result.priority,
      reply_needed: result.reply_needed,
    };

  } catch (error) {
    console.log(
      "\n❌ AI returned invalid JSON."
    );

    console.log(
      "Raw Qwen3 response:"
    );

    console.log(text);

    console.log(
      "\nCleaned response:"
    );

    console.log(cleaned);

    throw new Error(
      "AI did not return valid JSON."
    );
  }
}
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

  const prompt = `
Write a professional email reply.

Use the following personal writing style:

${personalStyle}

Rules:

- Be polite and professional.
- Use a proper greeting.
- Keep paragraphs separated by blank lines.
- Directly answer the sender.
- Do not invent facts.
- Keep the reply concise.
- Use "Best regards," followed by:
Manveer Singh Bhalla

Original email:

From: ${email.from}
Subject: ${email.subject}

${cleanEmailBody(email.body)}

Analysis:

${analysis.summary}

Write ONLY the email reply.
Do not add explanations.
Do not use markdown.
`;

  const response =
    await ai.chat.completions.create({
      model: "qwen3:8b",

      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],

      temperature: 0,

      max_tokens: 300,
    });

  return (
    response.choices[0]
      ?.message
      ?.content
      ?.trim() || ""
  );
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
      "Skipping Qwen3 analysis."
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
    "\n🧠 Analyzing with Qwen3..."
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

main().catch((error) => {
  console.error(
    "\nERROR:"
  );

  console.error(error);
});