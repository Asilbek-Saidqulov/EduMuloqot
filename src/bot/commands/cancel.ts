import type { BotContext } from "../../types";
import { mainMenu } from "../ui/screens";
import { safeEditMessage } from "../ui/helpers";

/**
 * Cancel current conversation and return to main menu
 */
export async function cancelCommand(ctx: BotContext): Promise<void> {
  // Exit any active conversation
  if (ctx.conversation) {
    await ctx.conversation.exit();
  }

  const screen = mainMenu();
  await safeEditMessage(ctx, "❌ Amal bekor qilindi.\n\n" + screen.text, screen.keyboard);
}
