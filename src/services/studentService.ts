import { StudentVerificationStatus } from "@prisma/client";
import { studentRepo } from "../repositories/studentRepo";
import { userRepo } from "../repositories/userRepo";
import { schoolRepo } from "../repositories/schoolRepo";
import { familyRepo } from "../repositories/familyRepo";
import { notificationService } from "./notificationService";
import { matchStudentName, normalizeName, tokenizeName, MatchConfidence } from "../utils/studentNameMatcher";

export interface ClaimCandidate {
  id: number;
  fullName: string;
  className: string;
  birthDate: Date | null;
  pinfl: string | null;
  score: number;
  confidence: MatchConfidence;
}

export const studentService = {
  // ─── OLD registerChild — DEPRECATED ───────────────────────────────
  // Kept for backward compatibility but should NOT be called from the
  // new childRegistration conversation. The new flow uses claimChild.
  async registerChild(params: {
    parentId: number;
    parentFullName: string;
    parentPhone: string;
    childFullName: string;
    className: string;
    schoolName: string;
  }) {
    await userRepo.updateFullName(params.parentId, params.parentFullName);
    await userRepo.updatePhone(params.parentId, params.parentPhone);

    const school = await schoolRepo.findById(
      await this.getSchoolIdByName(params.schoolName)
    );

    if (!school) {
      throw new Error(`Maktab topilmadi: ${params.schoolName}`);
    }

    const existing = await studentRepo.findByParentAndNameAndClass(
      params.parentId,
      params.childFullName,
      params.className
    );

    if (existing) {
      throw new Error("Bu farzand allaqachon ro'yxatdan o'tgan");
    }

    let student;
    try {
      student = await studentRepo.create({
        parentId: params.parentId,
        schoolId: school.id,
        fullName: params.childFullName,
        className: params.className,
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new Error("Bu farzand allaqachon ro'yxatdan o'tgan");
      }
      throw error;
    }

    await notificationService.notifySchoolAdminsNewStudent(student, school);
    return student;
  },

  // ─── NEW: Registry-based child claiming ───────────────────────────

  /**
   * Search the official school registry for unlinked students matching
   * the parent's input. Returns ranked candidates.
   *
   * School-scoped: only searches within parent.schoolId.
   * Only returns students with parentId = null (unclaimed).
   *
   * @param schoolId The parent's school ID
   * @param inputName The parent's raw input (e.g. "Muhammad Aliyev")
   * @returns Ranked candidates sorted by score (descending)
   */
  async searchClaimCandidates(schoolId: number, inputName: string): Promise<ClaimCandidate[]> {
    const normalized = normalizeName(inputName);
    const tokens = tokenizeName(normalized);

    if (tokens.length === 0) return [];

    // DB-level filter: find unlinked students in this school whose fullName
    // contains any of the input tokens (case-insensitive ILIKE).
    const dbCandidates = await studentRepo.searchUnlinkedBySchool(schoolId, tokens);

    if (dbCandidates.length === 0) return [];

    // Application-level fuzzy matching: score each candidate
    const scored: ClaimCandidate[] = dbCandidates.map((s) => {
      const match = matchStudentName(inputName, s.fullName);
      return {
        id: s.id,
        fullName: s.fullName,
        className: s.className,
        birthDate: s.birthDate,
        pinfl: s.pinfl,
        score: match.score,
        confidence: match.confidence,
      };
    });

    // Filter out LOW confidence matches (score < 0.5)
    const filtered = scored.filter((s) => s.score >= 0.5);

    // Sort by score descending
    filtered.sort((a, b) => b.score - a.score);

    return filtered;
  },

  /**
   * Search for a student by PINFL (optional fallback).
   * Only returns unlinked students in the specified school.
   */
  async searchByPinfl(schoolId: number, pinfl: string): Promise<ClaimCandidate | null> {
    const student = await studentRepo.findUnlinkedByPinfl(pinfl, schoolId);
    if (!student) return null;
    return {
      id: student.id,
      fullName: student.fullName,
      className: student.className,
      birthDate: student.birthDate,
      pinfl: student.pinfl,
      score: 1.0,
      confidence: "HIGH" as MatchConfidence,
    };
  },

  /**
   * Check if a student with the given PINFL is already claimed.
   * Returns true if the student exists but has a parent linked.
   */
  async isStudentAlreadyClaimed(pinfl: string, schoolId: number): Promise<boolean> {
    const student = await studentRepo.findByPinflAndSchool(pinfl, schoolId);
    return student !== null && student.parentId !== null;
  },

  /**
   * Atomically claim a student for a parent.
   *
   * Uses a database transaction with row-level locking (SELECT FOR UPDATE)
   * to prevent race conditions: if two parents try to claim the same
   * student simultaneously, only one will succeed.
   *
   * Defense-in-depth: the schoolId is passed to claimStudent so the DB
   * can verify the student belongs to the parent's school — even if a
   * parent somehow obtains a student ID from another school.
   *
   * @returns The claimed student if successful, or null if the student was
   *          already claimed by someone else or doesn't belong to the school.
   */
  async claimChild(studentId: number, parentId: number, schoolId: number): Promise<any | null> {
    const claimed = await studentRepo.claimStudent(studentId, parentId, schoolId);

    if (claimed) {
      // Phase 3: also link the student to the parent's family (if they have one)
      const family = await familyRepo.findFamilyByUserId(parentId);
      if (family) {
        await familyRepo.addStudentToFamily(family.id, studentId);
      }

      // Phase 5+: No longer notify school admins about verification
      // requests. Students are auto-verified on claim because they
      // are pre-validated via Excel import. The old
      // notifySchoolAdminsNewStudent notification is removed.
    }

    return claimed;
  },

  // ─── Existing methods (unchanged) ─────────────────────────────────

  async approveStudent(studentId: number, schoolId: number) {
    const student = await studentRepo.findByIdForSchool(studentId, schoolId);
    if (!student) {
      throw new Error("O'quvchi topilmadi yoki ruxsat yo'q");
    }

    // Idempotency check: if already verified, don't re-notify or re-update.
    if (student.verificationStatus === StudentVerificationStatus.VERIFIED) {
      return student;
    }

    const updated = await studentRepo.updateVerificationStatus(
      studentId,
      StudentVerificationStatus.VERIFIED
    );

    if (student.parentId !== null) {
      await notificationService.notifyParentVerificationStatus(
        student.parentId,
        student.fullName,
        "VERIFIED"
      );
    }

    return updated;
  },

  async rejectStudent(studentId: number, schoolId: number) {
    const student = await studentRepo.findByIdForSchool(studentId, schoolId);
    if (!student) {
      throw new Error("O'quvchi topilmadi yoki ruxsat yo'q");
    }

    // Idempotency check: if already rejected, don't re-notify or re-update.
    if (student.verificationStatus === StudentVerificationStatus.REJECTED) {
      return student;
    }

    const updated = await studentRepo.updateVerificationStatus(
      studentId,
      StudentVerificationStatus.REJECTED
    );

    if (student.parentId !== null) {
      await notificationService.notifyParentVerificationStatus(
        student.parentId,
        student.fullName,
        "REJECTED"
      );
    }

    return updated;
  },

  async listVerifiedStudentsByParent(parentId: number) {
    const students = await studentRepo.listByParent(parentId);
    return students.filter((s) => s.verificationStatus === StudentVerificationStatus.VERIFIED);
  },

  async listAllStudentsByParent(parentId: number) {
    return studentRepo.listByParent(parentId);
  },

  async getSchoolIdByName(name: string): Promise<number> {
    const school = await schoolRepo.findById(
      (await schoolRepo.listAll()).find((s) => s.name === name)?.id || 0
    );
    if (!school) {
      throw new Error(`Maktab topilmadi: ${name}`);
    }
    return school.id;
  },
};
