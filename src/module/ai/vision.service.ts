import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { LocalOcrService } from './local-ocr.service';

type GeminiContentPart =
  | string
  | { inlineData: { data: string; mimeType: string } };

@Injectable()
export class VisionService {
  private genAI: GoogleGenerativeAI | null = null;
  private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null =
    null;
  private readonly fallbackModelIds = [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro',
    'gemini-1.0-pro-001',
  ];
  constructor(
    private configService: ConfigService,
    private localOcr: LocalOcrService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      const primary =
        this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash';
      this.model = this.genAI.getGenerativeModel({ model: primary });
    }
  }

  private getModelIds(): string[] {
    const primary =
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash';
    return [...new Set([primary, ...this.fallbackModelIds])];
  }

  private isRetryableError(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return status === 503 || status === 429 || status === 500 || status === 502;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async generateContentText(
    parts: GeminiContentPart[],
  ): Promise<string> {
    if (!this.genAI) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    let lastError: unknown;
    const modelIds = this.getModelIds().slice(0, 2); // Limit to 2 models max to avoid Render timeout
    for (const modelId of modelIds) {
      const model = this.genAI.getGenerativeModel({ model: modelId });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // 25-second timeout per call to prevent Render free tier from killing the connection
          const result = await Promise.race([
            model.generateContent(parts),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('AI call timed out (25s)')), 25000),
            ),
          ]);
          if (modelId !== modelIds[0] && attempt === 0) {
            console.log(`[VisionService] Using fallback model: ${modelId}`);
          }
          return result.response.text();
        } catch (error) {
          lastError = error;
          const status = (error as { status?: number })?.status;
          const retryable = this.isRetryableError(error);
          if (!retryable) break;
          if (attempt < 1) {
            const delayMs = 1000 * 2 ** attempt;
            console.warn(
              `[VisionService] ${modelId} unavailable (${status ?? 'error'}), retry ${attempt + 1}/2 in ${delayMs}ms`,
            );
            await this.sleep(delayMs);
          }
        }
      }
      console.warn(`[VisionService] ${modelId} failed, trying next model…`);
    }
    throw lastError;
  }

  private async readImagePart(filePath: string): Promise<{
    inlineData: { data: string; mimeType: string };
  }> {
    const { decryptFileToBuffer } = require('../../utils/crypto.util');
    const imageBuffer = await decryptFileToBuffer(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/jpeg';
    return {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType,
      },
    };
  }


  async analyzeImage(
    filePath: string,
    title?: string,
    category?: string,
  ): Promise<string[]> {
    if (!this.model) {
      console.warn(
        '[VisionService] AI Model not initialized (missing API key). Falling back to simulation.',
      );
      return this.simulateAnalysis(title, category);
    }

    try {
      console.log(`[VisionService] Real AI Analyzing image: ${filePath}`);

      const imagePart = await this.readImagePart(filePath);

      const prompt = `
        Analyze this image for a Lost and Found application. 
        Context provided by user: Title: "${title}", Category: "${category}".
        
        Task: Provide a concise list of 10-15 single-word tags that describe:
        - The object itself (e.g., wallet, phone, keys)
        - Brand or Logos (e.g., Apple, Nike, Samsung)
        - Primary colors
        - Material (e.g., leather, plastic, metal)
        - Condition (e.g., cracked, new, scratched)
        
        Return ONLY a comma-separated list of tags. No other text.
      `;

      const text = await this.generateContentText([prompt, imagePart]);

      // 4. Parse and Clean Tags
      const aiTags = text
        .split(',')
        .map((tag: string) => tag.trim().toLowerCase())
        .filter((tag: string) => tag.length > 0);

      console.log(
        `[VisionService] Analysis successful. Tags: ${aiTags.join(', ')}`,
      );

      // 5. Merge with basic context tags to ensure consistency
      const contextTags = this.simulateAnalysis(title, category);
      const combinedTags = new Set([...aiTags, ...contextTags]);

      return Array.from(combinedTags);
    } catch (error) {
      console.error('[VisionService] AI Analysis failed:', error);
      return this.simulateAnalysis(title, category);
    }
  }

  async validateImageMatch(
    filePath: string,
    title: string,
    category: string,
    documentType?: string,
  ): Promise<{ isMatch: boolean; reason?: string }> {
    if (!this.model) return { isMatch: true }; // Skip if AI not available

    try {
      const imagePart = await this.readImagePart(filePath);

      let documentInstruction = '';
      if (category.toLowerCase() === 'documents' && documentType) {
        const readableDocType = documentType.replace(/_/g, ' ');
        documentInstruction = `
        CRITICAL DOCUMENT TYPE COMPLIANCE RULE:
        The selected document type is "${readableDocType}".
        You MUST verify that the document in the image is SPECIFICALLY a "${readableDocType}".
        - If selected is "passport", the image MUST be a Passport. A Citizenship Card, Driving License, or Student ID MUST BE REJECTED with isMatch: false.
        - If selected is "citizenship", the image MUST be a Citizenship Card/Certificate. A Passport or Driving License MUST BE REJECTED with isMatch: false.
        - If selected is "driving license", the image MUST be a Driving License. A Passport or Citizenship Card MUST BE REJECTED with isMatch: false.
        - If selected is "student id", the image MUST be a Student ID card.
        - If selected is "certificate", the image MUST be an educational/official Certificate.
        `;
      }

      const prompt = `
        You are a strict document and item verification assistant for a Lost and Found app.
        The user claims this item is a "${title}" in category "${category}".
        ${documentInstruction}
        
        Task: Verify if the image actually shows a "${title}" belonging to "${category}" AND strictly conforms to the specified document type if applicable.
        
        Return exactly in this JSON format:
        {
          "isMatch": boolean,
          "reason": "Brief explanation if isMatch is false (e.g., 'Uploaded image is a Citizenship Card, not a Passport'), otherwise empty string"
        }
      `;

      const responseText = await this.generateContentText([prompt, imagePart]);
      const jsonStr = responseText.match(/\{.*\}/s)?.[0] || '{"isMatch": true}';
      const validation = JSON.parse(jsonStr);

      console.log(`[VisionService] Validation for "${title}" (${documentType || 'N/A'}):`, validation);
      return validation;
    } catch (error) {
      console.error('[VisionService] Validation failed:', error);
      return { isMatch: true };
    }
  }

  async validateDocumentType(
    filePath: string,
    documentType: string,
  ): Promise<{ isMatch: boolean; reason?: string }> {
    if (!this.model) return { isMatch: true };

    try {
      const imagePart = await this.readImagePart(filePath);
      const readableDocType = documentType.replace(/_/g, ' ');

      const prompt = `
        You are a fraud prevention security inspector for identity document verification.
        The user claims they are uploading a "${readableDocType}".

        STRICT SPECIFIC DOCUMENT CHECKS:
        1. If claimed type is "passport": The photo MUST be an official Passport (showing passport header, MRZ code lines at the bottom, or passport layout). A Citizenship card, Driving License, National ID card, or Student ID MUST BE REJECTED.
        2. If claimed type is "citizenship" or "citizenship card": The photo MUST be a Citizenship Card/Certificate (e.g. Nepali Citizenship Certificate). A Passport, Driving License, or Student ID MUST BE REJECTED.
        3. If claimed type is "driving license" or "drivers license": The photo MUST be a Driving License. A Passport or Citizenship Card MUST BE REJECTED.
        4. If claimed type is "student id": The photo MUST be a Student ID Card.
        5. If claimed type is "certificate": The photo MUST be an educational or official Certificate.

        Is this uploaded document image SPECIFICALLY a "${readableDocType}"?

        Return ONLY JSON:
        {
          "isMatch": boolean,
          "reason": "Clear error message if isMatch is false (e.g., 'Uploaded image is a Citizenship Card, but you selected Passport. Please upload a valid Passport.'), otherwise empty string"
        }
      `;

      const responseText = await this.generateContentText([prompt, imagePart]);
      const jsonStr = responseText.match(/\{.*\}/s)?.[0] || '{"isMatch": true}';
      const validation = JSON.parse(jsonStr);

      console.log(`[VisionService] Verification Document Check for "${documentType}":`, validation);
      return validation;
    } catch (error) {
      console.error('[VisionService] Document type validation failed:', error);
      return { isMatch: true };
    }
  }

  private simulateAnalysis(title?: string, category?: string): string[] {
    const tags = new Set<string>();
    if (category) tags.add(category.toLowerCase().trim());
    if (title) {
      title
        .toLowerCase()
        .split(/\s+/)
        .filter((w: string) => w.length > 2)
        .forEach((w: string) => tags.add(w));
    }
    return Array.from(tags);
  }

  //
   //Extracts the holder's name from an identity document image.
   // Uses LOCAL Tesseract.js OCR — the image never leaves the server.
  
  /**
   * Extracts the holder's name from an identity document image.
   * Uses LOCAL Tesseract.js OCR — the image file NEVER leaves the server.
   * Only the extracted text string is processed to parse the name.
   */
  async extractNameFromIdentityDocument(
    filePath: string,
    documentType: string = 'identity document',
  ): Promise<{ name: string | null; unavailable?: boolean; isValid: boolean; reason?: string }> {
    console.log('[VisionService] Running Local Tesseract OCR on document (image stays on server)...');
    const result = await this.localOcr.extractNameFromDocument(filePath, documentType);
    console.log(`[VisionService] Extracted document name: ${result.name ?? '(none)'}, isValid: ${result.isValid}`);
    return result;
  }

  calculateSimilarity(tags1: string[], tags2: string[]): number {
    if (!tags1 || !tags2 || tags1.length === 0 || tags2.length === 0) return 0;

    // Convert to arrays and lowercase for safety
    const t1 = tags1.map((t) => t.toLowerCase());
    const t2 = tags2.map((t) => t.toLowerCase());

    const intersection = t1.filter((tag) => t2.includes(tag));
    return intersection.length / Math.max(t1.length, t2.length);
  }

  
  async autoFillDetails(
    filePath: string,
  ): Promise<{ title: string; category: string; description: string }> {
    if (!this.model) {
      return { title: '', category: 'Other', description: '' };
    }

    try {
      console.log(`[VisionService] Auto-filling details from image: ${filePath}`);
      const imagePart = await this.readImagePart(filePath);

      const prompt = `
        Analyze this image of a lost or found item.
        Provide a short title (2-4 words), the most appropriate category (Must be exactly one of: "Electronics", "Documents", "Vehicles", "Keys", "Clothing", "Wallets & Bags", or "Other"), and a brief physical description (1-2 sentences).
        Return ONLY valid JSON in this exact format, with no markdown code blocks or extra text:
        {
          "title": "Short descriptive title",
          "category": "One of the allowed categories",
          "description": "Brief description of the item's appearance"
        }
      `;

      const responseText = await this.generateContentText([prompt, imagePart]);
      
      // Attempt to extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : '{}';
      
      const parsed = JSON.parse(jsonStr);
      
      const allowedCategories = ['Electronics', 'Documents', 'Vehicles', 'Keys', 'Clothing', 'Wallets & Bags', 'Other'];
      const category = allowedCategories.includes(parsed.category) ? parsed.category : 'Other';

      return {
        title: parsed.title || '',
        category: category,
        description: parsed.description || ''
      };
    } catch (error) {
      console.error('[VisionService] Auto-fill failed:', error);
      return { title: '', category: 'Other', description: '' };
    }
  }
}

