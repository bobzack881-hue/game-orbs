const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const userNameEl = document.getElementById('user-name');
const highScoreEl = document.getElementById('high-score');
const tokensEl = document.getElementById('tokens');
const signOutBtn = document.getElementById('sign-out');
const playAgainBtn = document.getElementById('play-again-btn');
const loginOverlay = document.getElementById('login-overlay');
const loginTab = document.getElementById('login-tab');
const signupTab = document.getElementById('signup-tab');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const loginUserInput = document.getElementById('login-user');
const loginPassInput = document.getElementById('login-pass');
const signupUserInput = document.getElementById('signup-user');
const signupPassInput = document.getElementById('signup-pass');
const loginStatus = document.getElementById('login-status');

const W = canvas.width;
const H = canvas.height;
const PLAYER_BASE_SPEED = 220;
let cols = 25;
let rows = 20;
const cellSize = 40;
const wallThickness = 4;

const player = {
  x: cellSize / 2,
  y: cellSize / 2,
  r: 14,
  speed: PLAYER_BASE_SPEED,
  vx: 0,
  vy: 0,
  color: '#66e'
};

let playerColor = '#66e';
let enemyColor = '#e34d4d';
let wallColor = '#87cefa';
let orbColor = '#ffd166';
let finishColor = '#2ecc71';
const sessionColors = {
  player: '#66e',
  enemy: '#e34d4d',
  wall: '#87cefa',
  orb: '#ffd166',
  finish: '#2ecc71'
};

const orbRadius = 10;
let initialOrbCount = 25;
const orbs = [];
const enemies = [];
let score = 0;
let lives = 3;
let tokens = 0;
let invulnerable = false;
let invulnerabilityTimer = 0;
let deathTimer = 0;
const deathCooldown = 3;
const maze = [];
const finishCell = { x: cols - 1, y: rows - 1 };
let gameState = 'start';
let highScore = 0;
let currentUser = null;
let authToken = null;
let currentUserData = null;

function normalizeApiBase(value){
  if(!value) return '';
  return String(value).trim().replace(/\/+$/, '');
}

function resolveApiBaseUrl(){
  const urlParam = new URLSearchParams(window.location.search).get('api');
  if(urlParam){
    const normalized = normalizeApiBase(urlParam);
    localStorage.setItem('orbMazeApiBaseUrl', normalized);
    return normalized;
  }

  const stored = normalizeApiBase(localStorage.getItem('orbMazeApiBaseUrl'));
  if(stored) return stored;

  if(typeof window.ORB_API_BASE_URL === 'string' && window.ORB_API_BASE_URL.trim()){
    return normalizeApiBase(window.ORB_API_BASE_URL);
  }

  const host = window.location.hostname.toLowerCase();
  const knownFrontendHosts = new Set([
    'cool-orb.netlify.app',
    'game-orbs.vercel.app',
    'bobzack881-hue.github.io'
  ]);
  if(knownFrontendHosts.has(host)){
    return 'https://game-orbs-api.onrender.com';
  }

  if(window.location.protocol === 'file:') return 'http://localhost:8000';
  return '';
}

const API_BASE_URL = resolveApiBaseUrl();
const AUTH_SERVER_ERROR_MESSAGE = 'Cannot reach account server. If using a hosted website, append ?api=https://your-backend-domain or set localStorage key orbMazeApiBaseUrl.';

let enemyCount = 10;
let currentMode = 'Medium';

const modeConfigs = {
  Easy:    { cols: 15, rows: 12, orbs: 8, enemies: 3, speedFactor: 0.3, fogRadius: 400 },
  Medium:  { cols: 22, rows: 16, orbs: 20, enemies: 5, speedFactor: 0.4, fogRadius: 300 },
  Hard:    { cols: 28, rows: 20, orbs: 40, enemies: 10, speedFactor: 0.5, fogRadius: 200 },
  Nightmare:{ cols: 40, rows: 30, orbs: 150, enemies: 25, speedFactor: 0.6, fogRadius: 150 }
};

function applyMode(mode){
  if(!modeConfigs[mode]) return;
  currentMode = mode;
  const cfg = modeConfigs[mode];
  cols = cfg.cols;
  rows = cfg.rows;
  initialOrbCount = cfg.orbs;
  enemyCount = cfg.enemies;
  finishCell.x = cols - 1;
  finishCell.y = rows - 1;
  resetGame();
}

// selectedAbility removed; equipment controls which abilities are active
let stunKey = 'e';
let boostKey = 'Space';
let capturingKey = null; // 'stun' or 'boost' when waiting for key press
let sessionEquipped = [];
let sessionStunKey = 'e';
let sessionBoostKey = 'Space';

function isEquipped(name){
  if(currentUserData) return Array.isArray(currentUserData.equipped) && currentUserData.equipped.includes(name);
  return sessionEquipped.includes(name);
}

function hasEquipped(item){
  if(currentUserData) return Array.isArray(currentUserData.equipped) && currentUserData.equipped.includes(item);
  return sessionEquipped.includes(item);
}

function getUserValue(key, defaultValue = null){
  if(!currentUserData) return defaultValue;
  return currentUserData[key] != null ? currentUserData[key] : defaultValue;
}

function rand(min, max){ return Math.random() * (max - min) + min; }
function cellKey(cell){ return `${cell.x},${cell.y}`; }
function getCellAt(x, y){ return x >= 0 && x < cols && y >= 0 && y < rows ? maze[y][x] : null; }
function getCellCenter(x, y){ return { x: x * cellSize + cellSize / 2, y: y * cellSize + cellSize / 2 }; }

async function apiRequest(path, method = 'GET', body = null){
  const init = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };
  if(authToken){
    init.headers.Authorization = `Bearer ${authToken}`;
  }
  if(body){
    init.body = JSON.stringify(body);
  }
  return fetch(`${API_BASE_URL}${path}`, init);
}

async function syncUserState(){
  if(!currentUser || !authToken || !currentUserData) return;
  try {
    const response = await apiRequest('/api/user', 'POST', currentUserData);
    if(!response.ok){
      console.warn('Could not sync user state:', response.status);
      return;
    }
    const data = await response.json();
    if(data.user){
      currentUserData = data.user;
    }
  } catch (error) {
    console.warn('Failed to sync user state:', error);
  }
}

function hideAllOverlays(){
  if(homeOverlay) homeOverlay.style.display = 'none';
  if(shopOverlay) shopOverlay.style.display = 'none';
  if(settingsOverlay) settingsOverlay.style.display = 'none';
  if(inventoryPanel) inventoryPanel.style.display = 'none';
  if(homePlayPanel) homePlayPanel.style.display = 'none';
}

function showHomeMenu(){
  if(homeOverlay) homeOverlay.style.display = 'flex';
  if(homePlayPanel) homePlayPanel.style.display = 'none';
  if(inventoryPanel) inventoryPanel.style.display = 'none';
  if(shopOverlay) shopOverlay.style.display = 'none';
  if(settingsOverlay) settingsOverlay.style.display = 'none';
  if(homeTokensEl) homeTokensEl.textContent = tokens;
  if(homeStatus) homeStatus.textContent = '';
}

function showShopOverlay(){
  if(homeOverlay) homeOverlay.style.display = 'none';
  if(shopOverlay) shopOverlay.style.display = 'flex';
  if(settingsOverlay) settingsOverlay.style.display = 'none';
  if(homePlayPanel) homePlayPanel.style.display = 'none';
  if(inventoryPanel) inventoryPanel.style.display = 'none';
  updateShopUI();
}

function setCurrentUser(username, data, token){
  currentUser = username;
  currentUserData = data || {};
  authToken = token || authToken;
  highScore = currentUserData.highScore || 0;
  tokens = currentUserData.tokens || 0;
  stunKey = currentUserData.stunKey || 'e';
  boostKey = currentUserData.boostKey || 'Space';
  const userColors = currentUserData.colors || {};
  playerColor = userColors.player || sessionColors.player;
  enemyColor = userColors.enemy || sessionColors.enemy;
  wallColor = userColors.wall || sessionColors.wall;
  orbColor = userColors.orb || sessionColors.orb;
  finishColor = userColors.finish || sessionColors.finish;
  ensureUserUpgrades(currentUserData);
  player.color = playerColor;
  orbs.forEach(o => { o.color = orbColor; });
  enemies.forEach(e => { e.color = enemyColor; });
  userNameEl.textContent = username;
  highScoreEl.textContent = highScore;
  if(authToken){
    localStorage.setItem('orbMazeAuthToken', authToken);
  }
  if(homeOverlay){
    homeOverlay.style.display = 'flex';
    if(homeTokensEl) homeTokensEl.textContent = tokens;
    if(homePlayPanel) homePlayPanel.style.display = 'none';
  }
}

function updateUserUI(){
  userNameEl.textContent = currentUser || 'Guest';
  highScoreEl.textContent = highScore;
  tokensEl.textContent = tokens;
}

