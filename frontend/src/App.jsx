import { useEffect, useState } from "react";
import "./App.css";

const API = "http://127.0.0.1:3000";

function App() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedEmail, setSelectedEmail] = useState(null);

  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [reply, setReply] = useState("");
  const [creatingReply, setCreatingReply] = useState(false);
  const [sending, setSending] = useState(false);

  // New reply controls
  const [replyCreated, setReplyCreated] = useState(false);
  const [replyInstruction, setReplyInstruction] = useState("");
  const [tone, setTone] = useState("Friendly");
  const [length, setLength] = useState("Medium");

  // ============================================
  // LOAD EMAILS
  // ============================================

  async function loadEmails() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${API}/api/emails`);
      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Server returned invalid response: ${text.substring(0, 200)}`
        );
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || `Server returned ${response.status}`
        );
      }

      setEmails(data.emails || []);
    } catch (err) {
      console.error("LOAD EMAILS ERROR:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ============================================
  // ANALYZE EMAIL
  // ============================================

  async function analyzeSelectedEmail() {
    if (!selectedEmail) return;

    try {
      setAnalyzing(true);
      setError("");

      const response = await fetch(`${API}/api/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: selectedEmail,
        }),
      });

      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Server returned non-JSON response: ${text.substring(0, 200)}`
        );
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || `Analysis failed (${response.status})`
        );
      }

      setAnalysis(data.analysis || null);
    } catch (err) {
      console.error("ANALYZE ERROR:", err);
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  // ============================================
  // GENERATE REPLY
  // ============================================

  async function generateReplyDraft() {
    if (!selectedEmail) return;

    try {
      setCreatingReply(true);
      setError("");

      const instructionParts = [
        `Tone: ${tone}`,
        `Length: ${length}`,
      ];

      if (replyInstruction.trim()) {
        instructionParts.push(
          `User's additional instruction: ${replyInstruction.trim()}`
        );
      }

      const feedback = instructionParts.join("\n");

      const response = await fetch(`${API}/api/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: selectedEmail,
          analysis: analysis || {},
          feedback,
        }),
      });

      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Server returned non-JSON response: ${text.substring(0, 200)}`
        );
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || `Could not generate reply (${response.status})`
        );
      }

      setReply(data.reply || "");
      setReplyCreated(true);
    } catch (err) {
      console.error("GENERATE REPLY ERROR:", err);
      setError(err.message);
    } finally {
      setCreatingReply(false);
    }
  }

  // ============================================
  // CREATE FIRST REPLY
  // ============================================

  async function createReply() {
    if (replyCreated) {
      return;
    }

    await generateReplyDraft();
  }

  // ============================================
  // GENERATE ANOTHER REPLY
  // ============================================

  async function generateAnotherReply() {
    if (!selectedEmail) return;

    await generateReplyDraft();
  }

  // ============================================
  // SEND REPLY
  // ============================================

  async function sendReply() {
    if (!selectedEmail || !reply.trim()) {
      return;
    }

    try {
      setSending(true);
      setError("");

      const response = await fetch(`${API}/api/send-reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: selectedEmail,
          reply: reply.trim(),
        }),
      });

      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Server returned non-JSON response: ${text.substring(0, 200)}`
        );
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || `Could not send reply (${response.status})`
        );
      }

      alert("✅ Reply sent successfully!");

      setReply("");
      setReplyCreated(false);
      setReplyInstruction("");
    } catch (err) {
      console.error("SEND REPLY ERROR:", err);
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  // ============================================
  // RESET EMAIL
  // ============================================

  function resetSelectedEmail() {
    setSelectedEmail(null);
    setAnalysis(null);
    setReply("");
    setReplyCreated(false);
    setReplyInstruction("");
    setTone("Friendly");
    setLength("Medium");
    setError("");
  }

  // ============================================
  // LOAD ON START
  // ============================================

  useEffect(() => {
    loadEmails();
  }, []);

  // ============================================
  // EMAIL DETAIL PAGE
  // ============================================

  if (selectedEmail) {
    return (
      <div className="app">
        <header className="header">
          <div>
            <h1>📬 Mail Assistant</h1>
            <p>Your important emails, simplified.</p>
          </div>
        </header>

        <main>
          <button
            className="back-button"
            onClick={resetSelectedEmail}
          >
            ← Back to emails
          </button>

          {error && (
            <div className="error">
              ⚠️ {error}
            </div>
          )}

          <section className="email-detail">

            {/* ========================================
                EMAIL HEADER
            ======================================== */}

            <div className="detail-header">
              <div className="detail-icon">
                ✉️
              </div>

              <div>
                <h2>
                  {selectedEmail.subject || "No subject"}
                </h2>

                <p className="detail-sender">
                  From:{" "}
                  <strong>
                    {getSenderName(selectedEmail.from)}
                  </strong>
                </p>

                <p className="detail-date">
                  {selectedEmail.date}
                </p>
              </div>
            </div>

            {/* ========================================
                AI ACTIONS
            ======================================== */}

            <div className="detail-actions">

              <button
                className="ai-button"
                onClick={analyzeSelectedEmail}
                disabled={analyzing}
              >
                {analyzing
                  ? "🧠 Analyzing..."
                  : "🧠 Analyze Email"}
              </button>

              {!replyCreated && (
                <button
                  className="reply-button"
                  onClick={createReply}
                  disabled={creatingReply}
                >
                  {creatingReply
                    ? "✍️ Creating..."
                    : "✍️ Create Reply"}
                </button>
              )}

            </div>

            {/* ========================================
                AI ANALYSIS
            ======================================== */}

            {analysis && (
              <div className="analysis-box">
                <h3>🧠 AI Analysis</h3>

                <p>
                  <strong>Summary:</strong>{" "}
                  {analysis.summary || "No summary available."}
                </p>

                <p>
                  <strong>Priority:</strong>{" "}
                  {analysis.priority === "HIGH"
                    ? "🔴 HIGH"
                    : "🟢 LOW"}
                </p>

                {analysis.category && (
                  <p>
                    <strong>Category:</strong>{" "}
                    {analysis.category}
                  </p>
                )}

                {typeof analysis.reply_needed === "boolean" && (
                  <p>
                    <strong>Reply Needed:</strong>{" "}
                    {analysis.reply_needed
                      ? "✍️ Yes"
                      : "No"}
                  </p>
                )}
              </div>
            )}

            {/* ========================================
                REPLY ASSISTANT
            ======================================== */}

            {replyCreated && (
              <div className="reply-box">

                <h3>✍️ Reply Assistant</h3>

                {/* TONE */}

                <div className="reply-controls">

                  <div className="control-group">
                    <label htmlFor="tone">
                      🎭 Tone
                    </label>

                    <select
                      id="tone"
                      value={tone}
                      onChange={(e) =>
                        setTone(e.target.value)
                      }
                    >
                      <option value="Professional">
                        Professional
                      </option>

                      <option value="Friendly">
                        Friendly
                      </option>

                      <option value="Casual">
                        Casual
                      </option>

                      <option value="Formal">
                        Formal
                      </option>

                      <option value="Warm">
                        Warm
                      </option>

                      <option value="Concise">
                        Concise
                      </option>

                      <option value="Persuasive">
                        Persuasive
                      </option>
                    </select>
                  </div>

                  {/* LENGTH */}

                  <div className="control-group">
                    <label htmlFor="length">
                      📏 Length
                    </label>

                    <select
                      id="length"
                      value={length}
                      onChange={(e) =>
                        setLength(e.target.value)
                      }
                    >
                      <option value="Very Short">
                        Very Short
                      </option>

                      <option value="Short">
                        Short
                      </option>

                      <option value="Medium">
                        Medium
                      </option>

                      <option value="Detailed">
                        Detailed
                      </option>
                    </select>
                  </div>

                </div>

                {/* CUSTOM INSTRUCTION */}

                <div className="instruction-box">

                  <label htmlFor="replyInstruction">
                    💬 Tell AI what you want
                  </label>

                  <textarea
                    id="replyInstruction"
                    value={replyInstruction}
                    onChange={(e) =>
                      setReplyInstruction(
                        e.target.value
                      )
                    }
                    placeholder="Example: Make it shorter and more casual..."
                    rows={3}
                  />

                </div>

                {/* GENERATE ANOTHER */}

                <button
                  className="another-reply-button"
                  onClick={generateAnotherReply}
                  disabled={creatingReply}
                >
                  {creatingReply
                    ? "🧠 Generating..."
                    : "🔄 Generate Another Reply"}
                </button>

                {/* CURRENT DRAFT */}

                <label className="draft-label">
                  ✏️ Your Reply
                </label>

                <textarea
                  className="reply-textarea"
                  value={reply}
                  onChange={(e) =>
                    setReply(e.target.value)
                  }
                  rows={10}
                  placeholder="Your reply will appear here..."
                />

                {/* SEND */}

                <button
                  className="send-button"
                  onClick={sendReply}
                  disabled={
                    sending ||
                    !reply.trim()
                  }
                >
                  {sending
                    ? "📤 Sending..."
                    : "📤 Send Reply"}
                </button>

              </div>
            )}

            {/* ========================================
                ORIGINAL EMAIL
            ======================================== */}

            <div className="email-body">
              <h3>📧 Original Email</h3>

              <p>
                {selectedEmail.body ||
                  "No email content available."}
              </p>
            </div>

          </section>
        </main>
      </div>
    );
  }

  // ============================================
  // INBOX PAGE
  // ============================================

  return (
    <div className="app">

      <header className="header">

        <div>
          <h1>📬 Mail Assistant</h1>
          <p>
            Your important emails, simplified.
          </p>
        </div>

        <button
          onClick={loadEmails}
          className="refresh"
          disabled={loading}
        >
          ↻{" "}
          {loading
            ? "Refreshing..."
            : "Refresh"}
        </button>

      </header>

      <main>

        <section className="welcome">
          <h2>
            Good evening 👋
          </h2>

          <p>
            Here are the emails currently
            in your inbox.
          </p>
        </section>

        {error && (
          <div className="error">
            ⚠️ {error}
          </div>
        )}

        <section className="email-section">

          <div className="section-title">

            <h2>
              📥 Emails
            </h2>

            <span>
              {emails.length} emails
            </span>

          </div>

          {loading ? (
            <div className="loading">
              Loading your emails...
            </div>
          ) : emails.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">
                📭
              </div>

              <h3>
                No unread emails
              </h3>

              <p>
                You're all caught up!
              </p>
            </div>
          ) : (
            <div className="email-list">

              {emails.map((email) => (
                <EmailCard
                  key={email.id}
                  email={email}
                  onOpen={() => {
                    setSelectedEmail(email);
                    setAnalysis(null);
                    setReply("");
                    setReplyCreated(false);
                    setReplyInstruction("");
                    setTone("Friendly");
                    setLength("Medium");
                    setError("");
                  }}
                />
              ))}

            </div>
          )}

        </section>

      </main>

    </div>
  );
}

// ============================================
// EMAIL CARD
// ============================================

function EmailCard({ email, onOpen }) {
  return (
    <div className="email-card">

      <div className="email-icon">
        ✉️
      </div>

      <div className="email-content">

        <div className="email-top">

          <strong>
            {getSenderName(email.from)}
          </strong>

          <span>
            {email.date}
          </span>

        </div>

        <h3>
          {email.subject || "No subject"}
        </h3>

        <p>
          {email.body
            ? email.body.substring(0, 180) +
              (email.body.length > 180
                ? "..."
                : "")
            : "No preview available."}
        </p>

        <button
          className="open-button"
          onClick={onOpen}
        >
          Open Email
        </button>

      </div>

    </div>
  );
}

// ============================================
// GET SENDER NAME
// ============================================

function getSenderName(from) {
  if (!from) {
    return "Unknown sender";
  }

  const text = String(from);

  const match = text.match(
    /^"?([^"<]+)"?\s*<[^>]+>/
  );

  if (match) {
    return match[1].trim();
  }

  return text
    .replace(/<[^>]+>/g, "")
    .replace(/"/g, "")
    .trim();
}

export default App;