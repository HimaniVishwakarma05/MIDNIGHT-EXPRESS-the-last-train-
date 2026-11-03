/* ============================================================
   MIDNIGHT EXPRESS – THE LAST TRAIN
   Vanilla JavaScript + HTML5 Canvas. Graphics are drawn in code and
   sounds are generated with the Web Audio API, so no asset files are needed.
   Sections: 1 Setup · 2 Input · 3 Sound · 4 Game state · 5 Game logic
             6 Drawing · 7 Buttons and main loop
   ============================================================ */

// ===== 1. SETUP =====
const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const HORIZON = 120;          // screen y of the vanishing point
const LANE_GAP = 190;         // distance between lane centres near the train
const TRAIN_T = 0.9;          // depth where the train sits (0 = far away, 1 = bottom of screen)
const TS = 1.15;              // train drawing scale
const BRAKE_COST = 35, BRAKE_TIME = 2, BRAKE_COOLDOWN = 1.5;
const C = { navy: '#10182c', charcoal: '#171b2d', gold: '#d6a74f', cyan: '#48d8e8', red: '#e74c5b', green: '#397d63' };
const HAZARDS = ['rock', 'broken', 'ghost'];
const isTouch = matchMedia('(pointer: coarse)').matches;
const stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * HORIZON * 0.9, r: Math.random() * 1.3 + 0.3, p: Math.random() * 6 }));
let state = 'menu';          // menu | howto | playing | paused | over
let soundOn = true;
let highScore = Number(localStorage.getItem('midnightHigh')) || 0;

// Perspective helpers: depth t (0 = horizon, 1 = bottom) -> screen position and size
const yAt = t => HORIZON + (H - HORIZON) * t;
const scaleAt = t => 0.25 + 0.75 * t;
const xAt = (lane, t) => W / 2 + lane * LANE_GAP * scaleAt(t);
const levelSpeed = lvl => 0.22 + 0.03 * (lvl - 1);   // depth units per second
const spawnGap = lvl => Math.max(0.65, 1.5 - 0.12 * (lvl - 1));
const rand = (a, b) => a + Math.random() * (b - a);
const trainX = () => xAt(game.laneX, TRAIN_T);
const trainBaseY = () => yAt(TRAIN_T);
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let game = newRun();

// ===== 2. INPUT =====
window.addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;                                       // ignore held-key repeats
  if (e.code === 'Enter' && state !== 'playing' && state !== 'paused') startGame();
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state === 'playing') pauseGame(); else resumeGame();
  }
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') moveTrain(-1);
  if (e.code === 'ArrowRight' || e.code === 'KeyD') moveTrain(1);
  if (e.code === 'Space') activateEmergencyBrake();
  if (e.code === 'KeyW') whistle();
});
const press = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); fn(); });
press('t-left', () => moveTrain(-1));
press('t-right', () => moveTrain(1));
press('t-brake', activateEmergencyBrake);

// Mouse and touch on the canvas: a swipe changes lanes; a tap on the left or right
// quarter moves the train; a tap in the middle whistles.
let tapStart = null;
canvas.addEventListener('pointerdown', e => { tapStart = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => {
  if (!tapStart || state !== 'playing') return;
  const dx = e.clientX - tapStart.x, dy = e.clientY - tapStart.y;
  const r = canvas.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) moveTrain(dx > 0 ? 1 : -1);
  else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
    if (fx < 0.25) moveTrain(-1);
    else if (fx > 0.75) moveTrain(1);
    else whistle();
  }
  tapStart = null;
});

