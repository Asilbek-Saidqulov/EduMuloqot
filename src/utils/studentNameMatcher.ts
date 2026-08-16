/**
 * Intelligent Uzbek student name matcher.
 *
 * Designed specifically for matching parent-entered names against the
 * official school registry's FISH (F.I.Sh — Familiya Ism Sharif).
 *
 * Handles:
 * - Case differences (ALIYEV ≡ aliyev)
 * - Whitespace normalization (collapse multiple spaces)
 * - Apostrophe/tutuq belgisi variants (' ' ' ʻ ʼ → ')
 * - Tokenization (split into name parts)
 * - Patronymic recognition (o'g'li, qizi, o'g'li, ovich, evna, etc.)
 * - Order-independent matching (Muhammad Aliyev ≡ Aliyev Muhammad)
 * - Missing patronymic (Aliyev Muhammad matches Aliyev Muhammad Anvar o'g'li)
 * - Minor spelling differences via Levenshtein distance
 * - Confidence scoring (HIGH / MEDIUM / LOW)
 *
 * Usage:
 *   const result = matchStudentName("Muhammad Aliyev", "Aliyev Muhammad Anvar o'g'li");
 *   // result = { score: 0.96, confidence: "HIGH", matchedTokens: ["ALIYEV", "MUHAMMAD"] }
 */

// ─── Types ────────────────────────────────────────────────────────────

export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface StudentNameMatch {
  /** 0.0 – 1.0 */
  score: number;
  confidence: MatchConfidence;
  /** Which tokens from the input matched registry tokens */
  matchedTokens: string[];
}

// ─── Constants ────────────────────────────────────────────────────────

/** Patronymic suffixes — these are stripped/ignored for matching purposes. */
const PATRONYMIC_SUFFIXES = new Set([
  "OGLI", "OGLI", "G'LI", "GLI",
  "QIZI", "QIZI",
  "OVICH", "EVICH", "OVNA", "EVNA",
  "O'G'LI", "OʻGʻLI", "O‘G‘LI",
]);

/** Minimum token length to consider for matching (filters out single letters). */
const MIN_TOKEN_LENGTH = 2;

/** Levenshtein distance threshold for fuzzy token matching. */
const FUZZY_MAX_DISTANCE = 2;

// ─── Normalization ────────────────────────────────────────────────────

/**
 * Normalize a name string for matching.
 *
 * 1. Convert to uppercase
 * 2. Normalize apostrophe variants: ' ' ' ʻ ʼ ` ´ → '
 * 3. Normalize whitespace (collapse multiple spaces, trim)
 * 4. Remove dots (F.I.Sh. → FISH)
 */
export function normalizeName(raw: string): string {
  if (!raw) return "";
  let s = raw.toUpperCase().trim();
  // Apostrophe normalization: replace all Unicode apostrophe-like chars with ASCII '
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u0060\u00B4\u02BB\u02BC\u02BD\u02BE\u02BF\u02C8\u0301]/g, "'");
  // Also handle ʻ (U+02BB) and ʼ (U+02BC) — already covered above, but double-check
  s = s.replace(/[\u02BB\u02BC]/g, "'");
  // Remove dots (for F.I.Sh. format)
  s = s.replace(/\./g, "");
  // Collapse multiple spaces
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Tokenize a normalized name into meaningful parts.
 *
 * Splits on spaces, filters out empty tokens and single characters.
 * Does NOT filter patronymics here — that's done separately so the
 * matcher can distinguish "has patronymic" vs "doesn't have patronymic".
 */
export function tokenizeName(normalized: string): string[] {
  if (!normalized) return [];
  return normalized
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);
}

/**
 * Check if a token is a patronymic suffix (o'g'li, qizi, ovich, etc.).
 */
function isPatronymic(token: string): boolean {
  const cleaned = token.replace(/'/g, "").replace(/[\u02BB\u02BC]/g, "");
  return PATRONYMIC_SUFFIXES.has(token) || PATRONYMIC_SUFFIXES.has(cleaned);
}

/**
 * Split tokens into "significant" (non-patronymic) and "patronymic".
 * Significant tokens are the actual name parts we match on.
 */
function splitTokens(tokens: string[]): { significant: string[]; patronymics: string[] } {
  const significant: string[] = [];
  const patronymics: string[] = [];
  for (const t of tokens) {
    if (isPatronymic(t)) {
      patronymics.push(t);
    } else {
      significant.push(t);
    }
  }
  return { significant, patronymics };
}

// ─── Levenshtein distance ────────────────────────────────────────────

/**
 * Compute the Levenshtein edit distance between two strings.
 * Used for fuzzy token matching (handles minor typos like Muhamad vs Muhammad).
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Token similarity: 1.0 = exact match, 0.0 = no similarity.
 * Uses Levenshtein distance normalized to 0-1.
 */
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshtein(a, b);
  // Only consider it a fuzzy match if the distance is within threshold
  if (dist > FUZZY_MAX_DISTANCE) return 0.0;
  return 1.0 - dist / maxLen;
}

