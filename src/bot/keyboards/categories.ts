import { Keyboard } from "grammy";
import { CATEGORIES_NEIGHBORHOOD, CATEGORIES_SCHOOL } from "../../types";

function buildCategoryKeyboard(categories: readonly string[]) {
  const kb = new Keyboard();
  categories.forEach((cat, i) => {
    kb.text(cat);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text("⬅️ Orqaga").text("❌ Bekor qilish");
  return kb.resized();
}

export const schoolCategoryKeyboard = buildCategoryKeyboard(CATEGORIES_SCHOOL);
export const neighborhoodCategoryKeyboard = buildCategoryKeyboard(CATEGORIES_NEIGHBORHOOD);
