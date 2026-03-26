const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'pins_db.json');

function readDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}');
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return {}; }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

async function savePinnedSong(userId, song) {
  const db = readDB();
  if (!db[userId]) db[userId] = [];
  // Avoid duplicates
  if (!db[userId].find(s => s.id === song.id)) {
    db[userId].unshift({
      id:         song.id,
      title:      song.title,
      artist:     song.artist,
      album:      song.album,
      image:      song.image,
      preview:    song.preview,
      spotifyUrl: song.spotifyUrl,
      pinnedAt:   new Date().toISOString(),
    });
  }
  writeDB(db);
  return db[userId];
}

async function removePinnedSong(userId, songId) {
  const db = readDB();
  if (db[userId]) {
    db[userId] = db[userId].filter(s => s.id !== songId);
  }
  writeDB(db);
  return db[userId] || [];
}

async function getPinnedSongs(userId) {
  const db = readDB();
  return db[userId] || [];
}

async function savePlaylist(userId, playlist) {
  const db = readDB();
  if (!db.playlists) db.playlists = {};
  if (!db.playlists[userId]) db.playlists[userId] = [];
  
  playlist.id = Math.random().toString(36).slice(2);
  playlist.createdAt = new Date().toISOString();
  
  db.playlists[userId].unshift(playlist);
  writeDB(db);
  return playlist;
}

async function getPlaylists(userId) {
  const db = readDB();
  if (!db.playlists) return [];
  return db.playlists[userId] || [];
}

module.exports = { savePinnedSong, removePinnedSong, getPinnedSongs, savePlaylist, getPlaylists };
