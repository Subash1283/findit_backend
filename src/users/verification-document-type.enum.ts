export enum VerificationDocumentType {
  PASSPORT = 'passport',
  CITIZENSHIP = 'citizenship',
  DRIVERS_LICENSE = 'drivers_license',
  DRIVING_LICENSE = 'driving_license',
  STUDENT_ID = 'student_id',
}

export const VERIFICATION_DOCUMENT_TYPES = Object.values(VerificationDocumentType);

export function requiresTwoPhotos(type: string): boolean {
  return (
    type === VerificationDocumentType.CITIZENSHIP ||
    type === VerificationDocumentType.DRIVERS_LICENSE ||
    type === VerificationDocumentType.DRIVING_LICENSE
  );
}

export function isValidVerificationDocumentType(type: string): boolean {
  return VERIFICATION_DOCUMENT_TYPES.includes(type as VerificationDocumentType);
}

export function verificationDocumentTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    [VerificationDocumentType.PASSPORT]: 'Passport',
    [VerificationDocumentType.CITIZENSHIP]: 'Citizenship card',
    [VerificationDocumentType.DRIVERS_LICENSE]: "Driver's license",
    [VerificationDocumentType.DRIVING_LICENSE]: "Driver's license",
    [VerificationDocumentType.STUDENT_ID]: 'Student ID card',
  };
  return labels[type] || type;
}
