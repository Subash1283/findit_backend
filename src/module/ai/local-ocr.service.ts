import { Injectable, Logger } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { transliterateDevanagari, namesMatch } from '../../users/identity-verification.util';
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
      // Using '4.0.0_fast' models to significantly reduce RAM usage and prevent Render OOM crashes
      this.logger.log(
        `[LocalOCR] Starting OCR on document type: ${documentType} with fast models`,
      );
      let worker;
      try {
        worker = await createWorker('eng+nep', 1, {
          logger: () => {},
          langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
        });
      } catch (err) {
        this.logger.warn('[LocalOCR] Could not load eng+nep fast worker, falling back to eng:', err);
        worker = await createWorker('eng', 1, {
          logger: () => {},
          langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
        });
      }

      this.logger.log('[LocalOCR] Worker loaded. Starting recognize...');
      const recognizePromise = worker.recognize(decryptedTmp);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Tesseract timeout (35s)')), 35000)
      );

      let text = '';
      try {
        const result = await Promise.race([recognizePromise, timeoutPromise]) as any;
        text = result.data.text;
      } catch (timeoutErr) {
        this.logger.warn(`[LocalOCR] Tesseract failed or timed out: ${timeoutErr}`);
        await worker.terminate();
        return { name: null, isValid: true, reason: 'OCR took too long, moving to manual review.' };
      }
      
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
          isValid: true,
          reason: 'Could not read text from the uploaded image — left for review.',
        };
      }

      // Document Type Mismatch Verification via Text Keywords
      const lowerText = text.toLowerCase();
      const normDocType = (documentType || '').toLowerCase().trim();

      if (normDocType === 'passport') {
        if (/citizenship|नागरिकता|वंशज/i.test(text)) {
          return {
            name: null,
            isValid: false,
            reason: 'The uploaded image appears to be a Citizenship Card, but Passport was selected. Please upload a valid Passport.',
          };
        }
        if (/driving\s*license|sawabari|सवारी\s*चालक/i.test(text)) {
          return {
            name: null,
            isValid: false,
            reason: 'The uploaded image appears to be a Driving License, but Passport was selected. Please upload a valid Passport.',
          };
        }
      } else if (normDocType === 'citizenship') {
        if (/passport\s*no|republic\s*of\s*nepal\s*passport|p<npl/i.test(text)) {
          return {
            name: null,
            isValid: false,
            reason: 'The uploaded image appears to be a Passport, but Citizenship Card was selected. Please upload a valid Citizenship Card.',
          };
        }
      } else if (normDocType === 'driving_license' || normDocType === 'drivers_license') {
        if (/citizenship|नागरिकता|वंशज/i.test(text)) {
          return {
            name: null,
            isValid: false,
            reason: 'The uploaded image appears to be a Citizenship Card, but Driving License was selected. Please upload a valid Driving License.',
          };
        }
        if (/passport\s*no|republic\s*of\s*nepal\s*passport|p<npl/i.test(text)) {
          return {
            name: null,
            isValid: false,
            reason: 'The uploaded image appears to be a Passport, but Driving License was selected. Please upload a valid Driving License.',
          };
        }
      }

      // Try local pattern matching first
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

      // Final fallback: Transliterate entire raw text block to find any candidate name
      const fullTransliterated = transliterateDevanagari(text);
      const fallbackName = this.parseNameFromOcrText(fullTransliterated);
      if (fallbackName) {
        this.logger.log(`[LocalOCR] Parsed name via full transliterated text fallback: ${fallbackName}`);
        return { name: fallbackName, isValid: true };
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

      const aiPromise = model.generateContent(prompt);
      aiPromise.catch(() => {}); // prevent UnhandledPromiseRejection if it fails late

      const result = await Promise.race([
        aiPromise,
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Gemini text parse timeout')), 15000)
        )
      ]) as import('@google/generative-ai').GenerateContentResult;

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

  private parseNameFromOcrText(rawText: string, expectedName?: string): string | null {
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 1);

    // ── Strategy 1: label + value on the SAME line
    // e.g. "Full Name: © ALISHATAMANG be Jie we §", "ame: RAM LAL SHRESTHA", or "नाम धर: सोहन श्रेष्ठ लिङ्ग : पुरुष"
    const inlineLabelPatterns = [
      /\b(?:full\s*)?(?:name|[nN]?ame|naam)\b\s*(?:\([^)]*\))?\s*(?:of\s*(?:holder|applicant))?\s*[:\-\/~.]+\s*[-~]*\s*(.+)/i,
      /(?:पुरा\s*)?नाम\s*(?:[\/,\s]*(?:थर|धर|naam))?\s*[:\-\/~.]*\s*[-~]*\s*(.+)/i,
      /\bnaam\s*(?:thar|dhar)?\b\s*[:\-\/~.]*\s*[-~]*\s*(.+)/i,
    ];

    for (const line of lines) {
      // Ignore issuing officer lines at the bottom of citizenship cards
      if (/दर्जा|drja|प्रशासकीय|अधिकृत|दस्तखत/i.test(line)) continue;

      for (const pattern of inlineLabelPatterns) {
        const match = line.match(pattern);
        if (match) {
          let rawVal = match[1];
          // Strip secondary inline field labels (e.g. लिङ्ग, sex, gender, जन्म, स्थान, जिल्ला, etc.)
          rawVal = rawVal.split(/(?:लिङ्ग|sex|gender|जन्म|स्थान|जिल्ला|ठेगाना|बाबु|आमा|पति|पत्नी|dob|date)/i)[0].trim();

          if (!/[a-zA-Z]{2,}/.test(rawVal) && /[\u0900-\u097F]/.test(rawVal)) {
            rawVal = transliterateDevanagari(rawVal);
          }
          const candidate = this.cleanName(rawVal);
          if (
            candidate &&
            this.isPlausibleName(candidate) &&
            !this.isOcrGarbage(candidate) &&
            !this.containsFieldKeyword(candidate)
          ) {
            this.logger.log(`[LocalOCR] Name found via inline pattern: "${candidate}"`);
            return candidate;
          }
        }
      }
    }

    // ── Strategy 2: label on one line, name on the NEXT line ─────────────
    // Nepali citizenship cards: "नाम / Full Name of Holder" then next line is the name.
    const nextLineLabelPattern =
      /\b(?:full\s*)?(?:name|[nN]?ame|naam)\b\s*(?:\([^)]*\))?\s*(?:of\s*(?:holder|applicant))?|(?:पुरा\s*)?नाम/i;

    for (let i = 0; i < lines.length - 1; i++) {
      if (/दर्जा|drja|प्रशासकीय|अधिकृत|दस्तखत/i.test(lines[i])) continue;

      // Skip lines that ALREADY contain a value on the same line (e.g., "नाम धर: सोहन श्रेष्ठ")
      if (/[:\-\/~.].{3,}/.test(lines[i]) && lines[i].length > 12) continue;

      if (nextLineLabelPattern.test(lines[i])) {
        for (
          let offset = 1;
          offset <= 2 && i + offset < lines.length;
          offset++
        ) {
          let nextLine = lines[i + offset];
          if (/दर्जा|drja|प्रशासकीय|अधिकृत|दस्तखत/i.test(nextLine)) continue;

          if (!/[a-zA-Z]{2,}/.test(nextLine) && /[\u0900-\u097F]/.test(nextLine)) {
            nextLine = transliterateDevanagari(nextLine);
          }
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
      'ad',
      'bs',
      'born',
      'year',
      'month',
      'day',
      'place',
    ]);

    const noiseKeywords = new Set([
      'nb', 'te', 'fe', 'yl', 'ae', 'ey', 'or', 'is', 'it', 'to', 'in', 'on',
      'at', 'by', 're', 'no', 've', 'se', 'ii', 'iii', 'iv', 'vi', 'vii', 'viii',
      'ix', 'co', 'id', 'sn', 'st', 'nd', 'rd', 'th', 'pr', 'nnn', 'eao', 'eac',
      'eaf', 'eat', 'eee', 'sss', 'sessa', 'graal', 'ams', 'art', 'png', 'san',
      'sexfeml', 'sexmale', 'pai', 'jie', 'we',
    ]);

    for (const line of lines) {
      // Reject lines with digits, symbols, or heavy OCR garble
      if (/[0-9\u0966-\u096F]/.test(line)) continue;
      if (/[%§=@|\\\/#~_\+\*\^\<\>\[\]\{\}«»\?]/.test(line)) continue;

      const letterCount = (line.match(/[a-zA-Z\u0900-\u097F]/g) || []).length;
      if (line.length === 0 || letterCount / line.length < 0.6) continue;

      let targetLine = line;
      if (!/[a-zA-Z]{2,}/.test(targetLine) && /[\u0900-\u097F]/.test(targetLine)) {
        targetLine = transliterateDevanagari(targetLine);
      }

      const words = targetLine.split(/\s+/).filter((w) => /^[A-Za-z]{2,}$/.test(w));
      if (words.length < 2 || words.length > 4) continue;

      const hasKeyword = words.some(
        (w) => skipKeywords.has(w.toLowerCase()) || noiseKeywords.has(w.toLowerCase()),
      );
      if (hasKeyword) continue;

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

  private isPlausibleName(name: string): boolean {
    const words = name.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length < 2 && name.length < 5) return false;
    // At least one word must start with an uppercase letter
    return words.some((w) => /^[A-Z]/.test(w));
  }

  private isOcrGarbage(name: string): boolean {
    const words = name.split(/\s+/);
    if (words.some((w) => /^(.)\1+$/i.test(w))) return true;
    if (words.every((w) => /^[A-Z]{1,3}$/.test(w))) return true;
    const looksReal = words.some(
      (w) => w.length >= 3 && /^[A-Z]/.test(w) && /[aeiouAEIOU]/.test(w),
    );
    return !looksReal;
  }

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
      'sexfeml',
      'sexmale',
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
      'citizenship',
      'cutzmaship',
      'certtente',
      'certificate',
    ];
    const lower = name.toLowerCase();
    return fieldWords.some((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      return regex.test(lower);
    });
  }

  private cleanName(raw: string): string | null {
    let cleaned = raw
      .replace(/[^A-Za-z\s\-'\.]/g, '') // Remove digits, special chars
      .replace(/\s+/g, ' ')
      .trim();

    // Strip common trailing OCR noise words
    const noiseWords = new Set([
      'be', 'jie', 'we', 'pai', 'na', 'ii', 'iii', 'iv', 'vi', 'vii', 'viii',
      'ix', 'co', 'id', 'sn', 'st', 'nd', 'rd', 'th', 'pr', 'nnn', 'eao', 'eac',
      'eaf', 'eat', 'eee', 'sss', 'sessa', 'graal', 'ams', 'art', 'png', 'san',
      'sexfeml', 'sexmale', 'female', 'male', 'sex',
    ]);

    const parts = cleaned.split(' ').filter((w) => !noiseWords.has(w.toLowerCase()));
    cleaned = parts.join(' ').trim();

    if (cleaned.length < 3) return null;

    const isAllCaps = cleaned === cleaned.toUpperCase();
    if (isAllCaps) {
      return cleaned.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    }

    return cleaned;
  }
}
