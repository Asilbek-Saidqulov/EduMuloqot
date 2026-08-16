import { InlineKeyboard } from "grammy";
import { header, divider, backButton, homeButton, statusBadge, emptyState } from "./components";

/**
 * Welcome screen for new users — Phase 2 onboarding + Phase 5+.
 *
 * Shows role selection: Student, Parent, or Teacher.
 *
 * The "👨‍🏫 O'qituvchi" button is shown so teachers can easily find
 * their panel — but tapping it does NOT self-provision the teacher
 * role. The `onboard_teacher` handler verifies the user has been
 * provisioned as staff by an admin (User.role is a staff role AND
 * User.isActive is true). If not, the user sees an access-denied
 * message explaining they must be added by an administrator.
 */
export function welcomeScreen(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("EduMuloqot", "Maktab, ota-ona va mahalla o'rtasidagi raqamli aloqa platformasi.")}Bu yer orqali siz:
• maktabga murojaat yuborishingiz
• murojaatlaringizni kuzatishingiz
• farzandlaringiz ma'lumotlarini boshqarishingiz mumkin.\n\nSiz kimsiz?`,
    keyboard: new InlineKeyboard()
      .text("🎓 O'quvchi", "onboard_student")
      .row()
      .text("👨‍👩‍👧 Ota-ona", "onboard_parent")
      .row()
      .text("👨‍🏫 O'qituvchi", "onboard_teacher"),
  };
}

/**
 * Phase 5+: Access-denied screen shown when an unprovisioned user
 * taps "👨‍🏫 O'qituvchi" on the welcome screen.
 *
 * The user is told they must be added by a school administrator
 * before they can access the teacher panel. This prevents
 * self-provisioning of staff roles.
 */
export function teacherAccessDeniedScreen(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text:
      `${header("⛔️ Ruxsat yo'q")}${divider()}\n\n` +
      `Siz hali o'qituvchi sifatida tizimga kiritilmagansiz.\n\n` +
      `O'qituvchi paneliga kirish uchun maktab administratori sizni tizimga qo'shishi kerak.\n\n` +
      `Iltimos, maktabingiz administratori bilan bog'laning.`,
    keyboard: new InlineKeyboard()
      .text("◀️ Orqaga", "back_to_welcome"),
  };
}

/**
 * Phase 2: Parent role selection — father or mother.
 */
export function onboardingParentRole(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("👨‍👩‍👧 Ota-ona")}Siz farzandingizning kimisiz?`,
    keyboard: new InlineKeyboard()
      .text("👨 Ota", "onboard_parent_father")
      .row()
      .text("👩 Ona", "onboard_parent_mother")
      .row()
      .text("◀️ Orqaga", "onboard_back"),
  };
}

/**
 * Phase 2: Student onboarding — ask for student's full name.
 */
export function onboardingStudentName(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("🎓 O'quvchi")}${divider()}\n\n✍️ Ism va familiyangizni kiriting:`,
    keyboard: new InlineKeyboard().text("❌ Bekor qilish", "cancel_onboarding"),
  };
}

/**
 * Phase 2: Student onboarding — school selection.
 */
export function onboardingStudentSchool(schools: Array<{ id: number; name: string }>): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();
  schools.forEach((school) => {
    keyboard.text(school.name, `onboard_select_school:${school.id}`).row();
  });
  keyboard.text("❌ Bekor qilish", "cancel_onboarding");

  return {
    text: `${header("🏫 Maktabni tanlang")}${divider()}\n\nQaysi maktabda o'qiysiz?`,
    keyboard,
  };
}

/**
 * Phase 2: Student onboarding — completion screen.
 */
export function onboardingStudentComplete(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("✅ Ro'yxatdan o'tdingiz!")}${divider()}\n\nSiz o'quvchi sifatida ro'yxatdan o'tdingiz.\n\nKeyingi qadamlar bo'yicha ma'lumot keladi.`,
    keyboard: new InlineKeyboard().text("🏠 Bosh sahifa", "home"),
  };
}

/**
 * Main parent menu
 */
export function mainMenu(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("EduMuloqot", "Maktab va mahalla bilan raqamli aloqa platformasi.")}`,
    keyboard: new InlineKeyboard()
      .text("📝 Murojaat yuborish", "new_complaint")
      .row()
      .text("📋 Murojaatlarim", "my_complaints")
      .row()
      .text("👨‍👩‍👧 Farzandlarim", "my_children")
      .text("👤 Profil", "profile")
      .row()
      .text("ℹ️ Yordam", "help"),
  };
}

/**
 * Phase 9 Fix: Role-aware main menu resolver.
 *
 * Returns the correct InlineKeyboard for the user's role.
 * Staff roles get an InlineKeyboard with "🏠 Bosh menyu" that routes
 * back to their panel (via the "home" callback which is now role-aware).
 * STUDENT gets a student-specific menu with attendance view.
 * PARENT gets the standard parent menu.
 */
export function getMainMenuForRole(role: string): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const staffRoles = ["TEACHER", "CLASS_TEACHER", "MAHALLA_RESPONSIBLE", "SCHOOL_ADMIN", "ADMIN", "SUPER_ADMIN"];

  if (staffRoles.includes(role)) {
    // Staff: show a minimal inline keyboard that routes back to /panel
    return {
      text: `🏠 Bosh menyu\n\nPanelingizga qaytish uchun /panel ni bosing.`,
      keyboard: new InlineKeyboard()
        .text("⚙️ Mening panelim", "home"),
    };
  }

  if (role === "STUDENT") {
    // Student: attendance view + profile + help
    return {
      text: `🏠 Bosh menyu\n\n`,
      keyboard: new InlineKeyboard()
        .text("📋 Mening davomatim", "my_attendance")
        .row()
        .text("ℹ️ Yordam", "help"),
    };
  }

  // PARENT / unknown: show the standard parent menu
  return mainMenu();
}

/**
 * School complaint wizard - Step 1: Select school
 */
export function schoolComplaintStep1(schools: Array<{ id: number; name: string }>): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();
  schools.forEach((school) => {
    keyboard.text(school.name, `select_school:${school.id}`).row();
  });
  keyboard.text("❌ Bekor qilish", "cancel_complaint");

  return {
    text: `${header("📝 Yangi murojaat")}${divider()}\n\n1 / 6\n\n🏫 Maktabni tanlang`,
    keyboard,
  };
}

/**
 * School complaint wizard - Step 2: Select child
 */
export function schoolComplaintStep2(children: Array<{ id: number; fullName: string; grade: string }>): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();
  children.forEach((child) => {
    keyboard.text(`${child.fullName} — ${child.grade}`, `select_child:${child.id}`).row();
  });
  keyboard.text("+ Farzand qo'shish", "add_child").row();
  keyboard.text("◀️ Orqaga", "step1").text("❌ Bekor qilish", "cancel_complaint");

  return {
    text: `${header("📝 Yangi murojaat")}${divider()}\n\n2 / 6\n\n👨‍👩‍👧 Farzandingizni tanlang`,
    keyboard,
  };
}

/**
 * School complaint wizard - Step 3: Select category
 */
export function schoolComplaintStep3(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const categories = [
    { label: "🧠 Psixologik masala", value: "PSYCHOLOGIST" },
    { label: "📚 Ta'lim jarayoni", value: "EDUCATION" },
    { label: "⚖️ Intizom", value: "DISCIPLINE" },
    { label: "👨‍👩‍👧 Ijtimoiy masala", value: "SOCIAL_WORKER" },
    { label: "👨‍🎓 O'quvchi ishlari", value: "STUDENT_AFFAIRS" },
    { label: "📝 Boshqa", value: "COMPLAINT_MANAGER" },
  ];

  const keyboard = new InlineKeyboard();
  categories.forEach((cat) => {
    keyboard.text(cat.label, `select_category:${cat.value}`).row();
  });
  keyboard.text("◀️ Orqaga", "step2").text("❌ Bekor qilish", "cancel_complaint");

  return {
    text: `${header("📝 Yangi murojaat")}${divider()}\n\n3 / 6\n\n📂 Murojaat turini tanlang`,
    keyboard,
  };
}

/**
 * School complaint wizard - Step 4: Enter text
 */
export function schoolComplaintStep4(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("📝 Yangi murojaat")}${divider()}\n\n4 / 6\n\n💬 Murojaatingizni yozing\n\nMuammoingizni batafsil yozing.\n\nExample:\n"Farzandim ..."`,
    keyboard: new InlineKeyboard()
      .text("◀️ Orqaga", "step3")
      .text("❌ Bekor qilish", "cancel_complaint"),
  };
}

/**
 * School complaint wizard - Step 5: Attach file
 */
export function schoolComplaintStep5(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("📝 Yangi murojaat")}${divider()}\n\n5 / 6\n\n📎 Fayl biriktirish\n\nAgar kerak bo'lsa rasm yoki fayl yuboring.`,
    keyboard: new InlineKeyboard()
      .text("⏭️ O'tkazib yuborish", "skip_file")
      .row()
      .text("◀️ Orqaga", "step4")
      .text("❌ Bekor qilish", "cancel_complaint"),
  };
}

/**
 * School complaint wizard - Preview
 */
