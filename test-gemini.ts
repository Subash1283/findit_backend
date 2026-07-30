import { GoogleGenerativeAI } from '@google/generative-ai';

async function test() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'fake');
  const start = Date.now();
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
    await model.generateContent("hello");
  } catch (err: any) {
    console.log("Error status:", err.status, "Message:", err.message);
  }
  console.log("Time taken:", Date.now() - start);
}
test();
