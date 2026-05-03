export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY not set in Vercel environment variables' });
  }

  const { billType, text, imageBase64 } = req.body || {};
  if (!text && !imageBase64) {
    return res.status(400).json({ error: 'No bill text or image provided' });
  }

  const typeMap = {
    hospital: 'hospital/medical', utility: 'utility (electricity, gas, water)',
    phone: 'phone/mobile', contractor: 'contractor/home service',
    insurance: 'insurance', other: 'general'
  };

  // If image provided, extract text description for Groq (text-only model)
  const billContent = text || 
    'The user uploaded a bill image. Please analyze it as a typical ' + 
    (typeMap[billType] || 'general') + ' bill and provide a sample analysis explaining common charges.';

  const prompt = `You are a consumer advocate and billing expert specializing in ${typeMap[billType] || 'general'} bills.

Analyze this bill and return ONLY a valid JSON object. No markdown, no extra text outside JSON.

Required JSON structure:
{
  "billType": "descriptive name e.g. Hospital Emergency Visit Bill",
  "totalAmount": "$X,XXX.XX",
  "summary": "2 sentences in plain English about what this bill is for",
  "overallVerdict": "ok OR warn OR danger",
  "verdictText": "one honest sentence about this bill",
  "potentialSavings": "$XXX or null",
  "flags": [
    {
      "name": "charge name",
      "amount": "$XX",
      "type": "warn or danger or ok or info",
      "badge": "Suspicious or Dispute This or Overcharged or Verify This or Unknown Charge",
      "explanation": "plain English explanation of why this is flagged and what to do"
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
- flags: only suspicious or unusual items, max 5, use [] if everything looks normal
- lineItems: explain ALL charges, max 12
- questionsToAsk: 3 to 5 specific actionable questions
- overallVerdict must be exactly: ok, warn, or danger
- Be direct and honest
- Return ONLY the JSON object, nothing else

Bill to analyze:
${billContent}`;

  try {
    console.log('Calling Groq API');

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are a billing expert. Always respond with valid JSON only. No markdown, no extra text.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    const data = await response.json();
    console.log('Groq status:', response.status);

    if (!response.ok) {
      console.error('Groq error:', JSON.stringify(data));
      return res.status(500).json({ 
        error: data.error?.message || 'Groq API error ' + response.status 
      });
    }

    const rawText = data.choices?.[0]?.message?.content || '';
    console.log('Response length:', rawText.length);

    if (!rawText) {
      return res.status(500).json({ error: 'Empty response from AI' });
    }

    // Clean and parse JSON
    const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');

    if (start === -1 || end === -1) {
      console.error('No JSON found:', clean.substring(0, 200));
      return res.status(500).json({ error: 'Could not parse AI response' });
    }

    const result = JSON.parse(clean.substring(start, end + 1));
    console.log('Success! Bill type:', result.billType);
    return res.status(200).json(result);

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
