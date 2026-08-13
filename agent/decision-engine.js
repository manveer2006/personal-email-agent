export function decideAction(analysis) {
  const category = String(analysis?.category || "OTHER").toUpperCase();
  const priority = String(analysis?.priority || "LOW").toUpperCase();
  const replyNeeded = analysis?.reply_needed === true;

  const alwaysIgnore = [
    "PROMOTION",
    "ADVERTISEMENT",
    "MARKETING",
    "NEWSLETTER",
    "RECEIPT",
  ];

  const alwaysHuman = [
    "FINANCE",
    "COMPLAINT",
    "LEGAL",
    "SECURITY",
    "CONTRACT",
    "SENSITIVE_BUSINESS",
  ];

  if (alwaysIgnore.includes(category)) {
    return {
      action: "IGNORE",
      requiresApproval: false,
      reason: "Low-value or automated email.",
    };
  }

  if (alwaysHuman.includes(category)) {
    return {
      action: replyNeeded ? "DRAFT_REPLY" : "FLAG_HUMAN",
      requiresApproval: true,
      reason: "Sensitive email requires human approval.",
    };
  }

  if (replyNeeded || priority === "HIGH") {
    return {
      action: "DRAFT_REPLY",
      requiresApproval: true,
      reason: "Email may require a response.",
    };
  }

  return {
    action: "IGNORE",
    requiresApproval: false,
    reason: "No action required.",
  };
}
