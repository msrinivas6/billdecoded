export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'API key not configured. Add GEMINI_API_KEY in Vercel environment variables.' });
    return;
  }

  const { billType, text, imageBase64, imageMime } = req.body;
  if (!text && !imageBase64) {
    res.status(400).json({ error: 'Please provide bill text or an image.' });
    return;
  }

  const typeMap = {
    hospital: 'hospital/medical', utility: 'utility (electricity, gas, water)',
    phone: 'phone/mobile/internet', contractor: 'contractor/home service/repair',
    insurance: 'insurance', other: 'general'
  };
  const tLabel = typeMap[billType] || 'general';

  const prompt = `You are a consumer advocate and billing expert specializing in ${tLabel} bills.
Analyze this bill and return ONLY a valid JSON object. No markdown, no extra text outside JSON.

Return exactly this JSON structure:
{
  "billType": "descriptive name e.g. Hospital Emergency Visit Bill",
  "totalAmount": "$X,XXX.XX",
  "summary": "2 sentences in plain English explaining what this bill is for",
  "overallVerdict": "ok OR warn OR danger",
  "verdictText": "one honest sentence about this bill",
  "potentialSavings": "$XXX or null",
  "flags": [
    {
      "name": "charge name",
      "amount": "$XX",
      "type": "warn or danger or ok or info",
      "badge": "Suspicious or Dispute This or Overcharged or Verify This or Unknown Charge",
      "explanation": "plain English explanation of why this is flagged"
    }
  ],
  "lineItems": [
    {
      "icon": "single emoji",
      "name": "charge name",
      "amount": "$XX",
      "explanation": "what this charge means in simple plain English"
    }
  ],
  "questionsToAsk": [
    "specific question to ask the biller"
  ]
}

Rules:
- flags: only suspicious or unusual items, max 5, use empty array [] if everything looks normal
- lineItems: explain ALL charges from the bill, max 12 items
- questionsToAsk: 3 to 5 specific actionable questions
- overallVerdict must be exactly: ok, warn, or danger
- Be direct and honest
- Return ONLY the JSON, nothing else
${text ? `\nBill text to analyze:\n${text}` : '\nAnalyze the bill shown in the image.'}`;

  // Build request parts for Gemini
  const parts = [];

  if (imageBase64) {
    const mime = (imageMime && imageMime !== 'application/pdf') ? imageMime : 'image/jpeg';
    parts.push({
      inline_data: { mime_type: mime, data: imageBase64 }
    });
  }

  parts.push({ text: prompt });

  // Try gemini-1.5-flash first, fallback to gemini-pro
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      console.log(`Trying model: ${model}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2500 }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data.error?.message || `HTTP ${response.status}`;
        console.error(`Model ${model} error:`, errMsg);
        lastError = errMsg;
        continue; // try next model
      }

      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!rawText) {
        lastError = 'Empty response from AI';
        continue;
      }

      // Parse JSON from response
      let txt = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      const start = txt.indexOf('{');
      const end = txt.lastIndexOf('}');
      if (start === -1 || end === -1) {
        lastError = 'Could not find JSON in response';
        continue;
      }

      const result = JSON.parse(txt.substring(start, end + 1));
      console.log(`Success with model: ${model}`);
      return res.status(200).json(result);

    } catch (err) {
      console.error(`Model ${model} threw:`, err.message);
      lastError = err.message;
      continue;
    }
  }

  // All models failed
  console.error('All models failed. Last error:', lastError);
  res.status(500).json({ error: lastError || 'AI analysis failed. Please try again.' });
}
