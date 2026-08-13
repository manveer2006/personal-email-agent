export function validateDraft(draft, email) {
  const problems = [];

  if (!draft || !draft.trim()) {
    problems.push("Draft is empty.");
  }

  const placeholderPatterns = [
    /\[first name\]/i,
    /\[last name\]/i,
    /\[name\]/i,
    /\[company\]/i,
    /\[insert.*?\]/i,
    /<first name>/i,
    /<name>/i,
  ];

  for (const pattern of placeholderPatterns) {
    if (pattern.test(draft)) {
      problems.push("Draft contains an unresolved placeholder.");
      break;
    }
  }

  if (/^subject:/im.test(draft)) {
    problems.push("Draft contains a Subject line.");
  }

  if (/```/.test(draft)) {
    problems.push("Draft contains markdown code formatting.");
  }

  if (draft.length > 5000) {
    problems.push("Draft is unnecessarily long.");
  }

  if (
    email?.from &&
    draft.toLowerCase().includes(email.from.toLowerCase())
  ) {
    problems.push("Draft appears to contain the sender address.");
  }

  return {
    valid: problems.length === 0,
    problems,
  };
}
