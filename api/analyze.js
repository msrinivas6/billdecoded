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

  const prompt = `You are a billing expert. Analyze this ${typeMap[billType] || 'general'} bill and return ONLY valid JSON.

Return this exact structure (no markdown, no extra text):
{"billType":"Hospital Bill","totalAmount":"$925","summary":"This is a hospital emergency visit bill with 4 charges.","overallVerdict":"warn","verdictText":"Two charges look unusual and are worth questioning.","potentialSavings":"$200","flags":[{"name":"Facility Fee","amount":"$200","type":"warn","badge":"Verify This","explanation":"This fee is often negotiable. Ask if it can be waived."}],"lineItems":[{"icon":"🏥","name":"Emergency Room Visit","amount":"$450","explanation":"The base charge for using the emergency room."}],"questionsToAsk":["Can you waive the facility fee?","Do you offer a payment plan?"]}

Bill to analyze:
${text || 'See image provided'}`;

  const parts = [];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: imageMime || 'image/jpeg', data: imageBase64 } });
  }
  parts.push({ text: prompt });

  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    console.log('Calling Gemini model:', model);
    console.log('Has image:', !!imageBase64);
    console.log('Has text:', !!text);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
      })
    });

    const data = await response.json();
    console.log('Gemini HTTP status:', response.status);
    console.log('Gemini response keys:', Object.keys(data));

    if (!response.ok) {
      console.error('Gemini error:', JSON.stringify(data));
      return res.status(500).json({ 
        error: data.error?.message || 'Gemini API error: ' + response.status,
        details: data.error
      });
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('Raw text length:', rawText?.length);
    console.log('Raw text preview:', rawText?.substring(0, 200));

    if (!rawText) {
      console.error('No text in response:', JSON.stringify(data));
      return res.status(500).json({ error: 'Gemini returned empty response', raw: data });
    }

    const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');

    if (start === -1 || end === -1) {
      console.error('No JSON found in:', clean);
      return res.status(500).json({ error: 'Could not find JSON in response', raw: clean });
    }

    const result = JSON.parse(clean.substring(start, end + 1));
    console.log('Success! Bill type:', result.billType);
    return res.status(200).json(result);

  } catch (err) {
    console.error('Caught error:', err.message);
    console.error('Stack:', err.stack);
    return res.status(500).json({ error: err.message });
  }
}
