export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!groqKey && !geminiKey) {
    return res.status(500).json({ error: 'No API keys configured' });
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
  const tLabel = typeMap[billType] || 'general';

  const analysisPrompt = (billText) => `You are a billing expert. Analyze this ${tLabel} bill and return ONLY valid JSON with no markdown.

JSON structure required:
{"billType":"exact bill name","totalAmount":"exact total from bill","summary":"2 sentences about this specific bill","overallVerdict":"ok or warn or danger","verdictText":"one honest sentence","potentialSavings":"$X or null","flags":[{"name":"charge name","amount":"$X","type":"warn","badge":"Suspicious","explanation":"why flagged"}],"lineItems":[{"icon":"emoji","name":"charge","amount":"$X","explanation":"plain English"}],"questionsToAsk":["question 1","question 2","question 3"]}

Rules: Use EXACT amounts from the bill. flags=suspicious items only max 5, [] if normal. lineItems=ALL charges max 12. questionsToAsk=3-5 questions. Return ONLY JSON.

Bill content:
${billText}`;

  try {
    // PATH 1: Image uploaded — use Groq vision model (llama-4-scout supports images)
    if (imageBase64) {
      console.log('Image path — trying Groq vision model');
      const mime = imageMime || 'image/jpeg';
      
      const groqVisionRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
              { type: 'text', text: analysisPrompt('Read ALL text from this bill image and analyze every charge shown.') }
            ]
          }],
          temperature: 0.1,
          max_tokens: 2000
        })
      });

      const groqVisionData = await groqVisionRes.json();
      console.log('Groq vision status:', groqVisionRes.status);

      if (groqVisionRes.ok) {
        const raw = groqVisionData.choices?.[0]?.message?.content || '';
        console.log('Vision response preview:', raw.substring(0, 150));
        const result = parseJSON(raw);
        if (result) {
          console.log('Success via Groq vision! Total:', result.totalAmount);
          return res.status(200).json(result);
        }
      } else {
        console.log('Groq vision failed:', JSON.stringify(groqVisionData.error));
      }

      // Fallback: Gemini vision
      if (geminiKey) {
        console.log('Trying Gemini vision fallback');
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
        const gemRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: mime, data: imageBase64 } },
              { text: analysisPrompt('Read ALL text and numbers from this bill image.') }
            ]}],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
          })
        });
        const gemData = await gemRes.json();
        console.log('Gemini status:', gemRes.status);
        const gemText = gemData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const result = parseJSON(gemText);
        if (result) {
          console.log('Success via Gemini! Total:', result.totalAmount);
          return res.status(200).json(result);
        }
        console.log('Gemini also failed:', gemData.error?.message);
      }

      return res.status(500).json({ error: 'Could not read bill image. Please paste the bill text instead.' });
    }

    // PATH 2: Text provided — use Groq
    if (text && groqKey) {
      console.log('Text path — using Groq');
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are a billing expert. Return ONLY valid JSON. No markdown.' },
            { role: 'user', content: analysisPrompt(text) }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      });
      const groqData = await groqRes.json();
      console.log('Groq text status:', groqRes.status);
      if (!groqRes.ok) return res.status(500).json({ error: groqData.error?.message || 'Groq error' });
      const raw = groqData.choices?.[0]?.message?.content || '';
      const result = parseJSON(raw);
      if (result) { console.log('Success via Groq text! Total:', result.totalAmount); return res.status(200).json(result); }
    }

    return res.status(500).json({ error: 'Analysis failed. Please try pasting the bill text.' });

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

function parseJSON(text) {
  if (!text) return null;
  try {
    const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(clean.substring(start, end + 1));
  } catch (e) {
    console.error('JSON parse error:', e.message);
    return null;
  }
}