export function schoolComplaintPreview(data: {
  schoolName: string;
  childName: string;
  childGrade: string;
  category: string;
  text: string;
  hasFile: boolean;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const categoryLabels: Record<string, string> = {
    PSYCHOLOGIST: "🧠 Psixologik masala",
    EDUCATION: "📚 Ta'lim jarayoni",
    DISCIPLINE: "⚖️ Intizom",
    SOCIAL_WORKER: "👨‍👩‍👧 Ijtimoiy masala",
    STUDENT_AFFAIRS: "👨‍🎓 O'quvchi ishlari",
    COMPLAINT_MANAGER: "📝 Boshqa",
  };

  const keyboard = new InlineKeyboard()
    .text("✅ Yuborish", "submit_complaint")
    .row()
    .text("✏️ Maktab", "edit_school")
    .text("✏️ Farzand", "edit_child")
    .row()
    .text("✏️ Kategoriya", "edit_category")
    .text("✏️ Matn", "edit_text")
    .row()
    .text("❌ Bekor qilish", "cancel_complaint");

  return {
    text: `${header("📝 Murojaatni tekshiring")}${divider()}\n\n🏫 Maktab\n${data.schoolName}\n\n👨‍👩‍👧 Farzand\n${data.childName} — ${data.childGrade}\n\n📂 Kategoriya\n${categoryLabels[data.category] || data.category}\n\n💬 Murojaat\n${data.text}\n\n📎 ${data.hasFile ? "1 ta fayl" : "Fayl yo'q"}\n\n${divider()}\n\nHammasi to'g'rimi?`,
    keyboard,
  };
}

/**
 * Complaint detail screen
 *
 * Renders a single complaint for the parent-side "My Complaints → view" flow.
 * The `targetType` controls whether the school line or the neighborhood line
 * is shown (a complaint is either school-targeted or neighborhood-targeted,
 * never both). `assignedToAdminName` is shown only if the complaint has been
 * assigned to a specific admin.
 *
 * The refresh button carries the complaint id (`refresh_complaint:<id>`) so
 * the handler can reload the same complaint without re-resolving it from
 * session state.
 */
export function complaintDetail(complaint: {
  id: number;
  complaintNumber: string;
  targetType: "SCHOOL" | "NEIGHBORHOOD";
  schoolName?: string | null;
  neighborhoodName?: string | null;
  childName?: string | null;
  childGrade?: string | null;
  category: string;
  status: string;
  text: string;
  createdAt: Date | string;
  assignedToAdminName?: string | null;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const categoryLabels: Record<string, string> = {
    PSYCHOLOGIST: "🧠 Psixologik masala",
    EDUCATION: "📚 Ta'lim jarayoni",
    DISCIPLINE: "⚖️ Intizom",
    SOCIAL_WORKER: "👨‍👩‍👧 Ijtimoiy masala",
    STUDENT_AFFAIRS: "👨‍🎓 O'quvchi ishlari",
    COMPLAINT_MANAGER: "📝 Boshqa",
  };

  const keyboard = new InlineKeyboard()
    .text("🔄 Yangilash", `refresh_complaint:${complaint.id}`)
    .row()
    .text("◀️ Murojaatlarim", "my_complaints")
    .text("🏠 Bosh menyu", "home");

  const targetLabel = complaint.targetType === "SCHOOL" ? "🏫 Maktab" : "🏘️ Mahalla";
  const targetName =
    complaint.targetType === "SCHOOL"
      ? complaint.schoolName || "Noma'lum"
      : complaint.neighborhoodName || "Noma'lum";

  // Format createdAt as a readable date+time. Accept Date or ISO string —
  // the value may have been round-tripped through JSON (string) if it came
  // from a cached context, though here it is always fresh from Prisma.
  const createdDate = new Date(complaint.createdAt);
  const createdStr = isNaN(createdDate.getTime())
    ? String(complaint.createdAt)
    : createdDate.toLocaleString("uz-UZ", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

  let text = `${header(`📋 ${complaint.complaintNumber}`)}${divider()}\n\n${targetLabel}: ${targetName}\n`;

  if (complaint.childName) {
    text += `👨‍👩‍👧 ${complaint.childName}`;
    if (complaint.childGrade) {
      text += ` — ${complaint.childGrade}`;
    }
    text += "\n";
  }

  text += `📂 ${categoryLabels[complaint.category] || complaint.category}\n`;
  text += `📅 ${createdStr}\n`;

  if (complaint.assignedToAdminName) {
    text += `👤 Biriktirilgan admin: ${complaint.assignedToAdminName}\n`;
  }

  text += `\n${divider()}\n\n📍 Holat\n\n${statusBadge(complaint.status)}\n\n${divider()}\n\n💬 Murojaat:\n\n${complaint.text}`;

  return { text, keyboard };
}

/**
 * My complaints screen
 */
export function myComplaints(complaints: Array<{
  id: number;
  complaintNumber: string;
  status: string;
  category: string;
}>): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const categoryLabels: Record<string, string> = {
    PSYCHOLOGIST: "🧠",
    EDUCATION: "📚",
    DISCIPLINE: "⚖️",
    SOCIAL_WORKER: "👨‍👩‍👧",
    STUDENT_AFFAIRS: "👨‍🎓",
    COMPLAINT_MANAGER: "📝",
  };

  const statusCounts = {
    NEW: 0,
    IN_PROGRESS: 0,
    RESOLVED: 0,
  };

  complaints.forEach((c) => {
    if (c.status === "NEW") statusCounts.NEW++;
    else if (c.status === "IN_PROGRESS") statusCounts.IN_PROGRESS++;
    else if (c.status === "RESOLVED") statusCounts.RESOLVED++;
  });

  const keyboard = new InlineKeyboard();

  if (complaints.length === 0) {
    return emptyState(
      "📋 Murojaatlarim\n\nHozircha sizda murojaatlar mavjud emas.",
      "📝 Birinchi murojaatni yuborish",
      "new_complaint"
    );
  }

  complaints.forEach((c) => {
    // L2 fix: complaintNumber already starts with "#", don't add extra.
    keyboard
      .text(`${c.complaintNumber} — ${statusBadge(c.status)}`, `view_complaint:${c.id}`)
      .row();
  });

  keyboard.text("🔍 Raqam bo'yicha qidirish", "search_complaint_by_number").row();
  keyboard.text("◀️ Orqaga", "home");

  let text = `${header("📋 Murojaatlarim")}`;
  text += `🔴 ${statusCounts.NEW} ta yangi\n`;
  text += `🔄 ${statusCounts.IN_PROGRESS} ta ko'rib chiqilmoqda\n`;
  text += `✅ ${statusCounts.RESOLVED} ta yakunlangan\n\n`;

  return { text, keyboard };
}

/**
 * Search complaint by number — input prompt.
 *
 * ReplyKeyboard with cancel-only. The conversation's waitFor only needs
 * `message:text`. The user enters a complaint number like "#EDU-000001",
 * "EDU-000001", or "edu-000001" — the conversation normalizes it before
 * lookup.
 */
export function complaintSearchByNumberPrompt(): {
  text: string;
  reply_markup: any;
} {
  return {
    text: `${header("🔍 Raqam bo'yicha qidirish")}${divider()}\n\nMurojaat raqamini kiriting.\n\nMisol: #EDU-000001`,
    reply_markup: {
      keyboard: [[{ text: "❌ Bekor qilish" }]],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

/**
 * Children screen
 */
export function childrenScreen(children: Array<{ id: number; fullName: string; grade: string }>): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();

  if (children.length === 0) {
    return emptyState(
      "👨‍👩‍👧 Farzandlarim\n\nHali farzand qo'shilmagan.",
      "➕ Farzand qo'shish",
      "add_child"
    );
  }

  // Phase 5: each child gets two buttons — "Tahrirlash" (existing
  // childEdit flow) and "Davomat" (Phase 5 parent attendance view).
  // Both buttons are inline-keyboard callbacks.
  children.forEach((child) => {
    keyboard.text(`${child.fullName} — ${child.grade}`, `view_child:${child.id}`).row();
    keyboard.text("📋 Davomat", `view_child_attendance:${child.id}`).row();
  });

  keyboard.text("➕ Farzand qo'shish", "add_child").row();
  keyboard.text("◀️ Orqaga", "home");

  return {
    text: header("👨‍👩‍👧 Farzandlarim"),
    keyboard,
  };
}

/**
 * Profile screen
 */
export function profileScreen(user: {
  fullName?: string;
  phone?: string;
  childrenCount: number;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard()
    .text("👨‍👩‍👧 Farzandlarim", "my_children")
    .row()
    .text("✏️ Ma'lumotlarni o'zgartirish", "edit_profile")
    .row()
    .text("◀️ Orqaga", "home");

  let text = header("👤 Profilim");
  text += `Ism: ${user.fullName || "Noma'lum"}\n\n`;
  text += `Telefon: ${user.phone || "Noma'lum"}\n\n`;
  text += `Farzandlar: ${user.childrenCount}\n`;

  return { text, keyboard };
}

// ───────────────────────────────────────────────────────────────────────
// Profile Edit screens
//
// Used by the profileEdit conversation to edit an EXISTING user's profile
// (fullName, phone, schoolId, neighborhoodId). Distinct callback_data
// prefixes (`edit_profile_*`, `select_edit_profile_school:`,
// `select_edit_profile_neighborhood:`, `confirm_edit_profile`,
// `cancel_edit_profile`) avoid colliding with the registration conversation's
// `select_school:` / `select_neighborhood:` callbacks and the child-edit
// conversation's `edit_child_*` / `select_edit_class:` callbacks.
// ───────────────────────────────────────────────────────────────────────

/**
 * Profile Edit — current info + edit menu.
 * Shows the existing profile (name, phone, school, neighborhood) and
 * offers to edit each field individually, or cancel.
 */
export function profileEditCurrentInfo(data: {
  fullName?: string | null;
  phone?: string | null;
  schoolName?: string | null;
  neighborhoodName?: string | null;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const text =
    `${header("✏️ Profilni tahrirlash")}${divider()}\n\n` +
    `👤 Ism: ${data.fullName || "Noma'lum"}\n` +
    `📱 Telefon: ${data.phone || "Noma'lum"}\n` +
    `🏫 Maktab: ${data.schoolName || "Noma'lum"}\n` +
    `🏘️ Mahalla: ${data.neighborhoodName || "Noma'lum"}\n\n` +
    `Nimani o'zgartirmoqchisiz?`;

  // Phase 9 Security Fix: Removed school/neighborhood edit buttons.
  // These fields control school isolation and must not be self-service.
  const keyboard = new InlineKeyboard()
    .text("✏️ Ism", "edit_profile_name")
    .row()
    .text("📱 Telefon", "edit_profile_phone")
    .row()
    .text("❌ Bekor qilish", "cancel_edit_profile");

  return { text, keyboard };
}

/**
 * Profile Edit — name step.
 * ReplyKeyboard with cancel-only button. The conversation's waitFor only
 * needs `message:text`.
 */
export function profileEditName(data: { currentName?: string | null }): {
  text: string;
  reply_markup: any;
} {
  return {
    text: `${header("✏️ Ismni o'zgartirish")}${divider()}\n\nJoriy ism: ${data.currentName || "Noma'lum"}\n\n✍️ Yangi ism va familiyangizni kiriting:`,
    reply_markup: {
      keyboard: [[{ text: "❌ Bekor qilish" }]],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

/**
 * Profile Edit — phone step.
 * ReplyKeyboard with request_contact (same pattern as parent registration
 * step 1) plus a cancel button. The conversation's waitFor matches
 * `message:contact` or `message:text` (for cancel).
 */
export function profileEditPhone(data: { currentPhone?: string | null }): {
  text: string;
  reply_markup: any;
} {
  return {
    text: `${header("📱 Telefonni o'zgartirish")}${divider()}\n\nJoriy telefon: ${data.currentPhone || "Noma'lum"}\n\n📱 Yangi telefon raqamingizni yuboring:`,
    reply_markup: {
      keyboard: [
        [{ text: "📱 Telefon raqamimni yuborish", request_contact: true }],
        [{ text: "❌ Bekor qilish" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

/**
 * Profile Edit — school step.
 * InlineKeyboard list of schools. Uses `select_edit_profile_school:` prefix
 * to avoid colliding with the registration conversation's `select_school:`.
 */
export function profileEditSchool(
  schools: Array<{ id: number; name: string }>,
  data: { currentSchoolName?: string | null }
): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();
  schools.forEach((school) => {
    keyboard.text(school.name, `select_edit_profile_school:${school.id}`).row();
  });
  keyboard.text("❌ Bekor qilish", "cancel_edit_profile");

  return {
    text: `${header("🏫 Maktabni tanlang")}${divider()}\n\nJoriy maktab: ${data.currentSchoolName || "Noma'lum"}\n\nYangi maktabni tanlang:`,
    keyboard,
  };
}

/**
 * Profile Edit — neighborhood step.
 * InlineKeyboard list of neighborhoods. Uses `select_edit_profile_neighborhood:`
 * prefix to avoid colliding with the registration conversation's
 * `select_neighborhood:`.
 */
export function profileEditNeighborhood(
  neighborhoods: Array<{ id: number; name: string }>,
  data: { currentNeighborhoodName?: string | null }
): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();
  neighborhoods.forEach((neighborhood) => {
    keyboard.text(neighborhood.name, `select_edit_profile_neighborhood:${neighborhood.id}`).row();
  });
  keyboard.text("❌ Bekor qilish", "cancel_edit_profile");

  return {
    text: `${header("🏘️ Mahallani tanlang")}${divider()}\n\nJoriy mahalla: ${data.currentNeighborhoodName || "Noma'lum"}\n\nYangi mahallani tanlang:`,
    keyboard,
  };
}

/**
 * Profile Edit — preview before saving.
 * Shows the field being changed (old → new) and asks for confirmation.
 */
export function profileEditPreview(data: {
  field: "name" | "phone" | "school" | "neighborhood";
  oldValue: string;
  newValue: string;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const fieldLabels: Record<typeof data.field, string> = {
    name: "👤 Ism",
    phone: "📱 Telefon",
    school: "🏫 Maktab",
    neighborhood: "🏘️ Mahalla",
  };

  const text =
    `${header("📋 O'zgarishni tekshiring")}${divider()}\n\n` +
    `${fieldLabels[data.field]}:\n  ❌ ${data.oldValue}\n  ✅ ${data.newValue}\n\n` +
    `Saqlashni tasdiqlaysizmi?`;

  const keyboard = new InlineKeyboard()
    .text("✅ Saqlash", "confirm_edit_profile")
    .row()
    .text("❌ Bekor qilish", "cancel_edit_profile");

  return { text, keyboard };
}

/**
 * Profile Edit — success screen after saving.
 * Offers to go back to the profile screen (which will reload the updated
 * info via `showProfile`) or to the main menu.
 */
export function profileEditSaved(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("✅ Saqlandi")}${divider()}\n\nProfil ma'lumotlaringiz yangilandi.`,
    keyboard: new InlineKeyboard()
      .text("👤 Profil", "profile")
      .row()
      .text("🏠 Bosh sahifa", "home"),
  };
}

/**
 * Help screen
 */
export function helpScreen(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("ℹ️ EduMuloqot")}Bu bot orqali siz:\n\n• Maktabga murojaat yuborishingiz\n• Murojaat holatini kuzatishingiz\n• Farzandlaringizni boshqarishingiz\n• Zarur fayllarni biriktirishingiz mumkin.\n\nFavqulodda holatlar uchun maktabga to'g'ridan-to'g'ri murojaat qiling.`,
    keyboard: new InlineKeyboard().text("◀️ Bosh menyu", "home"),
  };
}

/**
 * Submission loading state
 */
export function submissionLoading(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: "⏳ Murojaat yuborilmoqda...",
    keyboard: new InlineKeyboard(),
  };
}

/**
 * Submission success state
 */
export function submissionSuccess(complaintNumber: string, schoolName: string): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    // L1 fix: complaintNumber already starts with "#" (e.g. "#EDU-000001"),
    // so don't add an extra "#" prefix — was rendering "##EDU-000001".
    text: `${header("✅ Murojaat qabul qilindi")}${divider()}\n\n${complaintNumber}\n\n🏫 ${schoolName}\n\nMurojaatingiz maktabga yuborildi.`,
    keyboard: new InlineKeyboard()
      .text("📋 Murojaatni ko'rish", `view_complaint_by_number:${complaintNumber}`)
      .row()
      .text("🏠 Bosh menyu", "home"),
  };
}

/**
 * Registration welcome screen
 */
export function registrationWelcome(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("👋 EduMuloqot")}${divider()}\n\nMaktab bilan bog'lanish,\nfarzandingiz bo'yicha murojaat yuborish\nva murojaatlaringizni kuzatish uchun\nro'yxatdan o'ting.`,
    keyboard: new InlineKeyboard().text("🚀 Ro'yxatdan o'tish", "start_registration"),
  };
}

/**
 * Registration step 1 - Parent information (phone request)
 * Returns raw Telegram API reply_markup object (simplified structure)
 */
export function registrationStep1Phone(): {
  text: string;
  reply_markup: any;
} {
  return {
    text: `${header("👤 Ota-ona ma'lumotlari")}${divider()}\n\n1 / 4\n\nMurojaat yuborish uchun avval\no'zingiz haqingizdagi ma'lumotlarni\nkiritishingiz kerak.\n\n📱 Telefon raqamingizni yuboring:`,
    reply_markup: {
      keyboard: [
        [{ text: "📱 Telefon raqamimni yuborish", request_contact: true }],
        [{ text: "❌ Bekor qilish" }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

/**
 * Registration step 1 - Request parent name
 *
 * Returns a ReplyKeyboard (raw reply_markup) so that it REPLACES the
 * temporary phone-sharing ReplyKeyboard from registrationStep1Phone.
 * This is the only safe way to remove a ReplyKeyboard in Telegram while
 * showing a new button set — a single message can only carry one
 * reply_markup, and remove_keyboard + inline_keyboard cannot be combined.
 *
 * The cancel button is therefore a ReplyKeyboard button (sends message:text
 * "❌ Bekor qilish"), NOT a callback query. The conversation's waitFor must
 * match `message:text` for this reason.
 */
export function registrationStep1Name(): {
  text: string;
  reply_markup: any;
} {
  return {
    text: `${header("👤 Ota-ona ma'lumotlari")}${divider()}\n\n2 / 4\n\n✍️ Ism va familiyangizni yozing:`,
    reply_markup: {
      keyboard: [[{ text: "❌ Bekor qilish" }]],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

/**
 * ReplyKeyboard removal marker — a no-content message whose only job is to
 * dismiss the current ReplyKeyboard (e.g. the cancel-only keyboard from
 * registrationStep1Name) so the subsequent InlineKeyboard screen is the
 * only keyboard visible. Telegram does not let us combine `remove_keyboard`
 * with `inline_keyboard` in a single message, so this must be its own
 * `ctx.reply` call. Used inside the parent registration conversation right
 * before transitioning to an InlineKeyboard screen.
 */
export function registrationRemoveKeyboard(): {
  text: string;
  reply_markup: any;
} {
  return {
    text: "⏎",
    reply_markup: { remove_keyboard: true },
  };
}

/**
 * Registration step 2 - School selection
 */
export function registrationStep2School(schools: Array<{ id: number; name: string }>): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();
  schools.forEach((school) => {
    keyboard.text(school.name, `select_school:${school.id}`).row();
  });
  keyboard.text("❌ Bekor qilish", "cancel_registration");

  return {
    text: `${header("🏫 Maktabni tanlang")}${divider()}\n\n3 / 4\n\nQaysi maktabga tegishlisiz?`,
    keyboard,
  };
}

/**
 * Registration step 3 - Neighborhood selection
 */
export function registrationStep3Neighborhood(neighborhoods: Array<{ id: number; name: string }>): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();
  neighborhoods.forEach((neighborhood) => {
    keyboard.text(neighborhood.name, `select_neighborhood:${neighborhood.id}`).row();
  });
  keyboard.text("❌ Bekor qilish", "cancel_registration");

  return {
    text: `${header("🏘️ Mahallani tanlang")}${divider()}\n\n4 / 4\n\nQaysi mahallaga tegishlisiz?`,
    keyboard,
  };
}

/**
 * Registration preview
 */
export function registrationPreview(data: {
  parentName: string;
  phone: string;
  schoolName: string;
  neighborhoodName: string;
  parentRoleLabel?: string;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const roleLine = data.parentRoleLabel ? `\n👨‍👩‍👧 Rol: ${data.parentRoleLabel}` : "";
  const text = `${header("📋 Ma'lumotlaringizni tekshiring")}${divider()}\n\n4 / 4\n\n👤 Ota-ona: ${data.parentName}\n📱 Telefon: ${data.phone}\n\n🏫 Maktab: ${data.schoolName}\n🏘️ Mahalla: ${data.neighborhoodName}${roleLine}\n\nYuborishni tasdiqlaysizmi?`;

  const keyboard = new InlineKeyboard()
    .text("✅ Tasdiqlash", "confirm_registration")
    .row()
    .text("✏️ O'zgartirish", "edit_registration")
    .row()
    .text("❌ Bekor qilish", "cancel_registration");

  return { text, keyboard };
}

/**
 * Registration complete - ask about child
 */
export function registrationCompleteAskChild(data: {
  parentName: string;
  schoolName: string;
  neighborhoodName: string;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const text = `${header("🎉 Ro'yxatdan o'tish yakunlandi!")}${divider()}\n\n👤 Ota-ona: ${data.parentName}\n🏫 Maktab: ${data.schoolName}\n🏘️ Mahalla: ${data.neighborhoodName}\n\n👨‍👩‍👧 Farzandlar: Hali qo'shilmagan\n\nFarzandingizni hozir qo'shasizmi?`;

  const keyboard = new InlineKeyboard()
    .text("➕ Farzand qo'shish", "add_child_now")
    .row()
    .text("⏭️ Keyinroq", "skip_child");

  return { text, keyboard };
}

/**
 * Child registration step 1 - Child name
 */
export function childRegistrationStep1(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("👦 Farzandingiz haqida")}${divider()}\n\n✍️ Farzandingizning ism va familiyasini kiriting:`,
    keyboard: new InlineKeyboard().text("❌ Bekor qilish", "cancel_child_registration"),
  };
}

/**
 * Child registration step 2 - Class selection
 */
export function childRegistrationStep2(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();
  const sections = ["A", "B", "V", "D", "E", "G"];
  for (let grade = 1; grade <= 11; grade++) {
    for (const section of sections) {
      keyboard.text(`${grade}-${section}`, `select_class:${grade}-${section}`);
      if (section === "G" || section === sections[Math.floor((grade - 1) * 6 + sections.indexOf(section)) % 6]) {
        keyboard.row();
      }
    }
  }
  keyboard.text("❌ Bekor qilish", "cancel_child_registration");

  return {
    text: `${header("🏫 Sinfni tanlang")}${divider()}\n\nFarzandingiz qaysi sinfda o'qiydi?`,
    keyboard,
  };
}

/**
 * Child registration preview
 */
export function childRegistrationPreview(data: {
  childName: string;
  className: string;
  schoolName: string;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const text = `${header("📋 Ma'lumotlarni tekshiring")}${divider()}\n\n👦 Farzand: ${data.childName}\n🏫 Sinf: ${data.className}\n🏫 Maktab: ${data.schoolName}\n\nYuborishni tasdiqlaysizmi?`;

  const keyboard = new InlineKeyboard()
    .text("✅ Tasdiqlash", "confirm_child_registration")
    .row()
    .text("✏️ O'zgartirish", "edit_child_registration")
    .row()
    .text("❌ Bekor qilish", "cancel_child_registration");

  return { text, keyboard };
}

/**
 * Registration pending verification
 */
export function registrationPending(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("⏳ Tasdiqlash kutilmoqda")}${divider()}\n\nFarzandingiz ma'lumotlari maktab\nadministratori tomonidan tekshiriladi.\n\nTasdiqlangandan so'ng siz ushbu\nfarzandingiz nomidan murojaat yubora olasiz.`,
    keyboard: new InlineKeyboard().text("🏠 Bosh sahifa", "home"),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Child Claim screens (registry-based)
//
// Used by the childRegistration conversation to search the official
// school registry and claim an existing Student record.
// ───────────────────────────────────────────────────────────────────────

/**
 * Child claim — ask for child's name (search input).
 */
export function childClaimNamePrompt(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("👦 Farzand qo'shish")}${divider()}\n\nFarzandingizning ism-familiyasini kiriting.\n\nMisol: Muhammad Aliyev`,
    keyboard: new InlineKeyboard().text("❌ Bekor qilish", "cancel_child_registration"),
  };
}

/**
 * Child claim — no candidates found.
 */
export function childClaimNoMatch(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text:
      `${header("🔍 Farzand topilmadi")}${divider()}\n\n` +
      `Farzandingiz maktab ro'yxatida topilmadi.\n\n` +
      `Iltimos, ism-familiyani to'liqroq kiriting yoki maktab administratori bilan bog'laning.\n\n` +
      `Agar PINFL raqamini bilsangiz, uni kiriting:`,
    keyboard: new InlineKeyboard()
      .text("🔍 Ism bilan qayta qidirish", "retry_name_search")
      .row()
      .text("❌ Bekor qilish", "cancel_child_registration"),
  };
}

/**
 * Child claim — single high-confidence match found.
 * Shows the candidate's details and asks for confirmation.
 */
export function childClaimPreview(data: {
  fullName: string;
  className: string;
  birthDate: Date | null;
  pinfl: string | null;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const dateStr = data.birthDate
    ? new Date(data.birthDate).toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" })
    : "Noma'lum";
  const pinflMasked = data.pinfl
    ? "****" + data.pinfl.slice(-4)
    : "—";

  const text =
    `${header("👤 Farzandingiz topildi")}${divider()}\n\n` +
    `F.I.Sh: ${data.fullName}\n\n` +
    `🏫 Sinf: ${data.className}\n` +
    `🎂 Tug'ilgan sana: ${dateStr}\n` +
    `🆔 PINFL: ${pinflMasked}\n\n` +
    `Bu ma'lumotlar farzandingizga tegishlimi?`;

  const keyboard = new InlineKeyboard()
    .text("✅ Ha, bu mening farzandim", "confirm_claim_child")
    .row()
    .text("❌ Yo'q", "reject_claim_child")
    .row()
    .text("🔍 Boshqa nom bilan qidirish", "retry_name_search");

  return { text, keyboard };
}

/**
 * Child claim — multiple candidates found.
 * Shows a selectable list.
 */
export function childClaimMultipleCandidates(
  candidates: Array<{ id: number; fullName: string; className: string }>
): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();
  candidates.slice(0, 8).forEach((c, i) => {
    keyboard.text(`${i + 1}. ${c.fullName} — ${c.className}`, `select_claim:${c.id}`).row();
  });
  keyboard.text("🔍 Boshqa nom bilan qidirish", "retry_name_search").row();
  keyboard.text("❌ Bekor qilish", "cancel_child_registration");

  const text =
    `${header("🔎 Bir nechta o'xshash o'quvchi topildi")}${divider()}\n\n` +
    `Farzandingizni tanlang:`;

  return { text, keyboard };
}

/**
 * Child claim — student already claimed by another parent.
 */
export function childClaimAlreadyClaimed(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text:
      `${header("⚠️ Diqqat")}${divider()}\n\n` +
      `Bu o'quvchi allaqachon boshqa ota-onaga biriktirilgan.\n\n` +
      `Agar bu xato bo'lsa, maktab administratori bilan bog'laning.`,
    keyboard: new InlineKeyboard()
      .text("🔍 Boshqa nom bilan qidirish", "retry_name_search")
      .row()
      .text("🏠 Bosh sahifa", "home"),
  };
}

/**
 * Child claim — success.
 */
export function childClaimSuccess(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text:
      `${header("✅ Farzand biriktirildi")}${divider()}\n\n` +
      `Farzandingiz ma'lumotlari maktab\nadministratori tomonidan tekshiriladi.\n\n` +
      `Tasdiqlangandan so'ng siz ushbu\nfarzandingiz nomidan murojaat yubora olasiz.`,
    keyboard: new InlineKeyboard().text("🏠 Bosh sahifa", "home"),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Child Edit screens
//
// These are used by the childEdit conversation to edit an EXISTING student
// record. They are completely separate from the childRegistration screens
// (which create a NEW student). The callback_data prefixes use `edit_child_*`
// and `select_edit_class:` to avoid colliding with the registration
// conversation's `confirm_child_registration` / `select_class:` callbacks —
// grammY conversations route a callback to the active conversation's
// `waitForCallbackQuery` only if no other handler consumed it first, so
// distinct prefixes prevent cross-talk between the two flows.
// ───────────────────────────────────────────────────────────────────────

/**
 * Child Edit — current info + edit menu.
 * Shows the existing student's name, class, school and verification status,
 * then offers to edit the name, edit the class, or cancel.
 */
export function childEditCurrentInfo(data: {
  childName: string;
  className: string;
  schoolName: string;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const statusLabel =
    data.verificationStatus === "VERIFIED"
      ? "✅ Tasdiqlangan"
      : data.verificationStatus === "REJECTED"
      ? "❌ Rad etilgan"
      : "⏳ Tasdiqlash kutilmoqda";

  const text =
    `${header("✏️ Farzandni tahrirlash")}${divider()}\n\n` +
    `👦 Farzand: ${data.childName}\n` +
    `🏫 Sinf: ${data.className}\n` +
    `🏫 Maktab: ${data.schoolName}\n` +
    `📊 Holat: ${statusLabel}\n\n` +
    `Nimani o'zgartirmoqchisiz?`;

  const keyboard = new InlineKeyboard()
    .text("✏️ Ism", "edit_child_name")
    .row()
    .text("🏫 Sinf", "edit_child_class")
    .row()
    .text("❌ Bekor qilish", "cancel_edit_child");

  return { text, keyboard };
}

/**
 * Child Edit — name step.
 * Asks the user for the new full name. Cancel is a ReplyKeyboard button so
 * the conversation's waitFor only needs `message:text`.
 */
export function childEditName(data: { currentName: string }): {
  text: string;
  reply_markup: any;
} {
  return {
    text: `${header("✏️ Ismni o'zgartirish")}${divider()}\n\nJoriy ism: ${data.currentName}\n\n✍️ Yangi ism va familiyani kiriting:`,
    reply_markup: {
      keyboard: [[{ text: "❌ Bekor qilish" }]],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

/**
 * Child Edit — class step.
 * Same grid as childRegistrationStep2 but uses `select_edit_class:` prefix
 * so the childEdit conversation's waitForCallbackQuery matches it instead
 * of the registration conversation's `select_class:` handler.
 */
export function childEditClass(data: { currentClass: string }): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();
  const sections = ["A", "B", "V", "D", "E", "G"];
  for (let grade = 1; grade <= 11; grade++) {
    for (const section of sections) {
      keyboard.text(`${grade}-${section}`, `select_edit_class:${grade}-${section}`);
      if (section === "G" || section === sections[Math.floor((grade - 1) * 6 + sections.indexOf(section)) % 6]) {
        keyboard.row();
      }
    }
  }
  keyboard.text("❌ Bekor qilish", "cancel_edit_child");

  return {
    text: `${header("🏫 Sinfni tanlang")}${divider()}\n\nJoriy sinf: ${data.currentClass}\n\nYangi sinfni tanlang:`,
    keyboard,
  };
}

/**
 * Child Edit — preview before saving.
 * Shows the field being changed (before → after) and asks for confirmation.
 */
export function childEditPreview(data: {
  field: "name" | "class";
  oldValue: string;
  newValue: string;
  childName: string;
  className: string;
  schoolName: string;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const fieldLabel = data.field === "name" ? "👦 Farzand" : "🏫 Sinf";
  const text =
    `${header("📋 O'zgarishni tekshiring")}${divider()}\n\n` +
    `${fieldLabel}:\n  ❌ ${data.oldValue}\n  ✅ ${data.newValue}\n\n` +
    `${divider()}\n\n` +
    `👦 Farzand: ${data.field === "name" ? data.newValue : data.childName}\n` +
    `🏫 Sinf: ${data.field === "class" ? data.newValue : data.className}\n` +
    `🏫 Maktab: ${data.schoolName}\n\n` +
    `Saqlashni tasdiqlaysizmi?`;

  const keyboard = new InlineKeyboard()
    .text("✅ Saqlash", "confirm_edit_child")
    .row()
    .text("❌ Bekor qilish", "cancel_edit_child");

  return { text, keyboard };
}

/**
 * Child Edit — success screen after saving.
 */
export function childEditSaved(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("✅ Saqlandi")}${divider()}\n\nFarzand ma'lumotlari yangilandi.`,
    keyboard: new InlineKeyboard()
      .text("👨‍👩‍👧 Farzandlarim", "my_children")
      .row()
      .text("🏠 Bosh sahifa", "home"),
  };
}

/**
 * Registration complete
 */
export function registrationComplete(hasVerifiedChild: boolean): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();

  if (hasVerifiedChild) {
    keyboard.text("📝 Murojaat yuborish", "new_complaint").row();
  }

  keyboard.text("👨‍👩‍👧 Farzandlarim", "my_children").row().text("🏠 Bosh sahifa", "home");

  let text = header("🎉 Ro'yxatdan o'tish yakunlandi!");
  text += divider();
  text += "\n\nEndi farzandlaringiz holatini ko'rishingiz\nva tasdiqlangan farzand nomidan\nmaktabga murojaat yuborishingiz mumkin.";

  if (!hasVerifiedChild) {
    text += "\n\n⏳ Farzandingiz tasdiqlanishini kuting.";
  }

  return { text, keyboard };
}

// ─── Phase 3: Family System screens ───────────────────────────────────

/**
 * Family menu — shown when a parent has a family.
 */
export function familyMenu(data: {
  fatherName: string | null;
  motherName: string | null;
  children: Array<{ fullName: string; className: string }>;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  let text = `${header("👨‍👩‍👧 Oilam")}${divider()}\n\n`;

  if (data.fatherName) {
    text += `👨 Ota: ${data.fatherName}\n`;
  }
  if (data.motherName) {
    text += `👩 Ona: ${data.motherName}\n`;
  }

  if (data.children.length > 0) {
    text += `\nFarzandlar:\n`;
    data.children.forEach((c) => {
      text += `🎓 ${c.fullName} — ${c.className}\n`;
    });
  } else {
    text += `\nFarzandlar: Hali qo'shilmagan\n`;
  }

  const keyboard = new InlineKeyboard()
    .text("➕ Farzand qo'shish", "add_child")
    .row();

  if (!data.fatherName || !data.motherName) {
    keyboard.text("👨‍👩‍👧 Oilaga ota/ona qo'shish", "family_invite").row();
  }

  keyboard.text("🏠 Bosh sahifa", "home");

  return { text, keyboard };
}

export function familyNoFamily(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("👨‍👩‍👧 Oila")}${divider()}\n\nSiz hali oilaga ulanmagansiz.\n\nOila yaratishingiz yoki mavjud oilaga ulanishingiz mumkin.`,
    keyboard: new InlineKeyboard()
      .text("➕ Oila yaratish", "family_create")
      .row()
      .text("🔐 Oila kodini kiritish", "family_join_prompt")
      .row()
      .text("🏠 Bosh sahifa", "home"),
  };
}

export function familyInvitationCreated(token: string): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("🔐 Oilaga ulanish kodi")}${divider()}\n\nUshbu kodni ota/ona ga yuboring:\n\n🔑 ${token}\n\nKod 24 soat amal qiladi va bir martalik.`,
    keyboard: new InlineKeyboard()
      .text("👨‍👩‍👧 Oilam", "family_menu")
      .row()
      .text("🏠 Bosh sahifa", "home"),
  };
}

export function familyJoinPrompt(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("🔐 Oila kodini kiritish")}${divider()}\n\nOilaga ulanish kodini kiriting:\n\nMisol: EDU-7K4P-92`,
    keyboard: new InlineKeyboard().text("❌ Bekor qilish", "cancel_family_join"),
  };
}

export function familyJoinPreview(data: {
  parentName: string;
  parentRole: string;
  children: Array<{ fullName: string; className: string }>;
}): {
  text: string;
  keyboard: InlineKeyboard;
} {
  let text = `${header("👨‍👩‍👧 Oila topildi")}${divider()}\n\n`;

  const roleLabel = data.parentRole === "FATHER" ? "👨 Ota" : "👩 Ona";
  text += `${roleLabel}: ${data.parentName}\n`;

  if (data.children.length > 0) {
    text += `\nFarzandlar:\n`;
    data.children.forEach((c) => {
      text += `• ${c.fullName} — ${c.className}\n`;
    });
  }

  text += `\nSiz ushbu oilaga qo'shilmoqchimisiz?`;

  return {
    text,
    keyboard: new InlineKeyboard()
      .text("✅ Ha, qo'shilish", "confirm_family_join")
      .row()
      .text("❌ Bekor qilish", "cancel_family_join"),
  };
}

export function familyJoinSuccess(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("✅ Oilaga qo'shildingiz!")}${divider()}\n\nSiz muvaffaqiyatli oilaga qo'shildingiz.`,
    keyboard: new InlineKeyboard()
      .text("👨‍👩‍👧 Oilam", "family_menu")
      .row()
      .text("🏠 Bosh sahifa", "home"),
  };
}

export function familyCreateConfirm(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("👨‍👩‍👧 Oila yaratish")}${divider()}\n\nSiz uchun yangi oila yaratiladi.\n\nDavom etasizmi?`,
    keyboard: new InlineKeyboard()
      .text("✅ Davom etish", "confirm_family_create")
      .row()
      .text("❌ Bekor qilish", "cancel_family_create"),
  };
}

export function familyCreateSuccess(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("✅ Oila yaratildi!")}${divider()}\n\nSizning oilangiz yaratildi.\n\nEndi farzand qo'shishingiz yoki ota/ona ni taklif qilishingiz mumkin.`,
    keyboard: new InlineKeyboard()
      .text("👨‍👩‍👧 Oilam", "family_menu")
      .row()
      .text("🏠 Bosh sahifa", "home"),
  };
}

// ─── Phase 4: Staff Provisioning screens ──────────────────────────────

export function staffManagementMenu(isSuperAdmin = false): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard()
    .text("➕ Xodim qo'shish", "staff_add")
    .row()
    .text("👥 Xodimlar ro'yxati", "staff_list")
    .row();
  // SUPER_ADMIN only: direct access to legacy admin list functions
  // (Maktab adminlari, Mahalla adminlari) — Phase 9 Fix: replaced the
  // broken "Eski admin boshqaruvi" sub-menu with direct buttons.
  if (isSuperAdmin) {
    keyboard.text("🏫 Maktab adminlari", "legacy_list_school_admins").row();
    keyboard.text("🏘️ Mahalla adminlari", "legacy_list_neighborhood_admins").row();
  }
  keyboard.text("🔙 Admin menyusi", "back_to_admin_menu");
  return {
    text: `${header("👨‍🏫 Staff boshqaruvi")}${divider()}\n\nXodimlarni boshqarish bo'limi.`,
    keyboard,
  };
}

export function staffAddTelegramIdPrompt(): { text: string; keyboard: InlineKeyboard } {
  return {
    text: `${header("➕ Xodim qo'shish")}${divider()}\n\nYangi xodimning Telegram ID sini kiriting:\n\nMisol: 123456789`,
    keyboard: new InlineKeyboard().text("❌ Bekor qilish", "cancel_staff_add"),
  };
}

export function staffRoleSelection(): { text: string; keyboard: InlineKeyboard } {
  return {
    text: `${header("🎭 Lavozimni tanlang")}${divider()}\n\nXodimning lavozimini tanlang:`,
    keyboard: new InlineKeyboard()
      .text("👨‍🏫 O'qituvchi", "staff_role:TEACHER")
      .row()
      .text("👨‍🏫 Sinf rahbari", "staff_role:CLASS_TEACHER")
      .row()
      .text("🏫 Maktab administratori", "staff_role:SCHOOL_ADMIN")
      .row()
      .text("🏘 Mahalla mas'uli", "staff_role:MAHALLA_RESPONSIBLE")
      .row()
      .text("🛡 Admin", "staff_role:ADMIN")
      .row()
      .text("❌ Bekor qilish", "cancel_staff_add"),
  };
}

export function staffSchoolSelection(schools: Array<{ id: number; name: string }>): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  schools.forEach((s) => keyboard.text(s.name, `staff_school:${s.id}`).row());
  keyboard.text("❌ Bekor qilish", "cancel_staff_add");
  return {
    text: `${header("🏫 Maktabni tanlang")}${divider()}\n\nXodim qaysi maktabga biriktiriladi?`,
    keyboard,
  };
}

export function staffNeighborhoodSelection(neighborhoods: Array<{ id: number; name: string }>): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  neighborhoods.forEach((n) => keyboard.text(n.name, `staff_neighborhood:${n.id}`).row());
  keyboard.text("❌ Bekor qilish", "cancel_staff_add");
  return {
    text: `${header("🏘 Mahallani tanlang")}${divider()}\n\nXodim qaysi mahallaga biriktiriladi?`,
    keyboard,
  };
}

export function staffPreview(data: {
  telegramId: string;
  fullName: string;
  roleLabel: string;
  schoolName?: string;
  neighborhoodName?: string;
}): { text: string; keyboard: InlineKeyboard } {
  let text = `${header("📋 Xodimni tekshiring")}${divider()}\n\n`;
  text += `Telegram ID: ${data.telegramId}\n`;
  text += `Ism: ${data.fullName || "Noma'lum"}\n`;
  text += `Lavozim: ${data.roleLabel}\n`;
  if (data.schoolName) text += `Maktab: ${data.schoolName}\n`;
  if (data.neighborhoodName) text += `Mahalla: ${data.neighborhoodName}\n`;
  text += `\nTasdiqlaysizmi?`;
  return {
    text,
    keyboard: new InlineKeyboard()
      .text("✅ Tasdiqlash", "confirm_staff_add")
      .row()
      .text("❌ Bekor qilish", "cancel_staff_add"),
  };
}

export function staffAddSuccess(roleLabel: string): { text: string; keyboard: InlineKeyboard } {
  return {
    text: `${header("✅ Xodim qo'shildi")}${divider()}\n\nXodim muvaffaqiyatli qo'shildi.\nLavozim: ${roleLabel}\n\nXodimga xabar yuborildi.`,
    keyboard: new InlineKeyboard()
      .text("👨‍🏫 Staff boshqaruvi", "staff_menu")
      .row()
      .text("🔙 Admin menyusi", "back_to_admin_menu"),
  };
}

export function staffListScreen(staff: Array<{ id: number; fullName: string | null; role: string; isActive: boolean }>): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  const roleLabels: Record<string, string> = {
    TEACHER: "👨‍🏫",
    CLASS_TEACHER: "👨‍🏫",
    SCHOOL_ADMIN: "🏫",
    MAHALLA_RESPONSIBLE: "🏘",
    ADMIN: "🛡",
    SUPER_ADMIN: "👑",
  };
  staff.slice(0, 15).forEach((s) => {
    const icon = s.isActive ? "🟢" : "🔴";
    const roleIcon = roleLabels[s.role] || "👤";
    keyboard.text(`${icon} ${roleIcon} ${s.fullName || "Noma'lum"} (${s.role})`, `staff_view:${s.id}`).row();
  });
  keyboard.text("🔙 Orqaga", "staff_menu");
  return {
    text: `${header("👥 Xodimlar ro'yxati")}${divider()}\n\nJami: ${staff.length} ta xodim`,
    keyboard,
  };
}

export function staffDetailScreen(data: {
  id: number;
  fullName: string | null;
  telegramId: string;
  role: string;
  schoolName?: string | null;
  isActive: boolean;
}): { text: string; keyboard: InlineKeyboard } {
  const status = data.isActive ? "🟢 Faol" : "🔴 Faol emas";
  let text = `${header("👤 Xodim")}${divider()}\n\n`;
  text += `Ism: ${data.fullName || "Noma'lum"}\n`;
  text += `Telegram ID: ${data.telegramId}\n`;
  text += `Lavozim: ${data.role}\n`;
  if (data.schoolName) text += `Maktab: ${data.schoolName}\n`;
  text += `Holat: ${status}`;

  const keyboard = new InlineKeyboard();
  if (data.isActive) {
    keyboard.text("🔴 Faolsizlantirish", `staff_deactivate:${data.id}`).row();
  } else {
    keyboard.text("🟢 Faollashtirish", `staff_activate:${data.id}`).row();
  }
  keyboard.text("🔙 Orqaga", "staff_list");

  return { text, keyboard };
}

/**
 * Phase 4 Hardening: screen shown to deactivated staff members when
 * they send /start. A deactivated staff member is a User whose
 * role is a staff role (TEACHER, SCHOOL_ADMIN, etc.) AND whose
 * isActive is false.
 *
 * The screen is deterministic: the user sees the same message every
 * time they /start while deactivated. They are NOT shown:
 *   - The admin menu (which would let them perform staff operations)
 *   - The parent onboarding flow (which would be confusing — they
 *     never registered as a parent, they were provisioned as staff)
 *
 * They CAN still see their own profile and children (if any) via the
 * "👤 Mening profilim" button — this is allowed because deactivation
 * only revokes STAFF permissions, not self-access permissions.
 *
 * If the user is also a parent (e.g. someone who was a parent first
 * and later provisioned as staff, then deactivated), they can still
 * use parent features. The deactivation screen's profile button leads
 * to the standard main menu where parent features are available.
 */
export function staffDeactivatedScreen(): { text: string; keyboard: InlineKeyboard } {
  return {
    text:
      `${header("⛔️ Hisob faol emas")}${divider()}\n\n` +
      `Sizning xodim hisobingiz hozircha faol emas.\n\n` +
      `Agar bu xato deb hisoblasangiz, administrator bilan bog'laning.\n\n` +
      `Mening profilimni ko'rish uchun quyidagi tugmadan foydalaning:`,
    keyboard: new InlineKeyboard()
      .text("👤 Mening profilim", "profile")
      .row()
      .text("ℹ️ Yordam", "help"),
  };
}

// ─── Phase 5: Attendance screens ──────────────────────────────────────

/**
 * Phase 5: Teacher attendance menu — entry point.
 * Shows class selection prompt. The actual class list is appended by
 * the caller (passed in as `classes`).
 */
export function attendanceTeacherMenu(classes: Array<{ className: string; studentCount: number }>): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const keyboard = new InlineKeyboard();
  if (classes.length === 0) {
    return emptyState(
      `${header("📋 Davomat")}${divider()}\n\nSizga biriktirilgan sinflar topilmadi.`,
      "◀️ Bosh menyu",
      "home"
    );
  }
  classes.forEach((c) => {
    keyboard.text(`${c.className} (${c.studentCount} ta o'quvchi)`, `att_class:${c.className}`).row();
  });
  keyboard.text("◀️ Orqaga", "home");
  return {
    text: `${header("📋 Davomat")}${divider()}\n\nSinfni tanlang:`,
    keyboard,
  };
}

/**
 * Phase 5: Date selection for attendance.
 * Offers "Today" plus a back button. Future enhancement: allow picking
 * a past date.
 */
export function attendanceDateSelect(className: string): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${header("📋 Davomat — ${className}")}${divider()}\n\nSanani tanlang:`,
    keyboard: new InlineKeyboard()
      .text("📅 Bugun", `att_date:${className}:${"today"}`)
      .row()
      .text("📅 Kecha", `att_date:${className}:${"yesterday"}`)
      .row()
      // Feature #7: copy-from-yesterday shortcut — offered when opening
      // today's roll (the handler checks if yesterday's data exists)
      .text("📋 Kechagi davomatni bugunga nusxalash", `att_copy_yesterday:${className}`)
      .row()
      .text("◀️ Orqaga", "att_menu"),
  };
}

/**
 * Phase 5: Attendance roll-call screen.
 * Shows each student with their current status (if already recorded)
 * and four buttons to mark them.
 *
 * The callback data format is `att_mark:<studentId>:<status>:<className>:<date>`
 * — note this is for UI state only; the service re-validates the
 * studentId, schoolId, and className from the DB on save.
 */
export function attendanceRollCall(params: {
  className: string;
  date: Date;
  dateLabel: string;
  subject?: string;
  students: Array<{
    id: number;
    fullName: string;
    isAbsent: boolean;
  }>;
  absentCount: number;
  page?: number;
  totalPages?: number;
}): { text: string; keyboard: InlineKeyboard } {
  const { className, dateLabel, subject, students, absentCount, page = 0, totalPages = 1 } = params;

  let text = `${header("📋 Davomat — ${className}")}${divider()}\n`;
  text += `📅 Sana: ${dateLabel}\n`;
  if (subject) text += `📚 Fan: ${subject}\n`;
  text += `❌ Kelmagan: ${absentCount} / ${students.length}\n`;
  if (totalPages > 1) {
    text += `📄 Sahifa: ${page + 1} / ${totalPages}\n`;
  }
  text += `\n`;
  text += `💡 Faqat kelmagan o'quvchilarni belgilang.\n`;
  text += `Belgilanmaganlar avtomatik ✅ Bor deb hisoblanadi.\n\n`;

  const keyboard = new InlineKeyboard();
  students.forEach((s) => {
    const mark = s.isAbsent ? " ❌" : " ✅";
    keyboard.text(`${s.fullName}${mark}`, `att_toggle:${s.id}`).row();
  });

  if (totalPages > 1) {
    if (page > 0) {
      keyboard.text("◀️ Orqaga", `att_page:${page - 1}`);
    }
    if (page < totalPages - 1) {
      keyboard.text("Keyingisi ➡️", `att_page:${page + 1}`);
    }
    keyboard.row();
  }

  keyboard.text("💾 Saqlash va yakunlash", "att_save").row();
  keyboard.text("🔙 Sinf tanlash", "att_menu");

  return { text, keyboard };
}

/**
 * Phase 5: Per-student status picker. Shown when a teacher taps a
 * student in the roll-call list.
 */
export function attendanceStudentMark(params: {
  studentId: number;
  studentName: string;
  currentStatus: string | null;
  className: string;
  date: string; // already-encoded date string for callback
}): { text: string; keyboard: InlineKeyboard } {
  const statusEmoji: Record<string, string> = {
    PRESENT: "✅ ",
    ABSENT: "❌ ",
    LATE: "⏰ ",
    EXCUSED: "📝 ",
  };
  const currentLabel = params.currentStatus
    ? `${statusEmoji[params.currentStatus] || ""}${params.currentStatus}`
    : "Belgilanmagan";

  return {
    text:
      `${header("👤 Davomat belgilash")}${divider()}\n\n` +
      `O'quvchi: ${params.studentName}\n` +
      `Sinf: ${params.className}\n` +
      `Joriy holat: ${currentLabel}\n\n` +
      `Holatni tanlang:`,
    keyboard: new InlineKeyboard()
      .text("✅ Bor", `att_mark:${params.studentId}:PRESENT`)
      .row()
      .text("❌ Yo'q", `att_mark:${params.studentId}:ABSENT`)
      .row()
      .text("⏰ Kechikdi", `att_mark:${params.studentId}:LATE`)
      .row()
      .text("📝 Sababli", `att_mark:${params.studentId}:EXCUSED`)
      .row()
      .text("◀️ Orqaga", "att_back_to_roll"),
  };
}

/**
 * Phase 5: Save-confirmation screen. Shows a summary of the marked
 * attendance before the teacher confirms.
 */
export function attendanceSavePreview(params: {
  className: string;
  dateLabel: string;
  subject?: string;
  teacherName?: string;
  totalCount: number;
  presentCount: number;
  absentCount: number;
  absentStudents: Array<{ fullName: string }>;
}): { text: string; keyboard: InlineKeyboard } {
  let text =
    `${header("📋 Davomatni tasdiqlaysizmi?")}${divider()}\n\n` +
    `🏫 Sinf: ${params.className}\n`;
  if (params.subject) text += `📚 Fan: ${params.subject}\n`;
  if (params.teacherName) text += `👨‍🏫 O'qituvchi: ${params.teacherName}\n`;
  text += `📅 ${params.dateLabel}\n\n`;
  text += `👨‍🎓 Jami: ${params.totalCount}\n`;
  text += `✅ Kelgan: ${params.presentCount}\n`;
  text += `❌ Kelmagan: ${params.absentCount}\n`;

  if (params.absentStudents.length > 0) {
    text += `\nKelmaganlar:\n`;
    for (const s of params.absentStudents) {
      text += `• ${s.fullName}\n`;
    }
  }

  return {
    text,
    keyboard: new InlineKeyboard()
      .text("✅ Tasdiqlash", "att_confirm_save")
      .row()
      .text("◀️ Orqaga", "att_back_to_roll")
      .row()
      .text("❌ Bekor qilish", "att_cancel"),
  };
}

/**
 * Phase 5: Attendance saved-success screen.
 */
export function attendanceSaved(params: {
  className: string;
  dateLabel: string;
  savedCount: number;
  failedCount: number;
  notifiedParents: number;
  escalated: boolean;
}): { text: string; keyboard: InlineKeyboard } {
  let text =
    `${header("✅ Davomat saqlandi")}${divider()}\n\n` +
    `Sinf: ${params.className}\n` +
    `Sana: ${params.dateLabel}\n` +
    `Saqlandi: ${params.savedCount} ta o'quvchi\n`;
  if (params.failedCount > 0) {
    text += `Xatolik: ${params.failedCount} ta\n`;
  }
  if (params.notifiedParents > 0) {
    text += `Ota-onalarga xabar yuborildi: ${params.notifiedParents} ta\n`;
  }
  if (params.escalated) {
    text += `🚨 Mahallaga ogohlantirish yuborildi (ketma-ket davom etmagan kunlar).\n`;
  }
  return {
    text,
    keyboard: new InlineKeyboard()
      .text("📋 Bosh sinfni tanlash", "att_menu")
      .row()
      .text("🏠 Bosh menyu", "home"),
  };
}

/**
 * Phase 5: Parent attendance view — shown when a parent opens a child
 * and taps "Davomat".
 */
export function parentAttendanceView(params: {
  childName: string;
  className: string;
  schoolName: string;
  stats: { total: number; present: number; absent: number; late: number; excused: number; percentage: number };
  records: Array<{ date: Date; status: string; note: string | null }>;
  siblings?: Array<{ id: number; fullName: string; className: string }>;
}): { text: string; keyboard: InlineKeyboard } {
  const statusLabel: Record<string, string> = {
    PRESENT: "✅",
    ABSENT: "❌",
    LATE: "⏰",
    EXCUSED: "📝",
  };

  let text =
    `${header("📋 Davomat")}${divider()}\n\n` +
    `Farzand: ${params.childName}\n` +
    `Sinf: ${params.className}\n` +
    `Maktab: ${params.schoolName}\n\n` +
    `📊 Umumiy statistika:\n` +
    `• Jami: ${params.stats.total} kun\n` +
    `• ✅ Bor: ${params.stats.present}\n` +
    `• ❌ Yo'q: ${params.stats.absent}\n` +
    `• ⏰ Kechikdi: ${params.stats.late}\n` +
    `• 📝 Sababli: ${params.stats.excused}\n` +
    `• 📈 Davomat foizi: ${params.stats.percentage}%\n`;

  if (params.records.length > 0) {
    text += `\n📅 So'nggi yozuvlar:\n`;
    const recent = params.records.slice(0, 10);
    for (const r of recent) {
      const dateStr = r.date.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });
      const label = statusLabel[r.status] || r.status;
      text += `${dateStr} — ${label}`;
      if (r.note) text += ` (${r.note})`;
      text += `\n`;
    }
    if (params.records.length > 10) {
      text += `... va yana ${params.records.length - 10} ta yozuv\n`;
    }
  } else {
    text += `\nHozircha davomat yozuvlari yo'q.\n`;
  }

  // Feature #3: multi-child switcher — if the parent has other children,
  // show quick-switch buttons to flip between them without going back.
  const keyboard = new InlineKeyboard();
  if (params.siblings && params.siblings.length > 1) {
    keyboard.text("🔄 Boshqa farzand:", "noop").row();
    for (const sib of params.siblings.slice(0, 5)) {
      keyboard.text(`👤 ${sib.fullName} (${sib.className})`, `view_child_attendance:${sib.id}`).row();
    }
  }
  keyboard.text("◀️ Orqaga", "my_children");

  return { text, keyboard };
}

/**
 * Phase 5: Student own-attendance view. Similar to parent view but
 * without the child-name header.
 */
export function studentAttendanceView(params: {
  stats: { total: number; present: number; absent: number; late: number; excused: number; percentage: number };
  records: Array<{ date: Date; status: string; note: string | null }>;
}): { text: string; keyboard: InlineKeyboard } {
  const statusLabel: Record<string, string> = {
    PRESENT: "✅",
    ABSENT: "❌",
    LATE: "⏰",
    EXCUSED: "📝",
  };

  let text =
    `${header("📋 Mening davomatim")}${divider()}\n\n` +
    `📊 Umumiy statistika:\n` +
    `• Jami: ${params.stats.total} kun\n` +
    `• ✅ Bor: ${params.stats.present}\n` +
    `• ❌ Yo'q: ${params.stats.absent}\n` +
    `• ⏰ Kechikdi: ${params.stats.late}\n` +
    `• 📝 Sababli: ${params.stats.excused}\n` +
    `• 📈 Davomat foizi: ${params.stats.percentage}%\n`;

  if (params.records.length > 0) {
    text += `\n📅 So'nggi yozuvlar:\n`;
    const recent = params.records.slice(0, 10);
    for (const r of recent) {
      const dateStr = r.date.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });
      const label = statusLabel[r.status] || r.status;
      text += `${dateStr} — ${label}`;
      if (r.note) text += ` (${r.note})`;
      text += `\n`;
    }
  } else {
    text += `\nHozircha davomat yozuvlari yo'q.\n`;
  }

  return {
    text,
    keyboard: new InlineKeyboard()
      .text("◀️ Orqaga", "home"),
  };
}

