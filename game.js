'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#a1887f', // Tuerca - bronze
];

const NUT = 8; // la tuerca: su hueco central es una celda vacía de verdad

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // Tuerca
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const RECORDS_KEY = 'tetris.records';
const TOP_SIZE = 5;
const NAME_MAX = 12;
const DEFAULT_NAME = 'Jugador';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const pauseMenu = document.getElementById('pause-menu');
const pauseOptions = [...pauseMenu.querySelectorAll('.pause-option')];
const pauseControls = document.getElementById('pause-controls');
const controlsBtn = pauseMenu.querySelector('[data-action="controls"]');
const startLevelEl = document.getElementById('start-level-value');
const comboEl = document.getElementById('combo');
const startScreen = document.getElementById('start-screen');
const startRecords = document.getElementById('start-records');
const startStats = document.getElementById('start-stats');
const playBtn = document.getElementById('play-btn');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const gameoverRecords = document.getElementById('gameover-records');
const newRecordMsg = document.getElementById('new-record-msg');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');
const overlayRecords = document.getElementById('overlay-records');
const overlayStats = document.getElementById('overlay-stats');

const THEMES = {
  dark:  { grid: '#22222e', shine: 'rgba(255,255,255,0.12)', ghostAlpha: 0.2 },
  light: { grid: '#e3e6ee', shine: 'rgba(255,255,255,0.35)', ghostAlpha: 0.35 },
};
let theme = 'dark';

const MIN_START_LEVEL = 1;
const MAX_START_LEVEL = 10;
const RESUME_LOCK_MS = 200; // tras cerrar el menú se ignoran las teclas de juego
const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'KeyX', 'Space']);
const MENU_KEYS = new Set(['KeyP', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter', 'Space', 'Tab']);

let startLevel = 1; // nivel con el que empieza la próxima partida (no se reinicia en init)
let gameStartLevel = 1; // nivel con el que empezó la partida actual
let inputLockUntil = 0;
const keysDown = new Set();   // teclas pulsadas ahora mismo
const staleKeys = new Set();  // teclas que ya estaban pulsadas al cerrar el menú

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, maxCombo;
let started = false;        // false hasta pulsar Jugar: no hay partida que controlar
let pendingRecord = null;   // puntuación que entra en el top y espera nombre
let pendingTop = [];        // top guardado en el momento del game over
let focusTimer;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  // combo: piezas seguidas que limpian al menos una línea
  combo = cleared ? combo + 1 : 0;
  maxCombo = Math.max(maxCombo, combo);
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.max(gameStartLevel, Math.floor(lines / 10) + 1);
    dropInterval = speedForLevel(level);
  }
  updateHUD();
}

