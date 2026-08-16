import { Keyboard } from "grammy";

export const mainMenuKeyboard = new Keyboard()
  .text("📝 Murojaat yuborish")
  .row()
  .text("📋 Murojaatlarim")
  .text("👨‍👩‍👧 Farzandlarim")
  .row()
  .text("ℹ️ Yordam")
  .resized();

export const backCancelKeyboard = new Keyboard()
  .text("⬅️ Orqaga")
  .text("❌ Bekor qilish")
  .resized();

export const cancelOnlyKeyboard = new Keyboard().text("❌ Bekor qilish").resized();