// ─── Matching algorithm ──────────────────────────────────────────────

/**
 * Match a parent-entered name against a registry student's full name.
 *
 * Algorithm:
 * 1. Normalize both names (case, apostrophes, whitespace).
 * 2. Tokenize both into significant (non-patronymic) tokens.
 * 3. For each input token, find the best-matching registry token
 *    (exact or fuzzy via Levenshtein).
 * 4. Score = weighted average of:
 *    - Input coverage: how many input tokens matched (fraction)
 *    - Registry coverage: how many registry tokens were matched (fraction)
 *    - Quality: average similarity of matched token pairs
 * 5. Bonus for exact token matches (penalize fuzzy-only matches slightly).
 * 6. Bonus if the registry has a patronymic that the input doesn't —
 *    this is expected behavior (parent omits patronymic).
 *
 * @param input The parent's raw input (e.g. "Muhammad Aliyev")
 * @param registryName The registry student's fullName (e.g. "Aliyev Muhammad Anvar o'g'li")
 * @returns Match result with score, confidence, and matched tokens
 */
export function matchStudentName(input: string, registryName: string): StudentNameMatch {
  const normalizedInput = normalizeName(input);
  const normalizedRegistry = normalizeName(registryName);

  // Quick exact match
  if (normalizedInput === normalizedRegistry) {
    return {
      score: 1.0,
      confidence: "HIGH",
      matchedTokens: tokenizeName(normalizedInput),
    };
  }

  const inputTokens = tokenizeName(normalizedInput);
  const registryTokens = tokenizeName(normalizedRegistry);

  const inputSplit = splitTokens(inputTokens);
  const registrySplit = splitTokens(registryTokens);

  const inputSig = inputSplit.significant;
  const registrySig = registrySplit.significant;

  // If input has no significant tokens, score 0
  if (inputSig.length === 0) {
    return { score: 0, confidence: "LOW", matchedTokens: [] };
  }

  // If registry has no significant tokens, score 0
  if (registrySig.length === 0) {
    return { score: 0, confidence: "LOW", matchedTokens: [] };
  }

  // Match each input token to the best registry token
  const matchedTokens: string[] = [];
  const usedRegistryIndices = new Set<number>();
  let totalSimilarity = 0;

  for (const inputTok of inputSig) {
    let bestSim = 0;
    let bestIdx = -1;

    for (let i = 0; i < registrySig.length; i++) {
      if (usedRegistryIndices.has(i)) continue;
      const sim = tokenSimilarity(inputTok, registrySig[i]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    // Only count as matched if similarity is above 0.7
    if (bestSim >= 0.7 && bestIdx >= 0) {
      matchedTokens.push(inputTok);
      totalSimilarity += bestSim;
      usedRegistryIndices.add(bestIdx);
    }
  }

  // Calculate scores
  const inputCoverage = matchedTokens.length / inputSig.length; // fraction of input tokens matched
  const registryCoverage = usedRegistryIndices.size / registrySig.length; // fraction of registry tokens matched
  const avgSimilarity = matchedTokens.length > 0 ? totalSimilarity / matchedTokens.length : 0;

  // Weighted score:
  // - Input coverage is the most important (all input tokens should match)
  // - Registry coverage is less important (parent may omit patronymic/middle name)
  // - Average similarity penalizes fuzzy-only matches
  let score = inputCoverage * 0.5 + registryCoverage * 0.2 + avgSimilarity * 0.3;

  // Bonus: if the registry has patronymics but the input doesn't, this is
  // expected behavior — don't penalize for it.
  if (registrySplit.patronymics.length > 0 && inputSplit.patronymics.length === 0) {
    // Give a small bonus because the parent's input is a valid subset
    score += 0.05;
  }

  // Bonus: if all matched tokens are exact matches (no fuzzy needed), boost
  if (matchedTokens.length > 0 && avgSimilarity === 1.0) {
    score += 0.05;
  }

  // Penalty: if the input has only 1 significant token but the registry has
  // 2+ significant tokens, the parent only provided a first name or surname.
  // This is insufficient for a HIGH-confidence match — require at least
  // first name + surname for HIGH.
  if (inputSig.length === 1 && registrySig.length >= 2) {
    score -= 0.25;
  }

  // Clamp to 0-1
  score = Math.min(1.0, Math.max(0, score));

  // Determine confidence
  let confidence: MatchConfidence;
  if (score >= 0.85) {
    confidence = "HIGH";
  } else if (score >= 0.65) {
    confidence = "MEDIUM";
  } else {
    confidence = "LOW";
  }

  return { score, confidence, matchedTokens };
}

/**
 * Mask a PINFL for display: show only last 4 digits.
 */
export function maskPinfl(pinfl: string | null): string {
  if (!pinfl) return "—";
  if (pinfl.length <= 4) return "****";
  return "****" + pinfl.slice(-4);
}
