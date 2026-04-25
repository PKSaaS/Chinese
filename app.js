/* ============================================================
   墨学 — Mò Xué — Chinese Flashcard Learning App
   With: tone colors, two-step reveal, progressive difficulty
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'moxue_learning_state';
  const BATCH_SIZE = 10;

  // ---- Difficulty thresholds (by items learned) ----
  // Level 1: Pinyin hint on front + two-step back reveal
  // Level 2: No hint on front + two-step back reveal
  // Level 3: No hint on front + single reveal (pinyin + english together)
  const LEVEL_THRESHOLDS = [0, 200, 450]; // items learned to reach level 1, 2, 3

  // ---- Tone detection ----
  const TONE_1_VOWELS = 'āēīōūǖĀĒĪŌŪǕ';
  const TONE_2_VOWELS = 'áéíóúǘÁÉÍÓÚǗ';
  const TONE_3_VOWELS = 'ǎěǐǒǔǚǍĚǏǑǓǙ';
  const TONE_4_VOWELS = 'àèìòùǜÀÈÌÒÙǛ';

  function detectTone(syllable) {
    for (const ch of syllable) {
      if (TONE_1_VOWELS.includes(ch)) return 1;
      if (TONE_2_VOWELS.includes(ch)) return 2;
      if (TONE_3_VOWELS.includes(ch)) return 3;
      if (TONE_4_VOWELS.includes(ch)) return 4;
    }
    return 5; // neutral
  }

  function colorPinyin(pinyinStr, useLightColors) {
    const suffix = useLightColors ? '-light' : '';
    return pinyinStr.split(/(\s+|[,，.。!！?？;；:：])/).map(part => {
      if (/^\s+$/.test(part) || /^[,，.。!！?？;；:：]$/.test(part)) return part;
      const tone = detectTone(part);
      return `<span class="py-t${tone}${suffix}">${part}</span>`;
    }).join('');
  }

  // ---- Ruby annotation: pinyin above each character ----
  const PUNCT = new Set("，。？！、；：\u201C\u201D\u2018\u2019（）…—·,.?!;:()'\"");

  function rubyAnnotate(chinese, pinyin, useLightColors) {
    const suffix = useLightColors ? '-light' : '';
    const syllables = pinyin.split(/\s+/).filter(Boolean);
    let sIdx = 0;
    let html = '';

    for (const ch of chinese) {
      if (PUNCT.has(ch) || /\s/.test(ch)) {
        html += ch;
      } else if (sIdx < syllables.length) {
        const syl = syllables[sIdx];
        const tone = detectTone(syl);
        html += `<ruby>${ch}<rt class="py-t${tone}${suffix}">${syl}</rt></ruby>`;
        sIdx++;
      } else {
        html += ch;
      }
    }
    return html;
  }

  // ---- Build flat item list ----
  const globalItemList = VOCABULARY_DATA.flatMap(section =>
    section.items.map(item => ({
      ...item,
      sectionId: section.sectionId,
      sectionNumber: section.sectionNumber,
      sectionTitle: section.sectionTitle
    }))
  );

  const TOTAL_ITEMS = globalItemList.length;

  // ---- State ----
  let state = loadState();

  function defaultState() {
    return {
      version: 2,
      currentBatchStart: 0,
      itemStatus: {},
      currentBatch: null,
      stats: { totalLearned: 0, daysStudied: 0, lastStudyDate: null, batchesCompleted: 0 }
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed.version) return defaultState();
      return parsed;
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    GistSync.schedulePush(state);
  }

  function currentLevel() {
    const learned = Object.keys(state.itemStatus).length;
    if (learned >= LEVEL_THRESHOLDS[2]) return 3;
    if (learned >= LEVEL_THRESHOLDS[1]) return 2;
    return 1;
  }

  // ---- Batch & Queue ----
  let queue = [];
  let currentCardId = null;
  let isTransitioning = false;

  // Card states: FRONT → REVEALED (single flip)
  let cardState = 'FRONT';

  function initBatch() {
    if (state.currentBatchStart >= TOTAL_ITEMS) {
      showAllComplete();
      return;
    }

    if (state.currentBatch && state.currentBatch.gotIt.length < batchItemCount()) {
      queue = state.currentBatch.items.filter(id => !state.currentBatch.gotIt.includes(id));
    } else {
      const end = Math.min(state.currentBatchStart + BATCH_SIZE, TOTAL_ITEMS);
      const batchItems = globalItemList.slice(state.currentBatchStart, end).map(i => i.id);
      state.currentBatch = { items: batchItems, gotIt: [] };
      queue = [...batchItems];
      saveState();
    }

    updateDayStats();
    showStudyView();
    showNextCard();
  }

  function batchItemCount() {
    return state.currentBatch ? state.currentBatch.items.length : BATCH_SIZE;
  }

  function updateDayStats() {
    const today = new Date().toISOString().slice(0, 10);
    if (state.stats.lastStudyDate !== today) {
      state.stats.daysStudied++;
      state.stats.lastStudyDate = today;
      saveState();
    }
  }

  function showNextCard() {
    if (queue.length === 0) {
      if (state.currentBatch.gotIt.length >= batchItemCount()) {
        completeBatch();
        return;
      }
      queue = state.currentBatch.items.filter(id => !state.currentBatch.gotIt.includes(id));
    }

    currentCardId = queue[0];
    cardState = 'FRONT';

    const item = getItem(currentCardId);
    renderCard(item);
    renderDots();
    renderBatchHeader(item);
    setButtonsEnabled(false);
  }

  function getItem(id) {
    return globalItemList.find(i => i.id === id);
  }

  function flipCard() {
    if (cardState !== 'FRONT' || isTransitioning) return;
    document.getElementById('cardInner').classList.add('flipped');
    cardState = 'REVEALED';
    setButtonsEnabled(true);
  }

  function onAdvance() {
    if (cardState === 'FRONT') flipCard();
    else if (cardState === 'REVEALED') onGotIt();
  }

  function onGotIt() {
    if (cardState !== 'REVEALED' || isTransitioning) return;

    if (!state.currentBatch.gotIt.includes(currentCardId)) {
      state.currentBatch.gotIt.push(currentCardId);
      state.itemStatus[currentCardId] = {
        learned: true,
        learnedDate: new Date().toISOString().slice(0, 10)
      };
      state.stats.totalLearned = Object.keys(state.itemStatus).length;
    }

    queue.shift();
    saveState();
    transitionToNext();
  }

  function onMissed() {
    if (cardState !== 'REVEALED' || isTransitioning) return;
    queue.shift();
    queue.push(currentCardId);
    saveState();
    transitionToNext();
  }

  function transitionToNext() {
    isTransitioning = true;
    const container = document.getElementById('cardContainer');
    container.classList.add('card-exit-left');

    setTimeout(() => {
      container.classList.remove('card-exit-left');
      container.classList.add('card-enter-right');
      showNextCard();

      setTimeout(() => {
        container.classList.remove('card-enter-right');
        isTransitioning = false;
      }, 400);
    }, 350);
  }

  function completeBatch() {
    cardState = 'FRONT';
    state.stats.batchesCompleted++;
    state.currentBatchStart += batchItemCount();
    state.currentBatch = null;
    saveState();
    showCompleteView();
    launchConfetti();
    renderSidebar();
    updateProgressBar();
    updateLevelIndicator();
  }

  // ---- DOM Helpers ----
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = document.getElementById(id);
    return els[id];
  }

  // ---- Rendering ----

  function renderCard(item) {
    const inner = document.getElementById('cardInner');
    inner.classList.remove('flipped');

    // Front
    const chinese = el('cardChinese');
    const level = currentLevel();

    // Ruby annotations above characters (progressive: visible → faded → hidden)
    chinese.innerHTML = rubyAnnotate(item.chinese, item.pinyin, true);
    chinese.className = 'card-chinese';
    chinese.classList.add('ruby-level-' + level);
    if (item.type === 'sentence') {
      chinese.classList.add(item.chinese.length > 10 ? 'long-text' : 'sentence-text');
    }

    const badgeText = item.type === 'sentence' ? 'Sentence' : 'Word';
    const badgeClass = item.type === 'sentence' ? 'sentence-badge' : '';
    el('cardTypeBadge').textContent = badgeText;
    el('cardTypeBadge').className = 'card-type-badge ' + badgeClass;
    el('cardTypeBadgeBack').textContent = badgeText;
    el('cardTypeBadgeBack').className = 'card-type-badge back-badge ' + badgeClass;

    el('cardHint').textContent = 'tap to flip';

    // Back
    el('cardChineseRef').textContent = item.chinese;
    el('cardPinyin').innerHTML = colorPinyin(item.pinyin, false);
    el('cardEnglish').textContent = item.english;
  }

  function renderDots() {
    const container = el('batchDots');
    const items = state.currentBatch.items;
    const gotIt = state.currentBatch.gotIt;

    container.innerHTML = items.map(id => {
      let cls = 'dot';
      if (gotIt.includes(id)) cls += ' done';
      else if (id === currentCardId) cls += ' current';
      return `<div class="${cls}"></div>`;
    }).join('');
  }

  function renderBatchHeader(item) {
    const section = VOCABULARY_DATA.find(s => s.sectionId === item.sectionId);
    el('batchSectionLabel').textContent = `${section.sectionNumber}. ${section.sectionTitle}`;

    const done = state.currentBatch.gotIt.length;
    const total = batchItemCount();
    el('batchCounter').textContent = `${done} of ${total} learned`;

    // Level badge
    const level = currentLevel();
    const levelNames = ['', 'Beginner', 'Intermediate', 'Advanced'];
    const badge = el('batchLevelBadge');
    badge.textContent = `Level ${level} · ${levelNames[level]}`;
    badge.className = `batch-level-badge level-${level}`;
  }

  function setButtonsEnabled(enabled) {
    el('missedBtn').disabled = !enabled;
    el('gotitBtn').disabled = !enabled;
  }

  function showStudyView() {
    el('studyView').classList.remove('hidden');
    el('completeView').classList.add('hidden');
    el('allDoneView').classList.add('hidden');
  }

  function showCompleteView() {
    el('studyView').classList.add('hidden');
    el('completeView').classList.remove('hidden');
    el('allDoneView').classList.add('hidden');

    const batchStart = state.currentBatchStart - BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, TOTAL_ITEMS);
    const batchItems = globalItemList.slice(batchStart, batchEnd);

    el('completeStats').textContent = `You learned ${batchItems.length} new items!`;

    el('completeItems').innerHTML = batchItems.map((item, i) =>
      `<span class="complete-item-chip" style="animation-delay: ${i * 0.06}s">${item.chinese}</span>`
    ).join('');

    if (state.currentBatchStart >= TOTAL_ITEMS) {
      el('nextBatchBtn').textContent = 'All Done!';
      el('nextBatchBtn').onclick = showAllComplete;
    } else {
      el('nextBatchBtn').textContent = 'Continue to Next 10 →';
      el('nextBatchBtn').onclick = () => initBatch();
    }
  }

  function showAllComplete() {
    cardState = 'FRONT';
    el('studyView').classList.add('hidden');
    el('completeView').classList.add('hidden');
    el('allDoneView').classList.remove('hidden');
  }

  // ---- Sidebar ----

  function renderSidebar() {
    const nav = el('sidebarNav');
    nav.querySelectorAll('.section-item').forEach(e => e.remove());

    let activeSectionId = null;
    if (state.currentBatch && state.currentBatch.items.length > 0) {
      const firstItem = getItem(state.currentBatch.items[0]);
      if (firstItem) activeSectionId = firstItem.sectionId;
    } else if (state.currentBatchStart < TOTAL_ITEMS) {
      activeSectionId = globalItemList[state.currentBatchStart].sectionId;
    }

    VOCABULARY_DATA.forEach(section => {
      const total = section.items.length;
      const learned = section.items.filter(i => state.itemStatus[i.id]?.learned).length;
      const pct = total > 0 ? Math.round((learned / total) * 100) : 0;
      const isActive = section.sectionId === activeSectionId;
      const isComplete = learned === total && total > 0;

      const div = document.createElement('div');
      div.className = 'section-item' + (isActive ? ' active' : '');

      div.innerHTML = `
        <div class="section-header">
          <span class="section-toggle">›</span>
          <span class="section-name">${section.sectionNumber}. ${section.sectionTitle}</span>
          <span class="section-count">${learned}/${total}</span>
          <div class="section-mini-bar">
            <div class="section-mini-fill${isComplete ? ' complete' : ''}" style="width: ${pct}%"></div>
          </div>
        </div>
        <div class="section-items">
          ${learned > 0
            ? section.items
                .filter(i => state.itemStatus[i.id]?.learned)
                .map(i => `<div class="learned-item"><span class="li-chinese">${i.chinese}</span><span class="li-english">${i.english}</span></div>`)
                .join('')
            : '<div class="section-empty">No items learned yet</div>'
          }
        </div>
      `;

      div.querySelector('.section-header').addEventListener('click', () => {
        div.classList.toggle('expanded');
      });

      nav.appendChild(div);
    });

    const activeEl = nav.querySelector('.section-item.active');
    if (activeEl) activeEl.classList.add('expanded');
  }

  function updateProgressBar() {
    const learned = Object.keys(state.itemStatus).length;
    const pct = Math.round((learned / TOTAL_ITEMS) * 100);
    el('progressFill').style.width = pct + '%';
    el('progressCount').textContent = `${learned} / ${TOTAL_ITEMS}`;
    el('statDays').textContent = state.stats.daysStudied;
    el('statBatches').textContent = state.stats.batchesCompleted;
    el('statLevel').textContent = currentLevel();
  }

  function updateLevelIndicator() {
    const level = currentLevel();
    document.querySelectorAll('.level-item').forEach(item => {
      const itemLevel = parseInt(item.dataset.level);
      item.classList.remove('active', 'completed');
      if (itemLevel === level) item.classList.add('active');
      else if (itemLevel < level) item.classList.add('completed');
    });
  }

  // ---- Tone Reference Panel ----

  function initTonePanel() {
    const toggle = document.getElementById('toneRefToggle');
    const panel = document.getElementById('toneRefPanel');

    toggle.addEventListener('click', () => {
      toggle.classList.toggle('expanded');
      panel.classList.toggle('expanded');
    });
  }

  // ---- Confetti ----

  function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#c73e1d', '#e04a2a', '#c9a94e', '#e8c84a', '#3a8a5c', '#4a7a9a', '#7b5ea7'];
    const particles = [];

    for (let i = 0; i < 80; i++) {
      particles.push({
        x: canvas.width * 0.5 + (Math.random() - 0.5) * 200,
        y: canvas.height * 0.4,
        vx: (Math.random() - 0.5) * 12,
        vy: -Math.random() * 14 - 4,
        w: Math.random() * 8 + 4,
        h: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.3,
        gravity: 0.25 + Math.random() * 0.1,
        opacity: 1
      });
    }

    let frame = 0;
    const maxFrames = 120;

    function animate() {
      if (frame > maxFrames) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.vy += p.gravity;
        p.y += p.vy;
        p.vx *= 0.99;
        p.rotation += p.rotationSpeed;
        p.opacity = Math.max(0, 1 - frame / maxFrames);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      frame++;
      requestAnimationFrame(animate);
    }
    animate();
  }

  // ---- Sync Setup Modal ----

  function showSyncModal() {
    const modal = document.getElementById('syncModal');
    const statusEl = document.getElementById('syncStatus');
    const nameInput = document.getElementById('syncNameInput');
    const tokenInput = document.getElementById('syncTokenInput');
    modal.classList.remove('hidden');

    // Pre-fill saved credentials
    nameInput.value = GistSync.getProfileName();
    if (GistSync.hasToken()) tokenInput.value = '••••••••••';

    if (GistSync.isConfigured()) {
      statusEl.innerHTML = '<span class="sync-ok">Synced as "' + GistSync.getProfileName() + '"</span>';
    } else {
      statusEl.textContent = '';
    }
  }

  function hideSyncModal() {
    document.getElementById('syncModal').classList.add('hidden');
  }

  function updateSyncBadge() {
    const badge = document.getElementById('syncBadge');
    if (GistSync.isConfigured()) {
      badge.textContent = GistSync.getProfileName() || 'synced';
      badge.className = 'sync-badge sync-on';
    } else {
      badge.textContent = 'local only';
      badge.className = 'sync-badge sync-off';
    }
  }

  async function handleSyncSetup() {
    const nameInput = document.getElementById('syncNameInput');
    const tokenInput = document.getElementById('syncTokenInput');
    const statusEl = document.getElementById('syncStatus');
    const name = nameInput.value.trim();
    const token = tokenInput.value.trim();

    if (!name) {
      statusEl.innerHTML = '<span class="sync-err">Please enter your name</span>';
      return;
    }
    if (!token || token === '••••••••••') {
      if (!GistSync.hasToken()) {
        statusEl.innerHTML = '<span class="sync-err">Please enter your secret key</span>';
        return;
      }
    } else {
      GistSync.setCredentials(name, token);
    }

    statusEl.innerHTML = '<span class="sync-pending">Connecting...</span>';

    try {
      const merged = await GistSync.setup(name, state);
      state = merged;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

      statusEl.innerHTML = '<span class="sync-ok">Connected! Welcome, ' + name + '.</span>';
      updateSyncBadge();

      renderSidebar();
      updateProgressBar();
      updateLevelIndicator();

      setTimeout(hideSyncModal, 1500);
    } catch (e) {
      statusEl.innerHTML = '<span class="sync-err">Error: ' + e.message + '</span>';
    }
  }

  async function trySyncOnLoad() {
    if (!GistSync.isConfigured()) return;

    try {
      const remote = await GistSync.fetchGist();
      if (remote) {
        const merged = GistSync.mergeStates(state, remote);
        state = merged;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderSidebar();
        updateProgressBar();
        updateLevelIndicator();
        // Re-init batch with merged state
        initBatch();
      }
    } catch (e) {
      console.warn('Sync on load failed:', e.message);
    }
    updateSyncBadge();
  }

  // ---- Event Listeners ----

  function init() {
    // Card click: flip
    document.getElementById('cardContainer').addEventListener('click', () => {
      if (cardState === 'FRONT') flipCard();
    });

    // Buttons
    el('gotitBtn').addEventListener('click', onGotIt);
    el('missedBtn').addEventListener('click', onMissed);

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onAdvance();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (cardState === 'REVEALED') onGotIt();
        else onAdvance();
      } else if (e.code === 'ArrowLeft' || e.code === 'Backspace') {
        e.preventDefault();
        if (cardState === 'REVEALED') onMissed();
      }
    });

    // Mobile sidebar
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    menuToggle.addEventListener('click', () => {
      const isOpen = sidebar.classList.toggle('open');
      menuToggle.classList.toggle('open');
      overlay.classList.toggle('visible', isOpen);
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      menuToggle.classList.remove('open');
      overlay.classList.remove('visible');
    });

    // Reset
    el('resetBtn').addEventListener('click', () => {
      if (confirm('This will erase all your progress. Are you sure?')) {
        localStorage.removeItem(STORAGE_KEY);
        state = defaultState();
        saveState();
        renderSidebar();
        updateProgressBar();
        updateLevelIndicator();
        initBatch();
      }
    });

    // Sync modal
    document.getElementById('syncBtn').addEventListener('click', showSyncModal);
    document.getElementById('syncClose').addEventListener('click', hideSyncModal);
    document.getElementById('syncCloseX').addEventListener('click', hideSyncModal);
    document.getElementById('syncConnect').addEventListener('click', handleSyncSetup);
    document.getElementById('syncDisconnect').addEventListener('click', () => {
      GistSync.clearConfig();
      updateSyncBadge();
      document.getElementById('syncStatus').innerHTML = '<span class="sync-pending">Disconnected. Progress is local only.</span>';
      document.getElementById('syncTokenInput').value = '';
    });

    // Tone reference panel
    initTonePanel();

    // Initial render
    renderSidebar();
    updateProgressBar();
    updateLevelIndicator();
    updateSyncBadge();
    initBatch();

    // Background sync
    trySyncOnLoad();
  }

  // ---- Boot ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
