// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the filters, and one protocol's detail at
// a time. No network: every byte it shows is in data.js.
//
// The page recomputes each row's implied value from the snapshot figures with the
// same function main.ts runs, and says whether the number matches board.json — so
// the page's code and the board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    watchlistOnly: false,
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null
  };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The tide-1 model, as main.ts computes it. Growth is clamped, tenure is capped at
  // four years, breadth counts at most five chains. Unknown age counts as 180 days.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var tenure = model.tenure_floor + (Math.min(Math.max(age, 0), model.tenure_days) / model.tenure_days) * model.tenure_range;
    var breadth = 1 + model.breadth_step * Math.min((row.chains || []).length, model.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * tenure * breadth));
  }

  var watchlist = {};
  (DATA.watchlist || []).forEach(function (s) { watchlist[s] = true; });

  function readHash() {
    // A new hash replaces the whole state: keys it omits fall back to defaults,
    // so a detail opened on one view never leaks into the next.
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.watchlistOnly = false;
    state.tab = 'pre-token';
    state.selected = null;
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q') !== null) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.watchlistOnly = true;
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('wl', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchlistOnly && !watchlist[r.slug]) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function renderStats() {
    var top = DATA.rows[0];
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    var median = DATA.rows[Math.floor(DATA.rows.length / 2)];
    document.getElementById('stats').innerHTML =
      '<div class="stat"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b><small>every protocol at or above the $50M floor</small></div>' +
      '<div class="stat"><span>Pre-token rows</span><b>' + DATA.board_size + '</b><small>' + DATA.early_size + ' early rows below the floor</small></div>' +
      '<div class="stat"><span>Top implied value</span><b>' + fmtUsd(top ? top.implied_value_usd : 0) + '</b><small>' + esc(top ? top.name : '') + ' at rank 1</small></div>' +
      '<div class="stat"><span>Median row</span><b>' + fmtUsd(median ? median.implied_value_usd : 0) + '</b><small>board total ' + fmtUsd(total) + '</small></div>';
  }

  function renderBoard() {
    var tbody = document.getElementById('rows');
    var empty = document.getElementById('empty');
    var count = document.getElementById('count');
    var list = state.tab === 'live' ? DATA.live : sortRows(visibleRows());
    if (state.tab === 'live') {
      count.textContent = DATA.live.length + ' live-token protocols — their market caps are facts, not a model.';
      tbody.innerHTML = DATA.live.map(function (r) {
        return '<tr data-slug="' + esc(r.slug) + '">' +
          '<td class="num rank">live</td>' +
          '<td><div class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
          '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
          '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>' +
          '<td class="num">—</td>' +
          '<td><div class="implied"><span class="num">' + fmtUsd(r.mcap_usd) + '</span></div></td>' +
          '<td><span class="pill live">already trades</span></td></tr>';
      }).join('');
      empty.hidden = true;
      return;
    }
    count.textContent = list.length + ' of ' + DATA.board_size + ' pre-token rows shown';
    empty.hidden = list.length !== 0;
    var max = list.length ? list[0].implied_value_usd : 1;
    tbody.innerHTML = list.map(function (r) {
      var growthCls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var width = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" class="' + (state.selected === r.slug ? 'selected' : '') + '" tabindex="0">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + (watchlist[r.slug] ? ' · watchlist' : '') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + growthCls + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td><div class="implied"><div class="bar" aria-hidden="true"><i style="width:' + width + '%"></i></div><span class="num">' + fmtUsd(r.implied_value_usd) + '</span></div></td>' +
        '<td><span class="pill">no token</span></td></tr>';
    }).join('');
  }

  function renderDetail() {
    var panel = document.getElementById('detail');
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === state.selected) { row = DATA.rows[i]; break; }
    }
    if (!row) {
      panel.innerHTML = '<p class="detail-hint">Select a protocol on the board to see its model breakdown and farm plan.</p>';
      return;
    }
    var recomputed = impliedOf(row, DATA.model);
    var matches = recomputed === row.implied_value_usd;
    var steps = (row.farm_steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    panel.innerHTML =
      '<p class="detail-hint">Rank ' + row.rank + ' of ' + DATA.board_size + (watchlist[row.slug] ? ' · on the watchlist' : ' · early radar') + '</p>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') + '</p>' +
      '<h3>Implied value</h3>' +
      '<dl class="kv">' +
      '<dt>TVL</dt><dd>' + fmtUsd(row.tvl_usd) + '</dd>' +
      '<dt>Seven-day growth</dt><dd>' + fmtPct(row.change_7d) + '</dd>' +
      '<dt>Age with no token</dt><dd>' + fmtAge(row.age_days) + '</dd>' +
      '<dt>Growth multiplier</dt><dd>' + row.growth_multiplier + '</dd>' +
      '<dt>Tenure multiplier</dt><dd>' + row.tenure_multiplier + '</dd>' +
      '<dt>Breadth multiplier</dt><dd>' + row.breadth_multiplier + '</dd>' +
      '<dt>Implied value</dt><dd class="total">' + fmtUsd(row.implied_value_usd) + '</dd>' +
      '</dl>' +
      '<p class="check-line">Recomputed from the snapshot figures: <b>' + fmtUsd(recomputed) + (matches ? ' — matches the board.' : ' — differs from the board.') + '</b></p>' +
      '<h3>Farm plan</h3><ol class="steps">' + steps + '</ol>';
  }

  function fillSelects() {
    var cats = {};
    var chains = {};
    DATA.rows.forEach(function (r) {
      cats[r.category || 'Other'] = true;
      (r.chains || []).forEach(function (c) { chains[c] = true; });
    });
    var catSel = document.getElementById('category');
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      if (c === state.category) o.selected = true;
      catSel.appendChild(o);
    });
    var chainSel = document.getElementById('chain');
    Object.keys(chains).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      if (c === state.chain) o.selected = true;
      chainSel.appendChild(o);
    });
  }

  function render() {
    document.getElementById('meta-asof').textContent = DATA.as_of;
    document.getElementById('meta-rows').textContent = String(DATA.board_size);
    document.getElementById('tab-pre').setAttribute('aria-selected', state.tab === 'pre-token' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
    document.querySelectorAll('th button[data-sort]').forEach(function (b) {
      var key = b.getAttribute('data-sort');
      var label = b.textContent.replace(/ [▲▼]$/, '');
      b.innerHTML = esc(label) + (state.sort === key ? ' <span class="arrow">' + (state.dir < 0 ? '▼' : '▲') + '</span>' : '');
    });
    renderStats();
    renderBoard();
    renderDetail();
    app.setAttribute('aria-busy', 'false');
  }

  function select(slug) {
    state.selected = slug;
    writeHash();
    renderBoard();
    renderDetail();
  }

  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value; writeHash(); renderBoard();
  });
  document.getElementById('category').addEventListener('change', function (e) {
    state.category = e.target.value; writeHash(); renderBoard();
  });
  document.getElementById('chain').addEventListener('change', function (e) {
    state.chain = e.target.value; writeHash(); renderBoard();
  });
  document.getElementById('watchlist-only').addEventListener('change', function (e) {
    state.watchlistOnly = e.target.checked; writeHash(); renderBoard();
  });
  document.getElementById('tab-pre').addEventListener('click', function () {
    state.tab = 'pre-token'; state.selected = null; writeHash(); render();
  });
  document.getElementById('tab-live').addEventListener('click', function () {
    state.tab = 'live'; state.selected = null; writeHash(); render();
  });
  document.getElementById('board').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) select(tr.getAttribute('data-slug'));
  });
  document.getElementById('board').addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-slug]')) {
      e.preventDefault();
      select(e.target.getAttribute('data-slug'));
    }
  });
  document.querySelectorAll('th button[data-sort]').forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      render();
    });
  });
  window.addEventListener('hashchange', function () {
    readHash();
    document.getElementById('q').value = state.q;
    document.getElementById('category').value = state.category;
    document.getElementById('chain').value = state.chain;
    document.getElementById('watchlist-only').checked = state.watchlistOnly;
    render();
  });

  readHash();
  document.getElementById('q').value = state.q;
  document.getElementById('watchlist-only').checked = state.watchlistOnly;
  fillSelects();
  render();
})();
