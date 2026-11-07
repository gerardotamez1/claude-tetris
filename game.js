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
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.max(gameStartLevel, Math.floor(lines / 10) + 1);
    dropInterval = speedForLevel(level);
    updateHUD();
  }
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
}

function togglePause() {
  if (gameOver) return;
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
  if (gameOver) return; // el game over lo gestiona el listener de juego
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
  }
}

themeToggle.addEventListener('click', () => {
  setTheme(theme === 'dark' ? 'light' : 'dark');
  themeToggle.blur(); // evita que Space/flechas activen el botón mientras se juega
});

init();