// ===== 3. SOUND (Web Audio, generated in code) =====
let audioCtx = null, master = null, droneOn = false;
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    master = audioCtx.createGain();
    master.gain.value = soundOn ? 0.5 : 0;
    master.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (!droneOn) startDrone();
}
function startDrone() {                  // quiet low hum for the midnight ambience
  droneOn = true;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sine'; o.frequency.value = 55; g.gain.value = 0.05;
  o.connect(g); g.connect(master); o.start();
}
function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + delay;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur);
}
function noise(dur, vol, freq) {         // filtered noise burst for hiss and crash sounds
  if (!audioCtx) return;
  const len = Math.floor(audioCtx.sampleRate * dur);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audioCtx.createBufferSource(), f = audioCtx.createBiquadFilter(), g = audioCtx.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master); src.start();
}
const SFX = {
  ticket: () => { tone(880, 0.12, 'triangle', 0.2); tone(1320, 0.18, 'triangle', 0.2, null, 0.08); },
  coin:   () => tone(1400, 0.12, 'sine', 0.18),
  fuel:   () => tone(300, 0.35, 'sawtooth', 0.1, 900),
  green:  () => [523, 659, 784].forEach((f, i) => tone(f, 0.2, 'sine', 0.2, null, i * 0.07)),
  brake:  () => noise(1.2, 0.5, 900),
  hit:    () => { tone(120, 0.5, 'square', 0.2, 40); noise(0.4, 0.4, 400); },
  over:   () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.5, 'triangle', 0.25, null, i * 0.3)),
  level:  () => tone(660, 0.3, 'triangle', 0.2, 990),
};
function toggleSound() {
  ensureAudio();
  soundOn = !soundOn;
  master.gain.setTargetAtTime(soundOn ? 0.5 : 0, audioCtx.currentTime, 0.05);
  document.querySelectorAll('.snd').forEach(b => b.textContent = soundOn ? 'SOUND: ON' : 'SOUND: OFF');
}

// ===== 4. GAME STATE =====
// newRun() creates a fresh set of values for one journey
function newRun() {
  return {
    time: 0, score: 0, lives: 3, fuel: 100, brake: 100, level: 1,
    lane: 0, laneX: 0,            // lane = target lane (-1, 0, 1); laneX = where the train is drawn
    brakeLeft: 0, cooldown: 0,    // seconds of braking left, seconds of cooldown left
    invuln: 0, shake: 0, flash: 0, banner: 0,
    spawnTimer: 0.5, scroll: 0, bgX: 0, wheel: 0, steamTimer: 0, chuffT: 0,
    objects: [],                  // tickets, coins, obstacles, ghosts...
    fx: []                        // sparks and steam particles
  };
}
// startGame(): resets everything and begins playing
function startGame() {
  ensureAudio();
  game = newRun();
  game.banner = 2;                // show "LEVEL 1" briefly
  state = 'playing';
  showScreen();
}
function pauseGame()  { if (state === 'playing') { state = 'paused'; showScreen(); } }
function resumeGame() { if (state === 'paused')  { state = 'playing'; showScreen(); } }
function restartGame() { startGame(); }
function showHowTo()  { state = 'howto'; showScreen(); }
function goMenu()     { state = 'menu'; game = newRun(); showScreen(); }

// gameOver(): stop the run, save the high score and show the results screen
function gameOver() {
  if (state !== 'playing') return;
  state = 'over';
  const s = Math.floor(game.score);
  const isNew = s > highScore;
  if (isNew) { highScore = s; localStorage.setItem('midnightHigh', s); }
  $('go-score').textContent = s;
  $('go-high').textContent = highScore;
  $('go-level').textContent = game.level;
  $('go-time').textContent = fmt(game.time);
  $('go-new').classList.toggle('hidden', !isNew);
  SFX.over();
  showScreen();
}

// Shows the overlay for the current state and hides the rest
function showScreen() {
  const active = { menu: 'menu', howto: 'howto', paused: 'pause', over: 'over' }[state];
  ['menu', 'howto', 'pause', 'over'].forEach(id => $(id).classList.toggle('hidden', id !== active));
  $('hud').classList.toggle('hidden', state !== 'playing' && state !== 'paused');
  $('touch').classList.toggle('hidden', !(isTouch && state === 'playing'));
}

// ===== 5. GAME LOGIC =====
// moveTrain(): sets the target lane; updateGame() animates the train towards it
function moveTrain(dir) {
  if (state !== 'playing') return;
  const next = Math.max(-1, Math.min(1, game.lane + dir));
  if (next !== game.lane) { game.lane = next; tone(900, 0.25, 'sawtooth', 0.04, 600); }   // wheel squeal
}