/**
 * Phase 5: Attendance report screen (for SCHOOL_ADMIN / MAHALLA / etc).
 */
export function attendanceReportScreen(params: {
  scope: string;
  totals: { total: number; present: number; absent: number; late: number; excused: number; percentage: number };
  byClass?: Array<{ className: string; total: number; present: number; absent: number; late: number; excused: number; percentage: number }>;
  escalations?: Array<{ studentName: string; className: string; schoolName: string; absenceCount: number; thresholdDate: Date }>;
  dateRange: string;
}): { text: string; keyboard: InlineKeyboard } {
  let text =
    `${header("📊 Davomat hisoboti")}${divider()}\n\n` +
    `Doira: ${params.scope}\n` +
    `Davr: ${params.dateRange}\n\n` +
    `📊 Umumiy:\n` +
    `• Jami yozuvlar: ${params.totals.total}\n` +
    `• ✅ Bor: ${params.totals.present}\n` +
    `• ❌ Yo'q: ${params.totals.absent}\n` +
    `• ⏰ Kechikdi: ${params.totals.late}\n` +
    `• 📝 Sababli: ${params.totals.excused}\n` +
    `• 📈 Foiz: ${params.totals.percentage}%\n`;

  if (params.byClass && params.byClass.length > 0) {
    text += `\n📋 Sinf bo'yicha:\n`;
    for (const c of params.byClass) {
      text += `• ${c.className}: ${c.percentage}% (${c.present}/${c.total} bor, ${c.absent} yo'q)\n`;
    }
  }

  if (params.escalations && params.escalations.length > 0) {
    text += `\n🚨 Ogohlantirishlar (${params.escalations.length}):\n`;
    for (const e of params.escalations.slice(0, 10)) {
      const dateStr = e.thresholdDate.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });
      text += `• ${e.studentName} (${e.className}) — ${e.absenceCount} kun (${dateStr})\n`;
    }
    if (params.escalations.length > 10) {
      text += `... va yana ${params.escalations.length - 10} ta\n`;
    }
  }

  return {
    text,
    keyboard: new InlineKeyboard()
      .text("◀️ Orqaga", "home"),
  };
}

