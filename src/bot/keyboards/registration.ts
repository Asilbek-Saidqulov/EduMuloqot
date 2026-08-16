import { Keyboard } from "grammy";

// Generate class options from 1-A to 11-G (only 6 sections: A, B, V, D, E, G)
function generateClassOptions(): string[] {
  const classes: string[] = [];
  const sections = ["A", "B", "V", "D", "E", "G"];
  for (let grade = 1; grade <= 11; grade++) {
    for (const section of sections) {
      classes.push(`${grade}-${section}`);
    }
  }
  return classes;
}

const CLASS_OPTIONS = generateClassOptions();

export function classSelectionKeyboard(): Keyboard {
  const kb = new Keyboard();
  
  // Display classes in a grid (3 per row)
  CLASS_OPTIONS.forEach((className, index) => {
    kb.text(className);
    if ((index + 1) % 3 === 0) kb.row();
  });
  
  kb.row().text("❌ Bekor qilish");
  return kb.resized();
}

export const confirmCancelKeyboard = new Keyboard()
  .text("✅ Tasdiqlash")
  .text("✏️ O'zgartirish")
  .text("❌ Bekor qilish")
  .resized();

export const cancelOnlyKeyboard = new Keyboard().text("❌ Bekor qilish").resized();
