/**
 * Student Registry Excel Importer
 *
 * Reads an Excel file containing the school's student list and imports
 * (or updates) Student records in the database.
 *
 * Safety:
 * - Never deletes existing records.
 * - Never unlinks a student from their parent.
 * - Existing students: updates registry-owned fields only.
 * - New students: parentId = null, verificationStatus = PENDING.
 * - --dry-run performs reads only and makes no database changes.
 *
 * Usage:
 *   npm run import:students -- --file ./students.xlsx --school "258-son maktab"
 *   npm run import:students -- --file ./students.xlsx --school 1
 *   npm run import:students -- --file ./students.xlsx --school "258-son maktab" --dry-run
 */

import * as XLSX from "xlsx";
import { prisma } from "./prisma";

// ─── Types ────────────────────────────────────────────────────────────

interface ParsedRow {
  rowNumber: number;
  fullName: string;
  birthDate: Date | null;
  pinfl: string | null;
  className: string;
  errors: string[];
}

interface ValidatedStudent {
  fullName: string;
  birthDate: Date | null;
  pinfl: string | null;
  className: string;
  rowNumber: number;
}

interface ExistingStudent {
  id: number;
  parentId: number | null;
  schoolId: number;
  fullName: string;
  birthDate: Date | null;
  pinfl: string | null;
}

interface ImportReport {
  school: string;
  file: string;
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicatePinflInExcel: number;
  missingPinfl: number;
  newStudents: number;
  existingStudents: number;
  updatedStudents: number;
  skippedStudents: number;
  linkedPreserved: number;
  errors: string[];
  classDistribution: Record<string, number>;
  dateParseFailures: number;
}

// ─── CLI argument parsing ─────────────────────────────────────────────

function parseArgs(): {
  file: string;
  school: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);

  let file = "";
  let school = "";
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && i + 1 < args.length) {
      file = args[++i];
    } else if (args[i] === "--school" && i + 1 < args.length) {
      school = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  if (!file) {
    console.error(
      "❌ --file is required. Example: --file ./students.xlsx"
    );
    process.exit(1);
  }

  if (!school) {
    console.error(
      '❌ --school is required. Example: --school "258-son maktab"'
    );
    process.exit(1);
  }

  return { file, school, dryRun };
}

// ─── PINFL masking ────────────────────────────────────────────────────

function maskPinfl(pinfl: string | null): string {
  if (!pinfl) return "(null)";
  if (pinfl.length <= 4) return "****";
  return "****" + pinfl.slice(-4);
}

// ─── Date parsing ─────────────────────────────────────────────────────

function parseDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return raw;
  }

  const str = String(raw).trim();

  if (!str) return null;

  // DD/MM/YYYY
  let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);

    const d = new Date(year, month - 1, day);

    if (
      d.getFullYear() !== year ||
      d.getMonth() !== month - 1 ||
      d.getDate() !== day
    ) {
      return null;
    }

    return d;
  }

  // DD.MM.YYYY
  m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);

    const d = new Date(year, month - 1, day);

    if (
      d.getFullYear() !== year ||
      d.getMonth() !== month - 1 ||
      d.getDate() !== day
    ) {
      return null;
    }

    return d;
  }

  // YYYY-MM-DD
  m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);

    const d = new Date(year, month - 1, day);

    if (
      d.getFullYear() !== year ||
      d.getMonth() !== month - 1 ||
      d.getDate() !== day
    ) {
      return null;
    }

    return d;
  }

  // Last resort
  const fallback = new Date(str);

  if (!isNaN(fallback.getTime())) {
    return fallback;
  }

  return null;
}

// ─── PINFL normalization ──────────────────────────────────────────────

function normalizePinfl(raw: unknown): {
  pinfl: string | null;
  error: string | null;
} {
  if (raw === null || raw === undefined || raw === "") {
    return {
      pinfl: null,
      error: null,
    };
  }

  let str: string;

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      return {
        pinfl: null,
        error: `PINFL is a non-integer number: ${raw}`,
      };
    }

    str = String(Math.floor(raw));
  } else {
    str = String(raw).trim();
  }

  str = str.replace(/[\s\-]/g, "");

  if (str === "") {
    return {
      pinfl: null,
      error: null,
    };
  }

  if (!/^\d{14}$/.test(str)) {
    return {
      pinfl: null,
      error: `Invalid PINFL format (expected 14 digits, got "${maskPinfl(
        str
      )}" length=${str.length})`,
    };
  }

  return {
    pinfl: str,
    error: null,
  };
}

