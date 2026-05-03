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

  const jsonTemplate = `{"billType":"exact bill name","totalAmount":"exact $ total from bill","summary":"2 sentences about this specific bill","overallVerdict":"ok or warn or danger","verdictText":"one honest sentence","potentialSavings":"$X or null","flags":[{"name":"charge name","amount":"$X","type":"warn","badge":"Suspicious","explanation":"why flagged"}],"lineItems":[{"icon":"emoji","name":"charge","amount":"$X","explanation":"plain English meaning"}],"questionsToAsk":["question 1","question 2","question 3"]}`;

  const analysisInstruction = `You are a billing expert. Analyze this ${typeMap[billType]||'general'} bill.
Return ONLY valid JSON. No markdown. No extra text. Use EXACT amounts from the bill.
Required JSON structure: ${jsonTemplate}
Rules: totalAmount=exact total shown. flags=suspicious items only max 5, []=if normal. lineItems=ALL charges max 12. questionsToAsk=3-5 questions. Return ONLY JSON.`;

  try {
    // PATH 1: Image — use Groq vision
    if (imageBase64) {
      // Ensure mime type is supported (jpg or png only for Groq vision)
      const supportedMime = (imageMime && imageMime.includes('png')) ? 'image/png' : 'image/jpeg';
      const imageUrl = `data:${supportedMime};base64,${imageBase64}`;
      
      console.log('Image path - mime:', supportedMime, '- base64 length:', imageBase64.length);

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: analysisInstruction + '\n\nRead ALL text, charges and amounts visible in this bill image, then return the JSON analysis.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl,
                    detail: 'high'
                  }
                }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      });

      const data = await response.json();
      console.log('Groq vision status:', response.status);

      if (response.status === 429) {
        return res.status(429).json({ error: 'Too busy right now. Please wait 1 minute and try again.' });
      }

      if (!response.ok) {
        console.error('Groq vision error:', JSON.stringify(data.error));
        // If vision fails, ask user to paste text
        return res.status(500).json({ 
          error: 'Could not read this image. Please paste the bill text in the text box instead — it works perfectly!' 
        });
      }

      const rawText = data.choices?.[0]?.message?.content || '';
      console.log('Vision response length:', rawText.length);
      const result = parseJSON(rawText);
      if (result) {
        console.log('SUCCESS via vision! Total:', result.totalAmount);
        return res.status(200).json(result);
      }
      return res.status(500).json({ error: 'Could not parse image analysis. Please paste the bill text instead.' });
    }

    // PATH 2: Text — use Groq text model
    if (text) {
      console.log('Text path - length:', text.length);
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'You are a billing expert. Always respond with ONLY valid JSON. No markdown, no extra text.'
            },
            {
              role: 'user',
              content: analysisInstruction + '\n\nBill text to analyze:\n' + text
            }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      });

      const data = await response.json();
      console.log('Groq text status:', response.status);

      if (response.status === 429) {
        return res.status(429).json({ error: 'Too busy right now. Please wait 1 minute and try again.' });
      }

      if (!response.ok) {
        console.error('Groq text error:', data.error?.message);
        return res.status(500).json({ error: data.error?.message || 'AI service error' });
      }

      const rawText = data.choices?.[0]?.message?.content || '';
      console.log('Text response length:', rawText.length);
      const result = parseJSON(rawText);
      if (result) {
        console.log('SUCCESS via text! Total:', result.totalAmount);
        return res.status(200).json(result);
      }
      return res.status(500).json({ error: 'Could not parse response. Please try again.' });
    }

  } catch (err) {
    console.error('Caught error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

function parseJSON(text) {
  if (!text) return null;
  try {
    const clean = text.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(clean.substring(start, end+1));
  } catch (e) {
    console.error('JSON parse error:', e.message);
    return null;
  }
}
