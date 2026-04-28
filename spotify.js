// Bump this whenever required scopes change — wipes stale tokens automatically.
const SCOPE_VERSION = '3';

// Spotify: Web Playback SDK (Premium/full songs) with automatic
// fallback to 30-second preview URLs (free accounts).
// Auth via Authorization Code + PKCE (no client secret needed).

export class SpotifyManager {
  constructor() {
    this.clientId     = null;
    this.token        = null;
    this.player       = null;
    this.deviceId     = null;
    this.sdkReady     = false;
    this.audioEl      = null;
    this.currentTrack = null;
    this.useSDK       = false; // flips to true once SDK + Premium confirmed

    this.onTrackChange = null;
    this.onReady       = null;
    this.onError       = null;
    this.onEnded       = null;
    this.onModeChange  = null; // called with 'sdk' | 'preview'

    this._tokenReady = this._resolveToken();
  }

  // ── PKCE helpers ──────────────────────────────────────────────────────────────
  _randomString(len = 64) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(bytes, b => chars[b % chars.length]).join('');
  }

  async _sha256b64url(plain) {
    const data   = new TextEncoder().encode(plain);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ── Token lifecycle ───────────────────────────────────────────────────────────
  async _resolveToken() {
    // Handle auth callback FIRST — verifier must still be in localStorage
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');
    if (code) {
      history.replaceState({}, '', window.location.pathname);
      await this._exchangeCode(code); // stores new token + scope version
      return this.token;
    }

    // Now safe to wipe stale tokens from old scope versions
    if (localStorage.getItem('pdj_scope_v') !== SCOPE_VERSION) {
      this._clearTokens();
      return null; // force re-auth
    }

    const stored = localStorage.getItem('pdj_token');
    const expiry = Number(localStorage.getItem('pdj_token_exp') || 0);
    if (stored && Date.now() < expiry) { this.token = stored; return stored; }
    const refresh = localStorage.getItem('pdj_refresh');
    if (refresh) { await this._refreshToken(refresh); return this.token; }
    return null;
  }

  _clearTokens() {
    ['pdj_token','pdj_token_exp','pdj_refresh','pdj_verifier','pdj_scope_v'].forEach(k => localStorage.removeItem(k));
    this.token = null;
  }

  async _exchangeCode(code) {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  window.location.origin + window.location.pathname,
        client_id:     localStorage.getItem('pdj_cid'),
        code_verifier: localStorage.getItem('pdj_verifier'),
      }),
    });
    const data = await res.json();
    if (data.access_token) this._storeTokens(data);
    else console.error('Token exchange failed:', data);
  }

  async _refreshToken(refreshToken) {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     localStorage.getItem('pdj_cid'),
      }),
    });
    const data = await res.json();
    if (data.access_token) this._storeTokens(data);
    else localStorage.removeItem('pdj_refresh');
  }

  _storeTokens(data) {
    this.token = data.access_token;
    localStorage.setItem('pdj_token',     data.access_token);
    localStorage.setItem('pdj_token_exp', Date.now() + (data.expires_in - 60) * 1000);
    localStorage.setItem('pdj_scope_v',   SCOPE_VERSION);
    if (data.refresh_token) localStorage.setItem('pdj_refresh', data.refresh_token);
  }

  getStoredToken() { return this.token; }

  async login(clientId) {
    this.clientId = clientId;
    localStorage.setItem('pdj_cid', clientId);
    // Clear old tokens so new scopes take effect
    ['pdj_token','pdj_token_exp','pdj_refresh','pdj_verifier'].forEach(k => localStorage.removeItem(k));

    const verifier  = this._randomString(64);
    const challenge = await this._sha256b64url(verifier);
    localStorage.setItem('pdj_verifier', verifier);

    const scopes = [
      'streaming',
      'user-read-email',
      'user-read-private',
      'user-modify-playback-state',
      'user-read-playback-state',
      'user-read-currently-playing',
    ].join(' ');

    window.location.href =
      'https://accounts.spotify.com/authorize'
      + `?client_id=${clientId}`
      + `&response_type=code`
      + `&redirect_uri=${encodeURIComponent(window.location.origin + window.location.pathname)}`
      + `&scope=${encodeURIComponent(scopes)}`
      + `&code_challenge_method=S256`
      + `&code_challenge=${challenge}`
      + `&show_dialog=true`;
  }

  async init() {
    await this._tokenReady;
    if (this.token && this.onReady) this.onReady();
    return !!this.token;
  }

  // ── Web Playback SDK ──────────────────────────────────────────────────────────
  initSDK() {
    if (!this.token) return Promise.resolve(false);

    return new Promise(resolve => {
      window.onSpotifyWebPlaybackSDKReady = () => {
        this.player = new window.Spotify.Player({
          name: 'Particle DJ',
          getOAuthToken: cb => cb(this.token),
          volume: 0.8,
        });

        this.player.addListener('ready', ({ device_id }) => {
          this.deviceId = device_id;
          this.sdkReady = true;
          this.useSDK   = true;
          if (this.onModeChange) this.onModeChange('sdk');
          resolve(true);
        });

        this.player.addListener('not_ready', () => {
          this.sdkReady = false;
          resolve(false);
        });

        this.player.addListener('player_state_changed', state => {
          if (!state) return;
          const track = state.track_window.current_track;
          if (track && track.id !== this.currentTrack?.id) {
            this.currentTrack = track;
            if (this.onTrackChange) this.onTrackChange(track);
          }
        });

        // No Premium → fall back to previews silently
        this.player.addListener('account_error', () => {
          this.sdkReady = false;
          this.useSDK   = false;
          if (this.onModeChange) this.onModeChange('preview');
          resolve(false);
        });

        this.player.addListener('authentication_error', ({ message }) => {
          console.warn('Spotify auth error:', message);
          this._clearTokens();
          if (this.onError) this.onError('auth', message);
          resolve(false);
        });

        this.player.connect();
      };

      const s  = document.createElement('script');
      s.src    = 'https://sdk.scdn.co/spotify-player.js';
      s.onerror = () => { this.useSDK = false; resolve(false); };
      document.head.appendChild(s);

      // If SDK doesn't initialise within 8 s, fall back to previews
      setTimeout(() => { if (!this.sdkReady) { this.useSDK = false; resolve(false); } }, 8000);
    });
  }

  // ── Unified play ─────────────────────────────────────────────────────────────
  async play(track) {
    if (this.useSDK && this.deviceId) {
      try {
        const res = await fetch(
          `https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uris: [track.uri] }),
          }
        );
        if (res.ok || res.status === 204) {
          this.currentTrack = track;
          if (this.onTrackChange) this.onTrackChange(track);
          return 'sdk';
        }
        // e.g. 403 Premium required — fall through to preview
      } catch (e) { /* fall through */ }
    }
    // Preview fallback
    return this.playPreview(track) ? 'preview' : false;
  }

  // ── Preview fallback ──────────────────────────────────────────────────────────
  _audio() {
    if (!this.audioEl) {
      const a = new Audio();
      a.crossOrigin = 'anonymous';
      a.volume = 0.8;
      a.addEventListener('ended', () => { if (this.onEnded) this.onEnded(); });
      this.audioEl = a;
    }
    return this.audioEl;
  }

  playPreview(track) {
    if (!track.preview_url) return false;
    const a = this._audio();
    a.src = track.preview_url;
    a.play().catch(() => {});
    this.currentTrack = track;
    if (this.onTrackChange) this.onTrackChange(track);
    return true;
  }

  // ── Playback controls ─────────────────────────────────────────────────────────
  async togglePlay() {
    if (this.useSDK && this.player) { await this.player.togglePlay(); return; }
    const a = this.audioEl;
    if (a) a.paused ? a.play() : a.pause();
  }

  async nextTrack() { if (this.useSDK && this.player) await this.player.nextTrack(); }
  async prevTrack() { if (this.useSDK && this.player) await this.player.previousTrack(); }

  async setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    if (this.useSDK && this.player) await this.player.setVolume(v);
    if (this.audioEl) this.audioEl.volume = v;
  }

  get paused() {
    if (this.useSDK && this.player) return false; // SDK manages its own state
    return this.audioEl?.paused ?? true;
  }

  // ── Spotify Web API ───────────────────────────────────────────────────────────
  async search(query) {
    if (!this.token || !query.trim()) return [];
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
        { headers: { Authorization: `Bearer ${this.token}` } }
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error(`Spotify search ${res.status}:`, body);

        if (res.status === 401) {
          this._clearTokens();
          if (this.onError) this.onError('auth', 'Token expired');
          return null;
        }
        if (res.status === 400) {
          // Bad request — show the reason but don't log the user out
          if (this.onError) this.onError('forbidden', `Search error: ${body?.error?.message ?? 'bad request'}`);
          return [];
        }
        if (res.status === 403) {
          if (this.onError) this.onError('forbidden', body?.error?.message || 'Forbidden — enable Web API in your Spotify app settings');
          return [];
        }
        return [];
      }

      const data = await res.json();
      return data.tracks?.items ?? [];
    } catch (e) {
      console.error('Search error:', e);
      return [];
    }
  }

  async getTrack(trackId) {
    if (!this.token) return null;
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/tracks/${trackId}`,
        { headers: { Authorization: `Bearer ${this.token}` } }
      );
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  async getAudioFeatures(trackId) {
    if (!this.token) return null;
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/audio-features/${trackId}`,
        { headers: { Authorization: `Bearer ${this.token}` } }
      );
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  static fmtMs(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
