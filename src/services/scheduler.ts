/**
 * Scheduled jobs for attendance + escalation digests + reminders.
 *
 * Features:
 *   - #5: Parent weekly attendance digest (Sundays 18:00)
 *   - #9: Teacher pending attendance reminder (daily 10:00)
 *   - #13: Mahalla weekly escalation digest (Mondays 09:00)
 *
 * Uses node-cron-free setInterval-based scheduler. The bot must be
 * running for these to fire. Times are in the server's local timezone.
 */
import type { Bot } from "grammy";
import type { BotContext } from "../types";
import { prisma } from "../database/prisma";

let botRef: Bot<BotContext> | undefined;
let intervals: NodeJS.Timeout[] = [];

export function setSchedulerBotRef(bot: Bot<BotContext>) {
  botRef = bot;
}

async function safeSend(telegramId: bigint, text: string) {
  if (!botRef) return;
  try {
    await botRef.api.sendMessage(telegramId.toString(), text);
  } catch (err) {
    // Phase 9: Mask telegramId in logs
    const { maskTelegramId } = require("../utils/piiRedact");
    console.error(`Scheduler notification failed (user=${maskTelegramId(telegramId)}):`, (err as Error).message);
  }
}

/**
 * Get the start of the current week (Monday).
 */
function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday
  const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * #5: Parent weekly attendance digest.
 * Sends every parent a summary of their children's attendance for the week.
 * Runs every Sunday at 18:00 local time.
 */
async function sendParentWeeklyDigest() {
  console.log("📅 Running parent weekly attendance digest...");
  const weekStart = getStartOfWeek(new Date());
  weekStart.setUTCDate(weekStart.getUTCDate() - 7); // last week Monday-Sunday (7 days back)
  const weekEnd = new Date();

  // Get all parents
  const parents = await prisma.user.findMany({
    where: { role: "PARENT", isActive: true },
    select: { id: true, telegramId: true, fullName: true, schoolId: true },
  });

  let sent = 0;
  for (const parent of parents) {
    // Get children for this parent
    const children = await prisma.student.findMany({
      where: { parentId: parent.id },
      select: { id: true, fullName: true, className: true },
    });

    if (children.length === 0) continue;

    let text = `📊 Haftalik davomat digesti\n\n`;
    let hasData = false;

    for (const child of children) {
      const records = await prisma.attendance.findMany({
        where: {
          studentId: child.id,
          date: { gte: weekStart, lte: weekEnd },
        },
        select: { status: true },
      });

      if (records.length === 0) continue;
      hasData = true;

      const present = records.filter(r => r.status === "PRESENT").length;
      const absent = records.filter(r => r.status === "ABSENT").length;
      const late = records.filter(r => r.status === "LATE").length;
      const excused = records.filter(r => r.status === "EXCUSED").length;
      const percentage = records.length > 0
        ? Math.round(((present + late + excused) / records.length) * 100)
        : 0;

      text += `👤 ${child.fullName} (${child.className}):\n`;
      text += `   ✅ ${present} bor, ❌ ${absent} yo'q, ⏰ ${late} kechikdi, 📝 ${excused} sababli\n`;
      text += `   📈 Davomat: ${percentage}%\n\n`;
    }

    if (hasData) {
      await safeSend(parent.telegramId, text);
      sent++;
    }
  }
  console.log(`✅ Parent weekly digest sent to ${sent} parents.`);
}

/**
 * #9: Teacher pending attendance reminder.
 * Sends at 10:00 AM local time to teachers who haven't recorded today's attendance.
 */
async function sendTeacherAttendanceReminder() {
  console.log("📅 Running teacher attendance reminder...");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Get all active teachers
  const teachers = await prisma.user.findMany({
    where: {
      role: { in: ["TEACHER", "CLASS_TEACHER"] },
      isActive: true,
      schoolId: { not: null },
    },
    select: { id: true, telegramId: true, fullName: true, schoolId: true },
  });

  let sent = 0;
  for (const teacher of teachers) {
    // Check if they recorded any attendance today
    const todayCount = await prisma.attendance.count({
      where: {
        recordedById: teacher.id,
        date: today,
      },
    });

    if (todayCount === 0) {
      await safeSend(
        teacher.telegramId,
        "📋 Bugungi davomat hali belgilanmagan!\n\n" +
        "Iltimos, /panel ni bosing va \"📋 Davomat\" tugmasi orqali bugungi davomatni belgilang."
      );
      sent++;
    }
  }
  console.log(`✅ Teacher attendance reminder sent to ${sent} teachers.`);
}

