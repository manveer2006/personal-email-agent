export function decideAction(analysis, email = {}) {
  const subject = String(email.subject || "").toLowerCase();
  const body = String(email.body || "").toLowerCase();
  const text = `${subject} ${body}`;

  const aiCategory = String(
    analysis?.category || "OTHER"
  ).toUpperCase();

  const aiPriority = String(
    analysis?.priority || "LOW"
  ).toUpperCase();

  const aiReplyNeeded =
    analysis?.reply_needed === true;

  // ============================================
  // 1. SECURITY — ALWAYS HUMAN REVIEW
  // ============================================

  if (
    /security alert|new sign-in|new login|suspicious login|unauthorized access|password changed|security notification|account compromised/.test(
      text
    )
  ) {
    return {
      category: "SECURITY",
      priority: "HIGH",
      reply_needed: false,
      action: "FLAG_HUMAN",
      requiresApproval: true,
      reason:
        "Security-sensitive email requires human review.",
    };
  }

  // ============================================
  // 2. CLEAR AUTOMATED TRANSACTIONS
  // ============================================

  if (
    /receipt|your bill|bill from|invoice|order confirmation|order placed|order delivered|delivery update|ride receipt|trip with uber|payment confirmation|transaction receipt/.test(
      text
    )
  ) {
    return {
      category: "AUTOMATED",
      priority: "LOW",
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason:
        "Receipt, bill, invoice, or automated transaction email.",
    };
  }

  // ============================================
  // 3. VERIFICATION / OTP
  // ============================================

  if (
    /verify your email|verify your account|email verification|verification code|one-time password|one time password|otp/.test(
      text
    )
  ) {
    return {
      category: "AUTOMATED",
      priority: "LOW",
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason:
        "Automated verification email.",
    };
  }

  // ============================================
  // 4. REAL JOB / INTERNSHIP APPLICATION EVENTS
  //
  // IMPORTANT: This must come BEFORE promotional
  // rules. Application acceptance, selection,
  // interview, offer, shortlist, etc. are
  // actionable even when the sender is a
  // recruitment platform such as Unstop.
  // ============================================

  const clearlyPromotional =
    /last chance|win ₹|win rs|win inr|prize|contest|lottery|shop now|buy now|exclusive offer|special offer|limited time|discount|coupon|cashback|sale|you might like|found something you might like|save more|savor more|unsubscribe/.test(
      text
    );

  const applicationEvent =
    /application (has been )?accepted|application accepted|your application (was|has been) successful|application successful|successfully applied|application status.*(accepted|selected|shortlisted|approved)|you have been selected|you have been shortlisted|you were selected|you were shortlisted|selected for (the )?(role|position|internship|job)|shortlisted for (the )?(role|position|internship|job)|we are pleased to inform you.*(selected|accepted|offer)|congratulations.*(selected|accepted|hired)|offer letter|job offer|internship offer|offer of employment|joining letter|employment offer|interview invitation|interview scheduled|schedule an interview|interview round|technical interview|please confirm your availability.*interview|application requires your response|next round|assessment|coding test/.test(
      text
    );

  if (applicationEvent) {
    return {
      category: /internship|intern/.test(text)
        ? "INTERNSHIP"
        : "JOB",
      priority: "HIGH",
      reply_needed: true,
      action: "DRAFT_REPLY",
      requiresApproval: true,
      reason:
        "Job or internship application event requires attention and may require a response.",
    };
  }

  // ============================================
  // 5. APOLOGY / HUMAN RESPONSE
  //
  // Apology emails are not promotional. If a person
  // is apologizing for their actions or asking for
  // forgiveness, prepare a draft for human approval.
  // ============================================

  const apologyEmail =
    /apology|apologize|apologised|apologized|sorry for my actions|sorry for what i did|request for forgiveness|ask for forgiveness|forgive me/.test(
      text
    );

  if (apologyEmail) {
    return {
      category: "OTHER",
      priority: "HIGH",
      reply_needed: true,
      action: "DRAFT_REPLY",
      requiresApproval: true,
      reason:
        "Apology or request for forgiveness requires a human-approved response.",
    };
  }

  // ============================================
  // 6. STRONG PROMOTIONAL SIGNALS
  //
  // These can override accidental keyword matches,
  // but application-event emails were already handled
  // above and therefore cannot be incorrectly ignored.
  // ============================================

  const strongPromotion =
    /unsubscribe|limited time|last chance|shop now|buy now|exclusive offer|special offer|discount|coupon|cashback|sale|₹.*off|off.*₹|win ₹|win rs|win inr|prize|contest|lottery|you might like|found something you might like|this independence day|save more|savor more/.test(
      text
    );

  if (strongPromotion && !applicationEvent && !aiReplyNeeded) {
    return {
      category: "PROMOTION",
      priority: "LOW",
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason:
        "Promotional or marketing email; no response required.",
    };
  }

  // ============================================
  // 7. AI-IDENTIFIED PROMOTION
  // ============================================

  if (
    aiCategory === "PROMOTION" &&
    !aiReplyNeeded
  ) {
    return {
      category: "PROMOTION",
      priority: "LOW",
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason:
        "AI classified the email as promotional.",
    };
  }

  // ============================================
  // 8. AI-IDENTIFIED AUTOMATED EMAIL
  // ============================================

  if (
    aiCategory === "AUTOMATED" &&
    !aiReplyNeeded
  ) {
    return {
      category: "AUTOMATED",
      priority: "LOW",
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason:
        "AI classified the email as automated.",
    };
  }

  // ============================================
  // 9. FINANCIAL / SENSITIVE
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
      reason:
        "Financial action or potential financial issue requires human review.",
    };
  }

  // ============================================
  // 10. REAL JOB / INTERNSHIP INTERACTION
  // ============================================

  const realJobInteraction =
    /you have been shortlisted|your application has been shortlisted|we would like to interview you|interview invitation|interview scheduled|schedule an interview|interview round|job offer|offer letter|selected for interview|selection process|please confirm your availability|please confirm.*interview|application requires your response|application status|next round|assessment|coding test|technical interview/.test(
      text
    );

  if (realJobInteraction) {
    return {
      category: /internship|intern|training/.test(text)
        ? "INTERNSHIP"
        : "JOB",
      priority: "HIGH",
      reply_needed: true,
      action: "DRAFT_REPLY",
      requiresApproval: true,
      reason:
        "Job or internship communication requires a response.",
    };
  }

  // ============================================
  // 11. COMPLAINT / ESCALATION
  // ============================================

  if (
    /complaint|grievance|escalation|consumer complaint|poor service|issue with your service|formal complaint/.test(
      text
    )
  ) {
    return {
      category: "COMPLAINT",
      priority: "HIGH",
      reply_needed: true,
      action: "DRAFT_REPLY",
      requiresApproval: true,
      reason:
        "Complaint or escalation may require a response.",
    };
  }

  // ============================================
  // 12. COLLEGE / ACADEMIC
  // ============================================

  const strongAcademic =
    /university|college administration|professor|faculty|hod|semester exam|course registration|class schedule|attendance shortage|assignment submission/.test(
      text
    );

  if (
    aiCategory === "COLLEGE" ||
    strongAcademic
  ) {
    if (
      aiReplyNeeded ||
      /please reply|please respond|confirm|let us know|kindly respond|reply by|please submit|please provide/.test(
        text
      )
    ) {
      return {
        category: "COLLEGE",
        priority: "HIGH",
        reply_needed: true,
        action: "DRAFT_REPLY",
        requiresApproval: true,
        reason:
          "Academic email requires a response or action.",
      };
    }

    return {
      category: "COLLEGE",
      priority: "LOW",
      reply_needed: false,
      action: "IGNORE",
      requiresApproval: false,
      reason:
        "Academic/informational email does not require a response.",
    };
  }

  // ============================================
  // 13. BUSINESS
  // ============================================

  const strongBusiness =
    /quotation request|quote request|proposal request|business inquiry|project requirement|purchase order|meeting request|partnership inquiry|customer inquiry|business proposal/.test(
      text
    );

  if (
    aiCategory === "BUSINESS" ||
    strongBusiness
  ) {
    if (
      aiReplyNeeded ||
      /please reply|please respond|let us know|kindly respond|confirm|can you|could you|are you available|when can we|send us|provide us|please share|please send/.test(
        text
      )
    ) {
      return {
        category: "BUSINESS",
        priority: "HIGH",
        reply_needed: true,
        action: "DRAFT_REPLY",
        requiresApproval: true,
        reason:
          "Business communication requires a response.",
      };
    }

    return {
      category: "BUSINESS",
      priority: "MEDIUM",
      reply_needed: false,
      action: "FLAG_HUMAN",
      requiresApproval: true,
      reason:
        "Business communication may require human attention.",
    };
  }

  // ============================================
  // 14. AI SAYS A REPLY IS NEEDED
  // ============================================

  if (aiReplyNeeded) {
    return {
      category: aiCategory,
      priority:
        aiPriority === "HIGH"
          ? "HIGH"
          : aiPriority === "MEDIUM"
            ? "MEDIUM"
            : "LOW",
      reply_needed: true,
      action: "DRAFT_REPLY",
      requiresApproval: true,
      reason:
        "AI analysis indicates that a response is needed.",
    };
  }

  // ============================================
  // 15. HIGH PRIORITY → HUMAN
  // ============================================

  if (aiPriority === "HIGH") {
    return {
      category: aiCategory,
      priority: "HIGH",
      reply_needed: false,
      action: "FLAG_HUMAN",
      requiresApproval: true,
      reason:
        "High-priority email requires human attention.",
    };
  }

  // ============================================
  // 16. SAFE DEFAULT
  // ============================================

  return {
    category: aiCategory,
    priority: "LOW",
    reply_needed: false,
    action: "IGNORE",
    requiresApproval: false,
    reason:
      "No clear response or action required.",
  };
}