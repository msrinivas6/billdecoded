export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  const { billType, text, imageBase64, imageMime } = req.body || {};
  if (!text && !imageBase64) return res.status(400).json({ error: 'No bill content provided' });

  const typeMap = {
    hospital:'hospital/medical', utility:'utility (electricity, gas, internet)',
    phone:'phone/mobile', contractor:'contractor/home service',
    insurance:'insurance', other:'general'
  };

  const jsonTemplate = `{"billType":"exact bill name","totalAmount":"exact $ from bill","summary":"2 sentences about this specific bill","overallVerdict":"ok or warn or danger","verdictText":"one honest sentence","potentialSavings":"$X or null","flags":[{"name":"charge","amount":"$X","type":"warn","badge":"Suspicious","explanation":"why flagged and what to do"}],"lineItems":[{"icon":"emoji","name":"charge","amount":"$X","explanation":"plain English meaning"}],"questionsToAsk":["question 1","question 2","question 3"]}`;

  const prompt = `You are a consumer billing expert specializing in ${typeMap[billType]||'general'} bills.
Analyze this bill carefully and return ONLY valid JSON. No markdown. No extra text.
Use EXACT amounts and names from the bill — do not make up numbers.

Required JSON: ${jsonTemplate}

Rules:
- totalAmount: use the EXACT total shown on the bill
- flags: only suspicious/unusual items, max 5, use [] if everything looks normal  
- lineItems: explain ALL charges shown, max 12
- questionsToAsk: 3-5 specific actionable questions
- Return ONLY the JSON object`;

  try {
    // Choose model based on whether image is provided
    const hasImage = !!imageBase64;
    const model = hasImage
      ? 'meta-llama/llama-4-scout-17b-16e-instruct'  // vision model for images
      : 'llama-3.3-70b-versatile';                    // text model for paste

    console.log('Model:', model, '| Has image:', hasImage, '| Has text:', !!text);

    // Build message content
    let messageContent;
    if (hasImage) {
      const mime = imageMime || 'image/jpeg';
      messageContent = [
        {
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${imageBase64}` }
        },
        {
          type: 'text',
          text: prompt + '\n\nRead ALL text, numbers and amounts from this bill image and analyze it.'
        }
      ];
    } else {
      messageContent = prompt + '\n\nBill to analyze:\n' + text;
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a billing expert. Always respond with ONLY valid JSON. No markdown, no extra text, no explanation.'
          },
          {
            role: 'user',
            content: messageContent
          }
        ],
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    const data = await response.json();
    console.log('Status:', response.status);

    if (response.status === 429) {
      return res.status(429).json({ error: 'Too many requests. Please wait 1 minute and try again.' });
    }

    if (!response.ok) {
      console.error('Groq error:', data.error?.message);
      return res.status(500).json({ error: data.error?.message || 'AI service error' });
    }

    const rawText = data.choices?.[0]?.message?.content || '';
    console.log('Response length:', rawText.length);
    console.log('Preview:', rawText.substring(0, 100));

    if (!rawText) return res.status(500).json({ error: 'Empty response from AI' });

    // Parse JSON
    const clean = rawText.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) {
      console.error('No JSON found in:', clean.substring(0, 200));
      return res.status(500).json({ error: 'Could not parse response. Please try again.' });
    }

    const result = JSON.parse(clean.substring(start, end+1));
    console.log('SUCCESS — Bill type:', result.billType, '| Total:', result.totalAmount);
    return res.status(200).json(result);

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