// activateEmergencyBrake(): the main customization. Costs 35% energy and
// slows the world to 35% speed for 2 seconds, then a short cooldown.
function activateEmergencyBrake() {
  if (state !== 'playing') return;
  if (game.brakeLeft > 0 || game.cooldown > 0) return;     // no repeats while braking or cooling down
  if (game.brake < BRAKE_COST) { tone(180, 0.15, 'square', 0.1); return; } // not enough energy
  game.brake -= BRAKE_COST;
  game.brakeLeft = BRAKE_TIME;
  game.cooldown = BRAKE_TIME + BRAKE_COOLDOWN;
  SFX.brake();
}

// whistle(): a rising steam whistle with a puff of steam from the chimney
function whistle() {
  if (state === 'paused') return;
  ensureAudio();
  tone(480, 0.9, 'triangle', 0.18, 540);
  tone(620, 0.9, 'sine', 0.08, 700, 0.02);
  for (let i = 0; i < 8; i++) {
    game.fx.push({ x: trainX() + 14 * TS, y: trainBaseY() - 60 * TS, vx: rand(20, 60), vy: rand(-90, -40), life: 1.4, max: 1.4, size: rand(6, 10), steam: true });
  }
}

// updateDifficulty(): raises the level as score and survival time grow
function updateDifficulty() {
  const lvl = Math.min(6, 1 + Math.floor(game.score / 120 + game.time / 45));
  if (lvl > game.level) { game.level = lvl; game.banner = 2; SFX.level(); }
}

// spawnObject(): adds a new object at the horizon in a random lane
function spawnObject() {
  const lane = Math.floor(rand(-1, 2));                     // -1, 0 or 1
  const hazardChance = Math.min(0.35, 0.08 + 0.05 * (game.level - 1));
  // Fairness rule: never let hazards fill two lanes near the spawn point
  const blockedLanes = new Set(game.objects.filter(o => o.hazard && o.t < 0.3).map(o => o.lane)).size;
  if (Math.random() < hazardChance && blockedLanes < 2) {
    const r = Math.random();
    if (game.level >= 2 && r < 0.25) addObject('ghost', lane);
    else addObject(r < 0.6 - 0.05 * (game.level - 1) ? 'rock' : 'broken', lane);
    return;
  }
  const r = Math.random();
  if (r < 0.45) addObject('ticket', lane);
  else if (r < 0.75) for (let i = 0; i < 3; i++) addObject('coin', lane, -i * 0.06); // coin group
  else if (r < 0.9) addObject('fuel', lane);
  else addObject('green', lane);
}
function addObject(kind, lane, t0 = 0) {
  game.objects.push({
    kind, lane, ox: lane, t: t0, hazard: HAZARDS.includes(kind),
    len: kind === 'broken' ? 0.16 : 0,                      // broken track covers a stretch of lane
    phase: Math.random() * 6, switchT: rand(2, 5), dead: false
  });
}

// updateObjects(): moves everything towards the train and removes what has passed
function updateObjects(dt, speed) {
  for (const o of game.objects) {
    const ghostMult = 1.35 + 0.08 * (game.level - 1);       // ghosts approach faster on higher levels
    o.t += speed * (o.kind === 'ghost' ? ghostMult : 1) * dt;
    o.ox += (o.lane - o.ox) * Math.min(1, dt * 5);          // smooth sideways drawing
    if (o.kind === 'ghost' && o.t < 0.7) {                  // ghosts sometimes switch lanes
      o.switchT -= dt;
      if (o.switchT <= 0) {
        o.lane = o.lane === 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        o.switchT = Math.max(1, rand(2, 5) - game.level * 0.3);
      }
    }
    if (o.t > 1.15) o.dead = true;
  }
  game.objects = game.objects.filter(o => !o.dead);
}

// detectCollision(): checks the train against objects in its lane
function detectCollision() {
  for (const o of game.objects) {
    if (state !== 'playing') return;
    if (o.dead || Math.abs(o.lane - game.laneX) > 0.5) continue;   // only objects in the train's lane
    if (o.kind === 'broken') {                               // track covers depths t-len .. t
      if (o.t - o.len < TRAIN_T + 0.04 && o.t > TRAIN_T - 0.04) hitPlayer();
    } else if (o.hazard) {                                   // rock or ghost: a single point
      if (Math.abs(o.t - TRAIN_T) < 0.05) hitPlayer();
    } else if (Math.abs(o.t - TRAIN_T) < 0.06) {             // collectibles
      collectItem(o);
    }
  }
}

