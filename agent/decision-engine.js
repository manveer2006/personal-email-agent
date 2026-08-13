export function decideAction(analysis, email = {}) {
  const subject = String(email.subject || "").toLowerCase();
  const body = String(email.body || "").toLowerCase();
  const text = `${subject} ${body}`;

  let category = "OTHER";
  let priority = "LOW";
  let replyNeeded = false;

  // ============================================
  // 1. SECURITY — ALWAYS HUMAN REVIEW
  // ============================================

  if (
    /security alert|new sign-in|new login|suspicious login|unauthorized access|password changed|security notification|account compromised/.test(text)
  ) {
    return {
      category: "SECURITY",
      priority: "HIGH",
      reply_needed: false,
      action: "FLAG_HUMAN",
      requiresApproval: true,
      reason: "Security-sensitive email requires human review.",
    };
  }

  // ============================================
  // 2. CLEARLY AUTOMATED / RECEIPTS / BILLS
  // ============================================

  if (
    /receipt|your bill|bill from|invoice|order confirmation|order placed|order delivered|delivery update|ride receipt|trip with uber|payment confirmation|transaction receipt/.test(text)
  ) {
    return {
      category: "AUTOMATED",
      priority: "LOW",
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason: "Receipt, bill, invoice, or automated transaction email.",
    };
  }

  // ============================================
  // 3. VERIFICATION / ACCOUNT EMAILS
  // ============================================

  if (
    /verify your email|verify your account|email verification|verification code|one-time password|one time password|otp|welcome to /.test(text)
  ) {
    return {
      category: "AUTOMATED",
      priority: "LOW",
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason: "Automated account or verification email.",
    };
  }

  // ============================================
  // 4. PROMOTIONAL / MARKETING
  // ============================================

  const promotional =
    /unsubscribe|discount|coupon|promo|promotion|marketing|newsletter|sale|limited time offer|special offer|shop now|buy now|exclusive offer|₹.*off|off.*₹|rewards|cashback|deal|deals|you might like|found something you might like|hiring opportunities|openings that match your skills/.test(
      text
    );

  if (promotional) {
    return {
      category: "PROMOTION",
      priority: "LOW",
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason: "Promotional or marketing email; no response required.",
    };
  }

  // ============================================
  // 5. INTERNSHIP / JOB — ONLY REAL INTERACTION
  // ============================================

  const realJobInteraction =
    /you have been shortlisted|your application has been shortlisted|we would like to interview you|interview invitation|schedule an interview|interview scheduled|interview round|job offer|offer letter|selected for|selection process|please confirm your availability|please confirm.*interview|application requires your response/.test(
      text
    );

  if (realJobInteraction) {
    return {
      category: "INTERNSHIP",
      priority: "HIGH",
      reply_needed: true,
      action: "DRAFT_REPLY",
      requiresApproval: true,
      reason: "Job or internship communication requires a response.",
    };
  }

  // ============================================
  // 6. FINANCIAL ACTION — HUMAN REVIEW
  // ============================================

  const financialAction =
    /fraud|fraudulent|unauthorized transaction|chargeback|payment failed|payment failure|refund requested|refund issue|refund pending|account charged|money deducted|dispute transaction|loan application|credit card application/.test(
      text
    );

  if (financialAction) {
    return {
      category: "FINANCE",
      priority: "HIGH",
      reply_needed: false,
      action: "FLAG_HUMAN",
      requiresApproval: true,
      reason: "Financial action or potential financial issue requires human review.",
    };
  }

  // ============================================
  // 7. COMPLAINT / ESCALATION
  // ============================================

  if (
    /complaint|grievance|escalation|dispute|consumer complaint|poor service|issue with your service|formal complaint/.test(
      text
    )
  ) {
    return {
      category: "COMPLAINT",
      priority: "HIGH",
      reply_needed: true,
      action: "DRAFT_REPLY",
      requiresApproval: true,
      reason: "Complaint or escalation may require a response.",
    };
  }

  // ============================================
  // 8. COLLEGE / ACADEMIC
  // ============================================

  if (
    /college|university|semester|exam|assignment|attendance|professor|faculty|hod|admission|academic|course registration|class schedule/.test(
      text
    )
  ) {
    const asksForResponse =
      /please reply|please respond|confirm|let us know|kindly respond|reply by|submit|provide|are you available|can you|could you/.test(
        text
      );

    if (asksForResponse) {
      return {
        category: "COLLEGE",
        priority: "HIGH",
        reply_needed: true,
        action: "DRAFT_REPLY",
        requiresApproval: true,
        reason: "Academic email explicitly requests a response or action.",
      };
    }

    return {
      category: "COLLEGE",
      priority: "LOW",
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason: "Academic/informational email does not require a response.",
    };
  }

  // ============================================
  // 9. BUSINESS / CLIENT
  // ============================================

  if (
    /client|quotation request|quote request|proposal request|business inquiry|project requirement|purchase order|meeting request|partnership inquiry|customer inquiry/.test(
      text
    )
  ) {
    const asksForResponse =
      /please reply|please respond|let us know|kindly respond|confirm|can you|could you|are you available|when can we|send us|provide us/.test(
        text
      );

    if (asksForResponse) {
      return {
        category: "BUSINESS",
        priority: "HIGH",
        reply_needed: true,
        action: "DRAFT_REPLY",
        requiresApproval: true,
        reason: "Business communication explicitly requests a response.",
      };
    }

    return {
      category: "BUSINESS",
      priority: "MEDIUM",
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason: "Business email does not clearly require a response.",
    };
  }

  // ============================================
  // 10. PERSONAL
  // ============================================

  if (
    /hey|hello|hi |how are you|how's it going|nice to meet|good morning|good evening|good afternoon|intro/.test(
      text
    )
  ) {
    const asksForResponse =
      /how are you|how's it going|what do you think|let me know|can you|could you|are you free|are you available|when can we/.test(
        text
      );

    if (asksForResponse) {
      return {
        category: "PERSONAL",
        priority: "MEDIUM",
        reply_needed: true,
        action: "DRAFT_REPLY",
        requiresApproval: true,
        reason: "Personal email appears to expect a response.",
      };
    }
  }

  // ============================================
  // 11. AI FALLBACK
  // ============================================

  category = analysis?.category || "OTHER";

  priority =
    analysis?.priority === "HIGH"
      ? "HIGH"
      : analysis?.priority === "MEDIUM"
        ? "MEDIUM"
        : "LOW";

  replyNeeded = analysis?.reply_needed === true;

  /*
   * IMPORTANT:
   *
   * AI fallback is conservative.
   * We do NOT automatically send or draft a reply
   * just because the LLM says reply_needed=true.
   *
   * Unknown emails go to human review.
   */

  if (priority === "HIGH") {
    return {
      category,
      priority,
      reply_needed: false,
      action: "FLAG_HUMAN",
      requiresApproval: true,
      reason: "Email could not be safely classified automatically.",
    };
  }

  return {
    category,
    priority,
    reply_needed: false,
    action: "IGNORE",
    requiresApproval: false,
    reason: "No clear response or action required.",
  };
}
