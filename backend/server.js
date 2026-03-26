const express = require('express');
const cors    = require('cors');
const https   = require('https');
require('dotenv').config();

const { fixSpellingAndSearch, generateSuggestions, generatePlaylistFromVibe } = require('./claude');
const { savePinnedSong, getPinnedSongs, removePinnedSong, savePlaylist, getPlaylists } = require('./dynamo');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

const { google } = require('googleapis');
const YOUTUBE_CLIENT_ID     = (process.env.YOUTUBE_CLIENT_ID || '').trim();
const YOUTUBE_CLIENT_SECRET = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
const YOUTUBE_REDIRECT_URI  = 'http://localhost:3001/auth/callback';
const FRONTEND_URI          = 'http://localhost:3000';
const querystring           = require('querystring');

const oauth2Client = new google.auth.OAuth2(
  YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET,
  YOUTUBE_REDIRECT_URI
);

// ── YouTube OAuth Endpoints ───────────────────────────────────────────────
app.get('/login', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code || null;
  if (!code) return res.redirect(`${FRONTEND_URI}?error=auth_failed`);

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.redirect(`${FRONTEND_URI}?token=${tokens.access_token}`);
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.redirect(`${FRONTEND_URI}?error=auth_failed`);
  }
});

// ── YouTube Search Helper ────────────────────────────────────────────────
async function youtubeSearch(query, token, limit = 10) {
  try {
    const tempClient = new google.auth.OAuth2();
    tempClient.setCredentials({ access_token: token });
    const youtube = google.youtube({ version: 'v3', auth: tempClient });
    
    const searchRes = await youtube.search.list({
      part: 'snippet',
      q: query + ' official audio -"playlist" -"mix" -"jukebox" -"full album"',
      type: 'video',
      videoCategoryId: '10',
      maxResults: limit
    });
    
    return (searchRes.data.items || []).map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
      album: 'YouTube',
      image: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default?.url,
      preview: null,
      youtubeUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      duration: 0
    }));
  } catch (err) {
    console.error('YouTube Search Error:', err.message);
    return [];
  }
}