// collectItem(): gives points and effects for each collectible
function collectItem(o) {
  o.dead = true;
  const x = trainX(), y = trainBaseY() - 30;
  switch (o.kind) {
    case 'ticket': game.score += 10; SFX.ticket(); burst(x, y, C.gold, 14); break;
    case 'coin':   game.score += 5;  SFX.coin();   burst(x, y, '#ffe08a', 8); break;
    case 'fuel':
      game.score += 15; game.fuel = Math.min(100, game.fuel + 20);
      SFX.fuel(); burst(x, y, '#c9703a', 12); break;
    case 'green':
      game.score += 20; game.brake = Math.min(100, game.brake + BRAKE_COST);
      SFX.green(); burst(x, y, C.cyan, 16); break;
  }
}

// hitPlayer(): removes one life, then grants invulnerability so one crash cannot cost several lives
function hitPlayer() {
  if (game.invuln > 0) return;
  game.lives -= 1;
  game.invuln = 1.2;
  game.shake = 0.4; game.flash = 0.4;
  SFX.hit();
  burst(trainX(), trainBaseY() - 30, C.red, 24);
  if (game.lives <= 0) gameOver();
}

// burst(): creates a short shower of particles
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(60, 200);
    game.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.6, max: 0.6, size: rand(2, 4.5), color });
  }
}

// updateGame(): one frame of gameplay, called from the main loop while playing
function updateGame(dt) {
  const g = game;
  g.time += dt;
  g.score += dt;                                      // survival bonus: 1 point per second
  g.fuel = Math.max(0, g.fuel - dt * 1.4);            // fuel slowly burns
  if (g.fuel === 0) return gameOver();
  updateDifficulty();
  g.laneX += (g.lane - g.laneX) * Math.min(1, dt * 12); // smooth lane-change animation
  for (const k of ['invuln', 'shake', 'flash', 'banner', 'cooldown']) if (g[k] > 0) g[k] -= dt;
  if (g.brakeLeft > 0) {                              // braking: sparks from the wheels
    g.brakeLeft -= dt;
    if (Math.random() < 0.6) burst(trainX() + rand(-35, 35), trainBaseY(), '#ffb347', 2);
  }
  const speed = levelSpeed(g.level) * (g.brakeLeft > 0 ? 0.35 : 1);   // brake cuts world speed to 35%
  g.chuffT -= dt;                                       // steam chuff, synced to the wheels
  if (g.chuffT <= 0 && g.brakeLeft <= 0) { noise(0.12, 0.25, 220); g.chuffT = 0.09 / speed; }
  g.spawnTimer -= dt;
  if (g.spawnTimer <= 0) { spawnObject(); g.spawnTimer = spawnGap(g.level) * rand(0.8, 1.2); }
  updateObjects(dt, speed);
  detectCollision();
  updateScenery(dt, speed);
}

// updateScenery(): scrolls the track, forest, wheels and steam. Used in menus too.
function updateScenery(dt, speed) {
  const g = game;
  g.scroll = (g.scroll + speed * dt) % 1;            // sleepers and lanterns move with world speed
  g.bgX += speed * 300 * dt;                          // forest parallax
  g.wheel += dt * (3 + speed * 25);                   // wheel rotation
  g.steamTimer -= dt;
  if (g.steamTimer <= 0) {                            // steam puffs from the chimney
    g.steamTimer = 0.12;
    g.fx.push({ x: trainX() + 14 * TS, y: trainBaseY() - 60 * TS, vx: 25, vy: -45, life: 1.6, max: 1.6, size: 4, steam: true });
  }
  for (const p of g.fx) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (!p.steam) p.vy += 200 * dt;                   // sparks fall with gravity
    p.size += dt * (p.steam ? 10 : 0);
    p.life -= dt;
  }
  g.fx = g.fx.filter(p => p.life > 0);
}

