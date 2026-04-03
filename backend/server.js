const express = require('express');
const cors    = require('cors');
const https   = require('https');
require('dotenv').config();
const ytSearch = require('yt-search');

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
const searchCache = new Map();
const CACHE_TTL = 1000 * 60 * 15; // 15 minutes cache

async function youtubeSearch(query, token, limit = 10) {
  const cacheKey = `${query.toLowerCase().trim()}_${limit}`;
  const now = Date.now();
  
  if (searchCache.has(cacheKey)) {
    const cached = searchCache.get(cacheKey);
    if (now - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  try {
    const r = await ytSearch(query + ' official audio');
    const videos = r.videos.slice(0, limit);
    
    const result = videos.map(item => ({
      id: item.videoId,
      title: item.title,
      artist: item.author.name,
      album: 'YouTube',
      image: item.thumbnail,
      preview: null,
      youtubeUrl: item.url,
      duration: item.seconds
    }));
    
    searchCache.set(cacheKey, { data: result, timestamp: now });
    return result;
  } catch (err) {
    console.error('yt-search Error:', err.message);
    return [];
  }
}

// ── SEARCH endpoint — handles typos, lyrics, partial names ───────────────
app.get('/search', async (req, res) => {
  try {
    const { q, userId, token } = req.query;
    if (!q || q.trim().length < 2) return res.json({ tracks: [], didYouMean: null });

    console.log('🔍 Searching:', q);

    // Pull 30 results for a deep cache pool
    let allTracks = await youtubeSearch(q, token, 30);
    let tracks = [];

    if (allTracks.length > 2) {
      // Keep the top 2 most relevant videos at the top (so if you search a specific song, you get the official track)
      const topTracks = allTracks.slice(0, 2);
      const restTracks = allTracks.slice(2);
      
      // Shuffle the remaining 28 tracks
      for (let i = restTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [restTracks[i], restTracks[j]] = [restTracks[j], restTracks[i]];
      }
      
      // Combine and pick 10
      tracks = [...topTracks, ...restTracks].slice(0, 10);
    } else {
      tracks = allTracks;
    }

    let didYouMean = null;
    if (tracks.length < 2) {
      console.log('🤖 Few results, asking Groq AI to fix/identify...');
      const fixed = await fixSpellingAndSearch(q);
      if (fixed && fixed !== q) {
        didYouMean = fixed;
        // Same logic for fixed query
        const fixedTracksAll = await youtubeSearch(fixed, token, 30);
        if (fixedTracksAll.length > 2) {
          const topTracks = fixedTracksAll.slice(0, 2);
          const restTracks = fixedTracksAll.slice(2);
          for (let i = restTracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [restTracks[i], restTracks[j]] = [restTracks[j], restTracks[i]];
          }
          tracks = [...topTracks, ...restTracks].slice(0, 10);
        } else {
          tracks = fixedTracksAll;
        }
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

    const results = await Promise.all(queries.slice(0, 5).map(q => youtubeSearch(q, token, 15)));
    let allTracks = [...new Map(
      results.flat()
        .filter(t => !pinnedSongs.find(p => p.id === t.id))
        .map(t => [t.id, t])
    ).values()];

    // Randomize (shuffle) the results before returning them
    for (let i = allTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
    }

    res.json({ tracks: allTracks.slice(0, 20), basedOn: pinnedSongs.length >= 2 ? 'pinned' : 'trending' });
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

    // Execute searches concurrently using Promise.all for speed
    const searchPromises = suggestedSongs.map(async (sg) => {
      const q = `${sg.title} ${sg.artist}`;
      const searchRes = await youtubeSearch(q, token, 1);
      if (searchRes && searchRes.length > 0) {
        return {
          ...searchRes[0],
          reason: sg.reason // Attach the AI's reason
        };
      }
      return null;
    });

    const results = await Promise.all(searchPromises);
    const tracks = results.filter(t => t !== null);

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
