import { Injectable, Logger } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
@Injectable()
export class LocalOcrService {
  private readonly logger = new Logger(LocalOcrService.name);
  private genAI: GoogleGenerativeAI | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  // Extract and parse a full name from an identity document image.
  // Returns null when no name can be reliably extracted.

  async extractNameFromDocument(
    imagePath: string,
    documentType: string = 'identity document',
  ): Promise<{ name: string | null; isValid: boolean; reason?: string }> {
    let decryptedTmp: string | null = null;

    try {
      //  Decrypt the stored image to a temp file
      const { decryptFileToBuffer } = require('../../utils/crypto.util');
      const imageBuffer: Buffer = await decryptFileToBuffer(imagePath);

      const ext = path.extname(imagePath) || '.jpg';
      decryptedTmp = path.join(os.tmpdir(), `findit-ocr-${Date.now()}${ext}`);
      fs.writeFileSync(decryptedTmp, imageBuffer);

      // Run Tesseract OCR (eng + nep languages)
      this.logger.log(
        `[LocalOCR] Starting OCR on document type: ${documentType}`,
      );
      const worker = await createWorker('eng+nep', 1, {
        logger: () => {},
      });

      const {
        data: { text },
      } = await worker.recognize(decryptedTmp);
      await worker.terminate();

      this.logger.log(
        `[LocalOCR] Raw OCR text extracted (${text.length} chars)`,
      );
      // Debug dump — lets us see exactly what Tesseract reads
      this.logger.debug(
        `[LocalOCR] ── RAW TEXT START ──\n${text}\n── RAW TEXT END ──`,
      );

      if (!text || text.trim().length < 5) {
        this.logger.warn(
          '[LocalOCR] OCR returned too little text — possibly a blank or non-document image',
        );
        return {
          name: null,
          isValid: false,
          reason: 'Could not read any text from the uploaded image.',
        };
      }

      //  Try local pattern matching first
      const name = this.parseNameFromOcrText(text);

      if (name) {
        this.logger.log(`[LocalOCR] Parsed name via local patterns: ${name}`);
        return { name, isValid: true };
      }

      //  Fallback: send ONLY the raw text (NOT the image) to Gemini
      // This is safe — only garbled OCR text leaves the server, not the photo.
      this.logger.log(
        '[LocalOCR] Local patterns failed. Sending raw OCR text to Gemini for name parsing (image stays local).',
      );
      const aiName = await this.extractNameFromTextViaGemini(
        text,
        documentType,
      );

      if (aiName) {
        this.logger.log(`[LocalOCR] Gemini parsed name from text: ${aiName}`);
        return { name: aiName, isValid: true };
      }

      this.logger.log(
        '[LocalOCR] Could not extract name from document — left for manual review.',
      );
      return { name: null, isValid: true };
    } catch (err) {
      this.logger.error('[LocalOCR] OCR failed:', err);
      return { name: null, isValid: true };
    } finally {
      // Always delete the temporary decrypted file
      if (decryptedTmp && fs.existsSync(decryptedTmp)) {
        fs.unlinkSync(decryptedTmp);
        this.logger.debug('[LocalOCR] Temp file deleted');
      }
    }
  }

  // Sends ONLY the raw OCR text to Gemini to extract a name.The actual ID image never leaves the server.

  private async extractNameFromTextViaGemini(
    ocrText: string,
    documentType: string,
  ): Promise<string | null> {
    if (!this.genAI) return null;

    try {
      const model = this.genAI.getGenerativeModel({
        model:
          this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash',
      });

      const prompt = `
You are given raw OCR text extracted from a ${documentType}.
The text may contain noise, misread characters, and mixed languages (English + Nepali).

Your task: Find the document holder's FULL NAME in English.
- Look for fields like "Name", "Full Name", "Name of Holder", "नाम", etc.
- The name is usually on the line AFTER such a label.
- Return the name in English. If it is in Nepali script, transliterate it.
- Do NOT return field labels, dates, addresses, or other metadata.

Raw OCR text:
"""
${ocrText.substring(0, 1500)}
"""

Return ONLY valid JSON:
{ "fullName": "Name In English" }
If no name found, return: { "fullName": null }
`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const jsonStr = responseText.match(/\{[\s\S]*\}/)?.[0] || '{}';
      const parsed = JSON.parse(jsonStr);

      const fullName =
        typeof parsed.fullName === 'string' ? parsed.fullName.trim() : null;
      return fullName || null;
    } catch (err) {
      this.logger.warn('[LocalOCR] Gemini text-parsing fallback failed:', err);
      return null;
    }
  }

