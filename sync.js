/* ============================================================
   Gist Sync — Cross-device progress via GitHub Gist
   ============================================================ */

const GistSync = (function () {
  'use strict';

  const TOKEN_KEY = 'moxue_gh_token';
  const GIST_KEY = 'moxue_gist_id';
  const GIST_FILENAME = 'moxue_progress.json';
  const API = 'https://api.github.com';

  let _token = localStorage.getItem(TOKEN_KEY);
  let _gistId = getGistIdFromHash() || localStorage.getItem(GIST_KEY);
  let _syncTimer = null;
  let _onReady = null;

  function getGistIdFromHash() {
    const match = location.hash.match(/g=([a-f0-9]+)/);
    return match ? match[1] : null;
  }

  function setGistIdInHash(id) {
    const existing = location.hash.replace(/[#&]?g=[a-f0-9]+/, '');
    location.hash = (existing ? existing + '&' : '') + 'g=' + id;
  }

  function isConfigured() {
    return _token && _gistId;
  }

  function hasToken() {
    return !!_token;
  }

  function setToken(token) {
    _token = token.trim();
    localStorage.setItem(TOKEN_KEY, _token);
  }

  function clearConfig() {
    _token = null;
    _gistId = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(GIST_KEY);
    history.replaceState(null, '', location.pathname);
  }

  async function apiCall(url, options) {
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Authorization': 'token ' + _token,
        'Accept': 'application/vnd.github+json',
        ...(options.headers || {})
      }
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GitHub API ${resp.status}: ${text}`);
    }
    return resp.json();
  }

  async function createGist(stateData) {
    const data = await apiCall(API + '/gists', {
      method: 'POST',
      body: JSON.stringify({
        description: 'MoXue Chinese Learning Progress',
        public: false,
        files: {
          [GIST_FILENAME]: { content: JSON.stringify(stateData, null, 2) }
        }
      })
    });
    _gistId = data.id;
    localStorage.setItem(GIST_KEY, _gistId);
    setGistIdInHash(_gistId);
    return data;
  }

  async function fetchGist() {
    if (!isConfigured()) return null;
    try {
      const data = await apiCall(API + '/gists/' + _gistId, { method: 'GET' });
      const file = data.files[GIST_FILENAME];
      if (!file) return null;
      return JSON.parse(file.content);
    } catch (e) {
      console.warn('GistSync: fetch failed', e.message);
      return null;
    }
  }

  async function updateGist(stateData) {
    if (!isConfigured()) return;
    try {
      await apiCall(API + '/gists/' + _gistId, {
        method: 'PATCH',
        body: JSON.stringify({
          files: {
            [GIST_FILENAME]: { content: JSON.stringify(stateData, null, 2) }
          }
        })
      });
    } catch (e) {
      console.warn('GistSync: update failed', e.message);
    }
  }

  // Merge: take the state with more learned items, keeping the superset of itemStatus
  function mergeStates(local, remote) {
    if (!remote) return local;
    if (!local) return remote;

    const localLearned = Object.keys(local.itemStatus || {}).length;
    const remoteLearned = Object.keys(remote.itemStatus || {}).length;

    // Base: whichever has more progress
    const base = remoteLearned > localLearned ? { ...remote } : { ...local };
    const other = remoteLearned > localLearned ? local : remote;

    // Merge itemStatus: union of both (learned items from both devices)
    base.itemStatus = { ...other.itemStatus, ...base.itemStatus };
    base.stats.totalLearned = Object.keys(base.itemStatus).length;

    // Use the higher batchStart (further along)
    if ((other.currentBatchStart || 0) > (base.currentBatchStart || 0)) {
      base.currentBatchStart = other.currentBatchStart;
      base.currentBatch = other.currentBatch;
    }

    // Keep higher stats
    base.stats.daysStudied = Math.max(base.stats.daysStudied || 0, other.stats.daysStudied || 0);
    base.stats.batchesCompleted = Math.max(base.stats.batchesCompleted || 0, other.stats.batchesCompleted || 0);

    return base;
  }

  // Debounced push to gist (2 seconds after last save)
  function schedulePush(stateData) {
    if (!isConfigured()) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => updateGist(stateData), 2000);
  }

  // Validate token by checking the user endpoint
  async function validateToken() {
    try {
      await apiCall(API + '/user', { method: 'GET' });
      return true;
    } catch {
      return false;
    }
  }

  // Setup flow: validate token, create or fetch gist, return merged state
  async function setup(localState) {
    if (!_token) throw new Error('No token');

    const valid = await validateToken();
    if (!valid) throw new Error('Invalid token');

    if (_gistId) {
      // Existing gist — fetch and merge
      const remote = await fetchGist();
      const merged = mergeStates(localState, remote);
      await updateGist(merged);
      localStorage.setItem(GIST_KEY, _gistId);
      setGistIdInHash(_gistId);
      return merged;
    } else {
      // No gist yet — create one
      await createGist(localState);
      return localState;
    }
  }

  return {
    isConfigured,
    hasToken,
    setToken,
    clearConfig,
    setup,
    fetchGist,
    mergeStates,
    schedulePush,
    getGistId: () => _gistId,
    setGistId: (id) => { _gistId = id; localStorage.setItem(GIST_KEY, id); setGistIdInHash(id); }
  };
})();