async function restoreSession(){
  const savedToken = localStorage.getItem('orbMazeAuthToken');
  if(!savedToken) return false;
  authToken = savedToken;
  try {
    const response = await apiRequest('/api/me');
    if(!response.ok){
      localStorage.removeItem('orbMazeAuthToken');
      return false;
    }
    const data = await response.json();
    setCurrentUser(data.username, data.user, authToken);
    loginOverlay.style.display = 'none';
    return true;
  } catch (error) {
    localStorage.removeItem('orbMazeAuthToken');
    return false;
  }
}

function initLogin(){
  activateLoginTab();
  loginOverlay.style.display = 'flex';
  if(homeOverlay) homeOverlay.style.display = 'none';
  gameState = 'start';
}

function showStatus(message, error = false){
  loginStatus.textContent = message;
  loginStatus.style.color = error ? '#ff7b7b' : '#7af97a';
}

function activateLoginTab(){
  loginTab.classList.add('active');
  signupTab.classList.remove('active');
  loginForm.classList.remove('hidden');
  signupForm.classList.add('hidden');
  loginUserInput.value = '';
  loginPassInput.value = '';
  signupUserInput.value = '';
  signupPassInput.value = '';
  showStatus('');
}

function activateSignupTab(){
  signupTab.classList.add('active');
  loginTab.classList.remove('active');
  signupForm.classList.remove('hidden');
  loginForm.classList.add('hidden');
  loginUserInput.value = '';
  loginPassInput.value = '';
  signupUserInput.value = '';
  signupPassInput.value = '';
  showStatus('');
}

async function handleLogin(){
  const username = loginUserInput.value.trim();
  const password = loginPassInput.value;
  if(!username || !password){
    showStatus('Enter username and password.', true);
    return;
  }
  try {
    const response = await apiRequest('/api/login', 'POST', { username, password });
    if(!response.ok){
      const data = await response.json().catch(() => ({}));
      showStatus(data.message || 'Invalid username or password.', true);
      return;
    }
    const data = await response.json();
    setCurrentUser(data.username, data.user, data.token);
    loginOverlay.style.display = 'none';
    loginUserInput.value = '';
    loginPassInput.value = '';
    showStatus('Logged in successfully.');
    gameState = 'start';
    updateUserUI();
  } catch (error) {
    showStatus(AUTH_SERVER_ERROR_MESSAGE, true);
  }
}

async function handleSignup(){
  const username = signupUserInput.value.trim();
  const password = signupPassInput.value;
  if(!username || !password){
    showStatus('Enter username and password.', true);
    return;
  }
  try {
    const response = await apiRequest('/api/signup', 'POST', { username, password });
    if(!response.ok){
      const data = await response.json().catch(() => ({}));
      showStatus(data.message || 'Could not create account.', true);
      return;
    }
    const data = await response.json();
    setCurrentUser(data.username, data.user, data.token);
    loginOverlay.style.display = 'none';
    signupUserInput.value = '';
    signupPassInput.value = '';
    showStatus('Account created; logged in.');
    gameState = 'start';
    updateUserUI();
  } catch (error) {
    showStatus(AUTH_SERVER_ERROR_MESSAGE, true);
  }
}

function initMaze(){
  for(let y = 0; y < rows; y++){
    maze[y] = [];
    for(let x = 0; x < cols; x++){
      maze[y][x] = { x, y, walls: [true, true, true, true], visited: false };
    }
  }

  const stack = [];
  let current = maze[0][0];
  current.visited = true;
  stack.push(current);

  while(stack.length){
    current = stack[stack.length - 1];
    const neighbors = [];
    const directions = [
      {dx: 0, dy: -1, wall: 0, opp: 2},
      {dx: 1, dy: 0, wall: 1, opp: 3},
      {dx: 0, dy: 1, wall: 2, opp: 0},
      {dx: -1, dy: 0, wall: 3, opp: 1}
    ];

    for(const d of directions){
      const nx = current.x + d.dx;
      const ny = current.y + d.dy;
      if(nx >= 0 && nx < cols && ny >= 0 && ny < rows && !maze[ny][nx].visited){
        neighbors.push({cell: maze[ny][nx], dir: d});
      }
    }

    if(neighbors.length){
      const choice = neighbors[Math.floor(rand(0, neighbors.length))];
      current.walls[choice.dir.wall] = false;
      choice.cell.walls[choice.dir.opp] = false;
      choice.cell.visited = true;
      stack.push(choice.cell);
    } else {
      stack.pop();
    }
  }

  // add a few loops so the maze isn't too strict
  for(let i = 0; i < 18; i++){
    const x = Math.floor(rand(0, cols));
    const y = Math.floor(rand(0, rows));
    const cell = maze[y][x];
    const choices = [];
    if(y > 0 && cell.walls[0] && !maze[y-1][x].walls[2]) choices.push({dx: 0, dy: -1, wall: 0, opp: 2});
    if(x < cols - 1 && cell.walls[1] && !maze[y][x+1].walls[3]) choices.push({dx: 1, dy: 0, wall: 1, opp: 3});
    if(y < rows - 1 && cell.walls[2] && !maze[y+1][x].walls[0]) choices.push({dx: 0, dy: 1, wall: 2, opp: 0});
    if(x > 0 && cell.walls[3] && !maze[y][x-1].walls[1]) choices.push({dx: -1, dy: 0, wall: 3, opp: 1});
    if(choices.length){
      const extra = choices[Math.floor(rand(0, choices.length))];
      cell.walls[extra.wall] = false;
      maze[y + extra.dy][x + extra.dx].walls[extra.opp] = false;
    }
  }
}

function spawnOrbs(){
  const spots = [];
  for(let y = 0; y < rows; y++){
    for(let x = 0; x < cols; x++){
      if((x === 0 && y === 0) || (x === finishCell.x && y === finishCell.y)) continue;
      spots.push({ x, y });
    }
  }

  for(let i = 0; i < initialOrbCount && spots.length > 0; i++){
    const idx = Math.floor(rand(0, spots.length));
    const spot = spots.splice(idx, 1)[0];
    orbs.push({
      x: spot.x * cellSize + cellSize / 2,
      y: spot.y * cellSize + cellSize / 2,
      r: orbRadius,
      color: orbColor
    });
  }
}

function spawnEnemies(){
  enemies.length = 0;
  const spots = [];
  for(let y = 0; y < rows; y++){
    for(let x = 0; x < cols; x++){
      if((x === 0 && y === 0) || (x === finishCell.x && y === finishCell.y)) continue;
      if(Math.hypot(x, y) < 4) continue;
      spots.push({ x, y });
    }
  }

  const cfg = modeConfigs[currentMode] || modeConfigs.Medium;
  for(let i = 0; i < enemyCount && spots.length > 0; i++){
    const idx = Math.floor(rand(0, spots.length));
    const spot = spots.splice(idx, 1)[0];
    const center = getCellCenter(spot.x, spot.y);
    // Enemy speed is anchored to starter movement speed, not player upgrades.
    const baseSpeed = PLAYER_BASE_SPEED * (cfg.speedFactor || 0.8);
    const speed = baseSpeed * (0.9 + Math.random() * 0.2);
    enemies.push({
      x: center.x,
      y: center.y,
      spawnX: center.x,
      spawnY: center.y,
      r: 12,
      speed: speed,
      color: enemyColor,
      path: [],
      pathTimer: 0,
      stunned: false,
      stunTimer: 0
    });
  }
}

function hideAllOverlays(){
  if(homeOverlay) homeOverlay.style.display = 'none';
  if(shopOverlay) shopOverlay.style.display = 'none';
  if(settingsOverlay) settingsOverlay.style.display = 'none';
  if(inventoryPanel) inventoryPanel.style.display = 'none';
  if(homePlayPanel) homePlayPanel.style.display = 'none';
}

function startGame(){
  hideAllOverlays();
  resetGame();
  gameState = 'playing';
}

function resetGame(){
  initMaze();
  orbs.length = 0;
  enemies.length = 0;
  score = 0;
  lives = 3;
  invulnerable = false;
  invulnerabilityTimer = 0;
  // reset boost state
  boostActive = false;
  boostTimer = 0;
  boostCooldown = 0;
  teleportUsed = false;
  scoreEl.textContent = score;
  livesEl.textContent = lives;
  player.x = cellSize / 2;
  player.y = cellSize / 2;
  spawnOrbs();
  spawnEnemies();
}

function resetPlayerPosition(){
  player.x = cellSize / 2;
  player.y = cellSize / 2;
  player.vx = 0;
  player.vy = 0;
}

function resetEnemiesToSpawn(){
  enemies.forEach(e => {
    if(typeof e.spawnX === 'number' && typeof e.spawnY === 'number'){
      e.x = e.spawnX;
      e.y = e.spawnY;
    }
    e.path = [];
    e.pathTimer = 0;
    e.stunned = false;
    e.stunTimer = 0;
  });
}

