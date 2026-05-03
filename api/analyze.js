export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set in Vercel environment variables' });
  }

  const { billType, text, imageBase64, imageMime } = req.body || {};
  if (!text && !imageBase64) {
    return res.status(400).json({ error: 'No bill text or image provided' });
  }

  const typeMap = {
    hospital: 'hospital/medical', utility: 'utility',
    phone: 'phone/mobile', contractor: 'contractor',
    insurance: 'insurance', other: 'general'
  };

  const prompt = `You are a billing expert. Analyze this ${typeMap[billType] || 'general'} bill and return ONLY valid JSON with no markdown or extra text.

Required JSON structure:
{"billType":"descriptive name","totalAmount":"$X","summary":"2 sentences about what this bill is for","overallVerdict":"ok or warn or danger","verdictText":"one honest sentence about this bill","potentialSavings":"$X or null","flags":[{"name":"charge name","amount":"$X","type":"warn","badge":"Suspicious","explanation":"plain English explanation"}],"lineItems":[{"icon":"emoji","name":"charge name","amount":"$X","explanation":"plain English explanation"}],"questionsToAsk":["question 1","question 2"]}

Rules: flags = suspicious items only max 5, empty [] if normal. lineItems = ALL charges max 12. questionsToAsk = 3 to 5 questions. Return ONLY JSON.

Bill:
${text || 'Analyze the image provided.'}`;

  const parts = [];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: imageMime || 'image/jpeg', data: imageBase64 } });
  }
  parts.push({ text: prompt });

  // Use only gemini-2.0-flash — confirmed working from API key test
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    console.log('Calling:', model);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
      })
    });

    const data = await response.json();
    console.log('Status:', response.status);

    if (response.status === 429) {
      return res.status(429).json({ error: 'Rate limit reached. Please wait 30 seconds and try again.' });
    }

    if (!response.ok) {
      console.error('Error:', JSON.stringify(data.error));
      return res.status(500).json({ error: data.error?.message || 'Gemini error ' + response.status });
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('Response length:', rawText.length);

    if (!rawText) {
      return res.status(500).json({ error: 'Empty response from Gemini' });
    }

    const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');

    if (start === -1 || end === -1) {
      console.error('No JSON found:', clean.substring(0, 300));
      return res.status(500).json({ error: 'Could not parse AI response' });
    }

    const result = JSON.parse(clean.substring(start, end + 1));
    console.log('Success:', result.billType);
    return res.status(200).json(result);

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
