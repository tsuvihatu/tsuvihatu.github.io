/*
 * bg-lattice.js — decorative background for shirotamiya.com
 *
 * A faint qubit lattice sits behind the page. Once in a while (about once a minute) a
 * slow decoding round plays out in the side margins: syndromes light up, they
 * are paired by minimum-weight perfect matching (MWPM), and each pair is
 * joined by a shortest lattice path that creeps from one syndrome to the
 * other, one pair at a time. The left and right edges of the screen are
 * identified (like a torus), so a pair can also be joined through the screen
 * edge when that is shorter.
 *
 * Kept light on purpose:
 *   - the lattice is a single CSS background (no canvas);
 *   - each round is a tiny SVG animated only with CSS and removed afterwards;
 *   - no per-frame JavaScript; between rounds nothing runs at all;
 *   - paused in background tabs; static dots only with prefers-reduced-motion.
 *
 * To turn it off, delete the line near the end of index.html that loads bg-lattice.js.
 */
(function () {
  'use strict';

  /* ---------- settings ---------- */
  var S = 34;                               /* lattice spacing (px) */
  var MAX_LIT = 4;                          /* at most this many syndromes on screen at once */
  var PATTERNS = [                          /* [name, number of syndromes, relative frequency] */
    ['near',  2, 30],                       /* a nearby pair in one margin */
    ['far',   2, 15],                       /* a distant pair in one margin */
    ['torus', 2, 20],                       /* one in each margin, joined through the screen edge */
    ['both',  4, 20],                       /* two in each margin (2 + 2) */
    ['side',  4, 15]                        /* two pairs in the same margin */
  ];

  /* tempo (ms) — deliberately slow, so it never pulls the eye away from the text:
     the syndromes surface, everything holds still for a while, a line creeps
     across and slows down just before it arrives, a long fade, and then a
     long quiet before the next round */
  var APPEAR  = 3500;                       /* syndromes fade in */
  var PAUSE   = 4000;                       /* stillness after all syndromes are lit, before the first line leaves */
  var WAKE    = 900;                        /* the starting syndrome brightens this long before its line leaves */
  var LINE    = 6000;                       /* every line takes this long, short or long */
  var BETWEEN = 3000;                       /* quiet after a pair connects, before the next line leaves */
  var HOLD    = 3500;                       /* a connected pair stays lit this long ... */
  var FADE    = 4500;                       /* ... then fades out over this long */
  var NEXT    = [15000, 30000];             /* quiet time after a round has fully faded, before the next one */
  var START   = 6000;                       /* the first round, after the page opens */
  var EASE      = 'cubic-bezier(.55,0,.2,1)';   /* slow start, slower arrival */
  var EASE_EXIT = 'cubic-bezier(.55,0,1,1)';    /* through the edge: first half speeds up out of the screen ... */
  var EASE_BACK = 'cubic-bezier(0,0,.2,1)';     /* ... second half comes back in and slows into the target */

  /* ---------- styles ---------- */
  /* visibility profile: 35% behind the text column, 100% in the side margins */
  var MASK = 'linear-gradient(to right, #000 0, #000 calc(50% - 660px), rgba(0,0,0,.35) calc(50% - 520px),' +
             ' rgba(0,0,0,.35) calc(50% + 520px), #000 calc(50% + 660px), #000 100%)';
  var CSS = [
    ':root { --bgl-dot: rgba(24,24,27,.11); --bgl-line: .22; --bgl-node: .45; --bgl-glow: .16; }',
    ':root[data-theme="dark"] { --bgl-dot: rgba(231,229,228,.085); --bgl-line: .28; --bgl-node: .55; --bgl-glow: .19; }',
    '#bg-lattice { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;',
    '  background: radial-gradient(circle at center, var(--bgl-dot) .9px, transparent 1.4px) 50% 0 / ' + S + 'px ' + S + 'px;',
    '  -webkit-mask-image: ' + MASK + '; mask-image: ' + MASK + '; }',
    'main.shell { position: relative; z-index: 1; }',
    '#bg-lattice svg { position: absolute; overflow: visible; }',
    /* a matched pair (its line and its two syndromes) fades out as one */
    '#bg-lattice .pr { animation: bgl-out ' + FADE + 'ms ease var(--out) forwards; }',
    '#bg-lattice .n { opacity: 0; animation: bgl-in ' + APPEAR + 'ms ease var(--d) forwards; }',
    '#bg-lattice .c { fill: var(--accent); fill-opacity: var(--bgl-node); }',
    /* the starting syndrome brightens a little just before its line sets off */
    '#bg-lattice .s .c { animation: bgl-core 1.6s ease-in-out var(--w); }',
    '#bg-lattice .g0 { stop-color: var(--accent); stop-opacity: var(--bgl-glow); }',
    '#bg-lattice .g1 { stop-color: var(--accent); stop-opacity: 0; }',
    '#bg-lattice .e { fill: none; stroke: var(--accent); stroke-opacity: var(--bgl-line); stroke-width: 1;',
    '  stroke-dasharray: 1; stroke-dashoffset: 1;',
    '  animation: bgl-draw var(--t) var(--ease, ease-in-out) var(--d) forwards; }',
    '@keyframes bgl-in { to { opacity: 1; } }',
    '@keyframes bgl-out { to { opacity: 0; } }',
    '@keyframes bgl-draw { to { stroke-dashoffset: 0; } }',
    '@keyframes bgl-core { 40% { fill-opacity: .85; } }',
    '@media print { #bg-lattice { display: none; } }'
  ].join('\n');

  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var box = document.createElement('div');
  box.id = 'bg-lattice';
  box.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(box, document.body.firstChild);

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* ---------- geometry ---------- */
  /* lattice point [i, j] sits at (W/2 + i*S, S/2 + j*S), matching the CSS background.
     The side margins are the columns aMin <= |i| <= imax. */
  var W = 0, H = 0, top = 90, imax = 0, aMin = 1, jmin = 0, jmax = 0;
  var lit = 0, timer = 0, uid = 0, gen = 0;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function irnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function X(p) { return W / 2 + p[0] * S; }
  function Y(p) { return S / 2 + p[1] * S; }
  function side() { return Math.random() < 0.5 ? -1 : 1; }
  function col(s, lo) { return s * irnd(lo || aMin, imax); }       /* a margin column on side s (-1 left, +1 right) */
  function onSide(s, i) { return s * i >= aMin && s * i <= imax; }
  function row() { return irnd(jmin, jmax); }
  function rowOK(j) { return j >= jmin && j <= jmax; }

  function measure() {
    W = box.clientWidth; H = box.clientHeight;
    var bar = document.querySelector('.top-bar-wrap');
    top = (bar ? bar.offsetHeight : 70) + 16;           /* keep rounds below the header */
    imax = Math.max(0, Math.floor((W / 2 - S) / S));
    aMin = Math.max(1, Math.min(imax - 2, Math.ceil(540 / S)));   /* narrow screens: the outer 3 columns */
    jmin = Math.ceil((top - S / 2) / S);
    jmax = Math.floor((H - 1.5 * S) / S);
  }

  /* distance on the screen-wide cylinder (left and right edges identified) */
  function wraps(p, q) { var dx = Math.abs(X(p) - X(q)); return W - dx < dx; }
  function tdist(p, q) {
    var dx = Math.abs(X(p) - X(q));
    return Math.min(dx, W - dx) + Math.abs(Y(p) - Y(q));
  }

  /* ---------- syndromes for each pattern ---------- */
  function nearPair(s, j0) {                            /* two syndromes 1-3 steps apart in margin s */
    for (var n = 0; n < 40; n++) {
      var a = [col(s), j0 === undefined ? row() : j0];
      var L = Math.random() < 0.6 ? 1 : irnd(2, 3), dx = irnd(-L, L);
      var b = [a[0] + dx, a[1] + (Math.random() < 0.5 ? -1 : 1) * (L - Math.abs(dx))];
      if (rowOK(a[1]) && rowOK(b[1]) && onSide(s, b[0])) return [a, b];
    }
    return null;
  }

  function syndromes(kind) {
    var s = side(), a, b, j, j2, p, q, n;
    if (kind === 'near') return nearPair(s);
    if (kind === 'far') {
      for (n = 0; n < 40; n++) {
        a = [col(s), row()];
        b = [col(s), a[1] + (Math.random() < 0.5 ? -1 : 1) * irnd(4, 8)];
        if (rowOK(b[1])) return [a, b];
      }
      return null;
    }
    if (kind === 'torus') {
      j = row(); b = j + irnd(-3, 3);
      return [[col(-1), j], [col(1), rowOK(b) ? b : j]];
    }
    if (kind === 'both') {
      if (Math.random() < 0.5) {                        /* a pair in each margin */
        p = nearPair(-1); q = nearPair(1);
        return p && q ? p.concat(q) : null;
      }
      /* near the edges with rows roughly aligned: MWPM may pair them through the edge */
      j = irnd(jmin, Math.max(jmin, jmax - 6)); j2 = j + irnd(3, 6);
      var outer = Math.max(aMin, imax - 1);
      var pts = [[col(-1, outer), j], [col(-1, outer), j2], [col(1, outer), j + irnd(-1, 1)], [col(1, outer), j2 + irnd(-1, 1)]];
      return pts.every(function (r) { return rowOK(r[1]); }) ? pts : null;
    }
    /* 'side': two pairs in the same margin */
    p = nearPair(s);
    for (n = 0; p && n < 30; n++) {
      q = nearPair(s, p[0][1] + irnd(-4, 4));
      if (q && distinct(p.concat(q))) return p.concat(q);
    }
    return null;
  }

  function distinct(pts) {
    var seen = {};
    return pts.every(function (p) { var k = p[0] + ',' + p[1]; if (seen[k]) return false; seen[k] = 1; return true; });
  }

  function mwpm(pts) {                                  /* minimum-weight perfect matching (<= 4 points: exhaustive) */
    var best = null, bestW = Infinity;
    (function rec(rest, pairs, w) {
      if (w >= bestW) return;
      if (!rest.length) { bestW = w; best = pairs.slice(); return; }
      for (var k = 1; k < rest.length; k++) {
        pairs.push([rest[0], rest[k]]);
        rec(rest.slice(1, k).concat(rest.slice(k + 1)), pairs, w + tdist(pts[rest[0]], pts[rest[k]]));
        pairs.pop();
      }
    })(pts.map(function (p, i) { return i; }), [], 0);
    return best;
  }

  /* ---------- the lines ---------- */
  function route(a, b) {                                /* a shortest lattice path a -> b, one or two bends */
    var p = a.slice(), path = [p.slice()];
    function go(axis, n) {
      for (var k = 0, s = n > 0 ? 1 : -1; k < Math.abs(n); k++) { p[axis] += s; path.push(p.slice()); }
    }
    var dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.random() < 0.5) { var h = Math.round(dy * rnd(0.25, 0.75)); go(1, h); go(0, dx); go(1, dy - h); }
    else { var v = Math.round(dx * rnd(0.25, 0.75)); go(0, v); go(1, dy); go(0, dx - v); }
    return path;
  }
  function edgeKeys(path) {
    var ks = [];
    for (var s = 1; s < path.length; s++) {
      var p = path[s - 1], q = path[s];
      ks.push(p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? p + '|' + q : q + '|' + p);
    }
    return ks;
  }
  function dedup(pts) {
    return pts.filter(function (p, k) { return !k || p[0] !== pts[k - 1][0] || p[1] !== pts[k - 1][1]; });
  }

  /* The line of a matched pair, as one or two pieces in px, running from the first
     syndrome to the second. Through the edge: out of the screen on the first one's
     side, back in on the second one's side. */
  function line(p, q, used) {
    if (!wraps(p, q)) {
      var best = null, fewest = Infinity;               /* of a few equally short routes, avoid the others */
      for (var n = 0; n < 6 && fewest > 0; n++) {
        var r = route(p, q), ov = 0;
        edgeKeys(r).forEach(function (k) { if (used[k]) ov++; });
        if (ov < fewest) { fewest = ov; best = r; }
      }
      edgeKeys(best).forEach(function (k) { used[k] = true; });
      return [best.map(function (r) { return [X(r), Y(r)]; })];
    }
    var P = [X(p), Y(p)], Q = [X(q), Y(q)], sp = P[0] < W / 2 ? -1 : 1;
    var out = sp < 0 ? -S : W + S, back = sp < 0 ? W + S : -S;
    function leg(x, s) {                                /* a lattice column between x and its screen edge */
      var room = Math.floor((s < 0 ? x : W - x) / S) - 1;
      return x + s * irnd(0, Math.max(0, room)) * S;
    }
    if (P[1] === Q[1]) return [[P, [out, P[1]]], [[back, Q[1]], Q]];
    if (Math.random() < 0.5) {                          /* the vertical step on p's side */
      var xv = leg(P[0], sp);
      return [dedup([P, [xv, P[1]], [xv, Q[1]], [out, Q[1]]]), [[back, Q[1]], Q]];
    }
    var xw = leg(Q[0], -sp);                            /* ... or on q's side */
    return [[P, [out, P[1]]], dedup([[back, P[1]], [xw, P[1]], [xw, Q[1]], Q])];
  }

  function length(pts) {
    var L = 0;
    for (var k = 1; k < pts.length; k++) L += Math.abs(pts[k][0] - pts[k - 1][0]) + Math.abs(pts[k][1] - pts[k - 1][1]);
    return L;
  }

  /* ---------- a round: syndromes, matching, and the timeline ---------- */
  function makeRound(room) {
    var kinds = PATTERNS.filter(function (k) { return k[1] <= room; });
    if (!kinds.length || imax < 3 || jmax - jmin < 8) return null;
    var total = 0, r;
    kinds.forEach(function (k) { total += k[2]; });
    r = Math.random() * total;
    var kind = kinds[0][0];
    for (var k = 0; k < kinds.length; k++) { r -= kinds[k][2]; if (r < 0) { kind = kinds[k][0]; break; } }

    var syn = syndromes(kind);
    if (!syn || !distinct(syn)) return null;
    var appear = syn.map(function (q, m) { return m === 0 ? 0 : Math.round(rnd(150, 1200)); });

    /* decode, then connect the matched pairs one at a time (in random order),
       each line leaving from a random one of its two syndromes */
    var used = {}, pairs = mwpm(syn).sort(function () { return Math.random() - 0.5; });
    var t = Math.max.apply(null, appear) + APPEAR + PAUSE, out = [];
    pairs.forEach(function (pr) {
      if (Math.random() < 0.5) pr = [pr[1], pr[0]];
      var pcs = line(syn[pr[0]], syn[pr[1]], used);
      var lens = pcs.map(length), sum = lens.reduce(function (a, b) { return a + b; }, 0);
      var D = LINE, t0 = t, pieces = [];
      pcs.forEach(function (pts, k) {
        var d = D * lens[k] / sum;
        pieces.push({ pts: pts, start: Math.round(t0), dur: Math.round(d),
                      ease: pcs.length === 1 ? EASE : k === 0 ? EASE_EXIT : EASE_BACK });
        t0 += d;
      });
      var conn = Math.round(t + D);
      out.push({
        from: pr[0], to: pr[1], pieces: pieces,
        wake: Math.round(t - WAKE), conn: conn, fade: conn + HOLD
      });
      t = conn + BETWEEN;
    });
    var lastFade = out[out.length - 1].fade;
    return { syn: syn, appear: appear, pairs: out, lastFade: lastFade, life: lastFade + FADE };
  }

  /* ---------- rendering: one small SVG per round, animated by CSS ---------- */
  function corners(path) {                              /* drop points in the middle of straight runs */
    return path.filter(function (p, k) {
      if (k === 0 || k === path.length - 1) return true;
      return (path[k - 1][0] === p[0]) !== (p[0] === path[k + 1][0]);
    });
  }

  function render(ev) {
    var pts = ev.syn.map(function (p) { return [X(p), Y(p)]; });
    ev.pairs.forEach(function (pr) { pr.pieces.forEach(function (pc) { pts = pts.concat(pc.pts); }); });
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; }), pad = 14;
    var left = Math.min.apply(null, xs) - pad, topPx = Math.min.apply(null, ys) - pad;
    var w = Math.max.apply(null, xs) - left + pad, h = Math.max.apply(null, ys) - topPx + pad;
    var id = 'bgl-g' + (++uid);
    var body = '<defs><radialGradient id="' + id + '"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></radialGradient></defs>';

    function node(m, wake) {                            /* wake: set only for the syndrome the line leaves from */
      var cx = X(ev.syn[m]) - left, cy = Y(ev.syn[m]) - topPx;
      return '<g class="n' + (wake === undefined ? '' : ' s') + '" style="--d:' + ev.appear[m] + 'ms' +
             (wake === undefined ? '' : ';--w:' + wake + 'ms') + '">' +
             '<circle class="h" cx="' + cx + '" cy="' + cy + '" r="10" fill="url(#' + id + ')"/>' +
             '<circle class="c" cx="' + cx + '" cy="' + cy + '" r="1.8"/></g>';
    }
    ev.pairs.forEach(function (pr) {
      body += '<g class="pr" style="--out:' + pr.fade + 'ms">';
      pr.pieces.forEach(function (pc) {
        var d = corners(pc.pts).map(function (p, k) { return (k ? 'L' : 'M') + (p[0] - left) + ' ' + (p[1] - topPx); }).join('');
        body += '<path class="e" pathLength="1" d="' + d + '" style="--d:' + pc.start + 'ms;--t:' + pc.dur + 'ms;--ease:' + pc.ease + '"/>';
      });
      body += node(pr.from, pr.wake) + node(pr.to) + '</g>';
    });

    var tmp = document.createElement('div');
    tmp.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
                    '" style="left:' + left + 'px;top:' + topPx + 'px">' + body + '</svg>';
    var svg = tmp.firstChild, g = gen;
    box.appendChild(svg);
    lit += ev.syn.length;
    ev.pairs.forEach(function (pr) {                    /* a pair stops counting once it has faded */
      setTimeout(function () { if (g === gen) lit -= 2; }, pr.fade + FADE);
    });
    setTimeout(function () { if (svg.parentNode) svg.parentNode.removeChild(svg); }, ev.life + 200);
  }

  /* ---------- scheduling (timers only; nothing runs between rounds) ---------- */
  function schedule(delay) { clearTimeout(timer); timer = setTimeout(spawn, delay); }
  function spawn() {
    timer = 0;
    if (document.hidden) return;
    var calmer = Math.min(2, Math.max(1, (1440 * 900) / Math.max(1, W * H)));  /* calmer on small screens */
    var room = MAX_LIT - lit, ev = room >= 2 ? makeRound(room) : null;
    if (!ev) { schedule(1500); return; }                /* no room (or no fit) yet: look again shortly */
    render(ev);
    schedule(ev.life + rnd(NEXT[0], NEXT[1]) * calmer);
  }

  measure();
  var lastW = W;
  window.addEventListener('resize', function () {
    measure();
    if (W !== lastW) {                                  /* rounds are laid out in px: start afresh */
      lastW = W; gen++;
      while (box.firstChild) box.removeChild(box.firstChild);
      lit = 0;
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(timer); timer = 0; }
    else if (!timer) schedule(START);
  });
  schedule(START);
})();