  //Parses a person's name from raw OCR text of an identity document.

  //Strategy (in order):
  //  1. Label on same line:  "Name: Subash Shrestha"
  //  2. Label then next line: "Full Name of Holder\nSubash SHRESTHA"
  //     (common on Nepali citizenship cards)
  // Heuristic: find an all-caps or Title Case line of 2–4 words
  //  that looks like a proper name.

  private parseNameFromOcrText(rawText: string): string | null {
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 1);

    // ── Strategy 1: label + value on the SAME line
    // e.g. "Name: Subash Shrestha"
    const inlineLabelPatterns = [
      /^(?:full\s*)?name\s*(?:of\s*(?:holder|applicant))?\s*[:\-\/]\s*(.+)/i,
      /^naam\s*[:\-]\s*(.+)/i,
      /^नाम\s*[:\-\/]\s*(.+)/i,
    ];

    for (const line of lines) {
      for (const pattern of inlineLabelPatterns) {
        const match = line.match(pattern);
        if (match) {
          const candidate = this.cleanName(match[1]);
          if (
            candidate &&
            this.isPlausibleName(candidate) &&
            !this.isOcrGarbage(candidate) &&
            !this.containsFieldKeyword(candidate)
          )
            return candidate;
        }
      }
    }

    // ── Strategy 2: label on one line, name on the NEXT line ─────────────
    // Nepali citizenship cards: "नाम / Full Name of Holder" then next line is the name.
    // IMPORTANT: Only use a line as a candidate if it is purely ASCII (Roman)
    // to avoid picking up garbled Devanagari text mis-read by Tesseract.
    const nextLineLabelPattern =
      /(?:full\s*)?name\s*(?:of\s*(?:holder|applicant))?|नाम/i;

    for (let i = 0; i < lines.length - 1; i++) {
      if (nextLineLabelPattern.test(lines[i])) {
        for (
          let offset = 1;
          offset <= 2 && i + offset < lines.length;
          offset++
        ) {
          const nextLine = lines[i + offset];
          // Skip Devanagari-only or mixed lines — these are Nepali-script noise
          if (/[^\x00-\x7F]/.test(nextLine)) continue;
          const candidate = this.cleanName(nextLine);
          if (
            candidate &&
            this.isPlausibleName(candidate) &&
            !this.isOcrGarbage(candidate) &&
            !this.containsFieldKeyword(candidate)
          ) {
            this.logger.log(
              `[LocalOCR] Name found via next-line label strategy: "${candidate}"`,
            );
            return candidate;
          }
        }
      }
    }

    // ── Strategy 3: heuristic — look for a standalone name-like line ─────
    // Must be purely ASCII, 2–4 words, all Title-Case or ALL-CAPS,
    // none of which are known non-name keywords.
    const skipKeywords = new Set([
      'nepal',
      'government',
      'district',
      'province',
      'municipality',
      'date',
      'birth',
      'expiry',
      'issued',
      'nationality',
      'sex',
      'male',
      'female',
      'citizen',
      'citizenship',
      'passport',
      'license',
      'driving',
      'address',
      'permanent',
      'temporary',
      'valid',
      'office',
      'republic',
      'unique',
      'number',
      'roll',
      'reg',
      'card',
      'id',
      'no',
      'campus',
      'college',
      'school',
      'university',
      'student',
      'full',
      'name',
      'holder',
      'father',
      'mother',
      'spouse',
      'dob',
      'surname',
      'given',
      'first',
      'last',
      'middle',
      'age',
      'of',
      'kabhre',
      'certificate',
      // Date-related terms that appear in DOB labels
      'ad',
      'bs',
      'born',
      'dob',
      'year',
      'month',
      'day',
      'place',
    ]);

