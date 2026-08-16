// Category to Responsibility mapping
// This centralized mapping determines which admin responsibility should handle a complaint category

export const CATEGORY_TO_RESPONSIBILITY: Record<string, string> = {
  // School categories
  "📚 Ta'lim jarayoni": "EDUCATION",
  "👨‍🏫 O'qituvchi bilan bog'liq masala": "EDUCATION",
  "👦 O'quvchi bilan bog'liq masala": "STUDENT_AFFAIRS",
  "⚠️ Xavfsizlik": "DISCIPLINE",
  "🏫 Maktab sharoiti": "EDUCATION",
  "📝 Boshqa": "COMPLAINT_MANAGER",

  // Neighborhood categories
  "🏘 Mahalla muammosi": "COMPLAINT_MANAGER",
  "💡 Infratuzilma": "COMPLAINT_MANAGER",
  "🧑‍👩‍👧 Ijtimoiy masala": "SOCIAL_WORKER",
  "🏫 Ta'lim bilan bog'liq masala": "EDUCATION",
};

// Responsibility display names (Uzbek)
export const RESPONSIBILITY_LABELS: Record<string, string> = {
  COMPLAINT_MANAGER: "Murojaatlar menedjeri",
  PSYCHOLOGIST: "Maktab psixologi",
  SOCIAL_WORKER: "Ijtimoiy pedagog",
  EDUCATION: "O'quv ishlari mas'uli",
  DISCIPLINE: "Intizom mas'uli",
  STUDENT_AFFAIRS: "O'quvchi ishlari mas'uli",
};

export const routingService = {
  /**
   * Get the recommended responsibility for a given category
   */
  getResponsibilityForCategory(category: string): string | null {
    return CATEGORY_TO_RESPONSIBILITY[category] || "COMPLAINT_MANAGER";
  },

  /**
   * Get the display label for a responsibility
   */
  getResponsibilityLabel(responsibility: string): string {
    return RESPONSIBILITY_LABELS[responsibility] || responsibility;
  },

  /**
   * Check if a category maps to a specific responsibility
   */
  categoryMatchesResponsibility(category: string, responsibility: string): boolean {
    return this.getResponsibilityForCategory(category) === responsibility;
  },
};
