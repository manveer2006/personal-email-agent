import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Email Agent API is running" });
});

app.get("/api/emails", (req, res) => {
  res.json({ success: true, emails: [], message: "Email endpoint is working" });
});

app.get("/api/attention", (req, res) => {
  res.json({ success: true, emails: [], message: "Attention endpoint is working" });
});

app.listen(3000, "127.0.0.1", () => {
  console.log("🚀 Email Agent API running on http://127.0.0.1:3000");
});
