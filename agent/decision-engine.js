export function decideAction(analysis, email = {}) {
  const subject = String(email.subject || "").toLowerCase();
  const body = String(email.body || "").toLowerCase();
  const text = `${subject} ${body}`;

  let category = "OTHER";
  let priority = "LOW";
  let replyNeeded = false;

  // ============================================
  // 1. SECURITY — HIGHEST PRIORITY
  // ============================================

  if (
    /security alert|new sign-in|new login|suspicious login|unauthorized access|password changed|security notification/.test(text)
  ) {
    category = "SECURITY";
    priority = "HIGH";
    replyNeeded = false;
  }

  // ============================================
  // 2. INTERNSHIP / JOB APPLICATION
  // ============================================

  else if (
    /application shortlisted|shortlisted for|confirm your application|application status|interview|interview invitation|job offer|internship offer|internship opportunity/.test(text)
  ) {
    category = "INTERNSHIP";
    priority = "HIGH";
    replyNeeded = true;
  }

  // ============================================
  // 3. VERIFICATION / ACCOUNT EMAILS
  // ============================================

  else if (
    /verify your email|verify your account|email verification|verification code|otp|one-time password|account created|welcome to n8n/.test(text)
  ) {
    category = "AUTOMATED";
    priority = "LOW";
    replyNeeded = false;
  }

  // ============================================
  // 4. FINANCE
  // ============================================

  else if (
    /bank|credit card|debit card|transaction|payment|refund|invoice|upi|loan|emi|₹|rs\./.test(text)
  ) {
    category = "FINANCE";
    priority = "HIGH";
    replyNeeded = false;
  }

  // ============================================
  // 5. COMPLAINT
  // ============================================

  else if (
    /complaint|grievance|escalation|dispute|consumer complaint|poor service|issue with your service/.test(text)
  ) {
    category = "COMPLAINT";
    priority = "HIGH";
    replyNeeded = true;
  }

  // ============================================
  // 6. COLLEGE
  // ============================================

  else if (
    /college|university|semester|exam|assignment|attendance|professor|faculty|hod|admission|academic/.test(text)
  ) {
    category = "COLLEGE";
    priority = "HIGH";
    replyNeeded = true;
  }

  // ============================================
  // 7. BUSINESS / CLIENT
  // ============================================

  else if (
    /client|quotation|quotation request|quote request|proposal|business inquiry|project requirement|purchase order/.test(text)
  ) {
    category = "BUSINESS";
    priority = "HIGH";
    replyNeeded = true;
  }

  // ============================================
  // 8. PROMOTIONS / MARKETING
  // ============================================

  else if (
    /unsubscribe|discount|coupon|promo|promotion|marketing|newsletter|sale|limited time offer|independence day/.test(text)
  ) {
    category = "PROMOTION";
    priority = "LOW";
    replyNeeded = false;
  }

  // ============================================
  // 9. OTHER AUTOMATED EMAILS
  // ============================================

  else if (
    /receipt|order confirmation|order delivered|order placed|delivery update|notification|deployment failed|deploy failed|build failed/.test(text)
  ) {
    category = "AUTOMATED";
    priority = "LOW";
    replyNeeded = false;
  }

  // ============================================
  // 10. PERSONAL
  // ============================================

  else if (
    /hey|hello|hi |how are you|how's it going|nice to meet|good morning|good evening|good afternoon|intro/.test(text)
  ) {
    category = "PERSONAL";
    priority = "MEDIUM";
    replyNeeded = true;
  }

  // ============================================
  // 11. AI FALLBACK
  // ============================================

  else {
    category = "OTHER";
    priority = analysis?.priority === "HIGH" ? "HIGH" : "LOW";
    replyNeeded = analysis?.reply_needed === true;
  }

  // ============================================
  // ACTION
  // ============================================

  if (
    category === "PROMOTION" ||
    category === "AUTOMATED"
  ) {
    return {
      category,
      priority,
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason: "Automated or promotional email.",
    };
  }

  if (
    category === "SECURITY" ||
    category === "FINANCE" ||
    category === "COMPLAINT"
  ) {
    return {
      category,
      priority: "HIGH",
      reply_needed: replyNeeded,
      action: "FLAG_HUMAN",
      requiresApproval: true,
      reason: "Sensitive email requires human review.",
    };
  }

  if (replyNeeded) {
    return {
      category,
      priority,
      reply_needed: true,
      action: "DRAFT_REPLY",
      requiresApproval: true,
      reason: "A response may be appropriate.",
    };
  }

  return {
    category,
    priority,
    reply_needed: false,
    action: "IGNORE",
    requiresApproval: false,
    reason: "No action required.",
  };
}
