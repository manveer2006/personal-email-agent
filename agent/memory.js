import fs from "fs/promises";
import path from "path";

const STYLE_FILE = path.join(process.cwd(), "personal-style.txt");

export async function loadPersonalStyle() {
  try {
    return await fs.readFile(STYLE_FILE, "utf8");
  } catch {
    return "";
  }
}
