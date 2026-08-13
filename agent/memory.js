import fs from "fs/promises";
import path from "path";

const STYLE_FILE = path.join(
  process.cwd(),
  "personal-style.txt"
);

const MEMORY_FILE = path.join(
  process.cwd(),
  "agent-memory.json"
);

const DEFAULT_MEMORY = {
  preferences: {
    tone: "professional and natural",
    signature: "Best regards,\nManveer Singh Bhalla",
    avoidOverExplaining: true,
    neverAssumeIntent: true,
  },

  senderRules: {},

  categoryRules: {},

  corrections: [],
};

async function loadJson() {
  try {
    const data = await fs.readFile(
      MEMORY_FILE,
      "utf8"
    );

    return {
      ...DEFAULT_MEMORY,
      ...JSON.parse(data),
    };
  } catch {
    return structuredClone(DEFAULT_MEMORY);
  }
}

async function saveJson(memory) {
  await fs.writeFile(
    MEMORY_FILE,
    JSON.stringify(memory, null, 2),
    "utf8"
  );
}

export async function loadPersonalStyle() {
  try {
    return await fs.readFile(
      STYLE_FILE,
      "utf8"
    );
  } catch {
    return "";
  }
}

export async function loadMemory() {
  return loadJson();
}

export async function savePreference(
  key,
  value
) {
  const memory = await loadJson();

  memory.preferences[key] = value;

  await saveJson(memory);

  return memory;
}

export async function addCorrection(
  correction
) {
  const memory = await loadJson();

  memory.corrections.push({
    correction,
    createdAt: new Date().toISOString(),
  });

  // Keep memory from growing forever.
  if (memory.corrections.length > 100) {
    memory.corrections =
      memory.corrections.slice(-100);
  }

  await saveJson(memory);

  return memory;
}

export async function setSenderRule(
  sender,
  rule
) {
  const memory = await loadJson();

  memory.senderRules[sender] = rule;

  await saveJson(memory);

  return memory;
}

export async function setCategoryRule(
  category,
  rule
) {
  const memory = await loadJson();

  memory.categoryRules[category] = rule;

  await saveJson(memory);

  return memory;
}
