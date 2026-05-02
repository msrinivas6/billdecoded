export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'API key not configured. Please add ANTHROPIC_API_KEY in Vercel environment variables.' }); return; }

  const { billType, text, imageBase64, imageMime } = req.body;
  if (!text && !imageBase64) { res.status(400).json({ error: 'Please provide bill text or an image.' }); return; }

  const typeMap = {
    hospital: 'hospital/medical', utility: 'utility (electricity, gas, water)',
    phone: 'phone/mobile/internet', contractor: 'contractor/home service/repair',
    insurance: 'insurance (health, auto, home)', other: 'general'
  };
  const tLabel = typeMap[billType] || 'general';

  const prompt = `You are a consumer advocate and billing expert specializing in ${tLabel} bills.
Analyze this bill carefully and return ONLY a valid JSON object. No markdown, no text outside JSON.

Return exactly this structure:
{"billType":"Descriptive bill name","totalAmount":"$X,XXX.XX","summary":"2-sentence plain English summary of what this bill is for","overallVerdict":"ok OR warn OR danger","verdictText":"One clear honest sentence about this bill","potentialSavings":"$XXX or null","flags":[{"name":"Charge name","amount":"$XX","type":"warn|danger|ok|info","badge":"Suspicious|Dispute This|Overcharged|Verify This|Unknown Charge","explanation":"Plain English — what this charge is and what the person should do about it"}],"lineItems":[{"icon":"emoji","name":"Charge name","amount":"$XX","explanation":"What this charge means in plain simple English — no jargon"}],"questionsToAsk":["Specific question 1","Specific question 2"]}

Rules:
- flags: only notable/suspicious items, max 5, empty [] if everything looks normal
- lineItems: ALL charges from the bill explained clearly, max 12
- questionsToAsk: 3 to 5 specific actionable questions the person should ask the biller
- Be direct and honest — if something looks wrong say so clearly
- overallVerdict: ok=looks normal, warn=has items worth questioning, danger=clear errors or overcharges
- Return ONLY the JSON object, nothing else
${text ? `\nBill text to analyze:\n${text}` : ''}`;

  // Build messages
  let messages;
  if (imageBase64) {
    const mime = imageMime || 'image/jpeg';
    if (mime === 'application/pdf') {
      messages = [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } },
        { type: 'text', text: prompt }
      ]}];
    } else {
      messages = [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: imageBase64 } },
        { type: 'text', text: prompt }
      ]}];
    }
  } else {
    messages = [{ role: 'user', content: prompt }];
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 2500, messages })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Anthropic API error' });
    }

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    let txt = '';
    if (data.content && Array.isArray(data.content)) {
      data.content.forEach(block => { if (block.type === 'text') txt += block.text; });
    }
    if (!txt) return res.status(500).json({ error: 'Empty response from AI' });

    // Clean and parse JSON
    txt = txt.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start === -1 || end === -1) return res.status(500).json({ error: 'Could not parse AI response' });

    const result = JSON.parse(txt.substring(start, end + 1));
    res.status(200).json(result);

  } catch (err) {
    console.error('BillDecoded API error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
