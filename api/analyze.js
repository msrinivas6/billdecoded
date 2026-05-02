export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'API key not configured. Please add GEMINI_API_KEY in Vercel environment variables.' });
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
Analyze this bill and return ONLY a valid JSON object. No markdown, no text outside JSON.

Required structure:
{"billType":"e.g. Hospital Emergency Visit Bill","totalAmount":"$X,XXX.XX","summary":"2-sentence plain English summary of what this bill is for","overallVerdict":"ok OR warn OR danger","verdictText":"One clear honest sentence — your overall assessment","potentialSavings":"$XXX or null","flags":[{"name":"Charge name","amount":"$XX","type":"warn|danger|ok|info","badge":"Suspicious|Dispute This|Overcharged|Verify This|Unknown Charge","explanation":"Plain English — what this is and what to do about it"}],"lineItems":[{"icon":"emoji","name":"Charge name","amount":"$XX","explanation":"What this charge means in simple plain English — no jargon"}],"questionsToAsk":["Specific question 1","Specific question 2"]}

Rules: flags=suspicious/notable items only max 5, empty [] if everything normal. lineItems=ALL charges explained max 12. questionsToAsk=3-5 specific actionable questions. Be direct — if something is wrong say so clearly. Return ONLY JSON.
${text ? `\nBill text:\n${text}` : ''}`;

  const parts = [];
  if (imageBase64) {
    const mime = imageMime && imageMime !== 'application/pdf' ? imageMime : 'image/jpeg';
    parts.push({ inline_data: { mime_type: mime, data: imageBase64 } });
  }
  parts.push({ text: prompt });

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2500 }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Gemini API error' });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!rawText) return res.status(500).json({ error: 'Empty response from AI' });

    let txt = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start === -1 || end === -1) return res.status(500).json({ error: 'Could not parse AI response' });

    const result = JSON.parse(txt.substring(start, end + 1));
    res.status(200).json(result);

  } catch (err) {
    console.error('BillDecoded error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
