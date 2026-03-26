import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

const API = 'http://localhost:3001';

// Icons
const HomeIcon = () => <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>;
const HistoryIcon = () => <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>;
const LogoutIcon = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>;
const MusicIcon = () => <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>;
const PlayIcon = () => <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>;
const PauseIcon = () => <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>;

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('youtube_token') || null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    
    if (urlToken) {
      setToken(urlToken);
      localStorage.setItem('youtube_token', urlToken);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleLogin = () => window.location.href = `${API}/login`;
  
  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('youtube_token');
  };

  if (!token) {
    return (
      <div className="login-screen">
        <div className="login-brand">
          <img src="/logo.png" alt="TuneAI Logo" style={{ height: '56px', borderRadius: '8px' }} />
          <span className="brand-name" style={{ fontSize: '40px', marginLeft: '6px' }}>TuneAI</span>
        </div>
        <h1 className="login-title">Your Personal <em>AI DJ.</em></h1>
        <p className="login-tagline">
          Connect your YouTube account securely. TuneAI analyzes your actual taste 
          to suggest the perfect songs for exactly how you feel right now.
        </p>
        <button className="login-btn" onClick={handleLogin}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21.582,6.186c-0.23-0.86-0.908-1.538-1.768-1.768C18.254,4,12,4,12,4S5.746,4,4.186,4.418 c-0.86,0.23-1.538,0.908-1.768,1.768C2,7.746,2,12,2,12s0,4.254,0.418,5.814c0.23,0.86,0.908,1.538,1.768,1.768 C5.746,20,12,20,12,20s6.254,0,7.814-0.418c0.86-0.23,1.538-0.908,1.768-1.768C22,16.254,22,12,22,12S22,7.746,21.582,6.186z M10,15.464V8.536L16,12L10,15.464z"/>
          </svg>
          Connect with YouTube
        </button>
      </div>
    );
  }

  return <DJStudio token={token} onLogout={handleLogout} />;
}

