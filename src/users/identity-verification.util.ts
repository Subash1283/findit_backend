export interface AutoVerificationResult {
  attempted: boolean;
  matched: boolean;
  documentName: string | null;
  accountName: string;
  verified: boolean;
  rejected: boolean;
  reason?: string;
}

export interface BulkAutoVerificationResult {
  processed: number;
  verified: number;
  rejected: number;
  pending: number;
  results: Array<AutoVerificationResult & { userId: number; userName: string }>;
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameWords(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((w) => w.length > 1);
}

/** Returns true when the account full name and document name refer to the same person. */
export function namesMatch(accountName: string, documentName: string): boolean {
  const a = normalizeName(accountName);
  const b = normalizeName(documentName);
  if (!a || !b) return false;
  if (a === b) return true;

  const wordsA = nameWords(accountName);
  const wordsB = nameWords(documentName);
  if (!wordsA.length || !wordsB.length) return false;

  const allWordsPresent = (needles: string[], haystack: string[]) =>
    needles.every((w) =>
      haystack.some((h) => h === w || h.includes(w) || w.includes(h)),
    );

  return allWordsPresent(wordsA, wordsB) || allWordsPresent(wordsB, wordsA);
}