// ─── Name normalization ───────────────────────────────────────────────

function normalizeName(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return "";
  }

  return String(raw)
    .trim()
    .replace(/\s+/g, " ");
}

// ─── Class normalization ──────────────────────────────────────────────

function normalizeClass(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return "";
  }

  return String(raw).trim();
}

// ─── Name key for matching ───────────────────────────────────────────

function normalizeNameKey(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

// ─── Date key for matching ───────────────────────────────────────────

function dateKey(date: Date | null): string {
  if (!date) return "null";

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

// ─── Fallback identity key ───────────────────────────────────────────

function fallbackStudentKey(
  schoolId: number,
  fullName: string,
  birthDate: Date | null
): string {
  return [
    schoolId,
    normalizeNameKey(fullName),
    dateKey(birthDate),
  ].join("|");
}

// ─── School resolution ────────────────────────────────────────────────

async function resolveSchool(
  schoolArg: string
): Promise<{ id: number; name: string }> {
  const numericId = Number(schoolArg);

  if (!isNaN(numericId) && Number.isInteger(numericId)) {
    const school = await prisma.school.findUnique({
      where: {
        id: numericId,
      },
    });

    if (school) {
      return {
        id: school.id,
        name: school.name,
      };
    }
  }

  const school = await prisma.school.findFirst({
    where: {
      name: {
        equals: schoolArg,
        mode: "insensitive",
      },
    },
  });

  if (school) {
    return {
      id: school.id,
      name: school.name,
    };
  }

  const partial = await prisma.school.findFirst({
    where: {
      name: {
        contains: schoolArg,
        mode: "insensitive",
      },
    },
  });

  if (partial) {
    return {
      id: partial.id,
      name: partial.name,
    };
  }

  console.error(`❌ School not found: "${schoolArg}"`);
  console.error("Available schools:");

  const allSchools = await prisma.school.findMany({
    orderBy: {
      name: "asc",
    },
  });

  for (const s of allSchools) {
    console.error(`  ${s.id}: ${s.name}`);
  }

  process.exit(1);
}

// ─── Excel parsing ────────────────────────────────────────────────────

function parseExcel(filePath: string): ParsedRow[] {
  const workbook = XLSX.readFile(filePath);

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    console.error("❌ Excel file has no sheets.");
    process.exit(1);
  }

  const sheet = workbook.Sheets[sheetName];

  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(
    sheet,
    {
      defval: null,
    }
  );

  console.log(
    "Excel headers:",
    Object.keys(rows[0] || {})
  );

  console.log(
    "First row:",
    rows[0]
  );

  return rows.map((row, index) =>
    parseRow(row, index + 2)
  );
}

function parseRow(
  row: Record<string, unknown>,
  rowNumber: number
): ParsedRow {
  const errors: string[] = [];

  // FISH → fullName
  const fullName = normalizeName(row["FISH"]);

  if (!fullName) {
    errors.push("Missing FISH (full name)");
  } else if (fullName.length < 3) {
    errors.push(`FISH too short: "${fullName}"`);
  }

  // Tug'ilgan sana → birthDate
  const rawBirthDate = row["Tug'ilgan sana"];

  const birthDate = parseDate(rawBirthDate);

  if (
    rawBirthDate !== null &&
    rawBirthDate !== undefined &&
    rawBirthDate !== "" &&
    !birthDate
  ) {
    errors.push(`Invalid date: "${rawBirthDate}"`);
  }

  // PINFL → pinfl
  const {
    pinfl,
    error: pinflError,
  } = normalizePinfl(row["PINFL"]);

  if (pinflError) {
    errors.push(pinflError);
  }

  // Sinf → className
  const className = normalizeClass(row["Sinf"]);

  if (!className) {
    errors.push("Missing Sinf (class)");
  } else if (!/^\d+-[A-Z]$/i.test(className)) {
    errors.push(
      `Unexpected class format: "${className}" (expected like "8-A")`
    );
  }

  return {
    rowNumber,
    fullName,
    birthDate,
    pinfl,
    className,
    errors,
  };
}

// ─── Deduplication ────────────────────────────────────────────────────

function deduplicate(
  students: ValidatedStudent[]
): {
  unique: ValidatedStudent[];
  duplicates: {
    student: ValidatedStudent;
    reason: string;
  }[];
} {
  const seenPinfl = new Map<
    string,
    ValidatedStudent
  >();

  const seenNoPinfl = new Map<
    string,
    ValidatedStudent
  >();

  const unique: ValidatedStudent[] = [];

  const duplicates: {
    student: ValidatedStudent;
    reason: string;
  }[] = [];

  for (const student of students) {
    if (student.pinfl) {
      const previous = seenPinfl.get(
        student.pinfl
      );

      if (previous) {
        duplicates.push({
          student,
          reason: `Duplicate PINFL ${maskPinfl(
            student.pinfl
          )} (first seen at row ${previous.rowNumber})`,
        });
      } else {
        seenPinfl.set(
          student.pinfl,
          student
        );

        unique.push(student);
      }
    } else {
      const key = fallbackStudentKey(
        0,
        student.fullName,
        student.birthDate
      ) + `|${student.className}`;

      const previous = seenNoPinfl.get(key);

      if (previous) {
        duplicates.push({
          student,
          reason: `Duplicate (no PINFL): same name+date+class as row ${previous.rowNumber}`,
        });
      } else {
        seenNoPinfl.set(key, student);
        unique.push(student);
      }
    }
  }

  return {
    unique,
    duplicates,
  };
}

// ─── Bulk-load existing students ──────────────────────────────────────

async function loadExistingStudents(
  schoolId: number,
  students: ValidatedStudent[]
): Promise<{
  byPinfl: Map<string, ExistingStudent>;
  byFallbackKey: Map<string, ExistingStudent>;
}> {
  console.log("   Loading existing students from database...");

  const pinfls = students
    .map((s) => s.pinfl)
    .filter(
      (p): p is string => p !== null
    );

  const uniquePinfls = [
    ...new Set(pinfls),
  ];

  console.log(
    `   Looking up ${uniquePinfls.length} PINFLs in bulk...`
  );

  const existingByPinfl =
    uniquePinfls.length > 0
      ? await prisma.student.findMany({
          where: {
            pinfl: {
              in: uniquePinfls,
            },
          },
          select: {
            id: true,
            parentId: true,
            schoolId: true,
            fullName: true,
            birthDate: true,
            pinfl: true,
          },
        })
      : [];

  console.log(
    `   Found ${existingByPinfl.length} existing students by PINFL.`
  );

  const byPinfl =
    new Map<string, ExistingStudent>();

  for (const student of existingByPinfl) {
    if (student.pinfl) {
      byPinfl.set(
        student.pinfl,
        student
      );
    }
  }

  // Load existing NULL-PINFL students for fallback matching.
  const hasNoPinflStudents = students.some(
    (s) => !s.pinfl && s.birthDate
  );

  const byFallbackKey =
    new Map<string, ExistingStudent>();

  if (hasNoPinflStudents) {
    console.log(
      "   Loading NULL-PINFL students for fallback matching..."
    );

    const existingNoPinfl =
      await prisma.student.findMany({
        where: {
          schoolId,
          pinfl: null,
        },
        select: {
          id: true,
          parentId: true,
          schoolId: true,
          fullName: true,
          birthDate: true,
          pinfl: true,
        },
      });

    for (const student of existingNoPinfl) {
      if (student.birthDate) {
        const key = fallbackStudentKey(
          student.schoolId,
          student.fullName,
          student.birthDate
        );

        byFallbackKey.set(
          key,
          student
        );
      }
    }

    console.log(
      `   Loaded ${existingNoPinfl.length} NULL-PINFL students for fallback matching.`
    );
  }

  return {
    byPinfl,
    byFallbackKey,
  };
}

// ─── Find existing student in memory ──────────────────────────────────

function findExistingInMemory(
  student: ValidatedStudent,
  schoolId: number,
  maps: {
    byPinfl: Map<string, ExistingStudent>;
    byFallbackKey: Map<string, ExistingStudent>;
  }
): ExistingStudent | null {
  if (student.pinfl) {
    const byPinfl = maps.byPinfl.get(
      student.pinfl
    );

    if (byPinfl) {
      return byPinfl;
    }
  }

  if (!student.pinfl && student.birthDate) {
    const key = fallbackStudentKey(
      schoolId,
      student.fullName,
      student.birthDate
    );

    const fallback =
      maps.byFallbackKey.get(key);

    if (fallback) {
      return fallback;
    }
  }

  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const {
    file,
    school: schoolArg,
    dryRun,
  } = parseArgs();

  console.log(
    "╔══════════════════════════════════════════════════╗"
  );
  console.log(
    "║     Student Registry Importer                    ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════╝"
  );

  console.log();

  console.log(`File:   ${file}`);
  console.log(`School: ${schoolArg}`);
  console.log(
    `Mode:   ${
      dryRun
        ? "DRY RUN (no DB changes)"
        : "LIVE"
    }`
  );

  console.log();

  // ─── Resolve school ────────────────────────────────────────────────

  const school =
    await resolveSchool(schoolArg);

  console.log(
    `✅ School resolved: ${school.name} (id=${school.id})`
  );

  console.log();

  // ─── Parse Excel ───────────────────────────────────────────────────

  console.log("📖 Parsing Excel...");

  const parsedRows =
    parseExcel(file);

  console.log(
    `   Parsed ${parsedRows.length} rows.`
  );

  console.log();

  // ─── Validation ───────────────────────────────────────────────────

  const validRows: ValidatedStudent[] =
    [];

  const invalidRows: ParsedRow[] = [];

  const errors: string[] = [];

  let dateParseFailures = 0;

  for (const row of parsedRows) {
    if (row.errors.length > 0) {
      const hasDateError =
        row.errors.some((e) =>
          e.includes("Invalid date")
        );

      if (hasDateError) {
        dateParseFailures++;
      }

      invalidRows.push(row);

      for (const err of row.errors) {
        errors.push(
          `Row ${row.rowNumber}: ${err}`
        );
      }
    } else {
      validRows.push({
        fullName: row.fullName,
        birthDate: row.birthDate,
        pinfl: row.pinfl,
        className: row.className,
        rowNumber: row.rowNumber,
      });
    }
  }

  // ─── Deduplication ─────────────────────────────────────────────────

  console.log("🔍 Deduplicating...");

  const {
    unique,
    duplicates,
  } = deduplicate(validRows);

  console.log(
    `   ${duplicates.length} duplicate(s) detected in Excel.`
  );

  console.log();

  for (const duplicate of duplicates) {
    errors.push(
      `Row ${duplicate.student.rowNumber}: ${duplicate.reason}`
    );
  }

  // ─── Class distribution ────────────────────────────────────────────

  const classDistribution: Record<
    string,
    number
  > = {};

  for (const student of unique) {
    classDistribution[
      student.className
    ] =
      (classDistribution[
        student.className
      ] || 0) + 1;
  }

  // ─── Missing PINFL count ────────────────────────────────────────────

  const missingPinfl =
    unique.filter(
      (student) => !student.pinfl
    ).length;

  // ─── Bulk database lookup ──────────────────────────────────────────

  console.log(
    dryRun
      ? "🔍 Checking against database (dry run)..."
      : "💾 Preparing database import..."
  );

  const maps =
    await loadExistingStudents(
      school.id,
      unique
    );

  console.log(
    "   ✅ Database matching data loaded."
  );

  console.log();

  // ─── Match students in memory ─────────────────────────────────────

  let newStudents = 0;
  let existingStudents = 0;
  let updatedStudents = 0;
  let skippedStudents = 0;
  let linkedPreserved = 0;

  const newRecords: ValidatedStudent[] =
    [];

  const updates: {
    student: ValidatedStudent;
    existing: ExistingStudent;
  }[] = [];

  console.log(
    "🔍 Matching students in memory..."
  );

  for (
    let i = 0;
    i < unique.length;
    i++
  ) {
    const student = unique[i];

    const existing =
      findExistingInMemory(
        student,
        school.id,
        maps
      );

    if (existing) {
      existingStudents++;

      if (existing.parentId !== null) {
        linkedPreserved++;
      }

      if (dryRun) {
        updatedStudents++;
      } else {
        updates.push({
          student,
          existing,
        });
      }
    } else {
      newStudents++;

      if (!dryRun) {
        newRecords.push(student);
      }
    }

    const processed = i + 1;

    if (
      processed % 200 === 0 ||
      processed === unique.length
    ) {
      console.log(
        `   Processed ${processed}/${unique.length}...`
      );
    }
  }

  // ─── Dry-run ends here ──────────────────────────────────────────────

  if (!dryRun) {
    console.log();
    console.log(
      `💾 Applying ${updates.length} updates and ${newRecords.length} new students...`
    );

    const WRITE_BATCH_SIZE = 50;

    // Updates
    for (
      let i = 0;
      i < updates.length;
      i += WRITE_BATCH_SIZE
    ) {
      const batch =
        updates.slice(
          i,
          i + WRITE_BATCH_SIZE
        );

      await prisma.$transaction(
        async (tx) => {
          for (const item of batch) {
            await tx.student.update({
              where: {
                id: item.existing.id,
              },
              data: {
                fullName: item.student.fullName,
                className: item.student.className,
                birthDate: item.student.birthDate,
                pinfl: item.student.pinfl,
              },
            });
          }
        },
        {
          timeout: 30000,
        }
      );

      console.log(
        `   Updated ${Math.min(
          i + WRITE_BATCH_SIZE,
          updates.length
        )}/${updates.length}...`
      );
    }

    // New records
    for (
      let i = 0;
      i < newRecords.length;
      i += WRITE_BATCH_SIZE
    ) {
      const batch = newRecords.slice(
        i,
        i + WRITE_BATCH_SIZE
      );

      await prisma.student.createMany({
        data: batch.map((student) => ({
          parentId: null,
          schoolId: school.id,
          fullName: student.fullName,
          className: student.className,
          pinfl: student.pinfl,
          birthDate: student.birthDate,
          verificationStatus: "PENDING",
        })),
      });

      console.log(
        `   Created ${Math.min(
          i + WRITE_BATCH_SIZE,
          newRecords.length
        )}/${newRecords.length}...`
      );
    }
  }
  // ─── Report ────────────────────────────────────────────────────────

  console.log();

  console.log(
    "╔══════════════════════════════════════════════════╗"
  );
  console.log(
    "║             Import Report                       ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════╝"
  );

  console.log();

  console.log(
    `School:                    ${school.name}`
  );

  console.log(
    `File:                      ${file}`
  );

  console.log(
    `Mode:                      ${
      dryRun ? "DRY RUN" : "LIVE"
    }`
  );

  console.log();

  console.log(
    `Total Excel rows:          ${parsedRows.length}`
  );

  console.log(
    `Valid rows:                ${validRows.length}`
  );

  console.log(
    `Invalid rows:              ${invalidRows.length}`
  );

  console.log(
    `Duplicate PINFL (Excel):   ${
      duplicates.filter((d) =>
        d.reason.includes("PINFL")
      ).length
    }`
  );

  console.log(
    `Duplicate (no PINFL):      ${
      duplicates.filter(
        (d) =>
          !d.reason.includes("PINFL")
      ).length
    }`
  );

  console.log(
    `Missing PINFL:             ${missingPinfl}`
  );

  console.log(
    `Date parse failures:       ${dateParseFailures}`
  );

  console.log();

  console.log(
    `New students:              ${newStudents}`
  );

  console.log(
    `Existing students:         ${existingStudents}`
  );

  console.log(
    `Updated students:          ${
      dryRun
        ? existingStudents
        : updates.length
    }`
  );

  console.log(
    `Skipped students:          ${skippedStudents}`
  );

  console.log();

  console.log(
    `Linked students preserved: ${linkedPreserved}`
  );

  console.log();

  // ─── Class distribution ────────────────────────────────────────────

  console.log(
    "Class distribution:"
  );

  const sortedClasses =
    Object.entries(
      classDistribution
    ).sort(
      ([a], [b]) =>
        a.localeCompare(
          b,
          undefined,
          { numeric: true }
        )
    );

  for (const [
    cls,
    count,
  ] of sortedClasses) {
    console.log(
      `  ${cls}: ${count}`
    );
  }

  console.log();

  // ─── Errors ────────────────────────────────────────────────────────

  if (errors.length > 0) {
    console.log(
      `Errors (${errors.length}):`
    );

    for (const error of errors) {
      console.log(
        `  - ${error}`
      );
    }

    console.log();
  }

  // ─── Completion ────────────────────────────────────────────────────

  if (dryRun) {
    console.log(
      "✅ Dry run complete — no database changes were made."
    );

    console.log(
      "   Review the report above, then run without --dry-run to apply."
    );
  } else {
    console.log(
      "✅ Import complete."
    );
  }

  await prisma.$disconnect();

}


// ─── Run ─────────────────────────────────────────────────────────────

main().catch(async (err) => {
  console.error(
    "❌ Fatal error:",
    err
  );

  await prisma.$disconnect();

  process.exit(1);
});