// ── MAIN APPLICATION INTERFACE ──
function DJStudio({ token, onLogout }) {
  const [view, setView] = useState('home'); // 'home' | 'history'
  
  // User Data
  const [userProfile, setUserProfile] = useState(null);
  const [likedSongs, setLikedSongs] = useState([]);
  
  // DJ State
  const [vibe, setVibe] = useState('');
  const [genre, setGenre] = useState('');
  const [artist, setArtist] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentSession, setCurrentSession] = useState(null); // The generated playlist
  const [history, setHistory] = useState([]);
  
  // Export State
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState('');
  
  // Loading dynamic message
  const [loadingMsg, setLoadingMsg] = useState('Analyzing your vibe...');

  useEffect(() => {
    if (loading) {
      const messages = [
        "Analyzing your vibe...",
        "DJ is picking the best tracks...",
        "Finding perfect matches...",
        "Tuning the frequencies...",
        "Almost ready..."
      ];
      let i = 0;
      const interval = setInterval(() => {
        i = (i + 1) % messages.length;
        setLoadingMsg(messages[i]);
      }, 2500);
      return () => clearInterval(interval);
    } else {
      setLoadingMsg('Analyzing your vibe...');
    }
  }, [loading]);

  // Player State
  const [playingTrack, setPlayingTrack] = useState(null);
  const ytPlayerInstance = React.useRef(null);
  const currentSessionRef = React.useRef(currentSession);

  // Keep ref in sync for the auto-advance callback
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  // Load YouTube IFrame API
  useEffect(() => {
    if (!document.getElementById('yt-api-script')) {
      const tag = document.createElement('script');
      tag.id = 'yt-api-script';
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // Initialize or update YouTube Player
  useEffect(() => {
    if (!playingTrack?.id) return;

    const initPlayer = () => {
      // If player already exists, just load new video
      if (ytPlayerInstance.current) {
        if (typeof ytPlayerInstance.current.loadVideoById === 'function') {
          ytPlayerInstance.current.loadVideoById(playingTrack.id);
        }
      } else {
        // Create new player instance if DOM is ready
        if (window.YT && window.YT.Player && document.getElementById('youtube-player')) {
          ytPlayerInstance.current = new window.YT.Player('youtube-player', {
            height: '60',
            width: '300',
            videoId: playingTrack.id,
            playerVars: { autoplay: 1, controls: 1 },
            events: {
              onStateChange: (event) => {
                if (event.data === window.YT.PlayerState.ENDED) {
                  const sess = currentSessionRef.current;
                  if (!sess || !sess.songs) return;
                  setPlayingTrack(prevTrack => {
                    if (!prevTrack) return null;
                    const idx = sess.songs.findIndex(s => s.id === prevTrack.id);
                    if (idx >= 0 && idx < sess.songs.length - 1) {
                      return sess.songs[idx + 1];
                    }
                    return prevTrack;
                  });
                }
              }
            }
          });
        }
      }
    };

    // YouTube API uses a global callback when loaded
    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }
  }, [playingTrack]);

  const MOODS = ['Focus', 'Late Night', 'Workout', 'Chill', 'Upbeat', 'Road Trip', 'Meditation'];

  // Fetch contextual user data on load
  useEffect(() => {
    async function fetchYouTubeData() {
      try {
        const meRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', { headers: { Authorization: `Bearer ${token}` } });
        if (meRes.status === 401) return onLogout();
        const meData = await meRes.json();
        setUserProfile({ name: meData.name, avatar: meData.picture });

        const tracksRes = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=LL&maxResults=50', { headers: { Authorization: `Bearer ${token}` } });
        const tracksData = await tracksRes.json();
        if (tracksData.items) {
          const library = tracksData.items.map(item => ({
            title: item.snippet.title,
            artist: item.snippet.videoOwnerChannelTitle || 'Unknown'
          }));
          setLikedSongs(library);
        }
      } catch (err) {
        console.error('Failed to fetch data', err);
      }
    }
    fetchYouTubeData();
  }, [token, onLogout]);

  // Generate DJ Session
  const generateSession = async () => {
    if (!vibe.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: "AUTH_USER",
          token: token,
          mood: vibe,
          genre: genre,
          artists: artist,
          libraryStr: likedSongs.slice(0, 50).map(s => `- "${s.title}" by ${s.artist}`).join('\n')
        })
      });
      const data = await res.json();
      setCurrentSession(data);
      setExportSuccess('');
      // Auto-play the first track if generated successfully
      if (data?.songs?.length > 0) {
        setPlayingTrack(data.songs[0]);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to curate music.");
    } finally {
      setLoading(false);
    }
  };

  // Load History
  useEffect(() => {
    if (view === 'history') {
      fetch(`${API}/playlists?userId=AUTH_USER`)
        .then(res => res.json())
        .then(data => setHistory(Array.isArray(data) ? data : []))
        .catch(console.error);
    }
  }, [view]);

  return (
    <div className="app-layout">
      {/* ── SIDEBAR ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <img src="/logo.png" alt="TuneAI Logo" style={{ height: '38px', borderRadius: '6px' }} />
          <span className="brand-name" style={{ fontSize: '32px', marginLeft: '4px' }}>TuneAI</span>
        </div>
        
        <nav className="sidebar-nav">
          <button className={`nav-item ${view === 'home' ? 'active' : ''}`} onClick={() => setView('home')}>
            <span className="nav-icon"><HomeIcon /></span>
            AI Studio
          </button>
          <button className={`nav-item ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>
            <span className="nav-icon"><HistoryIcon /></span>
            My Sessions
          </button>
        </nav>

        <div className="sidebar-footer">
          {userProfile?.avatar ? (
            <img src={userProfile.avatar} className="user-avatar" alt="User" />
          ) : <div className="user-avatar" />}
          <div className="user-info">
            <div className="user-name">{userProfile ? userProfile.name : 'Loading...'}</div>
          </div>
          <button className="logout-btn" onClick={onLogout} title="Log Out">
            <LogoutIcon />
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="main-view">
        <div className="main-content-inner">
          
          {view === 'home' && (
            <>
              {/* DJ Input Section */}
              <section className="dj-input-section">
                <h1 className="dj-greeting">
                  {userProfile ? `What's the vibe, ${userProfile.name.split(' ')[0]}?` : "What's the vibe today?"}
                </h1>
                
                <div className="input-wrapper" style={{ flexWrap: 'wrap', flexDirection: 'column' }}>
                  <div className="ai-textarea-wrapper">
                    <textarea 
                      className="ai-textarea" 
                      placeholder="Describe your perfect musical vibe... Don't hold back, the AI DJ is listening! ✨"
                      value={vibe}
                      onChange={e => setVibe(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          generateSession();
                        }
                      }}
                    />
                    <div className="ai-textarea-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2l3 6 6 3-6 3-3 6-3-6-6-3 6-3z"/>
                        <path d="M19 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>
                      </svg>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', width: '100%' }}>
                  <select className="vibe-input" style={{ flex: 1, minWidth: '150px' }} value={genre} onChange={e => setGenre(e.target.value)}>
                    <option value="">Any Genre</option>
                    <option value="Bollywood">Bollywood</option>
                    <option value="Pop">Pop</option>
                    <option value="Hip Hop">Hip-Hop</option>
                    <option value="Rock">Rock</option>
                    <option value="R&B">R&B</option>
                    <option value="Electronic">Electronic</option>
                    <option value="Classical">Classical</option>
                    <option value="Ambient">Ambient</option>
                  </select>

                  <input 
                    type="text" 
                    className="vibe-input" 
                    placeholder="Specific Artist? (Optional)"
                    style={{ flex: 1, minWidth: '200px' }}
                    value={artist}
                    onChange={e => setArtist(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && generateSession()}
                  />

                  </div>
                  <button className="generate-btn" onClick={generateSession} disabled={loading || !vibe.trim()} style={{ width: '100%', marginTop: 8, padding: '20px 0' }}>
                    {loading ? "✨ Curating..." : "✨ Ask TuneAI"}
                  </button>
                </div>

                <div className="quick-moods">
                  {MOODS.map(m => (
                    <button 
                      key={m} 
                      className={`mood-chip ${vibe === m ? 'active' : ''}`}
                      onClick={() => setVibe(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </section>

              {/* Loading Skeleton */}
              {loading && (
                <section className="dj-results" style={{ marginTop: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <h2 className="section-title text-muted" style={{ marginBottom: 0 }}>
                      <span className="pulse-dot">●</span> {loadingMsg}
                    </h2>
                  </div>
                  <div className="track-list">
                    {[1, 2, 3, 4, 5].map((item, index) => (
                      <div key={item} className="track-row skeleton-row" style={{ animationDelay: `${index * 0.1}s` }}>
                        <div className="skeleton-img">
                          <MusicIcon />
                        </div>
                        <div className="track-info">
                          <div className="skeleton-line title-line"></div>
                          <div className="skeleton-line artist-line"></div>
                        </div>
                        <div className="skeleton-reason" style={{ justifyContent: 'center' }}>
                          <div className="skeleton-line reason-line"></div>
                        </div>
                        <div className="play-indicator" style={{ opacity: 0.1 }}>
                          <PlayIcon />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Current Session Results */}
              {!loading && currentSession && currentSession.songs && (
                <section className="dj-results">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <h2 className="section-title" style={{ marginBottom: 0 }}>
                      <span style={{color: 'var(--brand)'}}>●</span> DJ's Selections
                    </h2>
                    
                    <button 
                      className="login-btn" 
                      style={{ padding: '10px 24px', fontSize: '14px' }}
                      onClick={async () => {
                        setExporting(true);
                        setExportSuccess('');
                        try {
                          const res = await fetch(`${API}/export-playlist`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              token: token,
                              title: currentSession.title,
                              description: currentSession.description,
                              videoIds: currentSession.songs.map(s => s.id)
                            })
                          });
                          if (!res.ok) throw new Error('Failed to export');
                          setExportSuccess('Playlist successfully saved to your YouTube library! ✅');
                        } catch (e) {
                          alert(e.message);
                        } finally {
                          setExporting(false);
                        }
                      }}
                      disabled={exporting}
                    >
                      {exporting ? "Saving..." : "📥 Save to YouTube"}
                    </button>
                  </div>
                  {exportSuccess && <p style={{ color: 'var(--brand-light)', marginBottom: 16, fontWeight: 'bold' }}>{exportSuccess}</p>}
                  
                  <div className="track-list">
                    {currentSession.songs.map((track, i) => {
                      const isPlaying = playingTrack?.id === track.id;
                      return (
                        <div 
                          key={track.id || i} 
                          className={`track-row ${isPlaying ? 'playing' : ''}`}
                          onClick={() => setPlayingTrack(track)}
                        >
                          <img src={track.image} className="track-img" alt={track.title} />
                          <div className="track-info">
                            <div className="track-title">{track.title}</div>
                            <div className="track-artist">{track.artist}</div>
                          </div>
                          
                          {/* We show the AI's reason prominent on desktop */}
                          <div className="ai-reason">"{track.reason}"</div>
                          
                          <div className="play-indicator">
                            {isPlaying ? <PauseIcon /> : <PlayIcon />}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {!currentSession && !loading && (
                <div className="empty-state">
                  <MusicIcon />
                  <p style={{marginTop: 16}}>Tell the DJ what you want to hear to get started.</p>
                </div>
              )}
            </>
          )}

          {view === 'history' && (
            <>
              <h1 className="dj-greeting" style={{marginBottom: 40}}>Past Sessions</h1>
              <div className="history-grid">
                {history.map((session, i) => (
                  <div key={i} className="history-card" onClick={() => {
                    setCurrentSession(session);
                    setView('home');
                  }}>
                    <div className="history-title">{session.title}</div>
                    <div className="history-songs">{session.songs?.length || 0} tracks curated</div>
                  </div>
                ))}
              </div>
              {history.length === 0 && (
                <div className="empty-state">No past sessions found.</div>
              )}
            </>
          )}
        </div>
      </main>

      {/* ── STICKY BOTTOM PLAYER ── */}
      {playingTrack && (
        <footer className="bottom-player">
          <div className="np-left">
            <img src={playingTrack.image} className="np-img" alt="Cover Art" />
            <div className="np-info">
              <div className="np-title">{playingTrack.title}</div>
              <div className="np-artist">{playingTrack.artist}</div>
            </div>
          </div>
          
          <div className="np-center">
             {/* The magic embedded YouTube Player */}
             {playingTrack.id ? (
               <div className="player-iframe-wrapper">
                 <div id="youtube-player"></div>
               </div>
             ) : (
               <div style={{color: 'var(--text-muted)'}}>No audio source found</div>
             )}
          </div>

          <div className="np-right">
             {/* Decorative or extra controls can go here */}
             <div className="volume-control">
                <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
             </div>
          </div>
        </footer>
      )}

    </div>
  );
}