/**
 * Phase 5: Child-detail screen with attendance button added.
 * This wraps the existing child-edit screen with an additional
 * "📋 Davomat" button so parents can view attendance from the
 * child-detail view.
 */
export function childDetailWithAttendance(params: {
  childId: number;
  childName: string;
  className: string;
  schoolName: string;
  verificationStatus: string;
}): { text: string; keyboard: InlineKeyboard } {
  const statusLabel: Record<string, string> = {
    PENDING: "⏳ Tasdiqlash kutilmoqda",
    VERIFIED: "✅ Tasdiqlangan",
    REJECTED: "❌ Rad etilgan",
  };
  const text =
    `${header("👤 Farzand")}${divider()}\n\n` +
    `Ism: ${params.childName}\n` +
    `Sinf: ${params.className}\n` +
    `Maktab: ${params.schoolName}\n` +
    `Holat: ${statusLabel[params.verificationStatus] || params.verificationStatus}`;

  return {
    text,
    keyboard: new InlineKeyboard()
      .text("📋 Davomat", `view_child_attendance:${params.childId}`)
      .row()
      .text("✏️ Tahrirlash", `view_child:${params.childId}`)
      .row()
      .text("◀️ Orqaga", "my_children"),
  };
}

// ─── Phase 7: Reports & Statistics screens ────────────────────────────