/**
 * #13: Mahalla weekly escalation digest.
 * Sends every Monday at 09:00 local time with a summary of the past week's escalations.
 */
async function sendMahallaWeeklyDigest() {
  console.log("📅 Running mahalla weekly escalation digest...");
  const weekStart = getStartOfWeek(new Date());
  weekStart.setUTCDate(weekStart.getUTCDate() - 7); // last week
  const weekEnd = new Date();

  // Get all active mahalla responsibles
  const mahallas = await prisma.user.findMany({
    where: { role: "MAHALLA_RESPONSIBLE", isActive: true, neighborhoodId: { not: null } },
    select: { id: true, telegramId: true, fullName: true, neighborhoodId: true },
  });

  let sent = 0;
  for (const mahalla of mahallas) {
    if (!mahalla.neighborhoodId) continue;

    const escalations = await prisma.attendanceEscalation.findMany({
      where: {
        neighborhoodId: mahalla.neighborhoodId,
        createdAt: { gte: weekStart, lte: weekEnd },
      },
      select: {
        id: true,
        studentId: true,
        absenceCount: true,
        thresholdDate: true,
        student: { select: { fullName: true, className: true } },
      },
    });

    if (escalations.length === 0) continue;

    let text = `📊 Haftalik ogohlantirishlar digesti\n\n`;
    text += `Bu hafta ${escalations.length} ta o'quvchi 3+ kun davom etmadi:\n\n`;

    for (const e of escalations.slice(0, 15)) {
      const dateStr = e.thresholdDate.toLocaleDateString("uz-UZ", {
        year: "numeric", month: "2-digit", day: "2-digit",
      });
      text += `• ${e.student?.fullName || "Noma'lum"} (${e.student?.className || "?"}) — ${e.absenceCount} kun (${dateStr})\n`;
    }

    if (escalations.length > 15) {
      text += `\n... va yana ${escalations.length - 15} ta\n`;
    }

    text += `\nIltimos, /panel orqali batafsil ko'ring.`;

    await safeSend(mahalla.telegramId, text);
    sent++;
  }
  console.log(`✅ Mahalla weekly digest sent to ${sent} mahalla responsibles.`);
}

/**
 * Check if the current time matches the target hour (local time).
 */
function isTime(hour: number, minute: number = 0): boolean {
  const now = new Date();
  // Use local time (server timezone)
  return now.getHours() === hour && now.getMinutes() === minute;
}

/**
 * Check if today is a specific day of week (0 = Sunday, 1 = Monday, etc.)
 */
function isDay(dayOfWeek: number): boolean {
  return new Date().getDay() === dayOfWeek;
}

/**
 * Start the scheduler. Checks every minute if any job should run.
 * Call this once at bot startup.
 */
export function startScheduler() {
  console.log("📅 Starting scheduled jobs...");

  // Check every minute
  const interval = setInterval(async () => {
    try {
      // #9: Teacher reminder — daily at 10:00
      if (isTime(10, 0)) {
        await sendTeacherAttendanceReminder();
      }

      // #5: Parent weekly digest — Sunday at 18:00
      if (isDay(0) && isTime(18, 0)) {
        await sendParentWeeklyDigest();
      }

      // #13: Mahalla weekly digest — Monday at 09:00
      if (isDay(1) && isTime(9, 0)) {
        await sendMahallaWeeklyDigest();
      }
    } catch (err) {
      console.error("Scheduler error:", (err as Error).message);
    }
  }, 60 * 1000); // every minute

  intervals.push(interval);
  console.log("✅ Scheduler started (teacher reminder 10:00, parent digest Sun 18:00, mahalla digest Mon 09:00)");
}

/**
 * Stop all scheduled jobs.
 */
export function stopScheduler() {
  for (const i of intervals) clearInterval(i);
  intervals = [];
  console.log("📅 Scheduler stopped.");
}
