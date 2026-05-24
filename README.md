# 🧾 BillDecoded

> **Understand any bill instantly** — AI-powered bill analyzer that flags suspicious charges, explains every line item, and tells you exactly what to ask before you pay.

![BillDecoded](https://img.shields.io/badge/AI--Powered-Groq%20LLaMA-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![Deploy](https://img.shields.io/badge/deploy-Vercel-black)

---

## ✨ Features

- 📸 **Upload a photo** of your bill (JPG, PNG, PDF) — OCR extracts the text automatically
- 📋 **Paste bill text** directly for instant analysis
- 🔍 **Flags suspicious charges** with explanations and what to do about them
- 📊 **Breaks down every line item** in plain English
- 💰 **Estimates potential savings** you could recover
- ❓ **Generates questions to ask** your provider before paying
- 🔊 **Text-to-speech** — listen to your full bill summary hands-free
- 📤 **Copy & share** your decoded report
- Supports: **Hospital, Utility, Phone, Contractor, Insurance**, and general bills

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (single file) |
| Backend | Vercel Serverless Functions (Node.js 18) |
| AI Analysis | [Groq](https://groq.com) — `llama-3.3-70b-versatile` |
| Vision Fallback | [Groq](https://groq.com) — `meta-llama/llama-4-scout-17b-16e-instruct` |
| OCR | [OCR.space](https://ocr.space) API |
| Deployment | [Vercel](https://vercel.com) |

---

## 📁 Project Structure

```
billdecoded/
├── public/
│   └── index.html        # Full frontend (single-page app)
├── api/
│   └── analyze.js        # Serverless API route
├── package.json
└── vercel.json           # Vercel routing config
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js 18+](https://nodejs.org)
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- A [Groq API key](https://console.groq.com) (free)
- Optionally a [OCR.space API key](https://ocr.space/ocrapi) (free tier available; defaults to `helloworld` key)

### Local Development

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/billdecoded.git
cd billdecoded

# 2. Set up environment variables
cp .env.example .env.local
# Add your keys to .env.local

# 3. Run locally
vercel dev
```

### Environment Variables

Create a `.env.local` file (for local dev) or set these in your Vercel dashboard:

```env
GROQ_API_KEY=your_groq_api_key_here
OCR_API_KEY=your_ocr_space_key_here   # optional, falls back to free 'helloworld' key
```

### Deploy to Vercel

```bash
vercel --prod
```

Or connect your GitHub repo to Vercel for automatic deployments on every push.

---

## 🔌 API Reference

### `POST /api/analyze`

Analyzes a bill and returns structured JSON.

**Request body:**

```json
{
  "billType": "hospital | utility | phone | contractor | insurance | other",
  "text": "pasted bill text...",
  "imageBase64": "base64-encoded image string",
  "imageMime": "image/jpeg | image/png | application/pdf"
}
```

Either `text` or `imageBase64` is required.

**Response:**

```json
{
  "billType": "AT&T Wireless Bill",
  "totalAmount": "$142.50",
  "summary": "Two-sentence summary of the bill.",
  "overallVerdict": "warn",
  "verdictText": "One honest sentence about the bill.",
  "potentialSavings": "$25",
  "flags": [
    {
      "name": "Equipment Protection",
      "amount": "$17.00",
      "type": "warn",
      "badge": "Suspicious",
      "explanation": "Why it was flagged and what to do."
    }
  ],
  "lineItems": [
    {
      "icon": "📱",
      "name": "Monthly Service",
      "amount": "$65.00",
      "explanation": "Plain English explanation."
    }
  ],
  "questionsToAsk": [
    "Did I agree to this charge?",
    "Can this fee be waived?"
  ]
}
```

`overallVerdict` is one of: `ok` · `warn` · `danger`

---

## ⚠️ Known Limitations

- **HEIC images** (iPhone camera default format) are not supported — users should take a screenshot instead (Side button + Volume Up on iPhone)
- OCR accuracy depends on image quality; clear, well-lit photos work best
- The free OCR.space `helloworld` key has rate limits — use your own key for production

---

## 📄 License

MIT — free to use, modify, and deploy.

---

## 🙌 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you'd like to change.

---

*Built with ❤️ to help people understand what they're actually paying for.*
