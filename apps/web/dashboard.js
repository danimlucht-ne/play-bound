/* ── PlayBound Web Dashboard ── */
/* My Dashboard: stats, multi-server factions, achievements, shop browser, premium/boost cards.
   Server admin lives only in index.html admin drawer. */
(function pbDashboard() {
  'use strict';

  var meta = document.querySelector('meta[name="playbound-api"]');
  var API = (meta && meta.getAttribute('content') ? meta.getAttribute('content').trim() : '').replace(/\/$/, '');

  function apiUrl(p) { return API + p; }
  async function apiFetch(p, o) {
    return fetch(apiUrl(p), Object.assign({ credentials: 'include' }, o || {}));
  }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Format helpers ── */
  function statsFormat(n, m) {
    return esc(String(n)) + ' wins across ' + esc(String(m)) + ' server' + (m !== 1 ? 's' : '');
  }

  // Known color hex values for shop color items
  var COLOR_HEX_MAP = {
    'Crystal Name Color': '#AEEEEE', 'Golden Name Color': '#FFD700',
    'Crimson': '#DC143C', 'Ocean Blue': '#1E90FF', 'Forest Green': '#228B22',
    'Royal Purple': '#6A0DAD', 'Sunset Orange': '#FF6347', 'Mint Fresh': '#98FF98',
    'Rose Pink': '#FF69B4', 'Midnight': '#191970', 'Lavender': '#E6E6FA',
    'Amber Glow': '#FFBF00', 'Emerald City': '#50C878', 'Cherry': '#DE3163',
    'Slate Gray': '#708090', 'Coral Reef': '#FF7F50', 'Ice Blue': '#AFEEEE',
    'Wine': '#722F37', 'Lemon Zest': '#FFFACD', 'Neon Magenta': '#FF00FF',
    'Steel Blue': '#4682B4', 'War Garnet': '#8B1538', 'Arcade Teal': '#008B8B',
    'Rotation Violet': '#5D3FD3',
    // Legacy aliases
    'Gold': '#FFD700', 'Silver': '#C0C0C0', 'Teal': '#008080',
    'Coral': '#FF7F50', 'Sky': '#87CEEB', 'Peach': '#FFDAB9',
    'Mint': '#98FF98', 'Rose Gold': '#B76E79', 'Electric Lime': '#CCFF00',
  };

  function shopItemHtml(item, isPremiumUser) {
    var owned = item.owned ? '<span class="pb-dash-badge pb-dash-badge--owned">Owned</span>' : '';
    var equipped = item.equipped ? '<span class="pb-dash-badge pb-dash-badge--equipped">Equipped</span>' : '';
    var premBadge = '';
    if (item.premiumOnly) {
      premBadge = isPremiumUser
        ? '<span class="pb-dash-badge pb-dash-badge--premium">Premium</span>'
        : '<span class="pb-dash-badge pb-dash-badge--locked">\ud83d\udd12 Premium Only</span>';
    }
    var colorSwatch = '';
    if (item.type === 'color') {
      var hex = item.colorHex || COLOR_HEX_MAP[item.name] || null;
      if (hex) {
        colorSwatch = '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:' + esc(hex) + ';border:1px solid rgba(255,255,255,0.2);vertical-align:middle;margin-right:0.35rem;"></span>';
      }
    }
    var cls = 'pb-dash-shop-item' + (item.premiumOnly ? ' pb-dash-shop-item--premium' : '');
    return '<div class="' + cls + '">' +
      '<div class="pb-dash-shop-item__head">' +
        '<strong>' + colorSwatch + esc(item.name) + '</strong>' +
        '<span class="pb-dash-shop-price">' + esc(String(item.price)) + ' credits</span>' +
      '</div>' +
      '<div class="pb-dash-shop-item__desc">' + esc(item.desc) + '</div>' +
      '<div class="pb-dash-shop-item__meta">' +
        '<span class="pb-dash-tag">' + esc(item.type) + '</span>' +
        premBadge + owned + equipped +
      '</div>' +
    '</div>';
  }

  /* ── Error + retry helper ── */
  function dashCardSkeleton() {
    return (
      '<div class="pb-dash-card pb-dash-card--skeleton" aria-hidden="true">' +
        '<div class="pb-dash-skel pb-dash-skel--title"></div>' +
        '<div class="pb-dash-skel"></div>' +
        '<div class="pb-dash-skel"></div>' +
        '<div class="pb-dash-skel pb-dash-skel--short"></div>' +
      '</div>'
    );
  }

  function errorRetryHtml(msg, retryFn) {
    var id = 'pb-retry-' + Math.random().toString(36).slice(2, 8);
    setTimeout(function () {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', retryFn);
    }, 0);
    return '<div class="pb-dash-error">' + esc(msg) + ' <button class="btn btn-ghost" id="' + id + '" style="font-size:0.78rem;padding:0.3rem 0.6rem;">Retry</button></div>';
  }

  /* ── Stats Card (Task 6.2) ── */
  async function loadStatsCard() {
    var el = document.getElementById('pb-dash-stats');
    if (!el) return;
    el.innerHTML = dashCardSkeleton();
    try {
      var r = await apiFetch('/api/me/stats');
      if (!r.ok) throw new Error('stats_failed');
      var d = await r.json();
      var gameTypes = [
        { key: 'trivia', label: 'Trivia' },
        { key: 'serverdle', label: 'Serverdle' },
        { key: 'unscramble', label: 'Unscramble' },
        { key: 'tune', label: 'Tune' },
        { key: 'caption', label: 'Caption' },
        { key: 'sprint', label: 'Sprint' },
        { key: 'guess', label: 'Guess' },
      ];
      var rows = gameTypes.map(function (g) {
        var n = d.perGame[g.key] || 0;
        var line = d.serverCount > 0 ? statsFormat(n, d.serverCount) : esc(String(n)) + ' wins';
        return '<div class="pb-dash-stat-row"><span>' + esc(g.label) + '</span><span>' + line + '</span></div>';
      }).join('');
      var totalW = Number(d.totalGamesWon || 0);
      var sc = Number(d.serverCount || 0);
      var emptyHint =
        totalW === 0 && sc === 0
          ? '<p class="muted pb-dash-empty-hint">No wins recorded yet — jump into a game in Discord, then refresh this tab. When you manage servers, open <strong>Admin</strong> from your account menu for server tools.</p>'
          : '';
      el.innerHTML =
        '<div class="pb-dash-card">' +
          '<h3>🏆 Game Stats</h3>' +
          emptyHint +
          '<div class="pb-dash-stat-total">Total games won: <strong>' + esc(String(d.totalGamesWon)) + '</strong></div>' +
          rows +
        '</div>';
    } catch (e) {
      el.innerHTML = errorRetryHtml('Could not load stats.', loadStatsCard);
    }
  }

  /* ── Faction Profile Card (Task 7.3) — one row per server enrollment ── */
  async function loadFactionCard() {
    var el = document.getElementById('pb-dash-faction');
    if (!el) return;
    el.innerHTML = dashCardSkeleton();
    try {
      var r = await apiFetch('/api/me/faction');
      if (!r.ok) throw new Error('faction_failed');
      var d = await r.json();
      var rows = (d.factions && d.factions.length)
        ? d.factions
        : (d.faction
          ? [{ guildId: '', name: d.faction.name, emoji: d.faction.emoji, matchPoints: d.faction.matchPoints, rank: d.faction.rank }]
          : []);
      if (!rows.length) {
        el.innerHTML = '<div class="pb-dash-card"><h3>⚔️ Factions</h3><p class="muted">You haven\'t joined a faction yet. Use <code>/faction join</code> in Discord to pick a team.</p></div>';
        return;
      }
      var wars = (d.recentWars || []).slice(0, 5).map(function (w) {
        var result = w.winnerFaction === w.userFaction ? '✅ Won' : (w.winnerFaction ? '❌ Lost' : '➖ Tie');
        return '<div class="pb-dash-stat-row"><span>' + result + ' vs ' + esc(w.winnerFaction || 'Tie') + '</span><span class="muted">' + (w.endedAt ? new Date(w.endedAt).toLocaleDateString() : '') + '</span></div>';
      }).join('');
      var blocks = rows.map(function (f, i) {
        var sep = i > 0 ? '<hr style="border:none;border-top:1px solid var(--border);margin:0.75rem 0;">' : '';
        var gid = f.guildId ? '<code style="font-size:0.72rem;">' + esc(String(f.guildId)) + '</code>' : '<span class="muted">—</span>';
        return sep +
          '<div class="pb-dash-stat-row"><span>Discord server</span><span>' + gid + '</span></div>' +
          '<div class="pb-dash-stat-row"><span>Team</span><span>' + esc(f.emoji) + ' <strong>' + esc(f.name) + '</strong></span></div>' +
          '<div class="pb-dash-stat-row"><span>Match points (global)</span><span><strong>' + esc(String(f.matchPoints != null ? f.matchPoints : 0)) + '</strong></span></div>' +
          '<div class="pb-dash-stat-row"><span>Global rank</span><span>#' + esc(String(f.rank != null ? f.rank : '—')) + '</span></div>';
      }).join('');
      el.innerHTML =
        '<div class="pb-dash-card">' +
          '<h3>⚔️ Factions</h3>' +
          '<p class="muted" style="font-size:0.76rem;margin-bottom:0.5rem;">Per-server enrollment. Official names (Phoenixes / Unicorns / Fireflies / Dragons / Wolves / Eagles) share one worldwide board.</p>' +
          blocks +
          '<div class="pb-dash-stat-row" style="margin-top:0.65rem;"><span>Wars (all servers)</span><span>' + esc(String(d.warCount != null ? d.warCount : 0)) + '</span></div>' +
          (wars ? '<h4 style="margin-top:0.75rem;font-size:0.82rem;">Recent wars</h4>' + wars : '') +
        '</div>';
    } catch (e) {
      el.innerHTML = errorRetryHtml('Could not load faction data.', loadFactionCard);
    }
  }

  /* ── Achievement Showcase (Task 7.4) ── */
  async function loadAchievements() {
    var el = document.getElementById('pb-dash-achievements');
    if (!el) return;
    el.innerHTML = dashCardSkeleton();
    try {
      var r = await apiFetch('/api/me/achievements');
      if (!r.ok) throw new Error('ach_failed');
      var d = await r.json();
      if (!d.achievements || !d.achievements.length) {
        el.innerHTML = '<div class="pb-dash-card"><h3>🏅 Achievements</h3><p class="muted">No achievements earned yet. Play games in Discord to unlock them.</p></div>';
        return;
      }
      var rows = d.achievements.map(function (a) {
        return '<div class="pb-dash-stat-row"><span><strong>' + esc(a.name) + '</strong></span><span class="muted">' + esc(a.desc || '') + '</span></div>';
      }).join('');
      el.innerHTML = '<div class="pb-dash-card"><h3>🏅 Achievements (' + d.achievements.length + ')</h3>' + rows + '</div>';
    } catch (e) {
      el.innerHTML = errorRetryHtml('Could not load achievements.', loadAchievements);
    }
  }

  /* ── Shop Browser (Task 7.1) ── */
  var shopGuildId = null;
  var shopIsPremium = false;

  async function loadShopBrowser() {
    var el = document.getElementById('pb-dash-shop');
    if (!el) return;
    el.innerHTML = dashCardSkeleton();
    try {
      var url = '/api/shop' + (shopGuildId ? '?guildId=' + encodeURIComponent(shopGuildId) : '');
      var r = await apiFetch(url);
      if (!r.ok) throw new Error('shop_failed');
      var d = await r.json();
      var items = d.items || [];
      if (!items.length) {
        el.innerHTML = '<div class="pb-dash-card"><h3>🛒 Shop</h3><p class="muted">No items available.</p></div>';
        return;
      }
      var groups = {};
      items.forEach(function (it) {
        var t = it.type || 'other';
        if (!groups[t]) groups[t] = [];
        groups[t].push(it);
      });
      var html = '<div class="pb-dash-card"><h3>\ud83d\uded2 Shop</h3>';
      html += '<div id="pb-dash-shop-server-select" style="margin-bottom:0.75rem;"></div>';
      var typeOrder = ['consumable', 'cosmetic', 'badge', 'color', 'role'];
      var typeLabels = { consumable: 'Consumables', cosmetic: 'Cosmetics', badge: 'Badges', color: 'Name Colors', role: 'Roles' };
      var accordionId = 0;
      function renderAccordion(label, arr) {
        accordionId++;
        var id = 'pb-shop-acc-' + accordionId;
        html += '<details class="pb-dash-shop-accordion">';
        html += '<summary class="pb-dash-shop-accordion__head">' + esc(label) + ' <span class="muted">(' + arr.length + ')</span></summary>';
        html += '<div class="pb-dash-shop-grid">';
        arr.forEach(function (it) { html += shopItemHtml(it, shopIsPremium); });
        html += '</div></details>';
      }
      typeOrder.forEach(function (type) {
        var arr = groups[type];
        if (!arr || !arr.length) return;
        renderAccordion(typeLabels[type] || type, arr);
      });
      Object.keys(groups).forEach(function (type) {
        if (typeOrder.indexOf(type) >= 0) return;
        var arr = groups[type];
        renderAccordion(type, arr);
      });
      html += '</div>';
      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = errorRetryHtml('Could not load shop.', loadShopBrowser);
    }
  }

  /* ── Premium Status Card (Task 8.1) ── */
  function renderPremiumCard(profile, publicConfig) {
    var el = document.getElementById('pb-dash-premium');
    if (!el) return;
    var isPremium = profile && profile.isPremium;
    if (isPremium) {
      var src = profile.premiumSource ? ' (' + esc(profile.premiumSource) + ')' : '';
      el.innerHTML =
        '<div class="pb-dash-card pb-dash-card--premium">' +
          '<h3>⭐ Premium Active' + src + '</h3>' +
          '<ul class="pb-dash-perks">' +
            '<li>2x point multiplier</li>' +
            '<li>Extended streak cap (+12)</li>' +
            '<li>Faction switch ability</li>' +
            '<li>Automation access</li>' +
          '</ul>' +
        '</div>';
    } else {
      var mUrl = publicConfig && publicConfig.premiumMonthlyUrl ? publicConfig.premiumMonthlyUrl : '#';
      var yUrl = publicConfig && publicConfig.premiumYearlyUrl ? publicConfig.premiumYearlyUrl : '#';
      el.innerHTML =
        '<div class="pb-dash-card">' +
          '<h3>⭐ Premium</h3>' +
          '<p class="muted">Unlock 2x multiplier, extended streaks, faction switching, and automation.</p>' +
          '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;">' +
            '<a href="' + esc(mUrl) + '" class="btn btn-primary" target="_blank" rel="noopener" style="font-size:0.8rem;padding:0.4rem 0.8rem;">Monthly</a>' +
            '<a href="' + esc(yUrl) + '" class="btn btn-secondary" target="_blank" rel="noopener" style="font-size:0.8rem;padding:0.4rem 0.8rem;">Yearly</a>' +
          '</div>' +
        '</div>';
    }
    shopIsPremium = !!isPremium;
  }

  /* ── Boost History (Task 9.7) ── */
  function renderBoostHistory(el, profile) {
    if (!el) return;
    if (!profile || !profile.isPremium) {
      el.innerHTML = '';
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML =
      '<div class="pb-dash-card">' +
        '<h3>🚀 Boost History</h3>' +
        '<p class="muted">No boost sessions recorded yet. Activate a premium aura boost during a game to see history here.</p>' +
      '</div>';
  }

  var dashboardLoaded = false;
  var dashInitPayload = null;
  var dashLoaded = { stats: false, faction: false, achievements: false, shop: false, premium: false };

  function ensureDashTabLoaded(tab) {
    if (!dashboardLoaded || !dashInitPayload) return;
    var pay = dashInitPayload;
    var prof = pay.me && pay.me.profile;
    var cfg = pay.cfg || {};
    switch (tab) {
      case 'stats':
        if (!dashLoaded.stats) {
          dashLoaded.stats = true;
          loadStatsCard();
        }
        return;
      case 'faction':
        if (!dashLoaded.faction) {
          dashLoaded.faction = true;
          loadFactionCard();
        }
        return;
      case 'achievements':
        if (!dashLoaded.achievements) {
          dashLoaded.achievements = true;
          loadAchievements();
        }
        return;
      case 'shop':
        shopIsPremium = !!(prof && prof.isPremium);
        if (!dashLoaded.shop) {
          dashLoaded.shop = true;
          loadShopBrowser();
        }
        return;
      case 'premium':
        if (!dashLoaded.premium) {
          dashLoaded.premium = true;
          renderPremiumCard(prof, cfg);
          renderBoostHistory(document.getElementById('pb-dash-boost'), prof);
        }
        return;
      default:
        return;
    }
  }

  /* ── Dashboard section tabs (Stats / Faction / …) ── */
  var dashTabCurrent = 'stats';
  var dashResizeTimer = null;

  function dashDualNarrow() {
    try {
      return window.matchMedia('(max-width: 768px)').matches;
    } catch (e) {
      return false;
    }
  }

  function dashTabFromHash() {
    try {
      var h = window.location.hash || '';
      if (h.indexOf('#dashboard') !== 0) return 'stats';
      var rest = h.length > 10 ? h.slice(10) : '';
      var slug = 'stats';
      if (rest.charAt(0) === '-') {
        slug = rest.slice(1).replace(/[^a-z-]/g, '') || 'stats';
      }
      var ok = { stats: 1, faction: 1, achievements: 1, shop: 1, premium: 1 };
      return ok[slug] ? slug : 'stats';
    } catch (e2) {
      return 'stats';
    }
  }

  function applyDashPanelDisplay(root, tab) {
    var t = tab || 'stats';
    var narrow = dashDualNarrow();
    root.querySelectorAll('.pb-dash-tab-panel').forEach(function (p) {
      var on = p.id === 'pb-dash-tab-' + t;
      p.classList.toggle('active', on);
      if (on) {
        p.removeAttribute('hidden');
        p.style.setProperty('display', 'grid', 'important');
        p.style.setProperty('gap', '1rem', 'important');
        if (p.classList.contains('pb-dash-tab-panel--dual')) {
          p.style.setProperty('grid-template-columns', narrow ? '1fr' : '1fr 1fr', 'important');
        } else {
          p.style.setProperty('grid-template-columns', '1fr', 'important');
        }
      } else {
        p.setAttribute('hidden', '');
        p.style.setProperty('display', 'none', 'important');
        p.style.removeProperty('gap');
        p.style.removeProperty('grid-template-columns');
      }
    });
  }

  function switchDashboardTab(tab) {
    var root = document.getElementById('pb-dash-detail-grid');
    if (!root) return;
    var t = tab || 'stats';
    dashTabCurrent = t;
    root.querySelectorAll('.pb-dash-tabs button[data-dash-tab]').forEach(function (b) {
      var on = b.getAttribute('data-dash-tab') === t;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    applyDashPanelDisplay(root, t);
    if (dashboardLoaded) ensureDashTabLoaded(t);
  }

  function setupDashboardTabs() {
    var root = document.getElementById('pb-dash-detail-grid');
    if (!root || root.dataset.pbDashTabsInit === '1') return;
    root.dataset.pbDashTabsInit = '1';
    root.querySelectorAll('.pb-dash-tabs button[data-dash-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-dash-tab');
        switchDashboardTab(tab);
        try {
          var next = tab === 'stats' ? '#dashboard' : '#dashboard-' + tab;
          if (window.location.hash !== next && history.replaceState) {
            history.replaceState(null, '', next);
          }
        } catch (e) { /* ignore */ }
      });
    });
    var copyL = document.getElementById('btn-copy-dash-link');
    if (copyL && !copyL.dataset.pbInit) {
      copyL.dataset.pbInit = '1';
      copyL.addEventListener('click', function () {
        var tab = dashTabCurrent || 'stats';
        var hash = tab === 'stats' ? '#dashboard' : '#dashboard-' + tab;
        var url = '';
        try {
          url = window.location.origin + window.location.pathname + window.location.search + hash;
        } catch (e2) {
          url = hash;
        }
        function done(ok) {
          copyL.textContent = ok ? 'Copied!' : 'Copy failed';
          setTimeout(function () {
            copyL.textContent = 'Copy link to this tab';
          }, 2000);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () { done(true); }).catch(function () { done(false); });
        } else {
          done(false);
        }
      });
    }
    if (!window.__pbDashResizeBound) {
      window.__pbDashResizeBound = 1;
      window.addEventListener('resize', function () {
        if (dashResizeTimer) clearTimeout(dashResizeTimer);
        dashResizeTimer = setTimeout(function () {
          var r = document.getElementById('pb-dash-detail-grid');
          if (r) applyDashPanelDisplay(r, dashTabCurrent);
        }, 120);
      });
    }
  }

  /* ── Main init ── */
  function initDashboard(meData, publicConfig) {
    if (dashboardLoaded) return;
    dashboardLoaded = true;

    dashInitPayload = { me: meData, cfg: publicConfig || {} };

    setupDashboardTabs();
    /* Only fetch/render the active tab; others stay empty until opened (avoids a wall of cards if CSS is ignored). */
    ensureDashTabLoaded(dashTabCurrent);
  }

  /* ── Expose for main script ── */
  window.pbDashboard = {
    init: initDashboard,
    loadStatsCard: loadStatsCard,
    loadFactionCard: loadFactionCard,
    loadAchievements: loadAchievements,
    loadShopBrowser: loadShopBrowser,
    statsFormat: statsFormat,
    setShopGuildId: function (id) { shopGuildId = id; },
    switchTab: switchDashboardTab,
  };

  /* Wire tabs as soon as the script runs; inline display:!important survives conflicting site CSS on CDN deploys. */
  (function bootDashTabs() {
    var root = document.getElementById('pb-dash-detail-grid');
    if (!root) return;
    setupDashboardTabs();
    switchDashboardTab(dashTabFromHash());
  })();
})();
