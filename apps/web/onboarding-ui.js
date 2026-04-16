/**
 * PlayBound  -  full onboarding UI (frontend only). Uses existing POST /api/me/onboarding actions.
 * @see onboarding-ui.css
 */
(function (global) {
  'use strict';

  var FACTIONS = [
    { key: 'Phoenixes', emoji: '🔥', flavor: 'Resilient' },
    { key: 'Unicorns', emoji: '🦄', flavor: 'Creative' },
    { key: 'Fireflies', emoji: '✨', flavor: 'Swift' },
    { key: 'Dragons', emoji: '🐉', flavor: 'Strategic' },
    { key: 'Wolves', emoji: '🐺', flavor: 'Aggressive' },
    { key: 'Eagles', emoji: '🦅', flavor: 'Balanced' },
  ];

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function categoryIcon(cat) {
    var c = String(cat || '').toLowerCase();
    if (c === 'dice') return '🎲';
    if (c === 'cards') return '🃏';
    if (c === 'trivia') return '❓';
    if (c === 'reaction') return '⚡';
    if (c === 'guess') return '🎯';
    if (c === 'puzzle') return '🧩';
    if (c === 'social') return '💬';
    if (c === 'elimination') return '🏆';
    return '🎮';
  }

  function warMockFromUrl() {
    try {
      if (String(global.location.search || '').indexOf('demoWar=1') >= 0) {
        return {
          active: true,
          line: 'Fire Lizards (Eagles) vs Wolves',
          officialScore: '12  -  10',
          rawScore: '450  -  410',
          timeLeft: '2h 14m left',
          enrolled: false,
        };
      }
    } catch (e) {}
    return { active: false };
  }

  function discordBlock(lines, buttons) {
    var t = (lines || []).map(escapeHtml).join('\n');
    var b = (buttons || [])
      .map(function (x) {
        return '<span class="pb-ob-discord-btn">' + escapeHtml(x) + '</span>';
      })
      .join('');
    return (
      '<div class="pb-ob-discord-msg">' +
      t +
      '</div>' +
      (b ? '<div class="pb-ob-discord-btns">' + b + '</div>' : '')
    );
  }

  /** @typedef {{ step: number, skipped?: boolean, complete?: boolean, active?: boolean, hasJoinedFaction?: boolean, hasPlayedFirstGame?: boolean, hasSeenChallenge?: boolean }} ObSnap */

  function viewKey(snap, local) {
    if (!snap || snap.complete) return 'home';
    if (snap.skipped) return 'paused';
    if (snap.step === 0) return 'welcome';
    if (snap.step === 1) return 'faction';
    if (snap.step === 2) {
      if (local.gameSub === 'playing') return 'game_playing';
      if (local.gameSub === 'afterDemo') return 'game_result';
      return 'first_intro';
    }
    if (snap.step === 3) {
      if (local.replayMode === 'playing') return 'game_playing';
      if (local.replayMode === 'after') return 'game_result';
      return 'post_game';
    }
    if (snap.step === 4) return 'challenge';
    if (snap.step === 5) return 'game_pick';
    if (snap.step === 6) return 'rotation';
    return 'home';
  }

  function runReactionDemo(rootEl, onDone) {
    var round = 0;
    var maxR = 3;
    var score = 0;
    var timerId;
    var phaseTimer;
    var roundRes = [];

    var titleEl = rootEl.querySelector('[data-g-title]');
    var roundEl = rootEl.querySelector('[data-g-round]');
    var timeEl = rootEl.querySelector('[data-g-time]');
    var promptEl = rootEl.querySelector('[data-g-prompt]');
    var tapEl = rootEl.querySelector('[data-g-tap]');
    var barEl = rootEl.querySelector('[data-g-bar]');
    var inputHint = rootEl.querySelector('[data-g-hint]');

    function clearTimers() {
      if (timerId) clearInterval(timerId);
      if (phaseTimer) clearTimeout(phaseTimer);
      timerId = null;
      phaseTimer = null;
    }

    function setState(pre, active, result) {
      rootEl.setAttribute('data-state', pre ? 'prestart' : active ? 'active' : result ? 'result' : 'idle');
    }

    function startRound() {
      round++;
      if (round > maxR) {
        finish();
        return;
      }
      if (titleEl) titleEl.textContent = 'Reaction Check';
      if (roundEl) roundEl.textContent = 'Round ' + round + '/' + maxR;
      if (promptEl) promptEl.textContent = 'Wait for green  -  then tap fast.';
      if (inputHint) inputHint.textContent = 'Tap the zone when it turns cyan.';
      tapEl.className = 'pb-ob-game-tap';
      tapEl.textContent = 'Get ready...';
      setState(true, false, false);

      var wait = 900 + Math.random() * 1400;
      phaseTimer = setTimeout(function () {
        tapEl.textContent = 'TAP!';
        tapEl.classList.add('is-go');
        setState(false, true, false);
        var ms = 900;
        var left = ms;
        if (timerId) clearInterval(timerId);
        timerId = setInterval(function () {
          left -= 100;
          if (timeEl) timeEl.textContent = (left / 1000).toFixed(1) + 's';
          if (barEl) {
            var pct = Math.max(0, (left / ms) * 100);
            barEl.querySelector('.pb-ob-timer-fill').style.width = pct + '%';
            barEl.querySelector('.pb-ob-timer-fill').classList.toggle('is-urgent', pct < 35);
          }
          if (left <= 0) {
            clearInterval(timerId);
            timerId = null;
            miss();
          }
        }, 100);
      }, wait);
    }

    function hit() {
      if (!tapEl.classList.contains('is-go')) {
        tapEl.classList.add('is-bad');
        setTimeout(function () {
          tapEl.classList.remove('is-bad');
        }, 400);
        return;
      }
      clearTimers();
      score++;
      roundRes.push('hit');
      tapEl.classList.remove('is-go');
      tapEl.classList.add('is-good');
      tapEl.textContent = 'Nice!';
      setTimeout(function () {
        tapEl.classList.remove('is-good');
        startRound();
      }, 380);
    }

    function miss() {
      roundRes.push('miss');
      tapEl.classList.remove('is-go');
      tapEl.textContent = 'Too slow';
      tapEl.classList.add('is-bad');
      setTimeout(function () {
        tapEl.classList.remove('is-bad');
        startRound();
      }, 450);
    }

    function finish() {
      clearTimers();
      setState(false, false, true);
      if (promptEl) promptEl.textContent = 'Round complete';
      tapEl.textContent = score + '/' + maxR + ' hits';
      tapEl.className = 'pb-ob-game-tap';
      onDone({ score: score, max: maxR });
    }

    tapEl.onclick = hit;
    startRound();

    return function destroy() {
      clearTimers();
      tapEl.onclick = null;
    };
  }

  function OnboardingUI(opts) {
    this.overlay = opts.overlay;
    this.launcher = opts.launcher;
    this.mainEl = opts.overlay.querySelector('[data-pb-ob-main]');
    this.discordEl = opts.overlay.querySelector('[data-pb-ob-discord]');
    this.onboardingPost = opts.onboardingPost;
    this.getGamesToday =
      opts.getGamesToday ||
      function () {
        return (typeof global !== 'undefined' && global.__pbGamesToday) || {};
      };
    this.getProfile = opts.getProfile || function () {
      return {};
    };
    this.onClose = opts.onClose || function () {};
    this._local = {
      selectedFaction: null,
      gameSub: null,
      demoDestroy: null,
      lastDemo: null,
      replayMode: null,
      lastPostReward: null,
    };
    this.snapshot = opts.snapshot || { step: 0 };
    this._bindChrome();
  }

  OnboardingUI.prototype._bindChrome = function () {
    var self = this;
    function dismiss() {
      try {
        sessionStorage.setItem('pb_ob_dismissed', '1');
      } catch (e) {}
      self.hide();
    }
    this.overlay.querySelectorAll('[data-pb-ob-close]').forEach(function (el) {
      el.addEventListener('click', dismiss);
    });
    var skipBtn = this.overlay.querySelector('[data-pb-ob-skip]');
    if (skipBtn) {
      skipBtn.addEventListener('click', function () {
        self.onboardingPost('skip').then(function (snap) {
          if (snap) {
            self.setSnapshot(snap);
            self.render();
          }
        });
      });
    }
  };

  OnboardingUI.prototype.setSnapshot = function (snap) {
    this.snapshot = snap || this.snapshot;
    if (this.snapshot && this.snapshot.step !== 2) {
      this._local.gameSub = null;
    }
    if (this.snapshot && this.snapshot.step !== 3) {
      this._local.replayMode = null;
      this._local.lastPostReward = null;
    }
  };

  OnboardingUI.prototype.setGamesToday = function (gt) {
    this._gt = gt;
  };

  OnboardingUI.prototype.setProfile = function (p) {
    this._profile = p;
  };

  OnboardingUI.prototype.show = function () {
    this.overlay.classList.remove('hidden');
    this.overlay.setAttribute('aria-hidden', 'false');
    if (this.launcher) this.launcher.classList.add('hidden');
    document.body.style.overflow = 'hidden';
    this.render();
  };

  OnboardingUI.prototype.hide = function () {
    this.overlay.classList.add('hidden');
    this.overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (this._local.demoDestroy) {
      this._local.demoDestroy();
      this._local.demoDestroy = null;
    }
    if (this.launcher) {
      if (this.snapshot && this.snapshot.complete) {
        this.launcher.classList.add('hidden');
      } else if (
        this.snapshot &&
        !this.snapshot.complete &&
        (this.snapshot.active || this.snapshot.skipped)
      ) {
        this.launcher.classList.remove('hidden');
      }
    }
    this.onClose();
  };

  OnboardingUI.prototype._post = function (action) {
    var self = this;
    return this.onboardingPost(action).then(function (snap) {
      if (snap) self.setSnapshot(snap);
      return snap;
    });
  };

  OnboardingUI.prototype.render = function () {
    if (!this.mainEl || !this.discordEl) return;
    var snap = this.snapshot || {};
    var local = this._local;
    var gt = this._gt || this.getGamesToday() || {};
    var profile = this._profile || this.getProfile() || {};
    var key = viewKey(snap, local);
    var war = warMockFromUrl();

    if (this._local.demoDestroy && key !== 'game_playing' && key !== 'game_result') {
      this._local.demoDestroy();
      this._local.demoDestroy = null;
    }

    var mainHtml = '';
    var discHtml = '';

    if (key === 'paused') {
      mainHtml =
        '<div class="pb-ob-screen">' +
        '<h2 class="pb-ob-h1">Tour paused</h2>' +
        '<p class="pb-ob-sub">Jump back in whenever you\u2019re ready.</p>' +
        '<div class="pb-ob-actions">' +
        '<button type="button" class="pb-ob-btn-primary" data-act="resume">Resume</button>' +
        '</div></div>';
      discHtml =
        '<p class="pb-ob-discord-title">Discord</p>' +
        discordBlock(['Tour paused.', 'Run `/onboarding` with **resume** anytime.'], []);
    } else if (key === 'welcome') {
      mainHtml =
        '<div class="pb-ob-screen">' +
        '<h2 class="pb-ob-h1">Welcome to PlayBound!</h2>' +
        '<p class="pb-ob-sub">Turn your server into game night with fast /playgame runs and ranked faction challenges.</p>' +
        '<ul class="pb-ob-bullets">' +
        '<li>Play /playgame rotations</li><li>Build Credits and Arena score</li><li>Join ranked faction challenges</li></ul>' +
        '<div class="pb-ob-actions">' +
        '<button type="button" class="pb-ob-btn-primary" data-act="next">Start Playing</button>' +
        '</div></div>';
      discHtml =
        '<p class="pb-ob-discord-title">Discord</p>' +
        discordBlock(['Welcome to PlayBound!'], ['Start Playing']);
    } else if (key === 'faction') {
      var cards = FACTIONS.map(function (f) {
        var sel = local.selectedFaction === f.key ? ' is-selected' : '';
        return (
          '<button type="button" class="pb-ob-faction-card' +
          sel +
          '" data-faction="' +
          escapeHtml(f.key) +
          '">' +
          '<div class="pb-ob-faction-emoji">' +
          f.emoji +
          '</div>' +
          '<div class="pb-ob-faction-name">' +
          escapeHtml(f.key) +
          '</div>' +
          '<div class="pb-ob-faction-tag">' +
          escapeHtml(f.flavor) +
          '</div></button>'
        );
      }).join('');
      var facJoinedName = profile.factionName || local.selectedFaction || '';
      var confirm = snap.hasJoinedFaction
        ? '<div class="pb-ob-confirm">You joined <strong>' +
          escapeHtml(facJoinedName) +
          '</strong>!<br><span style="color:var(--pb-ob-muted);font-size:0.82rem;">Some servers may rename this faction locally.</span></div>'
        : '';
      mainHtml =
        '<div class="pb-ob-screen pb-ob-screen--wide">' +
        '<h2 class="pb-ob-h1">Pick your faction</h2>' +
        '<p class="pb-ob-sub">Tap a team  -  we\u2019ll copy the Discord command.</p>' +
        '<div class="pb-ob-faction-grid">' +
        cards +
        '</div>' +
        confirm +
        '<div class="pb-ob-actions">' +
        '<button type="button" class="pb-ob-btn-primary" data-act="faction-continue" ' +
        (!snap.hasJoinedFaction ? 'disabled' : '') +
        '>Play First Game</button>' +
        '<button type="button" class="pb-ob-btn-secondary" data-act="refresh-faction">Refresh after joining</button>' +
        '</div></div>';
      discHtml =
        '<p class="pb-ob-discord-title">Discord</p>' +
        discordBlock(['Pick your faction'], ['Join Phoenixes', 'Join Unicorns', 'Join Fireflies', 'Join Dragons', 'Join Wolves', 'Join Eagles']);
    } else if (key === 'first_intro') {
      mainHtml =
        '<div class="pb-ob-screen">' +
        '<h2 class="pb-ob-h1">Let\u2019s Play!</h2>' +
        '<p class="pb-ob-sub">This is a quick practice round  -  real ranked progress happens in Discord through /playgame.</p>' +
        '<div class="pb-ob-actions">' +
        '<button type="button" class="pb-ob-btn-primary" data-act="start-demo">Start Game</button>' +
        '<button type="button" class="pb-ob-btn-ghost" data-act="refresh-step2">I played in Discord  -  sync</button>' +
        '</div></div>';
      discHtml =
        '<p class="pb-ob-discord-title">Discord</p>' +
        discordBlock(["Let's Play!", 'Quick game  -  jump in.'], ['Start Game']);
    } else if (key === 'game_playing' || key === 'game_result') {
      var isResult = key === 'game_result';
      var demo = local.lastDemo || { score: 0, max: 3 };
      mainHtml =
        '<div class="pb-ob-screen pb-ob-screen--wide">' +
        '<div class="pb-ob-game" data-game-shell>' +
        '<div class="pb-ob-game-head">' +
        '<span class="pb-ob-game-title" data-g-title>Reaction Check</span>' +
        '<div class="pb-ob-game-meta">' +
        '<span>Round <b data-g-round> - </b></span>' +
        '<span>Timer <b data-g-time> - </b></span>' +
        '</div></div>' +
        '<div class="pb-ob-game-body">' +
        '<p class="pb-ob-game-prompt" data-g-prompt>' +
        (isResult ? 'Nice run  -  that\u2019s the idea.' : 'Wait for green  -  then tap fast.') +
        '</p>' +
        '<div class="pb-ob-game-tap" data-g-tap>' +
        (isResult ? demo.score + '/' + demo.max + ' hits' : 'Loading...') +
        '</div>' +
        '<div class="pb-ob-timer-bar" data-g-bar><div class="pb-ob-timer-fill" style="width:100%"></div></div>' +
        '<p class="pb-ob-hint" data-g-hint>' +
        (isResult ? 'Real credits come from Discord games.' : '') +
        '</p>' +
        '</div></div>' +
        (isResult
          ? '<div class="pb-ob-actions"><button type="button" class="pb-ob-btn-primary" data-act="demo-continue">Continue</button></div>'
          : '') +
        '</div>';
      discHtml =
        '<p class="pb-ob-discord-title">Discord</p>' +
        discordBlock(['Reaction Check', 'Round · Timer', isResult ? 'Round complete' : 'Tap when green'], isResult ? [] : ['Tap']);
    } else if (key === 'post_game') {
      if (local.lastPostReward == null) {
        local.lastPostReward = 80 + Math.round(Math.random() * 80);
      }
      var bonus = local.lastPostReward;
      var demoLine =
        local.lastDemo && local.lastDemo.max
          ? '<p class="pb-ob-sub" style="margin-top:-0.35rem;">Practice round: <strong>' +
            local.lastDemo.score +
            '/' +
            local.lastDemo.max +
            '</strong> hits</p>'
          : '';
      mainHtml =
        '<div class="pb-ob-screen">' +
        '<h2 class="pb-ob-h1">You earned +' +
        bonus +
        ' credits</h2>' +
        demoLine +
        '<p class="pb-ob-sub">That\u2019s the loop in Discord  -  play as much as you like, but only your first 5 /playgame sessions each UTC day count for personal points.</p>' +
        '<div class="pb-ob-actions">' +
        '<button type="button" class="pb-ob-btn-primary" data-act="next">Next</button>' +
        '<button type="button" class="pb-ob-btn-secondary" data-act="replay-demo">Play Again</button>' +
        (war.active
          ? '<button type="button" class="pb-ob-btn-ghost" data-act="war-tip">View Challenge</button>'
          : '') +
        '</div></div>';
      discHtml =
        '<p class="pb-ob-discord-title">Discord</p>' +
        discordBlock(['You earned +' + bonus + ' credits', 'That\u2019s how you earn rewards.'], ['Play Again']);
    } else if (key === 'challenge') {
      if (war.active) {
        mainHtml =
          '<div class="pb-ob-screen pb-ob-screen--wide">' +
          '<div class="pb-ob-card">' +
          '<div class="pb-ob-war-header">' +
          '<div class="pb-ob-war-badge">Ranked Faction Challenge</div>' +
          '<div class="pb-ob-war-match">' +
          escapeHtml(war.line) +
          '</div>' +
          '<div class="pb-ob-war-timer">' +
          escapeHtml(war.timeLeft) +
          '</div></div>' +
          '<div class="pb-ob-war-scores">' +
          '<div class="pb-ob-war-stat"><label>Official score</label><strong>' +
          escapeHtml(war.officialScore) +
          '</strong></div>' +
          '<div class="pb-ob-war-stat"><label>Raw contribution</label><strong>' +
          escapeHtml(war.rawScore) +
          '</strong></div></div>' +
          '<div class="pb-ob-enroll">' +
          (war.enrolled ? 'Enrolled  -  allowed /playgame tags can count.' : 'Not enrolled in this challenge.') +
          '</div>' +
          '<div class="pb-ob-actions pb-ob-actions--row">' +
          (war.enrolled
            ? '<button type="button" class="pb-ob-btn-primary" data-act="next">Play Eligible Game</button>'
            : '<button type="button" class="pb-ob-btn-primary" data-act="next">Join Challenge</button>') +
          '</div>' +
          '<p class="pb-ob-hint">Only enrolled players contribute. Only allowed /playgame tags count.</p>' +
          '</div></div>';
      } else {
        mainHtml =
          '<div class="pb-ob-screen">' +
          '<h2 class="pb-ob-h1">Faction challenges</h2>' +
          '<p class="pb-ob-sub">When a ranked challenge is live, join in Discord  -  then play the allowed /playgame tags.</p>' +
          '<div class="pb-ob-actions">' +
          '<button type="button" class="pb-ob-btn-primary" data-act="next">Next</button>' +
          '</div>' +
          '<p class="pb-ob-hint">Add <code>?demoWar=1</code> to preview this screen.</p>' +
          '</div>';
      }
      discHtml =
        '<p class="pb-ob-discord-title">Discord</p>' +
        discordBlock(['Ranked Faction Challenge', war.active ? war.line : 'No challenge in preview'], ['Join', 'Play Game']);
    } else if (key === 'game_pick') {
      var featured = gt.featuredTag
        ? (gt.activeGames || []).find(function (g) {
            return g.tag === gt.featuredTag;
          })
        : null;
      var list = (gt.activeGames || []).slice(0, 8);
      var featBlock = '';
      if (featured) {
        featBlock =
          '<div class="pb-ob-featured">' +
          '<div class="pb-ob-featured-tag">Featured · casual bonus only</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;">' +
          '<div><strong>' +
          escapeHtml(featured.displayName || featured.tag) +
          '</strong><div class="pb-ob-mini-cat">' +
          escapeHtml(featured.category || '') +
          '</div></div>' +
          '<button type="button" class="pb-ob-btn-primary" data-copy="/playgame game:' +
          escapeHtml(featured.tag) +
          '">Play</button></div></div>';
      }
      var others = list
        .map(function (g) {
          var ranked = g.rankedEligible;
          var feat = !!g.featuredToday;
          var tags =
            '<span class="pb-ob-tag ' +
            (ranked ? 'pb-ob-tag--war' : 'pb-ob-tag--casual') +
            '">' +
            (ranked ? 'Ranked-eligible' : 'Casual only') +
            '</span>';
          if (feat) tags += '<span class="pb-ob-tag pb-ob-tag--feat">Featured</span>';
          return (
            '<div class="pb-ob-mini-card">' +
            '<div class="pb-ob-mini-card-top">' +
            '<div><span class="pb-ob-mini-ico">' +
            categoryIcon(g.category) +
            '</span> <span class="pb-ob-mini-name">' +
            escapeHtml(g.displayName || g.tag) +
            '</span>' +
            '<div class="pb-ob-mini-cat">' +
            escapeHtml(g.category || '') +
            '</div></div>' +
            '<button type="button" class="pb-ob-btn-primary" style="padding:0.45rem 0.75rem;font-size:0.8rem;" data-copy="/playgame game:' +
            escapeHtml(g.tag) +
            '">Play</button></div>' +
            '<div class="pb-ob-tag-row">' +
            tags +
            '</div></div>'
          );
        })
        .join('');
      mainHtml =
        '<div class="pb-ob-screen pb-ob-screen--wide">' +
        '<h2 class="pb-ob-h1">Pick a game</h2>' +
        '<p class="pb-ob-sub">Today\u2019s rotation  -  copy a /playgame tag in Discord. Ranked-eligible picks still depend on the active challenge filter.</p>' +
        '<div class="pb-ob-section-label">Featured</div>' +
        (featBlock || '<p class="pb-ob-hint">No featured meta from API.</p>') +
        '<div class="pb-ob-section-label">Active today</div>' +
        '<div class="pb-ob-game-grid">' +
        (others || '<p class="pb-ob-hint">No games list  -  refresh the page.</p>') +
        '</div>' +
        '<div class="pb-ob-actions" style="margin-top:1rem;">' +
        '<button type="button" class="pb-ob-btn-primary" data-act="next">Next</button>' +
        '</div></div>';
      discHtml =
        '<p class="pb-ob-discord-title">Discord</p>' +
        discordBlock(['Pick a game', '/playgame'], ['Play']);
    } else if (key === 'rotation') {
      mainHtml =
        '<div class="pb-ob-screen">' +
        '<h2 class="pb-ob-h1">Fresh games daily</h2>' +
        '<p class="pb-ob-sub">Games rotate every day (UTC) to keep things interesting, and only your first 5 /playgame sessions each UTC day count for personal points.</p>' +
        '<ul class="pb-ob-bullets">' +
        '<li>Try different games</li><li>Build Credits and Arena</li><li>Help in ranked challenges</li></ul>' +
        '<div class="pb-ob-actions">' +
        '<button type="button" class="pb-ob-btn-primary" data-act="next">Play Another Game</button>' +
        '</div></div>';
      discHtml =
        '<p class="pb-ob-discord-title">Discord</p>' +
        discordBlock(['Games rotate daily'], ['Play Another Game']);
    } else {
      /* home / post-onboarding */
      var fac = profile.factionName || ' - ';
      mainHtml =
        '<div class="pb-ob-screen pb-ob-screen--wide">' +
        '<h2 class="pb-ob-h1">You\u2019re in</h2>' +
        '<p class="pb-ob-sub">Here\u2019s your hub  -  /playgame is still the official lane for ranked progress.</p>' +
        '<div class="pb-ob-dash-banner">' +
        '<div class="pb-ob-section-label" style="margin-top:0;">Active challenge</div>' +
        (war.active
          ? '<p style="font-size:0.9rem;font-weight:700;">' +
            escapeHtml(war.line) +
            '</p><p class="pb-ob-hint">' +
            escapeHtml(war.timeLeft) +
            '</p><button type="button" class="pb-ob-btn-primary" style="margin-top:0.5rem;" data-act="noop-war">Play Eligible Game</button>'
          : '<p class="pb-ob-hint">No challenge preview  -  join in Discord when live.</p>') +
        '</div>' +
        (gt.featuredDisplayName
          ? '<div class="pb-ob-featured"><div class="pb-ob-featured-tag">Featured</div><strong>' +
            escapeHtml(gt.featuredDisplayName) +
            '</strong><div class="pb-ob-actions" style="margin-top:0.65rem;"><button type="button" class="pb-ob-btn-primary" data-copy="/playgame">Play</button></div></div>'
          : '') +
        '<div class="pb-ob-section-label">Today\u2019s games</div>' +
        '<div class="pb-ob-game-grid">' +
        (gt.activeGames || [])
          .slice(0, 6)
          .map(function (g) {
            return (
              '<div class="pb-ob-mini-card"><div class="pb-ob-mini-name">' +
              categoryIcon(g.category) +
              ' ' +
              escapeHtml(g.displayName || g.tag) +
              '</div><button type="button" class="pb-ob-btn-secondary" style="margin-top:0.35rem;" data-copy="/playgame game:' +
              escapeHtml(g.tag) +
              '">Play</button></div>'
            );
          })
          .join('') +
        '</div>' +
        '<div class="pb-ob-section-label">Player status</div>' +
        '<div class="pb-ob-dash-grid">' +
        '<div class="pb-ob-card"><div class="pb-ob-stat-row"><span>Faction</span><span>' +
        escapeHtml(fac) +
        '</span></div>' +
        '<div class="pb-ob-stat-row"><span>Credits</span><span>' +
        (profile.creditsTotal != null ? profile.creditsTotal : ' - ') +
        '</span></div>' +
        '<div class="pb-ob-stat-row"><span>Arena</span><span>' +
        (profile.arenaScoreTotal != null ? profile.arenaScoreTotal : ' - ') +
        '</span></div></div></div>' +
        '<div class="pb-ob-actions" style="margin-top:1rem;">' +
        '<button type="button" class="pb-ob-btn-primary" data-act="finish-ui">Go to site</button>' +
        '</div></div>';
      discHtml =
        '<p class="pb-ob-discord-title">Discord</p>' +
        discordBlock(['Home', '/playgame', '/factions'], ['Play', 'Join']);
    }

    this.mainEl.innerHTML = mainHtml;
    this.discordEl.innerHTML = discHtml;
    this._wire(gt, war, snap, local);
  };

  OnboardingUI.prototype._wire = function (gt, war, snap, local) {
    var self = this;
    function q(sel) {
      return self.mainEl.querySelector(sel);
    }

    self.mainEl.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        if (act === 'next') {
          self._post('next').then(function () {
            self.render();
          });
        } else if (act === 'resume') {
          self._post('resume').then(function () {
            self.render();
          });
        } else if (act === 'refresh-faction') {
          self._post('refresh').then(function () {
            self.render();
          });
        } else if (act === 'refresh-step2') {
          self._post('refresh').then(function () {
            self.render();
          });
        } else if (act === 'start-demo') {
          local.gameSub = 'playing';
          self.render();
          var shell = q('[data-game-shell]');
          if (shell) {
            self._local.demoDestroy = runReactionDemo(shell, function (res) {
              self._local.lastDemo = { score: res.score, max: res.max };
              self._local.gameSub = 'afterDemo';
              self.render();
            });
          }
        } else if (act === 'demo-continue') {
          if (snap.step === 2) {
            self._post('refresh').then(function () {
              self._local.gameSub = null;
              self.render();
            });
          } else {
            self._local.replayMode = null;
            self.render();
          }
        } else if (act === 'replay-demo') {
          self._local.replayMode = 'playing';
          self.render();
          var shellR = q('[data-game-shell]');
          if (shellR) {
            self._local.demoDestroy = runReactionDemo(shellR, function (res) {
              self._local.lastDemo = { score: res.score, max: res.max };
              self._local.replayMode = 'after';
              self.render();
            });
          }
        } else if (act === 'war-tip') {
          self.discordEl.innerHTML =
            '<p class="pb-ob-discord-title">Discord</p>' +
            discordBlock(['/faction_challenge join', 'Only enrolled + allowed /playgame tags count.'], ['Join']);
        } else if (act === 'finish-ui') {
          self.hide();
          var dash = document.getElementById('dashboard');
          if (dash) dash.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (act === 'noop-war') {
          global.alert('Run the same action in your Discord server with the bot.');
        } else if (act === 'faction-continue') {
          self._post('next').then(function () {
            self.render();
          });
        }
      });
    });

    self.mainEl.querySelectorAll('[data-faction]').forEach(function (card) {
      card.addEventListener('click', function () {
        var name = card.getAttribute('data-faction');
        local.selectedFaction = name;
        var cmd = '/faction join name:' + name;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(cmd).catch(function () {});
        }
        self.render();
      });
    });

    self.mainEl.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var t = btn.getAttribute('data-copy');
        if (t && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(function () {
            var o = btn.textContent;
            btn.textContent = 'Copied';
            setTimeout(function () {
              btn.textContent = o;
            }, 1400);
          });
        }
      });
    });
  };

  function init(opts) {
    var ui = new OnboardingUI(opts);
    return ui;
  }

  function syncFromPage(cfg) {
    var ob = cfg.me && cfg.me.onboarding;
    if (!ob || !cfg.overlay) return null;
    var ui = init({
      overlay: cfg.overlay,
      launcher: cfg.launcher,
      onboardingPost: cfg.onboardingPost,
      getGamesToday: function () {
        return cfg.gamesToday || {};
      },
      getProfile: function () {
        return (cfg.me && cfg.me.profile) || {};
      },
      snapshot: ob,
      onClose: cfg.onClose || function () {},
    });
    ui.setGamesToday(cfg.gamesToday || {});
    ui.setProfile((cfg.me && cfg.me.profile) || {});
    var needsTour = !ob.complete && (ob.active || ob.skipped);
    if (needsTour && cfg.launcher) {
      cfg.launcher.classList.remove('hidden');
    } else if (cfg.launcher) {
      cfg.launcher.classList.add('hidden');
    }
    if (ob.active && !ob.complete) {
      try {
        if (!sessionStorage.getItem('pb_ob_dismissed')) {
          ui.show();
        }
      } catch (e) {
        ui.show();
      }
    }
    var openBtn = cfg.launcher && cfg.launcher.querySelector('[data-open-ob]');
    if (openBtn) {
      openBtn.addEventListener('click', function () {
        try {
          sessionStorage.removeItem('pb_ob_dismissed');
        } catch (e2) {}
        ui.show();
      });
    }
    return ui;
  }

  global.PBOnboardingUI = { init: init, syncFromPage: syncFromPage };
})(typeof window !== 'undefined' ? window : this);