// ===== 6. DRAWING =====
// drawGame(): paints the whole scene in layers, back to front
function drawGame(time) {
  const g = game;
  ctx.save();
  if (g.shake > 0) ctx.translate(rand(-8, 8) * g.shake, rand(-8, 8) * g.shake);  // screen shake on crash
  drawSky(time);
  drawClouds(g.bgX);
  drawForest(g.bgX);
  drawGround();
  drawRails(g.scroll);
  drawLanterns(g.scroll, time);
  drawObjects(time);
  drawTrain(time);
  drawFx();
  ctx.restore();
  if (g.flash > 0) { ctx.fillStyle = `rgba(231, 76, 91, ${g.flash * 0.5})`; ctx.fillRect(0, 0, W, H); }
  if (g.brakeLeft > 0) {
    ctx.fillStyle = 'rgba(72, 216, 232, 0.08)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.cyan; ctx.font = 'bold 22px Georgia'; ctx.textAlign = 'center';
    ctx.fillText('EMERGENCY BRAKE', W / 2, 44);
  }
  if (g.banner > 0 && state === 'playing') {
    ctx.save();
    ctx.globalAlpha = Math.min(1, g.banner);
    ctx.font = 'bold 38px Georgia'; ctx.textAlign = 'center';
    ctx.fillStyle = C.gold; ctx.shadowColor = C.gold; ctx.shadowBlur = 20;
    ctx.fillText(`LEVEL ${g.level}`, W / 2, HORIZON - 20);
    ctx.restore();
  }
}

function drawSky(time) {
  const grad = ctx.createLinearGradient(0, 0, 0, HORIZON);
  grad.addColorStop(0, '#3f86d6'); grad.addColorStop(0.7, '#9fd9f5'); grad.addColorStop(1, '#ffe9b8');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, HORIZON + 2);
  for (const s of stars) {                             // twinkling stars
    ctx.globalAlpha = 0.12 + 0.08 * Math.sin(time * 2 + s.p);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const moon = ctx.createRadialGradient(660, 70, 8, 660, 70, 70);   // glowing moon
  moon.addColorStop(0, '#fffbe0'); moon.addColorStop(0.35, 'rgba(255, 214, 120, 0.75)'); moon.addColorStop(1, 'rgba(214, 167, 79, 0)');
  ctx.fillStyle = moon; ctx.beginPath(); ctx.arc(660, 70, 70, 0, Math.PI * 2); ctx.fill();
}

// Dark forest silhouette. The grid moves with `off` so the trees scroll smoothly.
function drawForest(off) {
  ctx.fillStyle = '#2f8a63';
  ctx.beginPath(); ctx.moveTo(0, HORIZON);
  const shift = off % 14;
  for (let x = -14 - shift; x <= W + 14; x += 14) {
    const i = Math.round((x + off) / 14);
    const h = 22 + ((i * 73) % 37) * 0.8;              // pseudo-random tree heights
    ctx.lineTo(x + 7, HORIZON - h); ctx.lineTo(x + 14, HORIZON);
  }
  ctx.fill();
}