function respawnOrb(){
  const spots = [];
  for(let y = 0; y < rows; y++){
    for(let x = 0; x < cols; x++){
      if((x === 0 && y === 0) || (x === finishCell.x && y === finishCell.y)) continue;
      const pos = { x: x * cellSize + cellSize / 2, y: y * cellSize + cellSize / 2 };
      const blocked = orbs.some(o => Math.hypot(o.x - pos.x, o.y - pos.y) < orbRadius * 2) ||
                     enemies.some(e => Math.hypot(e.x - pos.x, e.y - pos.y) < orbRadius * 2) ||
                     Math.hypot(player.x - pos.x, player.y - pos.y) < orbRadius * 3;
      if(!blocked) spots.push({ x, y });
    }
  }

  if(spots.length === 0) return;
  const spot = spots[Math.floor(rand(0, spots.length))];
  orbs.push({
    x: spot.x * cellSize + cellSize / 2,
    y: spot.y * cellSize + cellSize / 2,
    r: orbRadius,
    color: '#ffd166'
  });
}

function closestPointOnSegment(px, py, x1, y1, x2, y2){
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if(len2 === 0) return {x: x1, y: y1};
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return {x: x1 + dx * t, y: y1 + dy * t};
}

function getWallSegments(){
  const segments = [];
  for(let y = 0; y < rows; y++){
    for(let x = 0; x < cols; x++){
      const cell = maze[y][x];
      const x0 = x * cellSize;
      const y0 = y * cellSize;

      if(y === 0 && cell.walls[0]){
        segments.push({x1: x0, y1: y0, x2: x0 + cellSize, y2: y0});
      }
      if(cell.walls[1]){
        segments.push({x1: x0 + cellSize, y1: y0, x2: x0 + cellSize, y2: y0 + cellSize});
      }
      if(cell.walls[2]){
        segments.push({x1: x0, y1: y0 + cellSize, x2: x0 + cellSize, y2: y0 + cellSize});
      }
      if(x === 0 && cell.walls[3]){
        segments.push({x1: x0, y1: y0, x2: x0, y2: y0 + cellSize});
      }
    }
  }
  return segments;
}

function resolveWallCollisions(object){
  const walls = getWallSegments();
  for(let pass = 0; pass < 3; pass++){
    for(const wall of walls){
      const point = closestPointOnSegment(object.x, object.y, wall.x1, wall.y1, wall.x2, wall.y2);
      const dx = object.x - point.x;
      const dy = object.y - point.y;
      const dist = Math.hypot(dx, dy);
      if(dist < object.r){
        const overlap = object.r - dist;
        let nx = 0;
        let ny = 0;
        if(dist > 0){
          nx = dx / dist;
          ny = dy / dist;
        } else {
          nx = wall.y2 === wall.y1 ? 0 : 1;
          ny = wall.x2 === wall.x1 ? 0 : 1;
        }
        object.x += nx * overlap;
        object.y += ny * overlap;
      }
    }
  }
}

function findPath(startCell, targetCell){
  if(!startCell || !targetCell) return null;
  const queue = [startCell];
  const visited = new Set([cellKey(startCell)]);
  const parent = new Map();
  const directions = [
    {dx: 0, dy: -1, wall: 0},
    {dx: 1, dy: 0, wall: 1},
    {dx: 0, dy: 1, wall: 2},
    {dx: -1, dy: 0, wall: 3}
  ];

  while(queue.length){
    const cell = queue.shift();
    if(cell.x === targetCell.x && cell.y === targetCell.y){
      const path = [cell];
      let currentKey = cellKey(cell);
      while(parent.has(currentKey)){
        const prev = parent.get(currentKey);
        path.unshift(prev);
        currentKey = cellKey(prev);
      }
      return path;
    }

    for(const d of directions){
      if(cell.walls[d.wall]) continue;
      const next = getCellAt(cell.x + d.dx, cell.y + d.dy);
      if(!next) continue;
      const nextKey = cellKey(next);
      if(!visited.has(nextKey)){
        visited.add(nextKey);
        parent.set(nextKey, cell);
        queue.push(next);
      }
    }
  }
  return null;
}

function teleportNearExit(){
  const finish = getCellAt(finishCell.x, finishCell.y);
  if(!finish) return;
  const playerCell = getCellAt(Math.floor(player.x / cellSize), Math.floor(player.y / cellSize));
  const level = getTeleportLevel();
  let target = null;
  const path = findPath(playerCell, finish);
  if(path && path.length > 1){
    const stepsBack = Math.max(1, 4 - level);
    const index = Math.max(0, path.length - stepsBack - 1);
    target = path[index];
  }

  if(!target){
    const neighbors = [
      {dx: -1, dy: 0, wallIndex: 1, oppIndex: 3},
      {dx: 1, dy: 0, wallIndex: 3, oppIndex: 1},
      {dx: 0, dy: -1, wallIndex: 2, oppIndex: 0},
      {dx: 0, dy: 1, wallIndex: 0, oppIndex: 2}
    ];
    for(const neighbor of neighbors){
      const cell = getCellAt(finish.x + neighbor.dx, finish.y + neighbor.dy);
      if(!cell) continue;
      if(!cell.walls[neighbor.wallIndex] && !finish.walls[neighbor.oppIndex]){
        target = cell;
        break;
      }
    }
  }

  if(!target){
    const fallback = getCellAt(finish.x - 1, finish.y) || getCellAt(finish.x, finish.y - 1) || getCellAt(finish.x + 1, finish.y) || getCellAt(finish.x, finish.y + 1);
    if(fallback) target = fallback;
  }
  if(target){
    const center = getCellCenter(target.x, target.y);
    player.x = center.x;
    player.y = center.y;
    player.vx = 0;
    player.vy = 0;
    resolveWallCollisions(player);
  }
}

let stunCooldown = 0;
const stunCooldownMax = 5;
const stunDuration = 2.5;
let boostCooldown = 0;
const boostCooldownMax = 10;
const boostDuration = 3;
let boostActive = false;
let boostTimer = 0;
let teleportUsed = false;
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.key] = true;
  const normKey = (e.code === 'Space') ? 'Space' : (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  // If we're capturing a key assignment, handle it here and stop further processing
  if(capturingKey){
    if(normKey === 'Enter'){
      if(inventoryStatus) inventoryStatus.textContent = 'Enter cannot be used';
      return;
    }
    if(capturingKey === 'stun'){
      if(normKey === boostKey){
        if(inventoryStatus) inventoryStatus.textContent = 'That key is already assigned to boost';
      } else {
        stunKey = normKey;
        if(stunKeyDisplay) stunKeyDisplay.textContent = (stunKey === 'Space' ? 'Space' : stunKey.toUpperCase());
        if(currentUserData){
          currentUserData.stunKey = stunKey;
          syncUserState();
        } else { sessionStunKey = stunKey; }
        if(inventoryStatus) inventoryStatus.textContent = '';
        capturingKey = null;
      }
    } else if(capturingKey === 'boost'){
      if(normKey === stunKey){
        if(inventoryStatus) inventoryStatus.textContent = 'That key is already assigned to stun';
      } else {
        boostKey = normKey;
        if(boostKeyDisplay) boostKeyDisplay.textContent = (boostKey === 'Space' ? 'Space' : boostKey.toUpperCase());
        if(currentUserData){
          currentUserData.boostKey = boostKey;
          syncUserState();
        } else { sessionBoostKey = boostKey; }
        if(inventoryStatus) inventoryStatus.textContent = '';
        capturingKey = null;
      }
    }
    return;
  }
  if(e.key === 'Enter' && loginOverlay.style.display === 'none' && (!homeOverlay || homeOverlay.style.display === 'none') && (gameState === 'start' || gameState === 'dead' || gameState === 'won')){
    startGame();
  }
  if((e.key === 'm' || e.key === 'M') && (gameState === 'dead' || gameState === 'won')){
    returnToHomeMenu();
  }
  if(gameState === 'playing' && normKey === stunKey && stunCooldown <= 0){
    stunCooldown = stunCooldownMax * getCooldownFactor();
    enemies.forEach(enemy => {
      enemy.stunned = true;
      enemy.stunTimer = stunDuration;
    });
  }
  if(gameState === 'playing' && isEquipped('teleport') && normKey === boostKey && !teleportUsed){
    teleportNearExit();
    teleportUsed = true;
  }
  // Boost on assigned key if equipped
  if(gameState === 'playing' && isEquipped('boost') && normKey === boostKey && boostCooldown <= 0 && !boostActive){
    boostActive = true;
    boostTimer = getBoostDuration();
    boostCooldown = boostCooldownMax * getCooldownFactor();
  }
});
window.addEventListener('keyup', e => { keys[e.key] = false; });

loginTab.addEventListener('click', activateLoginTab);
signupTab.addEventListener('click', activateSignupTab);