function speedForLevel(lvl) {
  return Math.max(100, 1000 - (lvl - 1) * 90);
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  comboEl.textContent = combo;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = THEMES[theme].shine;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

// Una celda vacía rodeada por la tuerca. Se deduce al pintar, así que deja de
// dibujarse sola cuando una línea completa parte la tuerca.
function isNutHole(cells, r, c) {
  return !cells[r][c] &&
    [[-1, 0], [1, 0], [0, -1], [0, 1]].every(([dr, dc]) => cells[r + dr]?.[c + dc] === NUT);
}

function drawNutHole(context, x, y, size, alpha) {
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = COLORS[NUT];
  context.beginPath();
  context.rect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.arc((x + 0.5) * size, (y + 0.5) * size, size * 0.38, 0, Math.PI * 2);
  context.fill('evenodd');
  context.globalAlpha = 1;
}

function drawCell(context, cells, r, c, x, y, size, alpha) {
  if (isNutHole(cells, r, c)) drawNutHole(context, x, y, size, alpha);
  else drawBlock(context, x, y, cells[r][c], size, alpha);
}

function drawGrid() {
  ctx.strokeStyle = THEMES[theme].grid;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawCell(ctx, board, r, c, c, r, BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawCell(ctx, current.shape, r, c, current.x + c, gy + r, BLOCK, THEMES[theme].ghostAlpha);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawCell(ctx, current.shape, r, c, current.x + c, current.y + r, BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawCell(nextCtx, shape, r, c, offX + c, offY + r, NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  draw(); // último frame: el loop ya no volverá a pintar
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  showGameOverRecords(); // tras mostrar el overlay: un campo oculto no puede recibir el foco
}

function togglePause() {
  if (!started || gameOver) return;
  if (paused) {
    closePauseMenu();
    paused = false;
    lastTime = performance.now();
    loop(lastTime);
  } else {
    paused = true;
    cancelAnimationFrame(animId);
    openPauseMenu();
  }
}

// ---- Menú de pausa ----

function openPauseMenu() {
  startLevelEl.textContent = startLevel;
  setControlsOpen(false);
  pauseMenu.classList.remove('hidden');
  pauseOptions[0].focus();
}

function closePauseMenu() {
  pauseMenu.classList.add('hidden');
  if (pauseMenu.contains(document.activeElement)) document.activeElement.blur();
  // al volver al juego, una tecla mantenida o pulsada justo al cerrar no debe mover la pieza
  inputLockUntil = performance.now() + RESUME_LOCK_MS;
  staleKeys.clear();
  keysDown.forEach(k => staleKeys.add(k));
}

function setControlsOpen(open) {
  pauseControls.classList.toggle('hidden', !open);
  controlsBtn.setAttribute('aria-expanded', String(open));
}

function changeStartLevel(step) {
  startLevel = Math.min(MAX_START_LEVEL, Math.max(MIN_START_LEVEL, startLevel + step));
  startLevelEl.textContent = startLevel;
}

function focusPauseOption(step) {
  const i = pauseOptions.indexOf(document.activeElement);
  const n = pauseOptions.length;
  const nextIndex = i === -1 ? 0 : (i + step + n) % n;
  pauseOptions[nextIndex].focus();
}

function activatePauseOption(option) {
  switch (option.dataset.action) {
    case 'resume':
      togglePause();
      break;
    case 'restart':
      closePauseMenu();
      init();
      break;
    case 'controls':
      setControlsOpen(pauseControls.classList.contains('hidden'));
      option.focus();
      break;
    case 'level':
      // Enter recorre los niveles en ciclo; ←/→ los ajustan
      startLevel = startLevel === MAX_START_LEVEL ? MIN_START_LEVEL : startLevel + 1;
      startLevelEl.textContent = startLevel;
      option.focus();
      break;
  }
}

function handlePauseMenuKey(e) {
  const focused = document.activeElement;
  switch (e.code) {
    case 'KeyP':
    case 'Escape':
      if (!e.repeat) togglePause(); // mantener P no debe reanudar justo después de pausar
      break;
    case 'ArrowUp':
      focusPauseOption(-1);
      break;
    case 'ArrowDown':
      focusPauseOption(1);
      break;
    case 'Tab':
      focusPauseOption(e.shiftKey ? -1 : 1);
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      if (focused && focused.dataset.action === 'level') changeStartLevel(e.code === 'ArrowLeft' ? -1 : 1);
      break;
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
      if (e.repeat) break;
      // si el foco se perdió (p. ej. al pulsar el botón de tema), vuelve a la primera opción
      if (pauseOptions.includes(focused)) activatePauseOption(focused);
      else pauseOptions[0].focus();
      break;
  }
}

// Se registra en fase de captura sobre window, así corre antes que el listener
// de juego (document, burbuja) y puede impedir que las teclas lleguen a él.
window.addEventListener('keydown', e => {
  keysDown.add(e.code);
  // sin partida (pantalla de inicio) o en game over: lo gestiona el listener de juego
  if (!started || gameOver) return;
  if (paused) {
    // con el menú abierto ninguna tecla llega al juego
    e.stopPropagation();
    if (MENU_KEYS.has(e.code) || GAME_KEYS.has(e.code)) {
      e.preventDefault(); // también evita el click nativo de Enter/Space sobre el botón
      handlePauseMenuKey(e);
    }
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) togglePause();
    return;
  }
  if (!GAME_KEYS.has(e.code)) return;
  // una tecla pulsada durante el bloqueo queda ignorada (con sus repeticiones) hasta soltarla
  if (performance.now() < inputLockUntil) staleKeys.add(e.code);
  if (staleKeys.has(e.code)) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

window.addEventListener('keyup', e => {
  keysDown.delete(e.code);
  staleKeys.delete(e.code);
  // en macOS no llega el keyup de otras teclas mientras Cmd está pulsada
  if (e.key === 'Meta') keysDown.clear();
  if (paused) e.preventDefault(); // evita que Space active un botón al soltarla
});

window.addEventListener('blur', () => {
  keysDown.clear();
  staleKeys.clear();
});

pauseOptions.forEach(option => {
  option.addEventListener('click', e => {
    if (e.target.closest('.level-step')) return;
    activatePauseOption(option);
  });
});

pauseMenu.querySelectorAll('.level-step').forEach(btn => {
  btn.addEventListener('click', () => {
    changeStartLevel(Number(btn.dataset.step));
    btn.closest('.pause-option').focus();
  });
});

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
      // endGame() no puede cancelar el frame en curso: hay que salir sin reprogramar
      if (gameOver) return;
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  savePendingRecord(); // reiniciar sin pulsar Guardar no pierde el récord
  hideGameOverRecords();
  startScreen.classList.add('hidden');
  started = true;
  combo = 0;
  maxCombo = 0;
  board = createBoard();
  score = 0;
  lines = 0;
  gameStartLevel = startLevel;
  level = gameStartLevel;
  paused = false;
  gameOver = false;
  dropInterval = speedForLevel(level);
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.target === nameInput) return; // escribiendo el nombre del récord
  if (!started) {
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      init();
    }
    return;
  }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

function setTheme(name) {
  theme = name;
  document.documentElement.dataset.theme = name;
  themeToggle.textContent = name === 'dark' ? 'Modo claro' : 'Modo oscuro';
  themeToggle.setAttribute('aria-checked', String(name === 'light'));
  // el loop está detenido en pausa/game over: repintar manualmente
  if (current && next) {
    draw();
    drawNext();
  } else if (board) {
    drawIdleBoard();
  }
}

themeToggle.addEventListener('click', () => {
  setTheme(theme === 'dark' ? 'light' : 'dark');
  themeToggle.blur(); // evita que Space/flechas activen el botón mientras se juega
});

// ---- Tabla de records (localStorage) ----

function emptyRecords() {
  return { top: [], bestCombo: 0, maxLines: 0 };
}

function toCount(v) {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// Datos corruptos o de otra versión: se descarta lo que no encaje
function sanitizeRecords(data) {
  const rec = emptyRecords();
  if (!data || typeof data !== 'object') return rec;
  if (Array.isArray(data.top)) {
    rec.top = data.top
      .filter(e => e && typeof e === 'object' && typeof e.name === 'string' && Number.isFinite(e.score))
      .map(e => ({
        name: e.name.slice(0, NAME_MAX),
        score: toCount(e.score),
        lines: toCount(e.lines),
        combo: toCount(e.combo),
        date: typeof e.date === 'string' ? e.date : '',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_SIZE);
  }
  rec.bestCombo = toCount(data.bestCombo);
  rec.maxLines = toCount(data.maxLines);
  return rec;
}

function loadRecords() {
  try {
    return sanitizeRecords(JSON.parse(localStorage.getItem(RECORDS_KEY)));
  } catch {
    return emptyRecords();
  }
}

function saveRecords(rec) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(rec));
  } catch {
    // sin almacenamiento (modo privado, cuota...): el juego sigue sin records
  }
}

function qualifies(top, value) {
  return value > 0 && (top.length < TOP_SIZE || value > top[top.length - 1].score);
}

// Posición en la que entraría: tras los empates, que conservan su puesto
function insertIndex(top, value) {
  const i = top.findIndex(e => e.score < value);
  return i === -1 ? top.length : i;
}

function cleanName(raw) {
  return raw.trim().slice(0, NAME_MAX) || DEFAULT_NAME;
}

// Pinta el top en `container`. Solo textContent: los nombres son datos del usuario.
function renderRecords(container, top, highlight) {
  container.replaceChildren();
  if (!top.length) {
    const empty = document.createElement('p');
    empty.className = 'records-empty';
    empty.textContent = 'Sin records todavía';
    container.append(empty);
    return;
  }
  const table = document.createElement('table');
  table.className = 'records-table';
  const head = table.createTHead().insertRow();
  for (const text of ['#', 'Nombre', 'Puntos', 'Líneas']) {
    const th = document.createElement('th');
    th.textContent = text;
    head.append(th);
  }
  const body = table.createTBody();
  top.forEach((e, i) => {
    const row = body.insertRow();
    if (i === highlight) row.className = 'highlight';
    for (const text of [i + 1, e.name, e.score.toLocaleString(), e.lines]) {
      row.insertCell().textContent = text;
    }
  });
  container.append(table);
}

function renderStats(el, rec) {
  el.textContent = `Mejor combo: ${rec.bestCombo} · Líneas máximas: ${rec.maxLines}`;
}

function showStartScreen() {
  const rec = loadRecords();
  renderRecords(startRecords, rec.top, -1);
  renderStats(startStats, rec);
  startScreen.classList.remove('hidden');
}

// Inserta la entrada en una copia del top; devuelve el nuevo top y su posición
function withEntry(top, entry) {
  const idx = insertIndex(top, entry.score);
  const result = [...top];
  result.splice(idx, 0, entry);
  return { top: result.slice(0, TOP_SIZE), idx };
}

function pendingEntry() {
  return { ...pendingRecord, name: cleanName(nameInput.value) };
}

// Top provisional con la puntuación actual insertada y resaltada
function renderPendingTop() {
  const { top, idx } = withEntry(pendingTop, pendingEntry());
  renderRecords(overlayRecords, top, idx);
}

function showGameOverRecords() {
  // combo y líneas máximas cuentan siempre, entre o no en el top
  const rec = loadRecords();
  rec.bestCombo = Math.max(rec.bestCombo, maxCombo);
  rec.maxLines = Math.max(rec.maxLines, lines);
  saveRecords(rec);
  renderStats(overlayStats, rec);

  if (qualifies(rec.top, score)) {
    pendingRecord = { name: DEFAULT_NAME, score, lines, combo: maxCombo, date: new Date().toISOString() };
    pendingTop = rec.top;
    nameInput.value = DEFAULT_NAME;
    newRecordMsg.classList.remove('hidden');
    nameForm.classList.remove('hidden');
    renderPendingTop();
  } else {
    renderRecords(overlayRecords, rec.top, -1);
  }
  gameoverRecords.classList.remove('hidden');
  if (pendingRecord) {
    // pequeña espera: las teclas que se seguían pulsando para jugar no deben
    // acabar escritas en el nombre
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      if (!pendingRecord) return;
      nameInput.focus();
      nameInput.select();
    }, 400);
  }
}

function hideGameOverRecords() {
  gameoverRecords.classList.add('hidden');
  newRecordMsg.classList.add('hidden');
  nameForm.classList.add('hidden');
}

function savePendingRecord() {
  if (!pendingRecord) return;
  const entry = pendingEntry();
  pendingRecord = null;
  clearTimeout(focusTimer);
  const rec = loadRecords();
  const { top, idx } = withEntry(rec.top, entry);
  rec.top = top;
  saveRecords(rec);
  nameForm.classList.add('hidden');
  nameInput.blur();
  renderRecords(overlayRecords, rec.top, idx);
}

function drawIdleBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
}

nameForm.addEventListener('submit', e => {
  e.preventDefault(); // Guardar o Enter en el campo
  savePendingRecord();
});

// autorrepetición de una tecla mantenida desde la partida: no escribirla
nameInput.addEventListener('keydown', e => {
  if (e.repeat) e.preventDefault();
});

nameInput.addEventListener('input', () => {
  if (pendingRecord) renderPendingTop();
});

playBtn.addEventListener('click', () => {
  playBtn.blur();
  init();
});

resetRecordsBtn.addEventListener('click', () => {
  resetRecordsBtn.blur();
  if (!confirm('¿Borrar todos los records? Esta acción no se puede deshacer.')) return;
  try {
    localStorage.removeItem(RECORDS_KEY);
  } catch {
    // nada que borrar si no hay almacenamiento
  }
  showStartScreen();
});

// Arranque: tablero vacío detrás de la pantalla de inicio; Jugar llama a init()
board = createBoard();
drawIdleBoard();
showStartScreen();