/**
 * Phase 7: Report menu — entry point for statistics.
 * Shows time-range options + report types.
 * Only options the user is authorized to use should be shown
 * (the handler decides which to display).
 */
export function reportMenuScreen(canExport: boolean = false): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const kb = new InlineKeyboard()
    .text("📅 Bugungi davomat", "report:today")
    .row()
    .text("📆 Haftalik", "report:week")
    .row()
    .text("📅 Oylik", "report:month")
    .row()
    .text("📈 Davomat statistikasi", "report:stats")
    .row()
    .text("🚨 Davomat muammolari", "report:escalations")
    .row();
  if (canExport) {
    kb.text("📥 CSV eksport", "report:export").row();
  }
  kb.text("◀️ Orqaga", "back_to_admin_menu");
  return {
    text: `${header("📊 Hisobotlar")}${divider()}\n\nHisobot turini tanlang:`,
    keyboard: kb,
  };
}

/**
 * Phase 7: Detailed report screen — shows totals + byClass + trend + escalations.
 */
export function detailedReportScreen(params: {
  scope: string;
  dateRangeLabel: string;
  totals: {
    total: number; present: number; absent: number; late: number; excused: number;
    attendanceRate: number; absenceRate: number; lateRate: number; excusedRate: number;
  };
  byClass?: Array<{ className: string; total: number; present: number; absent: number; late: number; excused: number; attendanceRate: number; studentCount: number }>;
  trend?: Array<{ date: Date; present: number; absent: number; late: number; excused: number; total: number; attendanceRate: number }>;
  escalations?: { total: number; unresolved: number; resolved: number };
  totalStudents?: number;
}): { text: string; keyboard: InlineKeyboard } {
  let text =
    `${header("📊 Davomat hisoboti")}${divider()}\n\n` +
    `Doira: ${params.scope}\n` +
    `Davr: ${params.dateRangeLabel}\n`;

  if (params.totalStudents !== undefined) {
    text += `👥 Jami o'quvchilar: ${params.totalStudents}\n`;
  }

  text += `\n📊 Umumiy:\n` +
    `• Jami yozuvlar: ${params.totals.total}\n` +
    `• ✅ Bor: ${params.totals.present} (${params.totals.attendanceRate}%)\n` +
    `• ❌ Yo'q: ${params.totals.absent} (${params.totals.absenceRate}%)\n` +
    `• ⏰ Kechikdi: ${params.totals.late} (${params.totals.lateRate}%)\n` +
    `• 📝 Sababli: ${params.totals.excused} (${params.totals.excusedRate}%)\n`;

  if (params.byClass && params.byClass.length > 0) {
    text += `\n📋 Sinf bo'yicha:\n`;
    for (const c of params.byClass.slice(0, 15)) {
      text += `• ${c.className}: ${c.attendanceRate}% (${c.present}/${c.total} bor, ${c.absent} yo'q, ${c.studentCount} o'quvchi)\n`;
    }
    if (params.byClass.length > 15) {
      text += `... va yana ${params.byClass.length - 15} ta sinf\n`;
    }
  }

  if (params.trend && params.trend.length > 0) {
    text += `\n📈 Kunlik trend:\n`;
    for (const t of params.trend.slice(0, 10)) {
      const dateStr = t.date.toLocaleDateString("uz-UZ", { month: "2-digit", day: "2-digit" });
      text += `• ${dateStr}: ${t.attendanceRate}% (${t.present} bor, ${t.absent} yo'q)\n`;
    }
    if (params.trend.length > 10) {
      text += `... va yana ${params.trend.length - 10} kun\n`;
    }
  }

  if (params.escalations && params.escalations.total > 0) {
    text += `\n🚨 Ogohlantirishlar:\n`;
    text += `• Jami: ${params.escalations.total}\n`;
    text += `• Faol (hal qilinmagan): ${params.escalations.unresolved}\n`;
    text += `• Hal qilingan: ${params.escalations.resolved}\n`;
  }

  return {
    text,
    keyboard: new InlineKeyboard()
      .text("◀️ Hisobotlar menyusi", "report_menu")
      .row()
      .text("🏠 Bosh menyu", "home"),
  };
}