const loginFormElement = document.getElementById('login-form');
const signupFormElement = document.getElementById('signup-form');
const setStunBtn = document.getElementById('set-stun-key');
const setBoostBtn = document.getElementById('set-boost-key');
const stunKeyDisplay = document.getElementById('stun-key-display');
const boostKeyDisplay = document.getElementById('boost-key-display');
const homeOverlay = document.getElementById('home-overlay');
const homePlayBtn = document.getElementById('home-play');
const homeOpenShopBtn = document.getElementById('home-open-shop');
const homeInventoryBtn = document.getElementById('home-inventory');
const homeSignoutBtn = document.getElementById('home-signout');
const homeTokensEl = document.getElementById('home-tokens');
const homePlayPanel = document.getElementById('home-play-panel');
const inventoryPanel = document.getElementById('inventory-panel');
const startGameBtn = document.getElementById('start-game');
const inventorySaveBtn = document.getElementById('inventory-save');
const inventoryCloseBtn = document.getElementById('inventory-close');
const inventoryBackMainBtn = document.getElementById('inventory-back-main');
const inventoryStatus = document.getElementById('inventory-status');
const inventoryItemBoostBtn = document.getElementById('inventory-item-boost');
const inventoryItemPassiveBtn = document.getElementById('inventory-item-passive');
const inventoryItemTeleportBtn = document.getElementById('inventory-item-teleport');
const inventoryItemFastFeetBtn = document.getElementById('inventory-item-fastFeet');
const inventoryPreviewDetails = document.getElementById('inventory-preview-details');
const inventoryUpgradeCard = document.getElementById('inventory-upgrade-card');
const inventoryUpgradeLevelEl = document.getElementById('inventory-upgrade-level');
const inventoryUpgradeCostEl = document.getElementById('inventory-upgrade-cost');
const inventoryUpgradeBtn = document.getElementById('inventory-upgrade-btn');
const inventoryUpgradeStatus = document.getElementById('inventory-upgrade-status');
const homeStatus = document.getElementById('home-status');
const homeBackMainBtn = document.getElementById('home-back-main');
const shopBackMainBtn = document.getElementById('shop-back-main');
const openShopBtn = document.getElementById('open-shop');
const returnMenuBtn = document.getElementById('return-menu');
const shopOverlay = document.getElementById('shop-overlay');
const shopTokensEl = document.getElementById('shop-tokens');
const shopItemBoostBtn = document.getElementById('shop-item-boost');
const shopItemPassiveBtn = document.getElementById('shop-item-passive');
const shopPreviewTitle = document.getElementById('shop-preview-title');
const shopPreviewDescription = document.getElementById('shop-preview-description');
const shopPreviewStatus = document.getElementById('shop-preview-status');
const shopBuyBtn = document.getElementById('shop-buy-btn');
const shopCloseBtn = document.getElementById('shop-close-btn');
const homeSettingsBtn = document.getElementById('home-settings');
const homeUpgradesBtn = document.getElementById('home-upgrades');
const upgradesOverlay = document.getElementById('upgrades-overlay');
const upgradesCloseBtn = document.getElementById('upgrades-close-btn');
const upgradesTokensEl = document.getElementById('upgrades-tokens');
const speedUpgradeBtn = document.getElementById('speed-upgrade-btn');
const speedUpgradeLevelEl = document.getElementById('speed-upgrade-level');
const speedUpgradeCostEl = document.getElementById('speed-upgrade-cost');
const speedUpgradeFill = document.getElementById('speed-upgrade-fill');
const speedUpgradeStatus = document.getElementById('speed-upgrade-status');
const tokenUpgradeBtn = document.getElementById('token-upgrade-btn');
const tokenUpgradeLevelEl = document.getElementById('token-upgrade-level');
const tokenUpgradeCostEl = document.getElementById('token-upgrade-cost');
const tokenUpgradeFill = document.getElementById('token-upgrade-fill');
const tokenUpgradeStatus = document.getElementById('token-upgrade-status');
const cooldownUpgradeBtn = document.getElementById('cooldown-upgrade-btn');
const cooldownUpgradeLevelEl = document.getElementById('cooldown-upgrade-level');
const cooldownUpgradeCostEl = document.getElementById('cooldown-upgrade-cost');
const cooldownUpgradeFill = document.getElementById('cooldown-upgrade-fill');
const cooldownUpgradeStatus = document.getElementById('cooldown-upgrade-status');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsSaveBtn = document.getElementById('settings-save');
const settingsBackMainBtn = document.getElementById('settings-back-main');
const settingsStatus = document.getElementById('settings-status');
const playerColorPicker = document.getElementById('player-color-picker');
const enemyColorPicker = document.getElementById('enemy-color-picker');
const wallColorPicker = document.getElementById('wall-color-picker');
const orbColorPicker = document.getElementById('orb-color-picker');
const finishColorPicker = document.getElementById('finish-color-picker');

loginFormElement.addEventListener('submit', e => {
  e.preventDefault();
  handleLogin();
});
signupFormElement.addEventListener('submit', e => {
  e.preventDefault();
  handleSignup();
});
signOutBtn.addEventListener('click', () => {
  signOut();
});
if(playAgainBtn){
  playAgainBtn.addEventListener('click', () => {
    if(gameState === 'won'){
      startGame();
    }
  });
}
const modeSelect = document.getElementById('mode-select');
if(modeSelect){
  modeSelect.value = currentMode;
  modeSelect.addEventListener('change', e => {
    applyMode(e.target.value);
  });
}
// Home screen actions
if(homePlayBtn){
  homePlayBtn.addEventListener('click', () => {
    if(homePlayPanel) homePlayPanel.style.display = 'block';
    if(inventoryPanel) inventoryPanel.style.display = 'none';
    if(homeStatus) homeStatus.textContent = '';
    if(homeTokensEl) homeTokensEl.textContent = tokens;
  });
}
if(homeOpenShopBtn){
  homeOpenShopBtn.addEventListener('click', () => { showShopOverlay(); });
}
if(homeUpgradesBtn){
  homeUpgradesBtn.addEventListener('click', () => {
    if(upgradesOverlay) upgradesOverlay.style.display = 'flex';
    if(homeOverlay) homeOverlay.style.display = 'none';
    if(shopOverlay) shopOverlay.style.display = 'none';
    if(settingsOverlay) settingsOverlay.style.display = 'none';
    if(inventoryPanel) inventoryPanel.style.display = 'none';
    if(homePlayPanel) homePlayPanel.style.display = 'none';
    if(upgradesTokensEl) upgradesTokensEl.textContent = tokens;
    refreshUpgradeUI();
  });
}
if(homeInventoryBtn){
  homeInventoryBtn.addEventListener('click', () => {
    if(inventoryPanel) inventoryPanel.style.display = 'block';
    if(homePlayPanel) homePlayPanel.style.display = 'none';
    if(inventoryStatus) inventoryStatus.textContent = '';
    updateInventoryUI();
  });
}
if(homeSettingsBtn){
  homeSettingsBtn.addEventListener('click', () => {
    if(settingsOverlay) settingsOverlay.style.display = 'flex';
    if(homeOverlay) homeOverlay.style.display = 'none';
    if(shopOverlay) shopOverlay.style.display = 'none';
    if(inventoryPanel) inventoryPanel.style.display = 'none';
    if(homePlayPanel) homePlayPanel.style.display = 'none';
    if(settingsStatus) settingsStatus.textContent = '';
    syncSettingsInputs();
  });
}
if(settingsCloseBtn){
  settingsCloseBtn.addEventListener('click', () => {
    if(settingsOverlay) settingsOverlay.style.display = 'none';
    showHomeMenu();
  });
}
if(upgradesCloseBtn){
  upgradesCloseBtn.addEventListener('click', () => {
    if(upgradesOverlay) upgradesOverlay.style.display = 'none';
    showHomeMenu();
  });
}
if(speedUpgradeBtn){
  speedUpgradeBtn.addEventListener('click', () => applyUpgrade('speed'));
}
if(tokenUpgradeBtn){
  tokenUpgradeBtn.addEventListener('click', () => applyUpgrade('token'));
}
if(cooldownUpgradeBtn){
  cooldownUpgradeBtn.addEventListener('click', () => applyUpgrade('cooldown'));
}
if(settingsBackMainBtn){
  settingsBackMainBtn.addEventListener('click', () => {
    if(settingsOverlay) settingsOverlay.style.display = 'none';
    showHomeMenu();
  });
}
if(settingsSaveBtn){
  settingsSaveBtn.addEventListener('click', () => {
    applyColorSettings();
    if(settingsStatus) settingsStatus.textContent = 'Settings saved.';
  });
}
if(homeSignoutBtn){
  homeSignoutBtn.addEventListener('click', () => { signOut(); });
}

if(startGameBtn){
  startGameBtn.addEventListener('click', () => {
    // select mode
    const modeRadios = document.getElementsByName('home-mode');
    for(const r of modeRadios){ if(r.checked){ applyMode(r.value); break; } }
    if(homeOverlay) homeOverlay.style.display = 'none';
    startGame();
  });
}

