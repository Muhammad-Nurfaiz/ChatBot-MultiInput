import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from "path";
import mammoth from 'mammoth';
import { GoogleGenAI } from '@google/genai';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const __dirname = process.cwd();

const app = express();
app.use(cors());
app.use(express.json());

// init GenAI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// multer config (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // limit 25 MB (ubah jika perlu)
});

app.use(express.static(path.join(__dirname, "public")));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// helper: safe extract AI text from response
function extractAiText(response) {
  // many SDK responses place content in candidates[0].content.parts[*].text
  return response?.candidates?.[0]?.content?.parts
    ?.map((p) => p?.text || '')
    .join('') || '';
}

// helper: truncate long texts to avoid sending enormous payloads
function truncateText(s, max = 200000) { // 200k chars
  if (!s) return s;
  return s.length > max ? s.slice(0, max) + '\n\n...[truncated]' : s;
}

// ROUTE: Document upload (supports docx, pdf, txt)
app.post('/api/document', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan (field name harus "file")' });

    const mime = req.file.mimetype || '';
    const filename = req.file.originalname || 'document';
    let extractedText = '';

    // Handle .docx
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filename.toLowerCase().endsWith('.docx')) {
      try {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        extractedText = result.value || '';
      } catch (err) {
        console.error('DOCX PARSE ERROR:', err);
        return res.status(500).json({ error: 'Gagal mengekstrak DOCX' });
      }
    }
    // Handle PDF
    else if (mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
      try {
        const data = await pdfParse(req.file.buffer);
        extractedText = data?.text || '';
      } catch (err) {
        console.error('PDF PARSE ERROR:', err);
        return res.status(500).json({ error: 'Gagal mengekstrak PDF' });
      }
    }
    // Handle plain text
    else if (mime.startsWith('text/') || filename.toLowerCase().endsWith('.txt')) {
      extractedText = req.file.buffer.toString('utf8');
    }
    // Unsupported
    else {
      return res.status(400).json({
        error: 'Tipe file tidak didukung. Silakan upload .docx, .pdf, atau .txt'
      });
    }

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({ error: 'Tidak ada teks yang dapat diekstrak dari dokumen.' });
    }

    // Optional: limit length
    const promptFromClient = req.body.prompt || 'Tolong ringkas dokumen berikut.';
    const textToSend = promptFromClient + '\n\n' + truncateText(extractedText, 200000);

    // Call Gemini (send as text content)
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        { text: textToSend, type: 'text' }
      ],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 1500,
        topP: 0.98,
        topK: 70,
      },
    });

    const output = extractAiText(response);

    return res.json({ result: output || 'Tidak ada output dari model.' });
  } catch (e) {
    console.error('DOCUMENT ERROR:', e);
    // if library throws ApiError with structured message, forward it
    if (e?.message) return res.status(500).json({ error: e.message });
    return res.status(500).json({ error: 'Unknown error' });
  }
});

// small helper endpoints for chat & image/audio if needed
app.post('/api/chat', async (req, res) => {
  try {
    const prompt = req.body.prompt || '';
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ text: prompt, type: 'text' }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 1500,
        topP: 0.98,
        topK: 70,
      },
    });
    const output = extractAiText(response);
    res.json({ result: output || '' });
  } catch (e) {
    console.error('CHAT ERROR:', e);
    res.status(500).json({ error: e.message || 'error' });
  }
});

// image endpoint (kept simple: inlineData unsupported for many file types, we send base64 as inline if you really need)
app.post('/api/image', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Image tidak ditemukan (field "file")' });

    const mime = req.file.mimetype || '';
    // prefer sending a prompt + image as base64 inline only for supported image mime types
    if (!['image/png','image/jpeg','image/webp'].includes(mime)) {
      // fallback: reject or just send text prompt + note
      // Here we'll reject to avoid Gemini MIME errors
      return res.status(400).json({ error: `Mime type ${mime} mungkin tidak didukung untuk inline image. Gunakan PNG/JPEG/WEBP.` });
    }

    const base64 = req.file.buffer.toString('base64');
    const prompt = req.body.prompt || 'Analisis gambar berikut:';

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        { text: prompt, type: 'text' },
        { inlineData: { data: base64, mimeType: mime } }
      ],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 1500,
        topP: 0.98,
        topK: 70,
      },
    });

    const output = extractAiText(response);
    res.json({ result: output || '' });
  } catch (e) {
    console.error('IMAGE ERROR:', e);
    res.status(500).json({ error: e.message || 'error' });
  }
});

// audio endpoint (support WAV/MP3 inline only if supported)
app.post('/api/audio', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Audio tidak ditemukan (field "file")' });

    const mime = req.file.mimetype || '';
    if (!['audio/wav','audio/mpeg','audio/mp3'].includes(mime)) {
      return res.status(400).json({ error: `Mime type ${mime} mungkin tidak didukung. Gunakan WAV atau MP3.` });
    }

    const base64 = req.file.buffer.toString('base64');
    const prompt = req.body.prompt || 'Transkrip audio berikut:';

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        { text: prompt, type: 'text' },
        { inlineData: { data: base64, mimeType: mime } }
      ],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 1500,
        topP: 0.98,
        topK: 70,
      },
    });

    const output = extractAiText(response);
    res.json({ result: output || '' });
  } catch (e) {
    console.error('AUDIO ERROR:', e);
    res.status(500).json({ error: e.message || 'error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
