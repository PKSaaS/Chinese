/* ============================================================
   Gist Sync — Cross-device progress via GitHub Gist
   Name-based: same name + same key = same progress
   ============================================================ */

const GistSync = (function () {
  'use strict';

  const TOKEN_KEY = 'moxue_gh_token';
  const GIST_KEY = 'moxue_gist_id';
  const NAME_KEY = 'moxue_profile_name';
  const GIST_FILENAME = 'moxue_progress.json';
  const GIST_PREFIX = 'MoXue Sync: ';
  const API = 'https://api.github.com';

  let _token = localStorage.getItem(TOKEN_KEY);
  let _gistId = localStorage.getItem(GIST_KEY);
  let _profileName = localStorage.getItem(NAME_KEY);
  let _syncTimer = null;

  function isConfigured() {
    return _token && _gistId;
  }

  function hasToken() {
    return !!_token;
  }

  function getProfileName() {
    return _profileName || '';
  }

  function setCredentials(name, token) {
    _profileName = name.trim();
    _token = token.trim();
    localStorage.setItem(NAME_KEY, _profileName);
    localStorage.setItem(TOKEN_KEY, _token);
  }

  function clearConfig() {
    _token = null;
    _gistId = null;
    _profileName = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(GIST_KEY);
    localStorage.removeItem(NAME_KEY);
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
      throw new Error('GitHub API ' + resp.status + ': ' + text);
    }
    return resp.json();
  }

  // Search user's gists for one matching the profile name
  async function findGistByName(name) {
    const targetDesc = GIST_PREFIX + name;
    let page = 1;
    while (page <= 5) {
      const gists = await apiCall(API + '/gists?per_page=30&page=' + page, { method: 'GET' });
      if (gists.length === 0) break;
      for (const g of gists) {
        if (g.description === targetDesc && g.files[GIST_FILENAME]) {
          return g.id;
        }
      }
      page++;
    }
    return null;
  }

  async function createGist(name, stateData) {
    const data = await apiCall(API + '/gists', {
      method: 'POST',
      body: JSON.stringify({
        description: GIST_PREFIX + name,
        public: false,
        files: {
          [GIST_FILENAME]: { content: JSON.stringify(stateData, null, 2) }
        }
      })
    });
    _gistId = data.id;
    localStorage.setItem(GIST_KEY, _gistId);
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

  // Merge: union of learned items, keep highest progress
  function mergeStates(local, remote) {
    if (!remote) return local;
    if (!local) return remote;

    const localLearned = Object.keys(local.itemStatus || {}).length;
    const remoteLearned = Object.keys(remote.itemStatus || {}).length;

    const base = remoteLearned > localLearned ? { ...remote } : { ...local };
    const other = remoteLearned > localLearned ? local : remote;

    base.itemStatus = { ...other.itemStatus, ...base.itemStatus };
    base.stats = { ...base.stats };
    base.stats.totalLearned = Object.keys(base.itemStatus).length;

    if ((other.currentBatchStart || 0) > (base.currentBatchStart || 0)) {
      base.currentBatchStart = other.currentBatchStart;
      base.currentBatch = other.currentBatch;
    }

    base.stats.daysStudied = Math.max(base.stats.daysStudied || 0, other.stats.daysStudied || 0);
    base.stats.batchesCompleted = Math.max(base.stats.batchesCompleted || 0, other.stats.batchesCompleted || 0);

    return base;
  }

  // Debounced push (2s after last save)
  function schedulePush(stateData) {
    if (!isConfigured()) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => updateGist(stateData), 2000);
  }

  async function validateToken() {
    try {
      await apiCall(API + '/user', { method: 'GET' });
      return true;
    } catch {
      return false;
    }
  }

  // Main setup: validate token, find or create gist by name, merge
  async function setup(name, localState) {
    if (!_token) throw new Error('No secret key provided');

    const valid = await validateToken();
    if (!valid) throw new Error('Invalid secret key');

    // Try to find existing gist for this name
    const existingId = await findGistByName(name);

    if (existingId) {
      _gistId = existingId;
      localStorage.setItem(GIST_KEY, _gistId);
      const remote = await fetchGist();
      const merged = mergeStates(localState, remote);
      await updateGist(merged);
      return merged;
    } else {
      // Create new gist
      await createGist(name, localState);
      return localState;
    }
  }

  return {
    isConfigured,
    hasToken,
    getProfileName,
    setCredentials,
    clearConfig,
    setup,
    fetchGist,
    mergeStates,
    schedulePush,
    validateToken,
    getGistId: () => _gistId
  };
})();