if(inventorySaveBtn){
  inventorySaveBtn.addEventListener('click', () => {
    const wants = Array.from(selectedInventoryItems);
    const abilities = wants.filter(item => itemTypes[item] === 'ability');
    const passives = wants.filter(item => itemTypes[item] === 'passive');
    if(abilities.length > 1){ if(inventoryStatus) inventoryStatus.textContent = 'Only one ability can be equipped.'; return; }
    if(passives.length > 1){ if(inventoryStatus) inventoryStatus.textContent = 'Only one passive can be equipped.'; return; }
    if(wants.includes('boost') && !getUserValue('ownedBoost', false)){
      if(inventoryStatus) inventoryStatus.textContent = 'You do not own Speed Boost.'; return;
    }
    if(wants.includes('teleport') && !getUserValue('ownedTeleport', false)){
      if(inventoryStatus) inventoryStatus.textContent = 'You do not own Teleport.'; return;
    }
    if(wants.includes('fastFeet') && !getUserValue('ownedFastFeet', false)){
      if(inventoryStatus) inventoryStatus.textContent = 'You do not own Fast Feet.'; return;
    }
    if(wants.includes('passive') && !getUserValue('ownedPassive', false)){
      if(inventoryStatus) inventoryStatus.textContent = 'You do not own No Blindness passive.'; return;
    }
    if(currentUserData){
      currentUserData.equipped = wants;
      syncUserState();
    } else { sessionEquipped = wants; }
    if(inventoryStatus) inventoryStatus.textContent = 'Inventory saved.';
  });
}
if(inventoryCloseBtn){
  inventoryCloseBtn.addEventListener('click', () => {
    if(inventoryPanel) inventoryPanel.style.display = 'none';
    if(homePlayPanel) homePlayPanel.style.display = 'none';
  });
}
if(inventoryBackMainBtn){
  inventoryBackMainBtn.addEventListener('click', () => {
    if(inventoryPanel) inventoryPanel.style.display = 'none';
    if(homePlayPanel) homePlayPanel.style.display = 'none';
    showHomeMenu();
  });
}
if(inventoryItemBoostBtn){
  inventoryItemBoostBtn.addEventListener('click', () => selectInventoryItem('boost'));
}
if(inventoryItemTeleportBtn){
  inventoryItemTeleportBtn.addEventListener('click', () => selectInventoryItem('teleport'));
}
if(inventoryItemFastFeetBtn){
  inventoryItemFastFeetBtn.addEventListener('click', () => selectInventoryItem('fastFeet'));
}
if(inventoryItemPassiveBtn){
  inventoryItemPassiveBtn.addEventListener('click', () => selectInventoryItem('passive'));
}
if(inventoryUpgradeBtn){
  inventoryUpgradeBtn.addEventListener('click', async () => {
    if(!activeInventoryItem) return;
    await applyUpgrade(activeInventoryItem);
  });
}
if(shopBackMainBtn){
  shopBackMainBtn.addEventListener('click', () => {
    if(shopOverlay) shopOverlay.style.display = 'none';
    showHomeMenu();
  });
}
if(shopCloseBtn){
  shopCloseBtn.addEventListener('click', () => {
    if(shopOverlay) shopOverlay.style.display = 'none';
  });
}
if(homeBackMainBtn){
  homeBackMainBtn.addEventListener('click', () => {
    showHomeMenu();
  });
}

// key assignment buttons remain for inventory edits
if(setStunBtn){
  setStunBtn.addEventListener('click', () => {
    capturingKey = 'stun';
    if(inventoryStatus) inventoryStatus.textContent = 'Press a key to assign to Stun';
  });
}
if(setBoostBtn){
  setBoostBtn.addEventListener('click', () => {
    capturingKey = 'boost';
    if(inventoryStatus) inventoryStatus.textContent = 'Press a key to assign to Boost';
  });
}

// initialize displays
if(stunKeyDisplay) stunKeyDisplay.textContent = (stunKey === 'Space' ? 'Space' : stunKey.toUpperCase());
if(boostKeyDisplay) boostKeyDisplay.textContent = (boostKey === 'Space' ? 'Space' : boostKey.toUpperCase());

const shopItems = {
  boost: {
    name: 'Speed Boost',
    cost: 10,
    description: 'Equips a faster sprint ability for the next run.',
    icon: '⚡',
    ownedKey: 'ownedBoost',
    saveKey: 'ownedBoost'
  },
  teleport: {
    name: 'Teleport',
    cost: 100,
    description: 'Teleport near the exit once during a run.',
    icon: '🌀',
    ownedKey: 'ownedTeleport',
    saveKey: 'ownedTeleport'
  },
  fastFeet: {
    name: 'Fast Feet',
    cost: 25,
    description: 'Increase player movement speed by 1.5x while equipped.',
    icon: '🏃',
    ownedKey: 'ownedFastFeet',
    saveKey: 'ownedFastFeet'
  },
  passive: {
    name: 'No Blindness',
    cost: 50,
    description: 'Removes fog when playing, making the maze easier.',
    icon: '👁️',
    ownedKey: 'ownedPassive',
    saveKey: 'ownedPassive'
  }
};

let selectedShopItem = 'boost';
let selectedInventoryItems = new Set();
let activeInventoryItem = null;
const itemTypes = { boost: 'ability', teleport: 'ability', fastFeet: 'passive', passive: 'passive' };

const upgradeConfig = {
  speed: { maxLevel: 10, baseCost: 20, costFactor: 1.5 },
  token: { maxLevel: 10, baseCost: 20, costFactor: 1.5 },
  cooldown: { maxLevel: 10, baseCost: 20, costFactor: 1.5 },
  boost: { maxLevel: 3, baseCost: 40, costFactor: 2.2 },
  teleport: { maxLevel: 3, baseCost: 40, costFactor: 2.2 },
  fastFeet: { maxLevel: 3, baseCost: 40, costFactor: 2.2 },
  passive: { maxLevel: 3, baseCost: 40, costFactor: 2.2 }
};

function formatCurrency(amount){
  return `${amount} Tokens`;
}

function getUpgradeCost(type, level){
  const cfg = upgradeConfig[type];
  if(!cfg) return 0;
  return Math.max(1, Math.ceil(cfg.baseCost * Math.pow(cfg.costFactor, level)));
}

function ensureUserUpgrades(user){
  const legacyCharacterLevel = user.characterLevel || 0;
  if(user.speedLevel == null) user.speedLevel = legacyCharacterLevel;
  if(user.tokenLevel == null) user.tokenLevel = legacyCharacterLevel;
  if(user.cooldownLevel == null) user.cooldownLevel = legacyCharacterLevel;
  if(user.boostLevel == null) user.boostLevel = 0;
  if(user.teleportLevel == null) user.teleportLevel = 0;
  if(user.fastFeetLevel == null) user.fastFeetLevel = 0;
  if(user.passiveLevel == null) user.passiveLevel = 0;
}

function getSpeedLevel(){ return getUserValue('speedLevel', 0); }
function getTokenLevel(){ return getUserValue('tokenLevel', 0); }
function getCooldownLevel(){ return getUserValue('cooldownLevel', 0); }
function getBoostLevel(){ return getUserValue('boostLevel', 0); }
function getTeleportLevel(){ return getUserValue('teleportLevel', 0); }
function getFastFeetLevel(){ return getUserValue('fastFeetLevel', 0); }
function getPassiveLevel(){ return getUserValue('passiveLevel', 0); }

function getCharacterSpeedMultiplier(){
  return 1 + getSpeedLevel() * 0.03;
}

function getTokenMultiplier(){
  return 1 + getTokenLevel() * 0.05;
}

function getCooldownFactor(){
  return Math.max(0.55, 1 - getCooldownLevel() * 0.04);
}

function getBoostPower(){
  return 1 + getBoostLevel() * 0.25;
}

function getBoostDuration(){
  return boostDuration * (1 + getBoostLevel() * 0.2);
}

function getFastFeetMultiplier(){
  return 1.5 + getFastFeetLevel() * 0.12;
}

function getPassiveEffect(){
  return 1 + getPassiveLevel();
}

function getRunScoreValue(){
  return Math.max(1, Math.round(score * getTokenMultiplier()));
}

function getUpgradeLevel(type){
  if(type === 'speed') return getSpeedLevel();
  if(type === 'token') return getTokenLevel();
  if(type === 'cooldown') return getCooldownLevel();
  if(type === 'boost') return getBoostLevel();
  if(type === 'teleport') return getTeleportLevel();
  if(type === 'fastFeet') return getFastFeetLevel();
  if(type === 'passive') return getPassiveLevel();
  return 0;
}

function getUpgradeLevelKey(type){
  if(type === 'speed') return 'speedLevel';
  if(type === 'token') return 'tokenLevel';
  if(type === 'cooldown') return 'cooldownLevel';
  return `${type}Level`;
}

function getUpgradeDisplayName(type){
  if(type === 'speed') return 'Speed';
  if(type === 'token') return 'Token';
  if(type === 'cooldown') return 'Cooldown';
  return shopItems[type]?.name || 'Item';
}

function refreshUpgradeUI(){
  if(upgradesTokensEl) upgradesTokensEl.textContent = tokens;

  const setUpgradeRow = (type, levelEl, costEl, btnEl, fillEl) => {
    if(!levelEl || !costEl || !btnEl) return;
    const level = getUpgradeLevel(type);
    const maxLevel = upgradeConfig[type].maxLevel;
    const atMax = level >= maxLevel;
    const cost = getUpgradeCost(type, level);
    levelEl.textContent = String(level);
    if(fillEl){
      fillEl.style.width = `${Math.min(100, (level / maxLevel) * 100)}%`;
    }
    if(atMax){
      costEl.textContent = 'MAX';
      btnEl.textContent = 'Maxed';
      btnEl.disabled = true;
      return;
    }
    costEl.textContent = `Cost: ${cost}`;
    btnEl.textContent = `Upgrade ${getUpgradeDisplayName(type)}`;
    btnEl.disabled = tokens < cost;
  };

  setUpgradeRow('speed', speedUpgradeLevelEl, speedUpgradeCostEl, speedUpgradeBtn, speedUpgradeFill);
  setUpgradeRow('token', tokenUpgradeLevelEl, tokenUpgradeCostEl, tokenUpgradeBtn, tokenUpgradeFill);
  setUpgradeRow('cooldown', cooldownUpgradeLevelEl, cooldownUpgradeCostEl, cooldownUpgradeBtn, cooldownUpgradeFill);
}

