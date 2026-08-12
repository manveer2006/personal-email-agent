import path from "node:path";
import process from "node:process";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly"
];

const CREDENTIALS_PATH = path.join(
  process.cwd(),
  "credentials.json"
);

function decodeBase64Url(data) {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function findHeader(headers, name) {
  const header = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );

  return header ? header.value : "";
}

async function main() {
  console.log("Connecting to Gmail...");

  const auth = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  const gmail = google.gmail({
    version: "v1",
    auth,
  });

  console.log("Gmail connection successful!");

  // Get the latest email
  const listResponse = await gmail.users.messages.list({
    userId: "me",
    maxResults: 1,
    labelIds: ["INBOX"],
  });

  const messages = listResponse.data.messages || [];

  if (messages.length === 0) {
    console.log("No emails found.");
    return;
  }

  const messageId = messages[0].id;

  // Get the complete email
  const messageResponse = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const message = messageResponse.data;

  const headers = message.payload.headers || [];

  const from = findHeader(headers, "From");
  const subject = findHeader(headers, "Subject");
  const date = findHeader(headers, "Date");

  console.log("\n==============================");
  console.log("LATEST EMAIL");
  console.log("==============================");

  console.log("From:", from);
  console.log("Subject:", subject);
  console.log("Date:", date);

  console.log("\nMessage:");

  let body = "";

  if (message.payload.body?.data) {
    body = decodeBase64Url(message.payload.body.data);
  } else if (message.payload.parts) {
    const textPart = message.payload.parts.find(
      (part) => part.mimeType === "text/plain"
    );

    if (textPart?.body?.data) {
      body = decodeBase64Url(textPart.body.data);
    }
  }

  console.log(body || "[No plain-text body found]");
}

main().catch((error) => {
  console.error("\nERROR:");
  console.error(error);
});