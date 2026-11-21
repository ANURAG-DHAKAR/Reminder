/**
 * ============================================================================
 * AquaForce – Strict Water Drinking Reminder System
 * Production-ready Vanilla JavaScript implementation
 * ============================================================================
 * Features:
 * - High-precision timestamp countdown (immune to tab throttling and drift)
 * - Page Visibility API synchronization
 * - Full-screen attention-grabbing reminder overlay with animated glass
 * - Web Audio API synthesized water acoustics & chimes (100% offline, zero external files)
 * - Web Notification API desktop alerts
 * - LocalStorage persistence (timer state, daily progress, activity timeline, streak)
 * - Automatic daily reset at calendar midnight
 * - Strict tracking: DONE vs. CROSS (skips recorded, never traps user)
 * ============================================================================
 */

(function () {
  'use strict';

  // --- Configuration Constants ---
  const CONFIG = {
    DEFAULT_INTERVAL_MINUTES: 10,
    VOLUME_PER_GLASS_ML: 250,
    DAILY_GOAL_GLASSES: 8,
    DAILY_GOAL_VOLUME_ML: 2000,
    CIRCUMFERENCE: 2 * Math.PI * 120, // r = 120, approx 753.98
    STORAGE_KEYS: {
      DATA: 'aquaforce_daily_data',
      SETTINGS: 'aquaforce_settings',
      TIMER: 'aquaforce_timer_state'
    },
    HEALTH_TIPS: [
      "💧 Drinking water refreshes your brain, clears mental fatigue, and boosts focus.",
      "🧠 Mild dehydration of just 1-2% can impair concentration and working memory.",
      "⚡ Drinking a glass of water kickstarts metabolism and revitalizes energy levels.",
      "✨ Optimal hydration lubricates joints, aids digestion, and keeps skin healthy.",
      "🎯 Take 3 slow, deep breaths while drinking this glass to relax your nervous system.",
      "🌊 Proper fluid balance prevents headaches, eye strain, and afternoon brain fog."
    ]
  };

  // --- Helper: Format Dates & Times ---
  function getTodayDateString() {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatTimeHHMMSS(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [
      String(hours).padStart(2, '0'),
      String(minutes).padStart(2, '0'),
      String(seconds).padStart(2, '0')
    ].join(':');
  }

  function formatTimeMMSS(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function getCurrentTimeString() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  // ==========================================================================
  // 1. AUDIO SYNTHESIZER & VOICE PLAYER (Web Audio API & HTML5 Audio)
  // Plays custom uploaded voice reminder ("It's time to drink water!")
  // and generates realistic water plops & chimes
  // ==========================================================================
  const SoundSystem = (function () {
    let audioCtx = null;
    let reminderAudioEl = null;

    function getAudioContext() {
      if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          audioCtx = new AudioContextClass();
        }
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return audioCtx;
    }

    function getReminderAudio() {
      if (!reminderAudioEl) {
        reminderAudioEl = document.getElementById('reminderAudio');
        if (!reminderAudioEl) {
          reminderAudioEl = new Audio('reminder.mp3');
        }
      }
      return reminderAudioEl;
    }

    // Play user's custom voice reminder: "It's time to drink water!"
    // Repeats like an alarm if repeatAsAlarm is true
    function playReminderVoice(repeatAsAlarm = false) {
      try {
        const audio = getReminderAudio();
        if (audio) {
          audio.currentTime = 0;
          audio.loop = repeatAsAlarm;
          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise.catch(err => {
              console.warn('Audio play restricted or unavailable, falling back to synth chime:', err);
              playAlertChime();
            });
          }
        } else {
          playAlertChime();
        }

        // Vibrate mobile device like an alarm if supported
        if ('vibrate' in navigator) {
          navigator.vibrate([1000, 300, 1000, 300, 1000]);
        }
      } catch (e) {
        console.warn('Audio play error, falling back to synth chime:', e);
        playAlertChime();
      }
    }

    // Stop voice playback and vibration when reminder dismissed or completed
    function stopReminderVoice() {
      try {
        const audio = getReminderAudio();
        if (audio) {
          audio.loop = false;
          if (!audio.paused) {
            audio.pause();
            audio.currentTime = 0;
          }
        }
        if ('vibrate' in navigator) {
          navigator.vibrate(0);
        }
      } catch (e) {
        // ignore
      }
    }

    // Realistic water drop "bloop / plop"
    function playWaterDrop() {
      try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        // Frequency sweep downwards to mimic droplet surface impact
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(320, now + 0.14);

        gain.gain.setValueAtTime(0.01, now);
        gain.gain.linearRampToValueAtTime(0.28, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.18);
      } catch (e) {
        console.warn('Audio synthesis error:', e);
      }
    }

    // Pleasant high-priority alert chime for reminder popup (chord arpeggio)
    function playAlertChime() {
      try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 arpeggio

        notes.forEach((freq, idx) => {
          const noteTime = now + (idx * 0.11);
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, noteTime);

          gain.gain.setValueAtTime(0.001, noteTime);
          gain.gain.linearRampToValueAtTime(0.22, noteTime + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.65);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(noteTime);
          osc.stop(noteTime + 0.7);
        });
      } catch (e) {
        console.warn('Audio synthesis error:', e);
      }
    }

    // Triumphant double chime for completed drink
    function playSuccessChime() {
      try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const notes = [587.33, 880.00]; // D5, A5

        notes.forEach((freq, idx) => {
          const noteTime = now + (idx * 0.12);
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, noteTime);

          gain.gain.setValueAtTime(0.001, noteTime);
          gain.gain.linearRampToValueAtTime(0.25, noteTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.5);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(noteTime);
          osc.stop(noteTime + 0.55);
        });
      } catch (e) {
        console.warn('Audio synthesis error:', e);
      }
    }

    return {
      playWaterDrop,
      playAlertChime,
      playSuccessChime,
      playReminderVoice,
      stopReminderVoice,
      warmUp: getAudioContext
    };
  })();

  // ==========================================================================
  // 2. DATA STORAGE & PERSISTENCE
  // Handles daily stats, streak computation, and automatic midnight date reset
  // ==========================================================================
  const StorageManager = (function () {
    function getStoredSettings() {
      const defaults = {
        intervalMinutes: CONFIG.DEFAULT_INTERVAL_MINUTES,
        soundEnabled: true,
        notificationsEnabled: false,
        dailyGoalGlasses: CONFIG.DAILY_GOAL_GLASSES
      };
      try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS);
        return raw ? Object.assign(defaults, JSON.parse(raw)) : defaults;
      } catch (e) {
        return defaults;
      }
    }

    function saveSettings(settings) {
      try {
        localStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      } catch (e) {
        console.error('Failed to save settings to localStorage', e);
      }
    }

    function getStoredData() {
      const todayStr = getTodayDateString();
      const defaultData = {
        date: todayStr,
        completedSessions: 0,
        skippedSessions: 0,
        manualDrinks: 0,
        totalVolumeMl: 0,
        activeSecondsToday: 0,
        streakDays: 1,
        lastCompletedDate: null,
        timeline: []
      };

      try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.DATA);
        if (!raw) {
          saveData(defaultData);
          return defaultData;
        }

        const data = JSON.parse(raw);

        // Auto-reset when calendar date changes
        if (data.date !== todayStr) {
          // Check streak continuity
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

          let updatedStreak = data.streakDays || 1;
          if (data.date === yStr && data.completedSessions >= 4) {
            // Keep or increment streak if active yesterday
            updatedStreak += 1;
          } else if (data.date !== yStr) {
            // Missed more than a day
            updatedStreak = 1;
          }

          const freshDayData = {
            date: todayStr,
            completedSessions: 0,
            skippedSessions: 0,
            manualDrinks: 0,
            totalVolumeMl: 0,
            activeSecondsToday: 0,
            streakDays: updatedStreak,
            lastCompletedDate: data.lastCompletedDate || null,
            timeline: []
          };
          saveData(freshDayData);
          return freshDayData;
        }

        return Object.assign(defaultData, data);
      } catch (e) {
        return defaultData;
      }
    }

    function saveData(data) {
      try {
        localStorage.setItem(CONFIG.STORAGE_KEYS.DATA, JSON.stringify(data));
      } catch (e) {
        console.error('Failed to save data to localStorage', e);
      }
    }

    function getStoredTimer() {
      const defaults = {
        status: 'stopped', // 'stopped' | 'running' | 'paused'
        durationSeconds: CONFIG.DEFAULT_INTERVAL_MINUTES * 60,
        remainingSeconds: CONFIG.DEFAULT_INTERVAL_MINUTES * 60,
        targetTimestamp: null,
        lastActiveTick: Date.now()
      };
      try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.TIMER);
        return raw ? Object.assign(defaults, JSON.parse(raw)) : defaults;
      } catch (e) {
        return defaults;
      }
    }

    function saveTimer(timer) {
      try {
        localStorage.setItem(CONFIG.STORAGE_KEYS.TIMER, JSON.stringify(timer));
      } catch (e) {
        console.error('Failed to save timer to localStorage', e);
      }
    }

    return {
      getStoredSettings,
      saveSettings,
      getStoredData,
      saveData,
      getStoredTimer,
      saveTimer
    };
  })();

  // ==========================================================================
  // 3. TOAST NOTIFICATION COMPONENT
  // Non-intrusive animated notifications
  // ==========================================================================
  const Toast = (function () {
    const container = document.getElementById('toastContainer');

    function show(message, type = 'info', durationMs = 4000) {
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;

      let iconSvg = '';
      if (type === 'success') {
        iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      } else if (type === 'warning') {
        iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      } else {
        iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
      }

      toast.innerHTML = `
        ${iconSvg}
        <span class="toast-message">${message}</span>
      `;

      container.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('toast-hide');
        setTimeout(() => {
          if (toast.parentNode === container) {
            container.removeChild(toast);
          }
        }, 300);
      }, durationMs);
    }

    return { show };
  })();

  // ==========================================================================
  // 3.5 SCREEN WAKE LOCK MANAGER (Prevents phone screen from sleeping)
  // Ideal for desk/mobile use so reminders ring and stay continuous
  // ==========================================================================
  const WakeLockManager = (function () {
    let sentinel = null;
    let userEnabled = false;

    async function request() {
      if ('wakeLock' in navigator) {
        try {
          sentinel = await navigator.wakeLock.request('screen');
          updateUI(true);
          sentinel.addEventListener('release', () => {
            sentinel = null;
            updateUI(false);
          });
        } catch (e) {
          console.warn('Wake Lock request error:', e);
          updateUI(false);
        }
      } else {
        Toast.show('Screen Wake Lock is not supported on this browser.', 'warning');
      }
    }

    async function release() {
      if (sentinel !== null) {
        try {
          await sentinel.release();
          sentinel = null;
        } catch (e) {
          // ignore
        }
      }
      updateUI(false);
    }

    async function toggle() {
      userEnabled = !userEnabled;
      if (userEnabled) {
        await request();
        Toast.show('Screen Awake ON: Phone will not sleep while on your desk.', 'info');
      } else {
        await release();
        Toast.show('Screen Awake OFF: Normal screen sleep restored.', 'info');
      }
    }

    function updateUI(isActive) {
      if (DOM.wakeLockBtn && DOM.wakeLockStatusLabel) {
        if (isActive) {
          DOM.wakeLockBtn.classList.add('active');
          DOM.wakeLockStatusLabel.textContent = 'Awake ON';
        } else {
          DOM.wakeLockBtn.classList.remove('active');
          DOM.wakeLockStatusLabel.textContent = 'Awake OFF';
        }
      }
    }

    function isUserEnabled() {
      return userEnabled;
    }

    return { toggle, request, release, isUserEnabled };
  })();

  // ==========================================================================
  // 3.8 LOCK SCREEN ALARM & MEDIA SESSION MANAGER
  // Uses active background audio keep-alive (silence.wav) + navigator.mediaSession
  // to ensure mobile OS never freezes the timer and rings the alarm when locked
  // ==========================================================================
  const LockAlarmManager = (function () {
    let keepAliveAudioEl = null;
    let enabled = true;

    function getKeepAliveAudio() {
      if (!keepAliveAudioEl) {
        keepAliveAudioEl = document.getElementById('keepAliveAudio');
        if (!keepAliveAudioEl) {
          keepAliveAudioEl = new Audio('silence.wav');
          keepAliveAudioEl.loop = true;
        }
      }
      return keepAliveAudioEl;
    }

    function setupMediaSession(targetTimeStr) {
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: 'AquaForce Hydration Reminder',
            artist: `Next drink at ${targetTimeStr || '10m'} (Lock Alarm Active)`,
            album: 'AquaForce Strict Hydration'
          });

          navigator.mediaSession.setActionHandler('play', () => {
            if (timerState.status === 'paused') {
              startCountdown(timerState.remainingSeconds);
            }
          });

          navigator.mediaSession.setActionHandler('pause', () => {
            pauseCountdown();
          });

          navigator.mediaSession.setActionHandler('nexttrack', () => {
            handleDoneDrinking();
          });

          navigator.mediaSession.setActionHandler('previoustrack', () => {
            handleCrossDismiss();
          });
        } catch (e) {
          console.warn('mediaSession setup error:', e);
        }
      }
    }

    function updateMediaSessionAlarm() {
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: '🚨 TIME TO DRINK WATER! 💧',
            artist: 'Tap Next (Done) or Prev (Dismiss)',
            album: 'AquaForce Alert'
          });
        } catch (e) {
          // ignore
        }
      }
    }

    function start(targetTimeStr) {
      if (!enabled) return;
      try {
        const audio = getKeepAliveAudio();
        if (audio) {
          audio.currentTime = 0;
          const p = audio.play();
          if (p !== undefined) {
            p.catch(e => console.warn('Keep-alive audio auto-play restricted:', e));
          }

          // ontimeupdate keeps running in background on mobile OS!
          audio.ontimeupdate = function () {
            if (timerState.status === 'running' && timerState.targetTimestamp) {
              const now = Date.now();
              if (now >= timerState.targetTimestamp) {
                stopCountdownTick();
                onTimerExpired();
              }
            }
          };
        }
        setupMediaSession(targetTimeStr);
      } catch (e) {
        console.warn('Keep-alive start error:', e);
      }
    }

    function stop() {
      try {
        const audio = getKeepAliveAudio();
        if (audio) {
          audio.ontimeupdate = null;
          if (!audio.paused) {
            audio.pause();
            audio.currentTime = 0;
          }
        }
      } catch (e) {
        // ignore
      }
    }

    function toggle() {
      enabled = !enabled;
      if (DOM.lockAlarmToggleBtn && DOM.lockAlarmStatusLabel) {
        if (enabled) {
          DOM.lockAlarmToggleBtn.classList.add('active');
          DOM.lockAlarmStatusLabel.textContent = 'Lock Alarm: ON';
          Toast.show('Lock Screen Alarm ON: Audio session will keep phone active so reminder rings like an alarm.', 'info');
          if (timerState.status === 'running') {
            start();
          }
        } else {
          DOM.lockAlarmToggleBtn.classList.remove('active');
          DOM.lockAlarmStatusLabel.textContent = 'Lock Alarm: OFF';
          stop();
          Toast.show('Lock Screen Alarm OFF.', 'warning');
        }
      }
    }

    return {
      start,
      stop,
      toggle,
      updateMediaSessionAlarm,
      isEnabled: () => enabled
    };
  })();

  // ==========================================================================
  // 4. MAIN APPLICATION STATE
  // ==========================================================================
  let appSettings = StorageManager.getStoredSettings();
  let appData = StorageManager.getStoredData();
  let timerState = StorageManager.getStoredTimer();

  let timerTickInterval = null;
  let activeTimeInterval = null;

  // DOM Elements Cache
  const DOM = {
    // Header & Toggles
    soundToggleBtn: document.getElementById('soundToggleBtn'),
    soundStatusLabel: document.getElementById('soundStatusLabel'),
    testVoiceBtn: document.getElementById('testVoiceBtn'),
    iconSoundOn: document.querySelector('.icon-sound-on'),
    iconSoundOff: document.querySelector('.icon-sound-off'),
    notifyToggleBtn: document.getElementById('notifyToggleBtn'),
    notifyStatusLabel: document.getElementById('notifyStatusLabel'),
    lockAlarmToggleBtn: document.getElementById('lockAlarmToggleBtn'),
    lockAlarmStatusLabel: document.getElementById('lockAlarmStatusLabel'),
    wakeLockBtn: document.getElementById('wakeLockBtn'),
    wakeLockStatusLabel: document.getElementById('wakeLockStatusLabel'),
    manualDrinkBtn: document.getElementById('manualDrinkBtn'),

    // Top Stats
    statCompletedCount: document.getElementById('statCompletedCount'),
    statVolumeText: document.getElementById('statVolumeText'),
    statSkippedCount: document.getElementById('statSkippedCount'),
    statAdherenceRate: document.getElementById('statAdherenceRate'),
    statRatioText: document.getElementById('statRatioText'),
    statActiveTime: document.getElementById('statActiveTime'),

    // Timer Section
    timerStatusBadge: document.getElementById('timerStatusBadge'),
    timerStatusText: document.getElementById('timerStatusText'),
    timerProgressRing: document.getElementById('timerProgressRing'),
    countdownDisplay: document.getElementById('countdownDisplay'),
    countdownSubtext: document.getElementById('countdownSubtext'),
    currentIntervalChip: document.getElementById('currentIntervalChip'),
    intervalPills: document.querySelectorAll('.pill-btn'),
    customMinutesInput: document.getElementById('customMinutesInput'),
    applyCustomBtn: document.getElementById('applyCustomBtn'),
    startTimerBtn: document.getElementById('startTimerBtn'),
    startBtnLabel: document.getElementById('startBtnLabel'),
    pauseTimerBtn: document.getElementById('pauseTimerBtn'),
    resetTimerBtn: document.getElementById('resetTimerBtn'),

    // Hydration Goal Section
    streakCount: document.getElementById('streakCount'),
    gaugeWaterLevel: document.getElementById('gaugeWaterLevel'),
    goalPercentage: document.getElementById('goalPercentage'),
    goalProgressStatus: document.getElementById('goalProgressStatus'),
    glassesDrankText: document.getElementById('glassesDrankText'),
    targetGlassesText: document.getElementById('targetGlassesText'),
    volumeDrankText: document.getElementById('volumeDrankText'),
    remainingGoalText: document.getElementById('remainingGoalText'),
    quickLogGoalBtn: document.getElementById('quickLogGoalBtn'),
    glassesMiniRow: document.getElementById('glassesMiniRow'),

    // Timeline & Features
    activityTimelineList: document.getElementById('activityTimelineList'),
    timelineEmptyState: document.getElementById('timelineEmptyState'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    openResetModalBtn: document.getElementById('openResetModalBtn'),

    // Full-screen Reminder Overlay
    reminderOverlay: document.getElementById('reminderOverlay'),
    overlayCrossBtn: document.getElementById('overlayCrossBtn'),
    overlayDoneBtn: document.getElementById('overlayDoneBtn'),
    overlaySkipBtn: document.getElementById('overlaySkipBtn'),
    randomHealthTip: document.getElementById('randomHealthTip'),

    // Confirm Reset Modal
    resetModal: document.getElementById('resetModal'),
    cancelResetBtn: document.getElementById('cancelResetBtn'),
    confirmResetBtn: document.getElementById('confirmResetBtn')
  };

  // ==========================================================================
  // 5. UI UPDATE FUNCTIONS
  // ==========================================================================

  // Update Top Stats & Goal Cards
  function renderDashboardMetrics() {
    // Completed Sessions & Volume
    const totalGlasses = appData.completedSessions;
    const totalMl = appData.totalVolumeMl;
    DOM.statCompletedCount.textContent = totalGlasses;
    DOM.statVolumeText.textContent = `${totalMl} ml consumed`;

    // Skipped Sessions
    DOM.statSkippedCount.textContent = appData.skippedSessions;

    // Adherence Rate
    const totalEvents = appData.completedSessions + appData.skippedSessions;
    let adherenceRate = 100;
    if (totalEvents > 0) {
      adherenceRate = Math.round((appData.completedSessions / totalEvents) * 100);
    }
    DOM.statAdherenceRate.textContent = `${adherenceRate}%`;
    DOM.statRatioText.textContent = `${appData.completedSessions} completed / ${totalEvents} total`;

    // Active Time Today
    DOM.statActiveTime.textContent = formatTimeHHMMSS(appData.activeSecondsToday);

    // Hydration Goal Breakdown
    const targetGlasses = appSettings.dailyGoalGlasses || CONFIG.DAILY_GOAL_GLASSES;
    const targetVolume = targetGlasses * CONFIG.VOLUME_PER_GLASS_ML;
    const percent = Math.min(100, Math.round((totalMl / targetVolume) * 100));

    DOM.goalPercentage.textContent = `${percent}%`;
    DOM.glassesDrankText.textContent = totalGlasses;
    DOM.targetGlassesText.textContent = targetGlasses;
    DOM.volumeDrankText.textContent = totalMl;

    const remainingMl = Math.max(0, targetVolume - totalMl);
    DOM.remainingGoalText.textContent = `${remainingMl} ml`;

    // Gauge water fill height
    DOM.gaugeWaterLevel.style.height = `${percent}%`;

    // Goal Subtitle Status
    if (percent >= 100) {
      DOM.goalProgressStatus.textContent = '🎉 Daily Goal Achieved!';
      DOM.goalProgressStatus.style.color = 'var(--success)';
    } else if (percent >= 50) {
      DOM.goalProgressStatus.textContent = '⚡ Well on track!';
      DOM.goalProgressStatus.style.color = 'var(--primary)';
    } else if (percent > 0) {
      DOM.goalProgressStatus.textContent = '💧 Keep drinking!';
      DOM.goalProgressStatus.style.color = 'var(--secondary)';
    } else {
      DOM.goalProgressStatus.textContent = 'Goal Not Started';
      DOM.goalProgressStatus.style.color = 'var(--text-muted)';
    }

    // Streak
    const streak = appData.streakDays || 1;
    DOM.streakCount.textContent = `${streak} Day Streak`;

    // Mini 8-Glass Visualizer Row
    renderMiniGlasses(totalGlasses, targetGlasses);

    // Sound toggle state
    updateSoundUI();

    // Notification toggle state
    updateNotificationUI();
  }

  // Render Mini Glass Icons Row
  function renderMiniGlasses(drankCount, targetCount) {
    DOM.glassesMiniRow.innerHTML = '';
    for (let i = 1; i <= targetCount; i++) {
      const slot = document.createElement('div');
      slot.className = `mini-glass-slot ${i <= drankCount ? 'drank' : ''}`;
      slot.title = `Glass ${i} (${i * CONFIG.VOLUME_PER_GLASS_ML} ml)`;

      slot.innerHTML = `
        <div class="mini-glass-icon">
          <div class="mini-glass-liquid"></div>
        </div>
        <span class="mini-glass-num">#${i}</span>
      `;

      // Clicking an unfilled glass allows quick log
      slot.addEventListener('click', () => {
        SoundSystem.warmUp();
        logDrinkingSession('manual', 'Manual Quick Click');
      });

      DOM.glassesMiniRow.appendChild(slot);
    }
  }

  // Render Activity Timeline
  function renderTimeline() {
    const list = DOM.activityTimelineList;
    const items = appData.timeline || [];

    // Clear previous items except empty state
    list.innerHTML = '';

    if (items.length === 0) {
      list.appendChild(DOM.timelineEmptyState);
      DOM.timelineEmptyState.style.display = 'flex';
      return;
    }

    DOM.timelineEmptyState.style.display = 'none';

    // Show newest first
    const reversed = [...items].reverse();

    reversed.forEach(entry => {
      const li = document.createElement('li');
      li.className = 'timeline-item';

      let iconClass = 'bg-blue-light text-blue';
      let iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

      if (entry.type === 'skipped') {
        iconClass = 'bg-amber-light text-amber';
        iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      } else if (entry.type === 'manual') {
        iconClass = 'bg-cyan-light text-cyan';
        iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
      }

      li.innerHTML = `
        <div class="timeline-left">
          <div class="timeline-icon-wrap ${iconClass}">
            ${iconSvg}
          </div>
          <div>
            <div class="timeline-title">${entry.title}</div>
            <div class="timeline-note">${entry.note || ''}</div>
          </div>
        </div>
        <div class="timeline-time">${entry.time}</div>
      `;

      list.appendChild(li);
    });
  }

  // Update Timer Display & Circular Ring
  function updateTimerUI(remainingSeconds, totalDuration) {
    // Digits
    DOM.countdownDisplay.textContent = formatTimeMMSS(remainingSeconds);

    // Progress Ring offset
    const fraction = totalDuration > 0 ? remainingSeconds / totalDuration : 0;
    const offset = CONFIG.CIRCUMFERENCE * (1 - fraction);
    DOM.timerProgressRing.style.strokeDashoffset = offset;

    // Document title update
    if (timerState.status === 'running') {
      document.title = `(${formatTimeMMSS(remainingSeconds)}) AquaForce - Drink Water`;
    } else {
      document.title = 'AquaForce – Strict Water Drinking Reminder System';
    }

    // Status Badge UI
    DOM.timerStatusBadge.className = 'timer-status-badge';
    if (timerState.status === 'running') {
      DOM.timerStatusBadge.classList.add('status-running');
      DOM.timerStatusText.textContent = 'Running';
      DOM.startBtnLabel.textContent = 'Running...';
      DOM.startTimerBtn.disabled = true;
      DOM.pauseTimerBtn.disabled = false;
    } else if (timerState.status === 'paused') {
      DOM.timerStatusBadge.classList.add('status-paused');
      DOM.timerStatusText.textContent = 'Paused';
      DOM.startBtnLabel.textContent = 'Resume';
      DOM.startTimerBtn.disabled = false;
      DOM.pauseTimerBtn.disabled = true;
    } else {
      DOM.timerStatusBadge.classList.add('status-idle');
      DOM.timerStatusText.textContent = 'Ready';
      DOM.startBtnLabel.textContent = 'Start Reminder';
      DOM.startTimerBtn.disabled = false;
      DOM.pauseTimerBtn.disabled = true;
    }
  }

  function updateSoundUI() {
    if (appSettings.soundEnabled) {
      DOM.iconSoundOn.classList.remove('hidden');
      DOM.iconSoundOff.classList.add('hidden');
      DOM.soundStatusLabel.textContent = 'Sound ON';
      DOM.soundToggleBtn.classList.add('active');
    } else {
      DOM.iconSoundOn.classList.add('hidden');
      DOM.iconSoundOff.classList.remove('hidden');
      DOM.soundStatusLabel.textContent = 'Muted';
      DOM.soundToggleBtn.classList.remove('active');
    }
  }

  function updateNotificationUI() {
    if ('Notification' in window && Notification.permission === 'granted' && appSettings.notificationsEnabled) {
      DOM.notifyStatusLabel.textContent = 'Alerts ON';
      DOM.notifyToggleBtn.classList.add('active');
    } else {
      DOM.notifyStatusLabel.textContent = 'Alerts OFF';
      DOM.notifyToggleBtn.classList.remove('active');
    }
  }

  // ==========================================================================
  // 6. ACCURATE COUNTDOWN ENGINE
  // Handles drift-free timestamps, Page Visibility API & tab backgrounding
  // ==========================================================================

  function startCountdown(resumeFromSeconds = null) {
    SoundSystem.warmUp();

    // Prevent duplicate timers
    stopCountdownTick();

    const duration = appSettings.intervalMinutes * 60;
    const remaining = (resumeFromSeconds !== null) ? resumeFromSeconds : duration;

    timerState.status = 'running';
    timerState.durationSeconds = duration;
    timerState.remainingSeconds = remaining;
    timerState.targetTimestamp = Date.now() + (remaining * 1000);
    timerState.lastActiveTick = Date.now();

    StorageManager.saveTimer(timerState);
    updateTimerUI(remaining, duration);

    // Start background tick with precise timestamp delta
    timerTickInterval = setInterval(tick, 250);

    // Start active tracking increment timer
    startActiveTracking();

    // Start Lock Screen background audio keep-alive and media session
    const targetDate = new Date(Date.now() + (remaining * 1000));
    let targetHours = targetDate.getHours();
    const targetMins = String(targetDate.getMinutes()).padStart(2, '0');
    const ampm = targetHours >= 12 ? 'PM' : 'AM';
    targetHours = targetHours % 12 || 12;
    const targetTimeStr = `${targetHours}:${targetMins} ${ampm}`;
    LockAlarmManager.start(targetTimeStr);

    Toast.show(`Timer started! Next reminder at ${targetTimeStr} (${appSettings.intervalMinutes} min).`, 'info');
  }

  function tick() {
    if (timerState.status !== 'running') {
      stopCountdownTick();
      return;
    }

    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((timerState.targetTimestamp - now) / 1000));
    timerState.remainingSeconds = remaining;

    updateTimerUI(remaining, timerState.durationSeconds);

    if (remaining <= 0) {
      stopCountdownTick();
      onTimerExpired();
    }
  }

  function pauseCountdown() {
    if (timerState.status !== 'running') return;

    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((timerState.targetTimestamp - now) / 1000));

    timerState.status = 'paused';
    timerState.remainingSeconds = remaining;
    timerState.targetTimestamp = null;

    stopCountdownTick();
    stopActiveTracking();
    LockAlarmManager.stop();

    StorageManager.saveTimer(timerState);
    updateTimerUI(remaining, timerState.durationSeconds);

    Toast.show('Reminder paused. Stay hydrated!', 'warning');
  }

  function resetCountdown() {
    stopCountdownTick();
    stopActiveTracking();
    LockAlarmManager.stop();

    const duration = appSettings.intervalMinutes * 60;
    timerState.status = 'stopped';
    timerState.durationSeconds = duration;
    timerState.remainingSeconds = duration;
    timerState.targetTimestamp = null;

    StorageManager.saveTimer(timerState);
    updateTimerUI(duration, duration);

    Toast.show('Timer reset to ' + appSettings.intervalMinutes + ' minutes.', 'info');
  }

  function stopCountdownTick() {
    if (timerTickInterval) {
      clearInterval(timerTickInterval);
      timerTickInterval = null;
    }
  }

  // Active Monitoring Time Tracker
  function startActiveTracking() {
    if (activeTimeInterval) return;
    activeTimeInterval = setInterval(() => {
      if (timerState.status === 'running') {
        appData.activeSecondsToday += 1;
        DOM.statActiveTime.textContent = formatTimeHHMMSS(appData.activeSecondsToday);
        // Persist periodically
        if (appData.activeSecondsToday % 10 === 0) {
          StorageManager.saveData(appData);
        }
      }
    }, 1000);
  }

  function stopActiveTracking() {
    if (activeTimeInterval) {
      clearInterval(activeTimeInterval);
      activeTimeInterval = null;
    }
    StorageManager.saveData(appData);
  }

  // Page Visibility API handler to fix background tab throttling immediately
  function handleVisibilityChange() {
    if (document.hidden) return;

    // Restore screen wake lock if user had enabled it
    if (WakeLockManager.isUserEnabled()) {
      WakeLockManager.request();
    }

    // Tab became visible again: resync calculations
    if (timerState.status === 'running' && timerState.targetTimestamp) {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((timerState.targetTimestamp - now) / 1000));
      timerState.remainingSeconds = remaining;

      if (remaining <= 0) {
        stopCountdownTick();
        onTimerExpired();
      } else {
        updateTimerUI(remaining, timerState.durationSeconds);
      }
    }
  }

  // ==========================================================================
  // 7. ATTENTION-GRABBING REMINDER OVERLAY LOGIC
  // ==========================================================================

  function onTimerExpired() {
    // 1. Stop silent keep-alive and update lock screen media notification
    LockAlarmManager.stop();
    LockAlarmManager.updateMediaSessionAlarm();

    // 2. Play voice reminder audio (loops as alarm) if sound enabled ("It's time to drink water!")
    if (appSettings.soundEnabled) {
      SoundSystem.playReminderVoice(true);
    }

    // 3. Trigger desktop notification if granted
    triggerDesktopNotification();

    // 4. Show full-screen overlay with randomized health tip
    showReminderOverlay();
  }

  function showReminderOverlay() {
    const randomTip = CONFIG.HEALTH_TIPS[Math.floor(Math.random() * CONFIG.HEALTH_TIPS.length)];
    DOM.randomHealthTip.textContent = randomTip;

    DOM.reminderOverlay.classList.remove('hidden');

    // Make window title flash
    document.title = '🚨 TIME TO DRINK WATER! - AquaForce';
  }

  function hideReminderOverlay() {
    DOM.reminderOverlay.classList.add('hidden');
    document.title = 'AquaForce – Strict Water Drinking Reminder System';
  }

  function triggerDesktopNotification() {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted' && appSettings.notificationsEnabled) {
      try {
        const notif = new Notification('AquaForce: Time to Drink Water! 💧', {
          body: 'Take a break, stand up, and drink a full glass of water (~250ml) right now!',
          requireInteraction: true
        });

        notif.onclick = function () {
          window.focus();
          this.close();
        };
      } catch (e) {
        console.warn('Desktop notification error:', e);
      }
    }
  }

  // ==========================================================================
  // 8. ACTIONS: DONE vs. CROSS (STRICT TRACKING)
  // ==========================================================================

  // DONE Button Handler
  function handleDoneDrinking() {
    SoundSystem.stopReminderVoice();
    hideReminderOverlay();

    // Sound feedback
    if (appSettings.soundEnabled) {
      SoundSystem.playSuccessChime();
    }

    // Log completed session
    logDrinkingSession('completed', `Scheduled Reminder (${appSettings.intervalMinutes}m)`);

    Toast.show('Great job! Drinking session logged (+250ml). Restarting timer...', 'success');

    // Restart countdown immediately
    startCountdown();
  }

  // CROSS Button Handler
  function handleCrossDismiss() {
    SoundSystem.stopReminderVoice();
    hideReminderOverlay();

    // Water plop sound
    if (appSettings.soundEnabled) {
      SoundSystem.playWaterDrop();
    }

    // Strict tracking: Log skipped session
    logSkippedSession(`Dismissed (${appSettings.intervalMinutes}m interval)`);

    Toast.show('Reminder skipped. Stay hydrated!', 'warning');

    // Restart countdown
    startCountdown();
  }

  // Record a completed drinking session
  function logDrinkingSession(type, noteText) {
    appData.completedSessions += 1;
    appData.totalVolumeMl += CONFIG.VOLUME_PER_GLASS_ML;
    appData.lastCompletedDate = getTodayDateString();

    const entry = {
      id: Date.now().toString(),
      time: getCurrentTimeString(),
      type: type, // 'completed' or 'manual'
      title: type === 'manual' ? 'Quick Drink Logged' : '1 Glass Consumed',
      note: noteText || `+${CONFIG.VOLUME_PER_GLASS_ML} ml hydration`,
      volume: CONFIG.VOLUME_PER_GLASS_ML
    };

    appData.timeline.push(entry);
    StorageManager.saveData(appData);

    renderDashboardMetrics();
    renderTimeline();
  }

  // Record a skipped session
  function logSkippedSession(noteText) {
    appData.skippedSessions += 1;

    const entry = {
      id: Date.now().toString(),
      time: getCurrentTimeString(),
      type: 'skipped',
      title: 'Reminder Dismissed',
      note: noteText || 'Skipped session',
      volume: 0
    };

    appData.timeline.push(entry);
    StorageManager.saveData(appData);

    renderDashboardMetrics();
    renderTimeline();
  }

  // Manual Quick Drink Button
  function handleManualDrink() {
    SoundSystem.warmUp();
    if (appSettings.soundEnabled) {
      SoundSystem.playWaterDrop();
    }
    logDrinkingSession('manual', 'Manual Log (+250 ml)');
    Toast.show('Glass logged! Keep up the great hydration!', 'success');
  }

  // ==========================================================================
  // 9. SETTINGS & INTERVAL CONTROLS
  // ==========================================================================

  function setIntervalMinutes(minutes) {
    if (isNaN(minutes) || minutes < 1) minutes = 1;
    if (minutes > 180) minutes = 180;

    appSettings.intervalMinutes = minutes;
    StorageManager.saveSettings(appSettings);

    DOM.currentIntervalChip.textContent = `${minutes} Minutes`;
    DOM.countdownSubtext.textContent = `Every ${minutes} min reminder`;

    // Highlight matching preset pill
    DOM.intervalPills.forEach(pill => {
      const pMin = parseInt(pill.getAttribute('data-minutes'), 10);
      if (pMin === minutes) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });

    // If timer is not running, adjust display
    if (timerState.status === 'stopped') {
      const duration = minutes * 60;
      timerState.durationSeconds = duration;
      timerState.remainingSeconds = duration;
      StorageManager.saveTimer(timerState);
      updateTimerUI(duration, duration);
    } else {
      Toast.show(`Next cycle frequency updated to ${minutes} min.`, 'info');
    }
  }

  // Toggle Sound
  function toggleSound() {
    SoundSystem.warmUp();
    appSettings.soundEnabled = !appSettings.soundEnabled;
    StorageManager.saveSettings(appSettings);
    updateSoundUI();

    if (appSettings.soundEnabled) {
      SoundSystem.playWaterDrop();
      Toast.show('Reminder sound enabled', 'info');
    } else {
      Toast.show('Reminder sound muted', 'warning');
    }
  }

  // Request & Toggle Desktop Notifications
  function toggleNotifications() {
    if (!('Notification' in window)) {
      Toast.show('Desktop notifications are not supported in this browser.', 'warning');
      return;
    }

    if (Notification.permission === 'granted') {
      appSettings.notificationsEnabled = !appSettings.notificationsEnabled;
      StorageManager.saveSettings(appSettings);
      updateNotificationUI();
      Toast.show(appSettings.notificationsEnabled ? 'Desktop notifications enabled!' : 'Desktop notifications disabled.', 'info');
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          appSettings.notificationsEnabled = true;
          StorageManager.saveSettings(appSettings);
          updateNotificationUI();
          Toast.show('Notifications permission granted! You will be alerted even if this tab is in the background.', 'success');
        } else {
          appSettings.notificationsEnabled = false;
          StorageManager.saveSettings(appSettings);
          updateNotificationUI();
          Toast.show('Notification permission was denied.', 'warning');
        }
      });
    } else {
      Toast.show('Notification permission is blocked in your browser settings.', 'warning');
    }
  }

  // ==========================================================================
  // 10. CONFIRMATION MODAL & STATS RESET
  // ==========================================================================

  function openResetModal() {
    DOM.resetModal.classList.remove('hidden');
  }

  function closeResetModal() {
    DOM.resetModal.classList.add('hidden');
  }

  function resetDailyStatistics() {
    closeResetModal();

    appData.completedSessions = 0;
    appData.skippedSessions = 0;
    appData.manualDrinks = 0;
    appData.totalVolumeMl = 0;
    appData.activeSecondsToday = 0;
    appData.timeline = [];

    StorageManager.saveData(appData);

    renderDashboardMetrics();
    renderTimeline();

    Toast.show("Today's statistics and activity timeline have been reset.", 'info');
  }

  function clearTimelineOnly() {
    appData.timeline = [];
    StorageManager.saveData(appData);
    renderTimeline();
    Toast.show('Activity timeline cleared.', 'info');
  }

  // ==========================================================================
  // 11. EVENT LISTENERS SETUP
  // ==========================================================================

  function setupEventListeners() {
    // Header controls
    DOM.soundToggleBtn.addEventListener('click', toggleSound);
    if (DOM.testVoiceBtn) {
      DOM.testVoiceBtn.addEventListener('click', () => {
        SoundSystem.warmUp();
        SoundSystem.playReminderVoice();
        Toast.show("Playing voice alert: \"It's time to drink water!\"", 'info');
      });
    }
    DOM.notifyToggleBtn.addEventListener('click', toggleNotifications);
    if (DOM.lockAlarmToggleBtn) {
      DOM.lockAlarmToggleBtn.addEventListener('click', LockAlarmManager.toggle);
    }
    if (DOM.wakeLockBtn) {
      DOM.wakeLockBtn.addEventListener('click', WakeLockManager.toggle);
    }
    DOM.manualDrinkBtn.addEventListener('click', handleManualDrink);
    DOM.quickLogGoalBtn.addEventListener('click', handleManualDrink);

    // Timer controls
    DOM.startTimerBtn.addEventListener('click', () => {
      if (timerState.status === 'paused') {
        startCountdown(timerState.remainingSeconds);
      } else {
        startCountdown();
      }
    });

    DOM.pauseTimerBtn.addEventListener('click', pauseCountdown);
    DOM.resetTimerBtn.addEventListener('click', resetCountdown);

    // Interval Preset Pills
    DOM.intervalPills.forEach(pill => {
      pill.addEventListener('click', () => {
        const mins = parseInt(pill.getAttribute('data-minutes'), 10);
        setIntervalMinutes(mins);
      });
    });

    // Custom Interval Input
    DOM.applyCustomBtn.addEventListener('click', () => {
      const val = parseInt(DOM.customMinutesInput.value, 10);
      if (!isNaN(val) && val >= 1 && val <= 180) {
        setIntervalMinutes(val);
        DOM.customMinutesInput.value = '';
      } else {
        Toast.show('Please enter a valid interval between 1 and 180 minutes.', 'warning');
      }
    });

    DOM.customMinutesInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        DOM.applyCustomBtn.click();
      }
    });

    // Reminder Modal Actions
    DOM.overlayDoneBtn.addEventListener('click', handleDoneDrinking);
    DOM.overlaySkipBtn.addEventListener('click', handleCrossDismiss);
    DOM.overlayCrossBtn.addEventListener('click', handleCrossDismiss);

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      if (!DOM.reminderOverlay.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          handleCrossDismiss();
        } else if (e.key === 'Enter') {
          handleDoneDrinking();
        }
      } else if (!DOM.resetModal.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          closeResetModal();
        }
      }
    });

    // Reset Modal Dialog
    DOM.openResetModalBtn.addEventListener('click', openResetModal);
    DOM.cancelResetBtn.addEventListener('click', closeResetModal);
    DOM.confirmResetBtn.addEventListener('click', resetDailyStatistics);

    DOM.resetModal.addEventListener('click', (e) => {
      if (e.target === DOM.resetModal) {
        closeResetModal();
      }
    });

    // Timeline Clear
    DOM.clearHistoryBtn.addEventListener('click', clearTimelineOnly);

    // Page Visibility API
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Unlock Web Audio Context on first document interaction
    const unlockAudio = () => {
      SoundSystem.warmUp();
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('keydown', unlockAudio);
  }

  // ==========================================================================
  // 12. INITIALIZATION ON PAGE LOAD
  // ==========================================================================

  function init() {
    // 1. Setup UI with stored settings
    DOM.currentIntervalChip.textContent = `${appSettings.intervalMinutes} Minutes`;
    DOM.countdownSubtext.textContent = `Every ${appSettings.intervalMinutes} min reminder`;

    // Highlight active preset
    DOM.intervalPills.forEach(pill => {
      const pMin = parseInt(pill.getAttribute('data-minutes'), 10);
      if (pMin === appSettings.intervalMinutes) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });

    // 2. Render initial metrics & timeline
    renderDashboardMetrics();
    renderTimeline();

    // 3. Attach all DOM event listeners
    setupEventListeners();

    // 4. Restore Timer State gracefully
    const saved = StorageManager.getStoredTimer();
    const duration = appSettings.intervalMinutes * 60;

    if (saved.status === 'running' && saved.targetTimestamp) {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((saved.targetTimestamp - now) / 1000));

      if (remaining <= 0) {
        // Expired while tab was closed/refreshed
        timerState.status = 'stopped';
        timerState.remainingSeconds = duration;
        timerState.durationSeconds = duration;
        StorageManager.saveTimer(timerState);
        updateTimerUI(duration, duration);

        // Immediately present reminder
        setTimeout(onTimerExpired, 400);
      } else {
        // Resume running timer
        timerState = saved;
        timerState.remainingSeconds = remaining;
        timerTickInterval = setInterval(tick, 250);
        startActiveTracking();
        updateTimerUI(remaining, timerState.durationSeconds);
      }
    } else if (saved.status === 'paused') {
      timerState = saved;
      updateTimerUI(timerState.remainingSeconds, timerState.durationSeconds);
    } else {
      timerState.status = 'stopped';
      timerState.durationSeconds = duration;
      timerState.remainingSeconds = duration;
      updateTimerUI(duration, duration);
    }
  }

  // Expose global API for programmatic testing and developer console
  window.AquaForce = {
    triggerReminder: onTimerExpired,
    playVoice: SoundSystem.playReminderVoice,
    start: startCountdown,
    pause: pauseCountdown,
    reset: resetCountdown,
    logDrink: handleManualDrink,
    setInterval: setIntervalMinutes,
    resetStats: resetDailyStatistics,
    getState: () => ({ timerState, appSettings, appData })
  };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