function refreshInventoryUpgradePanel(item){
  if(!inventoryUpgradeCard || !inventoryUpgradeLevelEl || !inventoryUpgradeCostEl || !inventoryUpgradeBtn) return;
  if(!item || !shopItems[item] || !getOwned(item)){
    inventoryUpgradeCard.style.display = 'none';
    return;
  }

  inventoryUpgradeCard.style.display = 'block';
  const level = getUpgradeLevel(item);
  const maxLevel = upgradeConfig[item].maxLevel;
  const atMax = level >= maxLevel;
  const cost = getUpgradeCost(item, level);

  inventoryUpgradeLevelEl.textContent = `Level ${level}/${maxLevel}`;
  inventoryUpgradeCostEl.textContent = atMax ? 'Cost: MAX' : `Cost: ${cost} Tokens`;
  inventoryUpgradeBtn.textContent = atMax ? 'Maxed' : `Upgrade ${shopItems[item].name}`;
  inventoryUpgradeBtn.disabled = atMax || tokens < cost;
}

async function applyUpgrade(type){
  if(!currentUserData) return;
  if(!upgradeConfig[type]) return;

  const isCoreUpgrade = type === 'speed' || type === 'token' || type === 'cooldown';

  if(!isCoreUpgrade){
    if(!getOwned(type)){
      if(inventoryUpgradeStatus) inventoryUpgradeStatus.textContent = 'You need to own this item before upgrading.';
      return;
    }
    if(!activeInventoryItem || activeInventoryItem !== type){
      if(inventoryUpgradeStatus) inventoryUpgradeStatus.textContent = 'Select this item in inventory first.';
      return;
    }
  }

  const levelKey = getUpgradeLevelKey(type);
  const level = currentUserData[levelKey] || 0;
  const maxLevel = upgradeConfig[type].maxLevel;
  if(level >= maxLevel){
    if(!isCoreUpgrade && inventoryUpgradeStatus) inventoryUpgradeStatus.textContent = 'Already max level.';
    if(type === 'speed' && speedUpgradeStatus) speedUpgradeStatus.textContent = 'Already max level.';
    if(type === 'token' && tokenUpgradeStatus) tokenUpgradeStatus.textContent = 'Already max level.';
    if(type === 'cooldown' && cooldownUpgradeStatus) cooldownUpgradeStatus.textContent = 'Already max level.';
    refreshInventoryUpgradePanel(activeInventoryItem);
    refreshUpgradeUI();
    return;
  }

  const cost = getUpgradeCost(type, level);
  if(tokens < cost){
    if(!isCoreUpgrade && inventoryUpgradeStatus) inventoryUpgradeStatus.textContent = `Need ${cost - tokens} more tokens.`;
    if(type === 'speed' && speedUpgradeStatus) speedUpgradeStatus.textContent = `Need ${cost - tokens} more tokens.`;
    if(type === 'token' && tokenUpgradeStatus) tokenUpgradeStatus.textContent = `Need ${cost - tokens} more tokens.`;
    if(type === 'cooldown' && cooldownUpgradeStatus) cooldownUpgradeStatus.textContent = `Need ${cost - tokens} more tokens.`;
    refreshInventoryUpgradePanel(activeInventoryItem);
    refreshUpgradeUI();
    return;
  }

  tokens -= cost;
  currentUserData.tokens = tokens;
  currentUserData[levelKey] = level + 1;
  await syncUserState();

  updateUserUI();
  if(homeTokensEl) homeTokensEl.textContent = tokens;
  if(shopTokensEl) shopTokensEl.textContent = tokens;
  if(upgradesTokensEl) upgradesTokensEl.textContent = tokens;
  if(!isCoreUpgrade && inventoryUpgradeStatus) inventoryUpgradeStatus.textContent = `${getUpgradeDisplayName(type)} upgraded to level ${currentUserData[levelKey]}.`;
  if(type === 'speed' && speedUpgradeStatus) speedUpgradeStatus.textContent = `Speed upgraded to level ${currentUserData[levelKey]}.`;
  if(type === 'token' && tokenUpgradeStatus) tokenUpgradeStatus.textContent = `Token multiplier upgraded to level ${currentUserData[levelKey]}.`;
  if(type === 'cooldown' && cooldownUpgradeStatus) cooldownUpgradeStatus.textContent = `Cooldown upgraded to level ${currentUserData[levelKey]}.`;
  refreshInventoryUpgradePanel(activeInventoryItem);
  refreshUpgradeUI();
}

function getOwned(item){
  if(!currentUserData) return false;
  return !!getUserValue(shopItems[item].ownedKey, false);
}

function selectShopItem(item){
  selectedShopItem = item;
  const config = shopItems[item];
  if(!config) return;
  if(shopPreviewTitle) shopPreviewTitle.textContent = config.name;
  if(shopPreviewDescription) shopPreviewDescription.textContent = config.description;
  const owned = getOwned(item);
  if(shopPreviewStatus){
    shopPreviewStatus.textContent = owned ? 'Owned' : `Price: ${config.cost} Tokens`;
    shopPreviewStatus.style.color = owned ? '#7af97a' : '#fff';
  }
  if(shopBuyBtn){
    shopBuyBtn.disabled = owned || tokens < config.cost || !currentUserData;
    shopBuyBtn.textContent = owned ? 'Owned' : `Buy (${config.cost})`;
  }
  if(shopItemBoostBtn) shopItemBoostBtn.classList.toggle('selected', item === 'boost');
  if(shopItemTeleportBtn) shopItemTeleportBtn.classList.toggle('selected', item === 'teleport');
  if(shopItemFastFeetBtn) shopItemFastFeetBtn.classList.toggle('selected', item === 'fastFeet');
  if(shopItemPassiveBtn) shopItemPassiveBtn.classList.toggle('selected', item === 'passive');
}

function selectInventoryItem(item){
  const config = shopItems[item];
  if(!config) return;

  if(selectedInventoryItems.has(item)){
    selectedInventoryItems.delete(item);
  } else {
    const type = itemTypes[item];
    if(type === 'ability'){
      for(const selected of Array.from(selectedInventoryItems)){
        if(itemTypes[selected] === 'ability') selectedInventoryItems.delete(selected);
      }
    }
    if(type === 'passive'){
      for(const selected of Array.from(selectedInventoryItems)){
        if(itemTypes[selected] === 'passive') selectedInventoryItems.delete(selected);
      }
    }
    selectedInventoryItems.add(item);
  }

  activeInventoryItem = item;

  if(inventoryPreviewDetails){
    inventoryPreviewDetails.innerHTML = `<strong>${config.name}</strong><br>${config.description}<br><br>${selectedInventoryItems.has(item) ? 'Equipped in inventory' : 'Not equipped'}`;
  }
  if(inventoryUpgradeStatus) inventoryUpgradeStatus.textContent = '';
  refreshInventoryUpgradePanel(item);
  if(inventoryItemBoostBtn) inventoryItemBoostBtn.classList.toggle('selected', selectedInventoryItems.has('boost'));
  if(inventoryItemTeleportBtn) inventoryItemTeleportBtn.classList.toggle('selected', selectedInventoryItems.has('teleport'));
  if(inventoryItemFastFeetBtn) inventoryItemFastFeetBtn.classList.toggle('selected', selectedInventoryItems.has('fastFeet'));
  if(inventoryItemPassiveBtn) inventoryItemPassiveBtn.classList.toggle('selected', selectedInventoryItems.has('passive'));
}