// Soft white clouds drift across the sky. They move with the world, so braking slows them too.
function drawClouds(off) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  for (let i = 0; i < 5; i++) {
    const x = (((i * 190 - off * 0.15) % (W + 200)) + W + 200) % (W + 200) - 100;
    const y = 52 + (i % 3) * 26;
    ctx.beginPath();
    ctx.ellipse(x, y, 46, 14, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 30, y - 8, 30, 14, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 28, y - 4, 24, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGround() {
  const g = ctx.createLinearGradient(0, HORIZON, 0, H);
  g.addColorStop(0, '#9ccf8a'); g.addColorStop(1, '#4f9a5e');
  ctx.fillStyle = g; ctx.fillRect(0, HORIZON, W, H - HORIZON);
}

// Draws sleepers (scrolling), two steel rails per lane and dashed lane centres
function drawRails(scroll) {
  for (let k = 0; k < 16; k++) {
    const t = (k / 16 + scroll) % 1, s = scaleAt(t);
    ctx.strokeStyle = `rgba(214, 167, 79, ${0.25 + 0.4 * s})`;
    ctx.lineWidth = 1 + 6 * s;
    ctx.beginPath(); ctx.moveTo(xAt(-1.45, t), yAt(t)); ctx.lineTo(xAt(1.45, t), yAt(t)); ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (const lane of [-1, 0, 1]) {
    ctx.setLineDash([10, 14]); ctx.strokeStyle = 'rgba(72, 216, 232, 0.25)';
    ctx.beginPath(); ctx.moveTo(xAt(lane, 0), yAt(0)); ctx.lineTo(xAt(lane, 1), yAt(1)); ctx.stroke();
    ctx.setLineDash([]); ctx.strokeStyle = '#8d9bb5';
    for (const side of [-0.22, 0.22]) {
      ctx.beginPath(); ctx.moveTo(xAt(lane + side, 0), yAt(0)); ctx.lineTo(xAt(lane + side, 1), yAt(1)); ctx.stroke();
    }
  }
}

// Alternating lanterns and railway signals along both sides of the track
function drawLanterns(scroll, time) {
  for (let i = 0; i < 8; i++) {
    const t = (i / 8 + scroll) % 1, s = scaleAt(t), y = yAt(t);
    const x = W / 2 + LANE_GAP * 1.9 * s * (i % 2 ? 1 : -1);
    const col = i % 3 === 0 ? C.red : C.gold;           // every third post is a signal
    ctx.fillStyle = '#262b40';
    ctx.fillRect(x - 2 * s, y - 70 * s, 4 * s, 70 * s);
    const glow = ctx.createRadialGradient(x, y - 70 * s, 0, x, y - 70 * s, 30 * s);
    glow.addColorStop(0, col); glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(time * 3 + i);
    ctx.fillStyle = glow; ctx.fillRect(x - 30 * s, y - 100 * s, 60 * s, 60 * s);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - 70 * s, 3 * s + 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// Draws every object far to near. Sprites are drawn at unit size, then scaled by depth.
function drawObjects(time) {
  for (const o of [...game.objects].sort((a, b) => a.t - b.t)) {
    if (o.t < 0.01) continue;
    if (o.kind === 'broken') { drawBrokenTrack(o); continue; }
    ctx.save();
    ctx.translate(xAt(o.ox, o.t), yAt(o.t));
    ctx.scale(scaleAt(o.t), scaleAt(o.t));
    if (o.kind === 'ticket') drawTicket(time + o.phase);
    else if (o.kind === 'coin') drawCoin(time + o.phase);
    else if (o.kind === 'fuel') drawFuel();
    else if (o.kind === 'green') drawGreenToken(time);
    else if (o.kind === 'rock') drawRock(o.phase);
    else if (o.kind === 'ghost') drawGhost(time + o.phase);
    ctx.restore();
  }
}

function drawTicket(t) {                                // golden ticket that flips as it spins
  const w = 34 * Math.abs(Math.cos(t * 3)) + 2;
  ctx.fillStyle = '#f4d27a'; ctx.shadowColor = C.gold; ctx.shadowBlur = 14;
  ctx.fillRect(-w / 2, -30, w, 20);
  ctx.shadowBlur = 0; ctx.fillStyle = '#7a5418';
  ctx.fillRect(-w / 2 + 4, -25, w - 8, 2); ctx.fillRect(-w / 2 + 4, -18, w - 8, 2);
}
function drawCoin(t) {                                  // coin that rotates
  const w = 22 * Math.abs(Math.cos(t * 5)) + 3;
  ctx.fillStyle = '#ffd86b'; ctx.shadowColor = '#ffe08a'; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.ellipse(0, -16, w / 2, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}
function drawFuel() {
  ctx.fillStyle = '#c9703a'; ctx.fillRect(-12, -32, 24, 30);
  ctx.fillStyle = '#7a3e1c'; ctx.fillRect(-14, -36, 28, 5); ctx.fillRect(-6, -40, 12, 4);
  ctx.fillStyle = '#fff2d0'; ctx.fillRect(-6, -22, 12, 3);
}
function drawGreenToken(t) {                            // green signal token with a pulsing lamp
  const r = 12 + 2 * Math.sin(t * 6);
  const glow = ctx.createRadialGradient(0, -16, 2, 0, -16, r + 14);
  glow.addColorStop(0, 'rgba(57, 125, 99, 0.9)'); glow.addColorStop(1, 'rgba(57, 125, 99, 0)');
  ctx.fillStyle = glow; ctx.fillRect(-30, -46, 60, 60);
  ctx.fillStyle = C.green; ctx.beginPath(); ctx.arc(0, -16, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9ff5c8'; ctx.beginPath(); ctx.arc(0, -16, r * 0.45, 0, Math.PI * 2); ctx.fill();
}
function drawRock(seed) {                               // lumpy rock obstacle
  ctx.fillStyle = '#4a5470'; ctx.strokeStyle = '#1b2033'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, r = 16 + 4 * Math.sin(seed * 3 + i * 1.7);
    ctx.lineTo(Math.cos(a) * r, -14 + Math.sin(a) * r * 0.8);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
}
function drawGhost(t) {                                 // ghost train with a blue glow and bobbing
  const bob = Math.sin(t * 2) * 3;
  ctx.shadowColor = '#6fb8ff'; ctx.shadowBlur = 18;
  ctx.fillStyle = 'rgba(40, 90, 170, 0.55)';
  ctx.fillRect(-36, -50 + bob, 72, 40);
  ctx.fillStyle = 'rgba(200, 240, 255, 0.85)';
  for (let i = -2; i <= 2; i++) ctx.fillRect(i * 13 - 4, -44 + bob, 8, 12);   // glowing windows
  ctx.shadowBlur = 0;
}
// Broken track: a red danger zone with jagged rails. It spans the lane for several depths.
function drawBrokenTrack(o) {
  const tA = Math.max(0.01, o.t - o.len), tB = o.t;
  ctx.fillStyle = 'rgba(231, 76, 91, 0.18)';
  ctx.beginPath();
  ctx.moveTo(xAt(o.ox - 0.42, tA), yAt(tA)); ctx.lineTo(xAt(o.ox + 0.42, tA), yAt(tA));
  ctx.lineTo(xAt(o.ox + 0.42, tB), yAt(tB)); ctx.lineTo(xAt(o.ox - 0.42, tB), yAt(tB));
  ctx.fill();
  ctx.strokeStyle = C.red; ctx.lineWidth = 3;
  for (const side of [-0.22, 0.22]) {
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const t = tA + (tB - tA) * (i / 8);
      ctx.lineTo(xAt(o.ox + side + (i % 2 ? 0.05 : -0.05), t), yAt(t));
    }
    ctx.stroke();
  }
}

// The player's locomotive: side view with tender, cab, boiler, chimney, headlight and spoked wheels
function drawTrain(time) {
  const g = game;
  const blink = g.invuln > 0 && Math.floor(time * 12) % 2 === 0;   // flicker while invulnerable
  ctx.save();
  ctx.translate(trainX(), trainBaseY() + Math.sin(game.wheel * 2) * 0.8);
  ctx.rotate((game.lane - game.laneX) * 0.06);          // lean into the lane change
  ctx.scale(TS, TS);
  ctx.globalAlpha = blink ? 0.35 : 1;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'; ctx.beginPath(); ctx.ellipse(-4, 2, 80, 6, 0, 0, Math.PI * 2); ctx.fill();
  const beam = ctx.createLinearGradient(40, 0, 170, 0);          // headlight beam
  beam.addColorStop(0, 'rgba(72, 216, 232, 0.5)'); beam.addColorStop(1, 'rgba(72, 216, 232, 0)');
  ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(40, -34); ctx.lineTo(170, -60); ctx.lineTo(170, -8); ctx.fill();
  ctx.fillStyle = '#20263d'; ctx.fillRect(-66, -48, 22, 28);     // tender
  ctx.fillStyle = '#2a3350'; ctx.fillRect(-46, -66, 26, 46);     // cab
  ctx.fillStyle = '#ffb347'; ctx.fillRect(-40, -58, 12, 10);     // cab window glow
  const boiler = ctx.createLinearGradient(0, -42, 0, -18);   // metal shading: light top, dark bottom
  boiler.addColorStop(0, '#6d7a9c'); boiler.addColorStop(0.45, '#2e3857'); boiler.addColorStop(1, '#161c2e');
  ctx.fillStyle = boiler; ctx.fillRect(-24, -42, 52, 24);
  ctx.fillStyle = 'rgba(214, 167, 79, 0.7)';             // brass rivets
  for (let rx = -18; rx <= 24; rx += 8) ctx.fillRect(rx, -37, 2, 2);
  ctx.fillStyle = boiler;     // boiler
  ctx.beginPath(); ctx.arc(28, -30, 12, 0, Math.PI * 2); ctx.fill();   // smokebox
  ctx.fillRect(12, -62, 8, 20); ctx.fillRect(9, -64, 14, 4);     // chimney with flared top
  ctx.fillStyle = C.gold; ctx.fillRect(-24, -42, 52, 3); ctx.fillRect(-46, -66, 26, 3); // gold trim
  ctx.fillStyle = '#171b2d'; ctx.fillRect(-68, -20, 110, 6);     // frame
  ctx.beginPath(); ctx.moveTo(30, -18); ctx.lineTo(44, -2); ctx.lineTo(30, -2); ctx.fill(); // cowcatcher
  ctx.shadowColor = C.cyan; ctx.shadowBlur = 16; ctx.fillStyle = '#e8fdff';      // headlight lamp
  ctx.beginPath(); ctx.arc(38, -34, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  // Connecting rod and piston: the crank on the driving wheel moves the piston
  const crankX = 6 + Math.cos(g.wheel) * 7, crankY = -9 + Math.sin(g.wheel) * 7;
  const pistonX = 18 + Math.cos(g.wheel) * 9;
  ctx.strokeStyle = '#c0c8d8'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(crankX, crankY); ctx.lineTo(pistonX, -30); ctx.stroke();
  ctx.fillStyle = '#8d9bb5'; ctx.fillRect(pistonX - 5, -33, 10, 6);
  for (const wx of [-54, -28, 6, 28]) {                          // wheels rotate with speed
    ctx.fillStyle = '#0b0f1c'; ctx.beginPath(); ctx.arc(wx, -9, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5; ctx.beginPath();
    for (const k of [0, Math.PI]) {
      ctx.moveTo(wx, -9); ctx.lineTo(wx + Math.cos(g.wheel + k) * 8, -9 + Math.sin(g.wheel + k) * 8);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Steam, sparks and burst particles
function drawFx() {
  for (const p of game.fx) {
    ctx.globalAlpha = Math.max(0, p.life / p.max) * (p.steam ? 0.55 : 1);
    ctx.fillStyle = p.steam ? '#ffffff' : p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// HUD values are updated once per frame
function updateHUD() {
  const g = game, s = Math.floor(g.score);
  $('score').textContent = s;
  $('high').textContent = Math.max(highScore, s);
  $('level').textContent = g.level;
  $('lives').textContent = '♥'.repeat(Math.max(0, g.lives));
  $('time').textContent = fmt(g.time);
  $('fuel').style.width = g.fuel + '%';
  $('fuel').classList.toggle('low', g.fuel < 25);
  $('brake').style.width = g.brake + '%';
  $('brake-bar').classList.toggle('ready', g.brake >= BRAKE_COST && g.cooldown <= 0 && g.brakeLeft <= 0);
}

// ===== 7. BUTTONS AND MAIN LOOP =====
const on = (id, fn) => $(id).addEventListener('click', () => { $(id).blur(); fn(); });
on('btn-start', startGame);        on('btn-howto', showHowTo);       on('btn-back', goMenu);
on('btn-sound-menu', toggleSound); on('btn-sound-hud', toggleSound); on('btn-pause', pauseGame);
on('btn-resume', resumeGame);      on('btn-restart', restartGame);   on('btn-pmenu', goMenu);
on('btn-again', startGame);        on('btn-omenu', goMenu);
on('btn-whistle', whistle);

// requestAnimationFrame loop. dt (delta time) keeps movement the same speed on every screen.
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);   // capped so a background tab doesn't jump
  lastTime = now;
  if (state === 'playing') updateGame(dt);
  else if (state !== 'paused') updateScenery(dt, 0.2);  // menus and game over: slow scenery
  drawGame(now / 1000);
  if (state === 'playing' || state === 'paused') updateHUD();
  requestAnimationFrame(loop);
}

showScreen();
requestAnimationFrame(loop);
