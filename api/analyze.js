export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const groqKey = process.env.GROQ_API_KEY;
  const ocrKey = process.env.OCR_API_KEY || 'helloworld';

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
Analyze this bill and return ONLY valid JSON. No markdown. No extra text. Use EXACT amounts from the bill.
Required JSON: ${jsonTemplate}
Rules: totalAmount=exact total. flags=suspicious items only max 5, []=if normal. lineItems=ALL charges max 12. questionsToAsk=3-5 questions. Return ONLY JSON.
Bill:
${billText}`;

  try {
    let billText = text || '';

    // STEP 1: Extract text from image using OCR.space
    if (imageBase64 && !text) {
      const mime = imageMime || 'image/jpeg';
      console.log('OCR step - original mime:', mime, '- base64 length:', imageBase64.length);

      // OCR.space accepts base64 for most formats
      // For HEIC we tell it the filetype explicitly
      const isHeic = mime.includes('heic') || mime.includes('heif');
      const isPdf = mime.includes('pdf');

      // Always send as the correct type, OCR.space handles HEIC/PDF/JPG/PNG
      const dataUrl = `data:${mime};base64,${imageBase64}`;

      const formData = new URLSearchParams();
      formData.append('base64Image', dataUrl);
      formData.append('apikey', ocrKey);
      formData.append('language', 'eng');
      formData.append('isOverlayRequired', 'false');
      formData.append('detectOrientation', 'true');
      formData.append('scale', 'true');
      formData.append('isTable', 'true');
      formData.append('OCREngine', '2'); // Engine 2 is better for complex layouts
      if (isPdf) formData.append('filetype', 'PDF');
      if (isHeic) formData.append('filetype', 'HEIC');

      console.log('Sending to OCR.space - isHeic:', isHeic, '- isPdf:', isPdf);

      const ocrRes = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });

      const ocrData = await ocrRes.json();
      console.log('OCR exit code:', ocrData.OCRExitCode);
      console.log('OCR error message:', ocrData.ErrorMessage || 'none');

      if (ocrData.OCRExitCode === 1 && ocrData.ParsedResults?.[0]?.ParsedText) {
        billText = ocrData.ParsedResults[0].ParsedText.trim();
        console.log('OCR success! Text length:', billText.length);
        console.log('OCR preview:', billText.substring(0, 300));
      } else {
        // OCR failed - try Groq vision as fallback for JPG/PNG
        console.log('OCR failed. Exit code:', ocrData.OCRExitCode, 'Error:', ocrData.ErrorMessage);
        
        if (!isHeic && !isPdf) {
          console.log('Trying Groq vision fallback for non-HEIC image');
          const supportedMime = mime.includes('png') ? 'image/png' : 'image/jpeg';
          
          const groqVisionRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({
              model: 'meta-llama/llama-4-scout-17b-16e-instruct',
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: buildPrompt('Read ALL text, charges and amounts from this bill image.') },
                  { type: 'image_url', image_url: { url: `data:${supportedMime};base64,${imageBase64}`, detail: 'high' } }
                ]
              }],
              temperature: 0.1,
              max_tokens: 2000
            })
          });
          
          if (groqVisionRes.ok) {
            const gvData = await groqVisionRes.json();
            const raw = gvData.choices?.[0]?.message?.content || '';
            const result = parseJSON(raw);
            if (result) {
              console.log('Success via Groq vision fallback! Total:', result.totalAmount);
              return res.status(200).json(result);
            }
          } else {
            const gvErr = await groqVisionRes.json();
            console.log('Groq vision also failed:', gvErr.error?.message);
          }
        }

        return res.status(500).json({ 
          error: isHeic 
            ? 'HEIC photos from iPhone camera are not supported. Please take a screenshot instead (press Side button + Volume Up), or paste the bill text.'
            : 'Could not read this image. Please paste the bill text instead — it works perfectly!'
        });
      }
    }

    if (!billText || billText.length < 10) {
      return res.status(400).json({ error: 'Could not extract enough text. Please paste the bill text instead.' });
    }

    // STEP 2: Analyze extracted text with Groq
    console.log('Analyzing with Groq. Text length:', billText.length);

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
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
      return res.status(500).json({ error: groqData.error?.message || 'AI analysis failed' });
    }

    const rawText = groqData.choices?.[0]?.message?.content || '';
    const result = parseJSON(rawText);
    if (result) {
      console.log('SUCCESS! Bill:', result.billType, '| Total:', result.totalAmount);
      return res.status(200).json(result);
    }

    return res.status(500).json({ error: 'Could not parse response. Please try again.' });

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