function updateInventoryUI(){
  const ownedBoost = !!getUserValue('ownedBoost', false);
  const ownedTeleport = !!getUserValue('ownedTeleport', false);
  const ownedFastFeet = !!getUserValue('ownedFastFeet', false);
  const ownedPassive = !!getUserValue('ownedPassive', false);
  if(inventoryItemBoostBtn) inventoryItemBoostBtn.style.display = ownedBoost ? 'flex' : 'none';
  if(inventoryItemTeleportBtn) inventoryItemTeleportBtn.style.display = ownedTeleport ? 'flex' : 'none';
  if(inventoryItemFastFeetBtn) inventoryItemFastFeetBtn.style.display = ownedFastFeet ? 'flex' : 'none';
  if(inventoryItemPassiveBtn) inventoryItemPassiveBtn.style.display = ownedPassive ? 'flex' : 'none';

  const currentEquipped = currentUserData ? (currentUserData.equipped || []) : sessionEquipped;
  selectedInventoryItems = new Set(currentEquipped.filter(item =>
    (item === 'boost' && ownedBoost) ||
    (item === 'teleport' && ownedTeleport) ||
    (item === 'fastFeet' && ownedFastFeet) ||
    (item === 'passive' && ownedPassive)
  ));

  if(!ownedBoost && !ownedPassive && !ownedTeleport && !ownedFastFeet){
    selectedInventoryItems.clear();
    activeInventoryItem = null;
    if(inventoryPreviewDetails){
      inventoryPreviewDetails.innerHTML = '<strong>No owned items</strong><br>Purchase abilities in the shop to equip them.';
    }
    if(inventoryUpgradeCard) inventoryUpgradeCard.style.display = 'none';
    if(inventoryItemBoostBtn) inventoryItemBoostBtn.classList.remove('selected');
    if(inventoryItemTeleportBtn) inventoryItemTeleportBtn.classList.remove('selected');
    if(inventoryItemFastFeetBtn) inventoryItemFastFeetBtn.classList.remove('selected');
    if(inventoryItemPassiveBtn) inventoryItemPassiveBtn.classList.remove('selected');
    return;
  }

  if(selectedInventoryItems.size === 0){
    if(ownedBoost){
      selectedInventoryItems.add('boost');
    } else if(ownedTeleport){
      selectedInventoryItems.add('teleport');
    }
    if(ownedPassive){
      selectedInventoryItems.add('passive');
    } else if(ownedFastFeet){
      selectedInventoryItems.add('fastFeet');
    }
  }

  if(inventoryItemBoostBtn) inventoryItemBoostBtn.classList.toggle('selected', selectedInventoryItems.has('boost'));
  if(inventoryItemTeleportBtn) inventoryItemTeleportBtn.classList.toggle('selected', selectedInventoryItems.has('teleport'));
  if(inventoryItemFastFeetBtn) inventoryItemFastFeetBtn.classList.toggle('selected', selectedInventoryItems.has('fastFeet'));
  if(inventoryItemPassiveBtn) inventoryItemPassiveBtn.classList.toggle('selected', selectedInventoryItems.has('passive'));
  const firstItem = Array.from(selectedInventoryItems)[0] || (ownedBoost ? 'boost' : ownedTeleport ? 'teleport' : ownedPassive ? 'passive' : ownedFastFeet ? 'fastFeet' : null);
  activeInventoryItem = firstItem;
  if(inventoryPreviewDetails){
    if(firstItem){
      const config = shopItems[firstItem];
      inventoryPreviewDetails.innerHTML = `<strong>${config.name}</strong><br>${config.description}`;
    }
  }
  if(inventoryUpgradeStatus) inventoryUpgradeStatus.textContent = '';
  refreshInventoryUpgradePanel(activeInventoryItem);
}

function updateShopUI(){
  if(shopTokensEl) shopTokensEl.textContent = tokens;
  if(selectedShopItem) selectShopItem(selectedShopItem);
}

function syncSettingsInputs(){
  if(playerColorPicker) playerColorPicker.value = playerColor;
  if(enemyColorPicker) enemyColorPicker.value = enemyColor;
  if(wallColorPicker) wallColorPicker.value = wallColor;
  if(orbColorPicker) orbColorPicker.value = orbColor;
  if(finishColorPicker) finishColorPicker.value = finishColor;
}

function applyColorSettings(){
  playerColor = playerColorPicker?.value || playerColor;
  enemyColor = enemyColorPicker?.value || enemyColor;
  wallColor = wallColorPicker?.value || wallColor;
  orbColor = orbColorPicker?.value || orbColor;
  finishColor = finishColorPicker?.value || finishColor;
  player.color = playerColor;
  orbs.forEach(o => { o.color = orbColor; });
  enemies.forEach(e => { e.color = enemyColor; });
  if(currentUserData){
    currentUserData.colors = {
      player: playerColor,
      enemy: enemyColor,
      wall: wallColor,
      orb: orbColor,
      finish: finishColor
    };
    syncUserState();
  }
}

function showShopOverlay(){
  if(homeOverlay) homeOverlay.style.display = 'none';
  if(shopOverlay) shopOverlay.style.display = 'flex';
  if(settingsOverlay) settingsOverlay.style.display = 'none';
  if(homePlayPanel) homePlayPanel.style.display = 'none';
  if(inventoryPanel) inventoryPanel.style.display = 'none';
  updateShopUI();
}

if(shopItemBoostBtn){
  shopItemBoostBtn.addEventListener('click', () => selectShopItem('boost'));
}
const shopItemTeleportBtn = document.getElementById('shop-item-teleport');
const shopItemFastFeetBtn = document.getElementById('shop-item-fastFeet');
if(shopItemTeleportBtn){
  shopItemTeleportBtn.addEventListener('click', () => selectShopItem('teleport'));
}
if(shopItemFastFeetBtn){
  shopItemFastFeetBtn.addEventListener('click', () => selectShopItem('fastFeet'));
}
if(shopItemPassiveBtn){
  shopItemPassiveBtn.addEventListener('click', () => selectShopItem('passive'));
}
if(shopBuyBtn){
  shopBuyBtn.addEventListener('click', async () => {
    if(!currentUserData || !selectedShopItem) return;
    const item = shopItems[selectedShopItem];
    const owned = getOwned(selectedShopItem);
    if(owned) return;
    if(tokens < item.cost){
      if(shopPreviewStatus) shopPreviewStatus.textContent = 'Not enough tokens.';
      return;
    }
    tokens -= item.cost;
    currentUserData[item.saveKey] = true;
    currentUserData.tokens = tokens;
    await syncUserState();
    if(tokensEl) tokensEl.textContent = tokens;
    if(shopTokensEl) shopTokensEl.textContent = tokens;
    updateShopUI();
    if(shopPreviewStatus) shopPreviewStatus.textContent = 'Purchased!';
  });
}

if(inventoryCloseBtn){
  inventoryCloseBtn.addEventListener('click', () => {
    if(inventoryPanel) inventoryPanel.style.display = 'none';
    if(homePlayPanel) homePlayPanel.style.display = 'none';
  });
}
if(inventoryBackMainBtn){
  inventoryBackMainBtn.addEventListener('click', () => {
    if(inventoryPanel) inventoryPanel.style.display = 'none';
    if(homePlayPanel) homePlayPanel.style.display = 'none';
    showHomeMenu();
  });
}

if(openShopBtn){
  openShopBtn.addEventListener('click', () => {
    showShopOverlay();
  });
}
if(returnMenuBtn){
  returnMenuBtn.addEventListener('click', () => {
    returnToHomeMenu();
  });
}

function returnToHomeMenu(){
  gameState = 'start';
  showHomeMenu();
}

function signOut(){
  currentUser = null;
  currentUserData = null;
  authToken = null;
  localStorage.removeItem('orbMazeAuthToken');
  highScore = 0;
  tokens = 0;
  updateUserUI();
  activateLoginTab();
  loginOverlay.style.display = 'flex';
  showStatus('Signed out successfully.');
  gameState = 'start';
  hideAllOverlays();
  resetGame();
}

