import { config } from '../config.js';

const DEFAULT_MODEL = 'gemini-1.5-flash';
const FALLBACK_MODELS = ['gemini-1.5-flash-001', 'gemini-1.5-flash-8b', 'gemini-1.0-pro'];
let cachedModel = null;

const buildPrompt = ({ filename, existing }) => {
  return [
    'You are a music metadata assistant.',
    'Return ONLY a single JSON object with keys:',
    'title, artist, album, track_number, year, genre.',
    'If unknown, use null. Do not add extra text.',
    '',
    `Filename: ${filename}`,
    `Existing metadata: ${JSON.stringify(existing || {})}`
  ].join('\n');
};

const safeJsonParse = text => {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

export const geminiClient = {
  async suggestMetadata({ filename, existing, model = DEFAULT_MODEL }) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key is missing');

    const prompt = buildPrompt({ filename, existing });

    const modelsToTry = [];
    if (cachedModel) modelsToTry.push(cachedModel);
    modelsToTry.push(model, ...FALLBACK_MODELS.filter(item => item !== model));

    if (!cachedModel) {
      try {
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const listResponse = await fetch(listUrl);
        if (listResponse.ok) {
          const listData = await listResponse.json();
          const modelFromApi = (listData.models || []).find(item => (item.supportedGenerationMethods || []).includes('generateContent'));
          if (modelFromApi?.name) {
            cachedModel = modelFromApi.name.replace(/^models\//, '');
            modelsToTry.unshift(cachedModel);
          }
        }
      } catch {
        // ignore listModels failure, fallback to static list
      }
    }

    let lastError = null;

    for (const candidate of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate)}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 }
        })
      });

      if (!response.ok) {
        const text = await response.text();
        lastError = text;
        if (response.status === 404) continue;
        throw new Error(`Gemini error: ${text}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = safeJsonParse(text);
      if (!parsed) throw new Error('Gemini returned invalid JSON');

      return {
        title: parsed.title ?? null,
        artist: parsed.artist ?? null,
        album: parsed.album ?? null,
        track_number: Number(parsed.track_number) || null,
        year: Number(parsed.year) || null,
        genre: parsed.genre ?? null
      };
    }

    throw new Error(`Gemini error: ${lastError || 'model not found'}`);
  }
};


