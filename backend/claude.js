const https = require('https');

function groqRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.groq.com',
      path:     '/openai/v1/chat/completions',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`Groq error ${res.statusCode}: ${data}`));
        else resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Fix spelling errors + identify lyrics ─────────────────────────────────
async function fixSpellingAndSearch(query) {
  try {
    const prompt = `A user is searching for a song. Their input might have:
- Spelling mistakes
- Partial lyrics instead of song name
- Wrong song name but correct artist
- Hindi/Bollywood song written in English phonetically
- Context like "sad song from movie X"

User's search: "${query}"

Your task:
1. If this looks like lyrics → identify the song name and artist
2. If this has spelling mistakes → fix them
3. If this is a movie/context reference → identify the most likely song
4. Return ONLY the corrected search query (song name + artist) — nothing else
5. If you cannot identify it, return the original query

Examples:
"tum hi hoo" → "Tum Hi Ho Arijit Singh"
"jo bhi main kehna chahoon" → "Tum Hi Ho Arijit Singh"
"blinding lits weeknd" → "Blinding Lights The Weeknd"
"arijt singh sad song" → "Arijit Singh sad"
"bohemien rapsody" → "Bohemian Rhapsody Queen"

Return ONLY the corrected query, nothing else:`;

    const response = await groqRequest({
      model:       'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a music search assistant. Return only the corrected search query, nothing else.' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.3,
      max_tokens:  50,
    });

    const fixed = response.choices[0].message.content.trim();
    console.log(`🤖 Groq fixed "${query}" → "${fixed}"`);
    return fixed;
  } catch {
    return query;
  }
}

// ── Generate smart suggestions based on pinned songs ─────────────────────
async function generateSuggestions(pinnedSongs, mood) {
  try {
    const songList = pinnedSongs.slice(0, 10).map(s => `- "${s.title}" by ${s.artist}`).join('\n');

    const prompt = `A user has pinned (liked) these songs:
${songList}

${mood ? `Their current mood: ${mood}` : ''}

Analyse their music taste and suggest 8 songs they will love.
Consider: language preference, genre, mood, tempo, era.

Respond ONLY with valid JSON array, no markdown:
[
  { "title": "Song Name", "artist": "Artist Name" },
  { "title": "Song Name", "artist": "Artist Name" }
]`;

    const response = await groqRequest({
      model:       'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a music recommendation expert. Return only JSON array.' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.8,
      max_tokens:  500,
    });

    const text = response.choices[0].message.content.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return [
      { title: 'top hits 2024', artist: '' },
      { title: 'trending songs', artist: '' },
    ];
  }
}

// ── Generate full playlist from a vibe ────────────────────────────────────
async function generatePlaylistFromVibe(userId, mood, genre, query, libraryStr) {
  try {
    const prompt = `You are an elite, world-class DJ and AI Music Curator. A user wants a highly tailored music playlist.
Their requested vibe/description: "${query}"
Mood: "${mood}"
Genre: "${genre}"

Here is a glimpse into their current musical taste (their Liked Videos):
${libraryStr}

TASK: Curate a flawless playlist of exactly 10 to 15 incredible INDIVIDUAL songs.
CRITICAL RULES:
1. THE MOOD IS KING. Every single song MUST perfectly match the requested Mood and Vibe.
2. If they ask for "Meditation", "Sleep", or "Focus", DO NOT include pop, rock, rap, or heavy lyrical songs. You MUST provide authentic binaural beats, guided meditations, singing bowls, or ambient frequency music.
3. Use their liked videos ONLY as inspiration, and include them ONLY if they completely align with the requested mood. If their history clashes with the mood, completely ignore their history and pick perfect real-world tracks.
4. For each track, write a personalized 1-sentence "reason" explaining exactly why you picked it.
5. DO NOT recommend 1-hour mixes, jukeboxes, full albums, or "readymade playlists". Every suggestion MUST BE A SINGLE, SPECIFIC SONG.
6. You MUST return ONLY a valid, parseable JSON array. No markdown formatting, no introductions, no extra text.

Format EXACTLY like this:
[
  { "title": "Weightless", "artist": "Marconi Union", "reason": "Scientifically proven to reduce anxiety, perfect for deep meditation." }
]`;

    const response = await groqRequest({
      model:       'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a master music curator. Return only a JSON array.' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.8,
      max_tokens:  4000,
    });

    const text = response.choices[0].message.content.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error("Groq Playlist Gen Error:", err.message);
    return [];
  }
}

module.exports = { fixSpellingAndSearch, generateSuggestions, generatePlaylistFromVibe };