    for (const line of lines) {
      if (/[^\x00-\x7F]/.test(line)) continue; // Skip Devanagari-only lines

      const words = line.split(/\s+/).filter((w) => /^[A-Za-z]{2,}$/.test(w)); // min 2 chars per word
      if (words.length < 2 || words.length > 4) continue;

      const hasKeyword = words.some((w) => skipKeywords.has(w.toLowerCase()));
      if (hasKeyword) continue;

      const looksLikeName = words.every(
        (w) => /^[A-Z][A-Za-z]*$/.test(w) || /^[A-Z]{2,}$/.test(w),
      );
      if (!looksLikeName) continue;

      const candidate = this.cleanName(words.join(' '));
      if (
        candidate &&
        this.isPlausibleName(candidate) &&
        !this.isOcrGarbage(candidate) &&
        !this.containsFieldKeyword(candidate)
      ) {
        this.logger.log(
          `[LocalOCR] Name found via heuristic pattern: "${candidate}"`,
        );
        return candidate;
      }
    }

    return null;
  }

  //
  // Sanity check: a plausible name must have:
  // - At least 2 words of 2+ chars each
  // - Total name length ≥ 5 chars
  // - At least one word starting with an uppercase letter (proper name casing)

  private isPlausibleName(name: string): boolean {
    const words = name.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length < 2 || name.replace(/\s/g, '').length < 5) return false;
    // At least one word must start with an uppercase letter
    return words.some((w) => /^[A-Z]/.test(w));
  }

  //Detects obvious OCR garbage that is not a real name.
  //Rejects strings like "fama XXX AEA" or "Abc DEF GHI JKL".

  private isOcrGarbage(name: string): boolean {
    const words = name.split(/\s+/);
    // Reject if any word is a single-character or repeating-letter pattern (XXX, AAA)
    if (words.some((w) => /^(.)\1+$/i.test(w))) return true;
    // Reject if all words are very short all-caps (likely acronyms / garble)
    if (words.every((w) => /^[A-Z]{1,3}$/.test(w))) return true;
    // Reject if no word resembles a real name word (at least 3 chars, starts uppercase, has vowel)
    const looksReal = words.some(
      (w) => w.length >= 3 && /^[A-Z]/.test(w) && /[aeiouAEIOU]/.test(w),
    );
    return !looksReal;
  }

  //Rejects candidate names that contain known document field label words.
  //Catches cases like "Date of Birth AD", "Permanent Address", etc.

  private containsFieldKeyword(name: string): boolean {
    const fieldWords = [
      'date',
      'birth',
      'address',
      'dob',
      'expiry',
      'expire',
      'issued',
      'valid',
      'nationality',
      'sex',
      'gender',
      'father',
      'mother',
      'spouse',
      'husband',
      'wife',
      'district',
      'province',
      'office',
      'ward',
      'vdc',
      'ad',
      'bs',
      'born',
      'permanent',
      'temporary',
    ];
    const lower = name.toLowerCase();
    return fieldWords.some((kw) => {
      // Match whole word only (not substring), e.g. "ad" should not reject "Adam"
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      return regex.test(lower);
    });
  }
  //Normalizes OCR noise from a candidate name string.
  //Converts ALL-CAPS to Title Case, removes punctuation & digits, etc.

  private cleanName(raw: string): string | null {
    const cleaned = raw
      .replace(/[^A-Za-z\s\-'\.]/g, '') // Remove digits, special chars
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length < 3) return null;

    // Convert ALL CAPS → Title Case (e.g., "Subash SHRESTHA" → "Subash Shrestha")
    const isAllCaps = cleaned === cleaned.toUpperCase();
    if (isAllCaps) {
      return cleaned.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    }

    return cleaned;
  }
}