function update(dt){
  if(playAgainBtn){
    playAgainBtn.style.display = (gameState === 'won' && loginOverlay.style.display === 'none') ? 'inline-block' : 'none';
  }

  if(stunCooldown > 0){
    stunCooldown = Math.max(0, stunCooldown - dt);
  }

  if(boostCooldown > 0){
    boostCooldown = Math.max(0, boostCooldown - dt);
  }

  if(boostActive){
    boostTimer -= dt;
    if(boostTimer <= 0){
      boostActive = false;
    }
  }

  if(gameState === 'dead'){
    deathTimer -= dt;
    if(deathTimer <= 0){
      gameState = 'start';
      // show home overlay so player can choose mode / equip
      if(homeOverlay && loginOverlay.style.display === 'none'){
        homeOverlay.style.display = 'flex';
        if(homePlayPanel) homePlayPanel.style.display = 'none';
        if(homeTokensEl) homeTokensEl.textContent = tokens;
      }
    }
    return;
  }

  if(gameState !== 'playing') return;

  // apply boost multiplier to player speed
  player.baseSpeed = PLAYER_BASE_SPEED * getCharacterSpeedMultiplier();
  let speedMultiplier = boostActive ? 2 * getBoostPower() : 1;
  if(hasEquipped('fastFeet')){
    speedMultiplier *= getFastFeetMultiplier();
  }
  player.speed = player.baseSpeed * speedMultiplier;

  player.vx = 0;
  player.vy = 0;
  if(keys.ArrowLeft || keys.a) player.vx = -1;
  if(keys.ArrowRight || keys.d) player.vx = 1;
  if(keys.ArrowUp || keys.w) player.vy = -1;
  if(keys.ArrowDown || keys.s) player.vy = 1;

  if(player.vx !== 0 && player.vy !== 0){
    const inv = Math.sqrt(0.5);
    player.vx *= inv;
    player.vy *= inv;
  }

  player.x += player.vx * player.speed * dt;
  player.y += player.vy * player.speed * dt;
  resolveWallCollisions(player);
  player.x = Math.max(player.r, Math.min(W - player.r, player.x));
  player.y = Math.max(player.r, Math.min(H - player.r, player.y));

  if(invulnerable){
    invulnerabilityTimer -= dt;
    if(invulnerabilityTimer <= 0){
      invulnerable = false;
    }
  }

  for(let i = orbs.length - 1; i >= 0; i--){
    const o = orbs[i];
    const dx = player.x - o.x;
    const dy = player.y - o.y;
    const dist = Math.hypot(dx, dy);
    if(dist < player.r + o.r){
      orbs.splice(i, 1);
      score += 1;
      scoreEl.textContent = score;
      respawnOrb();
    }
  }

  const playerCell = getCellAt(Math.floor(player.x / cellSize), Math.floor(player.y / cellSize));
  if(playerCell && playerCell.x === finishCell.x && playerCell.y === finishCell.y){
    gameState = 'won';
    const earnedTokens = getRunScoreValue();
    tokens += earnedTokens;
    const runScoreValue = getRunScoreValue();
    if(runScoreValue > highScore){
      highScore = runScoreValue;
      highScoreEl.textContent = highScore;
    }
    if(currentUserData){
      currentUserData.tokens = tokens;
      currentUserData.highScore = highScore;
      syncUserState();
    }
    if(tokensEl) tokensEl.textContent = tokens;
    if(shopTokensEl) shopTokensEl.textContent = tokens;
    if(homeTokensEl) homeTokensEl.textContent = tokens;
    return;
  }

  enemies.forEach(enemy => {
    if(enemy.stunned){
      enemy.stunTimer -= dt;
      if(enemy.stunTimer <= 0){
        enemy.stunned = false;
      }
    } else {
      enemy.pathTimer += dt;
      const enemyCell = getCellAt(Math.floor(enemy.x / cellSize), Math.floor(enemy.y / cellSize));
      if(!enemy.path || enemy.path.length <= 1 || enemy.pathTimer > 0.3 || !enemyCell || enemy.path[0].x !== enemyCell.x || enemy.path[0].y !== enemyCell.y){
        enemy.pathTimer = 0;
        const path = findPath(enemyCell, playerCell);
        if(path) enemy.path = path;
      }

      if(enemy.path && enemy.path.length > 1){
        const nextCell = enemy.path[1];
        const target = getCellCenter(nextCell.x, nextCell.y);
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        const dist = Math.hypot(dx, dy);
        if(dist > 0.5){
          const passiveFactor = hasEquipped('passive') ? Math.max(0.5, 1 - getPassiveEffect() * 0.05) : 1;
          enemy.x += (dx / dist) * enemy.speed * passiveFactor * dt;
          enemy.y += (dy / dist) * enemy.speed * passiveFactor * dt;
        } else {
          enemy.path.shift();
        }
      }
    }

    // If enemy has no path, fallback to direct chase so they still move when player is idle
    if(!enemy.stunned && (!enemy.path || enemy.path.length <= 1)){
      const dxDirect = player.x - enemy.x;
      const dyDirect = player.y - enemy.y;
      const distDirect = Math.hypot(dxDirect, dyDirect);
      if(distDirect > 0.5){
        enemy.x += (dxDirect / distDirect) * enemy.speed * dt;
        enemy.y += (dyDirect / distDirect) * enemy.speed * dt;
      }
    }

    resolveWallCollisions(enemy);

    if(!enemy.stunned){
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      if(Math.hypot(dx, dy) < player.r + enemy.r - 2){
        if(!invulnerable){
          lives -= 1;
          livesEl.textContent = lives;
          invulnerable = true;
          invulnerabilityTimer = 1.5;
          if(lives <= 0){
            const runScoreValue = getRunScoreValue();
            if(runScoreValue > highScore){
              highScore = runScoreValue;
              highScoreEl.textContent = highScore;
              if(currentUserData){
                currentUserData.highScore = highScore;
                syncUserState();
              }
            }
            gameState = 'dead';
            deathTimer = deathCooldown;
          } else {
            // reset player and return enemies to their spawn positions
            resetPlayerPosition();
            resetEnemiesToSpawn();
          }
        }
      }
    }
  });
}

function drawText(message, subMessage){
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = '28px system-ui, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(message, W / 2, H / 2 - 20);
  ctx.font = '18px system-ui, Arial, sans-serif';
  ctx.fillText(subMessage, W / 2, H / 2 + 20);
}

function draw(){
  ctx.clearRect(0, 0, W, H);

  // background
  ctx.fillStyle = '#061021';
  ctx.fillRect(0, 0, W, H);

  // finish tile
  ctx.fillStyle = finishColor;
  const finishPos = { x: finishCell.x * cellSize, y: finishCell.y * cellSize };
  ctx.fillRect(finishPos.x + 6, finishPos.y + 6, cellSize - 12, cellSize - 12);

  // draw maze walls
  ctx.fillStyle = wallColor;
  const walls = getWallSegments();
  for(const wall of walls){
    if(wall.y1 === wall.y2){
      ctx.fillRect(wall.x1 - wallThickness / 2, wall.y1 - wallThickness / 2, wall.x2 - wall.x1, wallThickness);
    } else {
      ctx.fillRect(wall.x1 - wallThickness / 2, wall.y1 - wallThickness / 2, wallThickness, wall.y2 - wall.y1);
    }
  }

  // draw orbs
  orbs.forEach(o => {
    ctx.beginPath();
    ctx.fillStyle = orbColor;
    o.color = orbColor;
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.closePath();
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,209,102,0.06)';
    ctx.arc(o.x, o.y, o.r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.closePath();
  });

  // draw enemies
  enemies.forEach(enemy => {
    ctx.beginPath();
    enemy.color = enemyColor;
    ctx.fillStyle = enemy.stunned ? '#4dc9ff' : enemy.color;
    ctx.arc(enemy.x, enemy.y, enemy.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.closePath();
  });

  // player
  ctx.beginPath();
  ctx.fillStyle = player.color;
  ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.closePath();

  // flashlight fog (radius depends on current mode)
  const cfg = modeConfigs[currentMode] || modeConfigs.Medium;
  const fogRadius = cfg.fogRadius || 200;
  if(!isEquipped('passive')){
    const gradient = ctx.createRadialGradient(player.x, player.y, 0, player.x, player.y, fogRadius);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.3, 'rgba(0,0,0,0.1)');
    gradient.addColorStop(0.75, 'rgba(0,0,0,0.95)');
    gradient.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
  }
  

  // HUD: stun + boost
  const hudWidth = 260;
  const hudHeight = 56;
  const hudX = W - hudWidth - 16;
  const hudY = 16;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(hudX, hudY, hudWidth, hudHeight);
  ctx.strokeStyle = '#7af97a';
  ctx.lineWidth = 2;
  ctx.strokeRect(hudX, hudY, hudWidth, hudHeight);
  ctx.fillStyle = '#fff';
  ctx.font = '14px system-ui, Arial, sans-serif';
  ctx.textAlign = 'left';
  // Stun line
  const stunLabel = (stunKey === 'Space') ? 'Space Stun' : `${stunKey.toUpperCase()} Stun`;
  ctx.fillText(stunLabel, hudX + 10, hudY + 18);
  if(invulnerable){
    ctx.fillStyle = '#ffd700';
    ctx.fillText('Invul', hudX + 110, hudY + 18);
  }
  if(stunCooldown > 0){
    ctx.fillStyle = '#ff7b7b';
    ctx.fillText(`${stunCooldown.toFixed(1)}s`, hudX + 110, hudY + 18);
  } else {
    ctx.fillStyle = '#7af97a';
    ctx.fillText('Ready', hudX + 110, hudY + 18);
  }
  // Boost line
  ctx.fillStyle = '#fff';
  const boostLabel = (boostKey === 'Space') ? 'Space Boost' : `${boostKey.toUpperCase()} Boost`;
  ctx.fillText(boostLabel, hudX + 10, hudY + 38);
  if(!isEquipped('boost')){
    ctx.fillStyle = '#999';
    ctx.fillText('Locked', hudX + 110, hudY + 38);
  } else if(boostActive){
    ctx.fillStyle = '#ffd700';
    ctx.fillText(`${boostTimer.toFixed(1)}s`, hudX + 110, hudY + 38);
  } else if(boostCooldown > 0){
    ctx.fillStyle = '#ff7b7b';
    ctx.fillText(`${boostCooldown.toFixed(1)}s`, hudX + 110, hudY + 38);
  } else {
    ctx.fillStyle = '#7af97a';
    ctx.fillText('Ready', hudX + 110, hudY + 38);
  }

  if(gameState === 'start'){
    drawText('Maze Run', 'Press Enter to start and collect orbs before escaping');
  } else if(gameState === 'dead'){
    drawText('Game Over', `Score: ${getRunScoreValue()} | High score: ${highScore} — Press Enter to try again or M for menu`);
  } else if(gameState === 'won'){
    drawText(`You escaped! Score: ${getRunScoreValue()}`, `High score: ${highScore} — Press Enter to play again or M for menu`);
  }
}

let last = performance.now();
function loop(t){
  const dt = Math.min(0.05, (t - last) / 1000);
  update(dt);
  draw();
  last = t;
  requestAnimationFrame(loop);
}

restoreSession().finally(() => {
  initLogin();
  applyMode(currentMode);
  resetGame();
  requestAnimationFrame(loop);
});
