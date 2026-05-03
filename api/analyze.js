export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const groqKey = process.env.GROQ_API_KEY;
  const ocrKey = process.env.OCR_API_KEY;

  if (!groqKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  const { billType, text, imageBase64, imageMime } = req.body || {};
  if (!text && !imageBase64) return res.status(400).json({ error: 'No bill content provided' });

  const typeMap = {
    hospital:'hospital/medical', utility:'utility (electricity, gas, internet)',
    phone:'phone/mobile', contractor:'contractor/home service',
    insurance:'insurance', other:'general'
  };

  const jsonTemplate = `{"billType":"exact bill name","totalAmount":"exact $ total from bill","summary":"2 sentences about this specific bill","overallVerdict":"ok or warn or danger","verdictText":"one honest sentence","potentialSavings":"$X or null","flags":[{"name":"charge name","amount":"$X","type":"warn","badge":"Suspicious","explanation":"why flagged and what to do"}],"lineItems":[{"icon":"emoji","name":"charge","amount":"$X","explanation":"plain English meaning"}],"questionsToAsk":["question 1","question 2","question 3"]}`;

  const buildPrompt = (billText) => `You are a consumer billing expert specializing in ${typeMap[billType]||'general'} bills.
Analyze this bill carefully and return ONLY valid JSON. No markdown. No extra text. Use EXACT amounts from the bill.

Required JSON: ${jsonTemplate}

Rules: totalAmount=exact total shown on bill. flags=suspicious/unusual items only max 5, []=if all normal. lineItems=ALL charges explained max 12. questionsToAsk=3-5 specific questions. Return ONLY JSON.

Bill to analyze:
${billText}`;

  try {
    let billText = text || '';

    // STEP 1: If image provided, extract text using OCR.space
    if (imageBase64 && !text) {
      console.log('Image received - extracting text via OCR');
      const mime = imageMime || 'image/jpeg';
      const isPDF = mime === 'application/pdf';
      const apiKey = ocrKey || 'helloworld'; // helloworld is OCR.space free demo key

      // Build form data for OCR.space
      const formData = new URLSearchParams();
      formData.append('base64Image', `data:${mime};base64,${imageBase64}`);
      formData.append('apikey', apiKey);
      formData.append('language', 'eng');
      formData.append('isOverlayRequired', 'false');
      formData.append('detectOrientation', 'true');
      formData.append('scale', 'true');
      formData.append('isTable', 'true'); // Better for bills with tabular data
      if (isPDF) formData.append('filetype', 'PDF');

      console.log('Calling OCR.space - isPDF:', isPDF);

      const ocrRes = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });

      const ocrData = await ocrRes.json();
      console.log('OCR status:', ocrRes.status, '| OCR exit code:', ocrData.OCRExitCode);

      if (ocrData.OCRExitCode === 1 && ocrData.ParsedResults?.[0]?.ParsedText) {
        billText = ocrData.ParsedResults[0].ParsedText;
        console.log('OCR extracted text length:', billText.length);
        console.log('OCR preview:', billText.substring(0, 200));
      } else {
        console.error('OCR failed:', JSON.stringify(ocrData));
        // Try Groq vision as fallback
        console.log('Trying Groq vision as fallback');
        const supportedMime = mime.includes('png') ? 'image/png' : 'image/jpeg';
        const groqVisionRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
          body: JSON.stringify({
            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: buildPrompt('Read ALL text from this bill image and analyze every charge shown.') },
                { type: 'image_url', image_url: { url: `data:${supportedMime};base64,${imageBase64}`, detail: 'high' } }
              ]
            }],
            temperature: 0.1,
            max_tokens: 2000
          })
        });
        const groqVisionData = await groqVisionRes.json();
        if (groqVisionRes.ok) {
          const raw = groqVisionData.choices?.[0]?.message?.content || '';
          const result = parseJSON(raw);
          if (result) { console.log('Success via Groq vision fallback!'); return res.status(200).json(result); }
        }
        return res.status(500).json({ error: 'Could not read this image. Please paste the bill text instead.' });
      }
    }

    if (!billText || billText.length < 10) {
      return res.status(400).json({ error: 'Could not extract text from image. Please paste the bill text instead.' });
    }

    // STEP 2: Analyze with Groq
    console.log('Analyzing with Groq - text length:', billText.length);

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a billing expert. Always respond with ONLY valid JSON. No markdown, no extra text.' },
          { role: 'user', content: buildPrompt(billText) }
        ],
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    const groqData = await groqRes.json();
    console.log('Groq status:', groqRes.status);

    if (groqRes.status === 429) {
      return res.status(429).json({ error: 'Too many requests. Please wait 1 minute and try again.' });
    }

    if (!groqRes.ok) {
      console.error('Groq error:', groqData.error?.message);
      return res.status(500).json({ error: groqData.error?.message || 'AI analysis failed' });
    }

    const rawText = groqData.choices?.[0]?.message?.content || '';
    console.log('Groq response length:', rawText.length);

    const result = parseJSON(rawText);
    if (result) {
      console.log('SUCCESS! Bill type:', result.billType, '| Total:', result.totalAmount);
      return res.status(200).json(result);
    }

    return res.status(500).json({ error: 'Could not parse AI response. Please try again.' });

  } catch (err) {
    console.error('Error:', err.message);
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