// ── SEARCH endpoint — handles typos, lyrics, partial names ───────────────
app.get('/search', async (req, res) => {
  try {
    const { q, userId, token } = req.query;
    if (!q || q.trim().length < 2) return res.json({ tracks: [], didYouMean: null });

    console.log('🔍 Searching:', q);

    let tracks = await youtubeSearch(q, token, 10);

    let didYouMean = null;
    if (tracks.length < 2) {
      console.log('🤖 Few results, asking Groq AI to fix/identify...');
      const fixed = await fixSpellingAndSearch(q);
      if (fixed && fixed !== q) {
        didYouMean = fixed;
        tracks     = await youtubeSearch(fixed, token, 10);
      }
    }

    res.json({ tracks, didYouMean });
  } catch (err) {
    console.error('❌ /search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SUGGESTIONS — based on pinned songs ──────────────────────────────────
app.get('/suggestions', async (req, res) => {
  try {
    const { userId, mood, token } = req.query;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const pinnedSongs = await getPinnedSongs(userId);
    let queries = [];

    if (pinnedSongs.length >= 2) {
      console.log('🤖 Generating suggestions from pinned songs...');
      const suggestions = await generateSuggestions(pinnedSongs, mood);
      queries = suggestions.map(s => `${s.title} ${s.artist}`);
    } else {
      const trendingQueries = [
        'top hits 2024', 'bollywood hits 2024', 'trending songs india',
        'popular english songs 2024', 'viral songs 2024'
      ];
      queries = mood
        ? [`${mood} hindi songs`, `${mood} english songs`, `${mood} music 2024`]
        : trendingQueries;
    }

    const results = await Promise.all(queries.slice(0, 5).map(q => youtubeSearch(q, token, 4)));
    const allTracks = [...new Map(
      results.flat()
        .filter(t => !pinnedSongs.find(p => p.id === t.id))
        .map(t => [t.id, t])
    ).values()].slice(0, 20);

    res.json({ tracks: allTracks, basedOn: pinnedSongs.length >= 2 ? 'pinned' : 'trending' });
  } catch (err) {
    console.error('❌ /suggestions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PIN a song ────────────────────────────────────────────────────────────
app.post('/pin', async (req, res) => {
  try {
    const { userId, song } = req.body;
    if (!userId || !song) return res.status(400).json({ error: 'Missing userId or song' });
    const pinned = await savePinnedSong(userId, song);
    console.log('❤️  Pinned:', song.title, 'for user:', userId);
    res.json(pinned);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── UNPIN a song ──────────────────────────────────────────────────────────
app.delete('/pin', async (req, res) => {
  try {
    const { userId, songId } = req.body;
    if (!userId || !songId) return res.status(400).json({ error: 'Missing userId or songId' });
    await removePinnedSong(userId, songId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET pinned songs ──────────────────────────────────────────────────────
app.get('/pins', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const pins = await getPinnedSongs(userId);
    res.json(pins);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET Playlists ──────────────────────────────────────────────────────
app.get('/playlists', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const pl = await getPlaylists(userId);
    res.json(pl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GENERATE ───────────────────────────────────────────────────────────
app.post('/generate', async (req, res) => {
  try {
    const { userId, mood, genre, artists, libraryStr, token } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    console.log('✨ Generating playlist for:', { mood, genre, artists });
    
    const suggestedSongs = await generatePlaylistFromVibe(userId, mood, genre, artists, libraryStr);
    
    if (!Array.isArray(suggestedSongs) || suggestedSongs.length === 0) {
      throw new Error("AI could not extract enough context to generate music.");
    }

    // Execute searches sequentially with a slight delay to prevent YouTube API Rate Limiting (403/429)
    const tracks = [];
    for (const sg of suggestedSongs) {
      const q = `${sg.title} ${sg.artist}`;
      const searchRes = await youtubeSearch(q, token, 1);
      if (searchRes && searchRes.length > 0) {
        tracks.push({
          ...searchRes[0],
          reason: sg.reason // Attach the AI's reason
        });
      }
      // 100ms artificial delay to protect the API
      await new Promise(r => setTimeout(r, 100));
    }

    if (tracks.length === 0) {
      throw new Error("YouTube API Quota Exceeded. You have run out of daily free queries.");
    }

    const playlistObj = {
      title: `${mood ? mood.charAt(0).toUpperCase() + mood.slice(1) : 'Curated'} ${genre ? genre : 'Vibes'}`,
      description: `A custom artificial intelligence playlist tailored directly to your vibe.`,
      songs: tracks
    };

    const savedObj = await savePlaylist(userId, playlistObj);

    res.json(savedObj);
  } catch (err) {
    console.error('❌ /generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── EXPORT PLAYLIST TO YOUTUBE ──────────────────────────────────────────
app.post('/export-playlist', async (req, res) => {
  try {
    const { token, title, description, videoIds } = req.body;
    if (!token || !videoIds || !Array.isArray(videoIds)) return res.status(400).json({ error: 'Missing token or video ids' });

    const tempClient = new google.auth.OAuth2();
    tempClient.setCredentials({ access_token: token });
    const youtube = google.youtube({ version: 'v3', auth: tempClient });

    // Step 1: Create Playlist
    console.log('📝 Creating YouTube playlist:', title);
    const playlistResponse = await youtube.playlists.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: title || 'TuneAI Generated Playlist',
          description: description || 'Curated by TuneAI DJ'
        },
        status: { privacyStatus: 'private' }
      }
    });

    const playlistId = playlistResponse.data.id;

    // Step 2: Insert items one by one sequentially to avoid API errors
    console.log(`🎶 Appending ${videoIds.length} videos to playlist...`);
    for (const videoId of videoIds) {
      if (!videoId) continue;
      try {
        await youtube.playlistItems.insert({
          part: 'snippet',
          requestBody: {
            snippet: {
              playlistId: playlistId,
              resourceId: {
                kind: 'youtube#video',
                videoId: videoId
              }
            }
          }
        });
      } catch (err) {
        console.error('Failed to add video', videoId, ':', err.message);
      }
    }

    console.log('✅ Playlist successfully saved to YouTube!');
    res.json({ success: true, playlistId });
  } catch (err) {
    console.error('❌ /export-playlist error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', port: PORT }));

// ── Start ─────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║      🎵  TuneAI Backend Ready            ║');
  console.log(`║      http://localhost:${PORT}               ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  if (!YOUTUBE_CLIENT_ID)        console.log('⚠️  Missing YOUTUBE_CLIENT_ID');
  if (!YOUTUBE_CLIENT_SECRET)    console.log('⚠️  Missing YOUTUBE_CLIENT_SECRET');
  if (!process.env.GROQ_API_KEY) console.log('⚠️  Missing GROQ_API_KEY');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`❌ Port ${PORT} is busy. Run: npx kill-port ${PORT}`);
    process.exit(1);
  }
});