/**
 * Phase 7: Escalation statistics screen.
 */
export function escalationReportScreen(params: {
  scope: string;
  stats: { total: number; unresolved: number; resolved: number };
  bySchool?: Array<{ schoolName: string; count: number }>;
  byNeighborhood?: Array<{ neighborhoodId: number; count: number }>;
}): { text: string; keyboard: InlineKeyboard } {
  let text =
    `${header("🚨 Davomat muammolari")}${divider()}\n\n` +
    `Doira: ${params.scope}\n\n` +
    `📊 Umumiy:\n` +
    `• Jami ogohlantirishlar: ${params.stats.total}\n` +
    `• Faol (hal qilinmagan): ${params.stats.unresolved}\n` +
    `• Hal qilingan: ${params.stats.resolved}\n`;

  if (params.bySchool && params.bySchool.length > 0) {
    text += `\n🏫 Maktab bo'yicha:\n`;
    for (const s of params.bySchool.slice(0, 10)) {
      text += `• ${s.schoolName}: ${s.count} ta\n`;
    }
  }

  if (params.byNeighborhood && params.byNeighborhood.length > 0) {
    text += `\n🏘 Mahalla bo'yicha:\n`;
    for (const n of params.byNeighborhood.slice(0, 10)) {
      text += `• Mahalla #${n.neighborhoodId}: ${n.count} ta\n`;
    }
  }

  return {
    text,
    keyboard: new InlineKeyboard()
      .text("◀️ Hisobotlar menyusi", "report_menu")
      .row()
      .text("🏠 Bosh menyu", "home"),
  };
}

