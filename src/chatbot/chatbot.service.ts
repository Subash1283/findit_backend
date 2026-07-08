import { Injectable } from '@nestjs/common';
import { ItemsService } from '../items/items.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';

// Model list mirrors VisionService — newest first, fallback to older ones
const CHATBOT_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

@Injectable()
export class ChatbotService {
  private genAI: GoogleGenerativeAI | null = null;

  constructor(
    private readonly itemsService: ItemsService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  /**
   * Try generating content using the model list, falling back on failure.
   * Only 503/429/500/502 are retried; 404/401 immediately move to the next model.
   */
  private async generateWithFallback(prompt: string): Promise<string> {
    if (!this.genAI) throw new Error('GEMINI_API_KEY is not configured.');

    let lastError: unknown;

    for (const modelId of CHATBOT_MODELS) {
      const model = this.genAI.getGenerativeModel({ model: modelId });

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await model.generateContent(prompt);
          if (modelId !== CHATBOT_MODELS[0]) {
            console.log(`[ChatbotService] Using fallback model: ${modelId}`);
          }
          return result.response.text();
        } catch (err: any) {
          lastError = err;
          const status: number | undefined = err?.status;

          // Hard failures (404 wrong model, 401 bad key) — skip to next model
          if (status === 404 || status === 401) break;

          // Transient failures — one retry with a brief pause
          if ((status === 503 || status === 429 || status === 500 || status === 502) && attempt === 0) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }

          break;
        }
      }

      console.warn(`[ChatbotService] ${modelId} failed, trying next model…`);
    }

    throw lastError;
  }

  async processMessage(message: string, userId?: number): Promise<string> {
    try {
      const input = (message || '').trim().toLowerCase();
      if (!input) return 'Please type something so I can help you!';

      // ── Detect intent (Lost vs Found) ───────────────────────────────────
      let targetType: 'lost' | 'found' | null = null;
      if (input.includes('lost') || input.includes('missing')) {
        targetType = 'found';
      } else if (input.includes('found')) {
        targetType = 'lost';
      }

      // ── Extract keywords ────────────────────────────────────────────────
      const stopWords = new Set([
        'the', 'and', 'with', 'for', 'was', 'this', 'hey', 'you', 'seen',
        'any', 'my', 'your', 'lost', 'found', 'missing', 'near', 'at', 'in',
        'okay', 'thanks', 'thank', 'sure', 'great', 'nice', 'cool', 'yes',
        'yeah', 'nope', 'bye', 'hello', 'haha', 'wow', 'good', 'alright',
        'got', 'noted', 'awesome', 'how', 'are', 'what', 'who', 'when',
        'where', 'why', 'can', 'does', 'did', 'has', 'have', 'had',
      ]);
      const keywords = input
        .split(/[ ,.?!]+/)
        .filter((w) => w.length >= 3 && !stopWords.has(w));

      let targetMatches: any[] = [];

      if (keywords.length > 0) {
        let allItems = await this.itemsService.findAll().catch((): any[] => []);
        if (userId) {
          allItems = allItems.filter((item) => item.user?.id !== userId);
        }

        const matchScores = allItems.map((item) => {
          let score = 0;
          const title = item.title.toLowerCase();
          const desc = (item.description || '').toLowerCase();
          const loc = (item.location || '').toLowerCase();
          const cat = (item.category || '').toLowerCase();

          keywords.forEach((k) => {
            if (title.includes(k)) score += 10;
            if (cat.includes(k)) score += 5;
            if (desc.includes(k)) score += 3;
            if (loc.includes(k)) score += 2;
          });

          const isTargetType = !targetType || item.type === targetType;
          return { item, score, isTargetType };
        });

        targetMatches = matchScores
          .filter((m) => m.score >= 5 && m.isTargetType)
          .sort((a, b) => b.score - a.score)
          .map((m) => m.item);

      }

      const historyUserId = userId || 0;
      const historyPrompt = this.getHistoryPrompt(historyUserId);
      this.addToHistory(historyUserId, `User: ${message}`);

      const prompt = `
${historyPrompt ? `Conversation history:\n${historyPrompt}\n\n` : ''}A user said: "${message}"

POTENTIAL MATCHES FROM DATABASE:
${
  targetMatches.length > 0
    ? targetMatches
        .slice(0, 5)
        .map(
          (m) =>
            `- [ID:${m.id}] ${m.title} (${m.type}) in ${m.location}. Category: ${m.category}. Desc: ${m.description || 'N/A'}. Posted by: ${m.user?.name || 'Unknown'}`,
        )
        .join('\n')
    : 'None found.'
}

You are the "FindIT" AI assistant on the Findit Lost & Found platform. Be conversational, warm, and empathetic — like a helpful friend, not a bot.

GUIDELINES:
1. Always respond naturally, even to greetings like "hi" or "how are you".
2. For greetings or off-topic messages, briefly introduce yourself and ask what item they're looking for.
3. If there are POTENTIAL MATCHES, list them clearly. YOU MUST include the item ID in the exact format [ID:123] (e.g. [ID:45]) for EVERY item you mention. This is CRITICAL for the UI to display the 'View Item' button.
4. If no matches are found and they searched for an item, suggest filing a report or checking back.
5. Keep responses concise and friendly.
6. NEVER reveal any user's email, phone number, or private contact details.
7. NEVER use emojis in your responses.
`;

      try {
        const aiResponse = await this.generateWithFallback(prompt);
        this.addToHistory(historyUserId, `AI: ${aiResponse}`);
        return aiResponse;
      } catch (aiErr: any) {
        console.error('[ChatbotService] All Gemini models failed:', aiErr?.message ?? aiErr);

        // Graceful fallback without AI
        if (targetMatches.length > 0) {
          let reply = `I found **${targetMatches.length}** matching item(s):\n\n`;
          targetMatches.slice(0, 4).forEach((m) => {
            reply += `**${m.title}** — ${m.location} [ID:${m.id}]\n`;
          });
          return reply;
        }

        // General greeting fallback
        if (
          !targetType &&
          keywords.length === 0
        ) {
          return `Hi! I'm **FindIT**, your Findit AI assistant. Tell me what you **lost or found** and I'll search our database for matches!`;
        }

        return `I searched our database but couldn't find any matching items right now. Try posting a report so the community can help you!`;
      }
    } catch (error: any) {
      return `Something went wrong: ${error.message}. Please try again.`;
    }
  }

  // Simple in-memory conversation history (keyed by userId; 0 = anonymous)
  private conversationHistory = new Map<number, string[]>();

  private addToHistory(userId: number, message: string) {
    const hist = this.conversationHistory.get(userId) ?? [];
    hist.push(message);
    if (hist.length > 10) hist.shift();
    this.conversationHistory.set(userId, hist);
  }

  private getHistoryPrompt(userId: number): string {
    const hist = this.conversationHistory.get(userId);
    if (!hist || hist.length === 0) return '';
    return hist.map((msg, i) => `#${i + 1} ${msg}`).join('\n');
  }
}