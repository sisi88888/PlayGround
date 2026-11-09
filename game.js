const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const hud = {
  healthFill: document.getElementById('healthFill'),
  waveValue: document.getElementById('waveValue'),
  scoreValue: document.getElementById('scoreValue'),
  status: document.getElementById('status'),
  overlay: document.getElementById('overlay'),
  startButton: document.getElementById('startButton'),
};

const input = {
  keys: new Set(),
  pointer: { x: 0, y: 0, down: false, moved: false },
  move: { x: 0, y: 0 },
  fire: false,
  bomb: false,
  touchStick: { active: false, x: 0, y: 0 },
};

const world = {
  width: 1200,
  height: 720,
  lastTime: 0,
  running: false,
  gameOver: false,
  score: 0,
  wave: 1,
  spawnTimer: 0,
  zombies: [],
  bullets: [],
  loot: [],
  explosions: [],
  pickups: [],
  cars: [],
  particles: [],
  player: null,
  worldRadius: 320,
  bossTimer: 0,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const shell = document.getElementById('game-shell');
  const rect = shell.getBoundingClientRect();
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  world.width = rect.width;
  world.height = rect.height;
  if (world.player) {
    world.player.x = clamp(world.player.x, 0, world.width);
    world.player.y = clamp(world.player.y, 0, world.height);
  }
}

function createPlayer() {
  return {
    x: world.width / 2,
    y: world.height / 2,
    radius: 18,
    speed: 220,
    hp: 100,
    maxHp: 100,
    fireCooldown: 0,
    angle: 0,
    weaponLevel: 1,
    gunFlash: 0,
    invuln: 0,
  };
}

function spawnWave() {
  const count = 5 + world.wave * 2;
  world.spawnTimer = 0;
  for (let i = 0; i < count; i += 1) {
    const side = Math.floor(Math.random() * 4);
    const margin = 60;
    let x = 0;
    let y = 0;
    if (side === 0) { x = Math.random() * world.width; y = -margin; }
    if (side === 1) { x = world.width + margin; y = Math.random() * world.height; }
    if (side === 2) { x = Math.random() * world.width; y = world.height + margin; }
    if (side === 3) { x = -margin; y = Math.random() * world.height; }
    world.zombies.push(createZombie(x, y));
  }
}

function createZombie(x, y) {
  const levelBoost = 1 + (world.wave - 1) * 0.15;
  return {
    x,
    y,
    radius: 18,
    speed: 36 + Math.random() * 20 * levelBoost,
    hp: 32 + world.wave * 4,
    maxHp: 32 + world.wave * 4,
    damage: 10 + world.wave * 1.2,
    color: 'hsl(' + (120 + Math.random() * 24) + ', 55%, 46%)',
    eyeFluid: Math.random() * 0.8 + 0.4,
    hitFlash: 0,
  };
}

function createBullet(x, y, angle) {
  world.bullets.push({
    x,
    y,
    vx: Math.cos(angle) * 520,
    vy: Math.sin(angle) * 520,
    radius: 4,
    life: 1.1,
    damage: 20 + (world.player.weaponLevel - 1) * 8,
    color: '#f8d67d',
  });
}

function createExplosion(x, y, radius, color = '#ffbb33') {
  world.explosions.push({ x, y, radius, maxRadius: radius, color, life: 0.45, alpha: 1 });
  for (let i = 0; i < 18; i += 1) {
    world.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 200,
      vy: (Math.random() - 0.5) * 200,
      radius: 2 + Math.random() * 3,
      life: 0.8 + Math.random() * 0.6,
      color,
    });
  }
}

function addPickup(x, y, type = 'ammo') {
  world.pickups.push({
    x,
    y,
    radius: 10,
    type,
    bob: Math.random() * Math.PI * 2,
  });
}

function createCar(x, y) {
  world.cars.push({
    x,
    y,
    radius: 24,
    hp: 80,
    angle: Math.random() * Math.PI * 2,
    charge: 0,
  });
}

function maybeSpawnCars() {
  if (world.cars.length > 4 || Math.random() > 0.02) return;
  const side = Math.floor(Math.random() * 4);
  let x = 0;
  let y = 0;
  if (side === 0) { x = Math.random() * world.width; y = -50; }
  if (side === 1) { x = world.width + 50; y = Math.random() * world.height; }
  if (side === 2) { x = Math.random() * world.width; y = world.height + 50; }
  if (side === 3) { x = -50; y = Math.random() * world.height; }
  createCar(x, y);
}

function resetGame() {
  world.running = true;
  world.gameOver = false;
  world.score = 0;
  world.wave = 1;
  world.zombies = [];
  world.bullets = [];
  world.loot = [];
  world.pickups = [];
  world.explosions = [];
  world.particles = [];
  world.cars = [];
  world.player = createPlayer();
  hud.status.textContent = 'Survive the night';
  hud.waveValue.textContent = String(world.wave);
  hud.scoreValue.textContent = '0';
  spawnWave();
}

function startGame() {
  resetGame();
  hud.overlay.classList.add('hidden');
}

function updatePlayer(dt) {
  const player = world.player;
  let dx = 0;
  let dy = 0;

  if (input.keys.has('w') || input.keys.has('arrowup')) dy -= 1;
  if (input.keys.has('s') || input.keys.has('arrowdown')) dy += 1;
  if (input.keys.has('a') || input.keys.has('arrowleft')) dx -= 1;
  if (input.keys.has('d') || input.keys.has('arrowright')) dx += 1;

  if (input.touchStick.active) {
    dx += input.touchStick.x;
    dy += input.touchStick.y;
  }

  const length = Math.hypot(dx, dy) || 1;
  const moveX = (dx / length) * player.speed * dt;
  const moveY = (dy / length) * player.speed * dt;
  player.x = clamp(player.x + moveX, 20, world.width - 20);
  player.y = clamp(player.y + moveY, 20, world.height - 20);

  const pointerX = input.pointer.x;
  const pointerY = input.pointer.y;
  player.angle = Math.atan2(pointerY - player.y, pointerX - player.x);

  player.fireCooldown -= dt;
  if ((input.fire || input.pointer.down) && player.fireCooldown <= 0) {
    const shotSpread = 0.08 * player.weaponLevel;
    const spread = (Math.random() - 0.5) * shotSpread;
    const angle = player.angle + spread;
    createBullet(player.x + Math.cos(angle) * 26, player.y + Math.sin(angle) * 26, angle);
    player.fireCooldown = 0.15;
    player.gunFlash = 0.08;
  }

  if (input.bomb && player.weaponLevel >= 2) {
    input.bomb = false;
    const blastRadius = 120;
    for (const zombie of world.zombies) {
      const d = dist(player.x, player.y, zombie.x, zombie.y);
      if (d < blastRadius + zombie.radius) {
        zombie.hp -= 40;
      }
    }
    for (const car of world.cars) {
      const d = dist(player.x, player.y, car.x, car.y);
      if (d < blastRadius) {
        car.hp -= 70;
      }
    }
    createExplosion(player.x, player.y, blastRadius, '#ff5d73');
    hud.status.textContent = 'Bomb burst!';
  }

  if (player.invuln > 0) player.invuln -= dt;
  if (player.gunFlash > 0) player.gunFlash -= dt;
}

function resolveZombieMovement(zombie, dt) {
  const dx = world.player.x - zombie.x;
  const dy = world.player.y - zombie.y;
  const len = Math.hypot(dx, dy) || 1;
  zombie.x += (dx / len) * zombie.speed * dt;
  zombie.y += (dy / len) * zombie.speed * dt;
}

function updateBullets(dt) {
  for (let i = world.bullets.length - 1; i >= 0; i -= 1) {
    const bullet = world.bullets[i];
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;

    if (bullet.life <= 0 || bullet.x < -20 || bullet.x > world.width + 20 || bullet.y < -20 || bullet.y > world.height + 20) {
      world.bullets.splice(i, 1);
      continue;
    }

    for (let j = world.zombies.length - 1; j >= 0; j -= 1) {
      const zombie = world.zombies[j];
      if (dist(bullet.x, bullet.y, zombie.x, zombie.y) < bullet.radius + zombie.radius) {
        zombie.hp -= bullet.damage;
        zombie.hitFlash = 0.08;
        world.bullets.splice(i, 1);
        if (zombie.hp <= 0) {
          world.score += 15;
          world.zombies.splice(j, 1);
          createExplosion(zombie.x, zombie.y, 22, '#9ae6b4');
          if (Math.random() < 0.28) addPickup(zombie.x, zombie.y, 'ammo');
          else if (Math.random() < 0.12) addPickup(zombie.x, zombie.y, 'health');
        }
        break;
      }
    }
  }
}

function updateCars(dt) {
  for (let i = world.cars.length - 1; i >= 0; i -= 1) {
    const car = world.cars[i];
    car.charge = Math.min(1, car.charge + dt * 0.2);
    if (car.charge > 0.9 && Math.random() < 0.03) {
      createExplosion(car.x, car.y, 34, '#f97316');
      car.hp -= 20;
      car.charge = 0;
    }
    const dx = world.player.x - car.x;
    const dy = world.player.y - car.y;
    const len = Math.hypot(dx, dy) || 1;
    car.x += (dx / len) * 18 * dt;
    car.y += (dy / len) * 18 * dt;

    if (dist(car.x, car.y, world.player.x, world.player.y) < car.radius + world.player.radius + 10) {
      world.player.hp -= 10 * dt;
    }

    if (car.hp <= 0) {
      createExplosion(car.x, car.y, 48, '#fbbf24');
      world.cars.splice(i, 1);
      world.score += 40;
      continue;
    }
  }
}

function updatePickups(dt) {
  for (let i = world.pickups.length - 1; i >= 0; i -= 1) {
    const item = world.pickups[i];
    item.bob += dt * 4;
    const d = dist(item.x, item.y, world.player.x, world.player.y);
    if (d < item.radius + world.player.radius + 6) {
      if (item.type === 'ammo') {
        world.player.weaponLevel = Math.min(5, world.player.weaponLevel + 1);
        hud.status.textContent = 'Weapon upgraded';
      }
      if (item.type === 'health') {
        world.player.hp = Math.min(world.player.maxHp, world.player.hp + 25);
        hud.status.textContent = 'Health refill';
      }
      world.pickups.splice(i, 1);
    }
  }
}

function updateParticles(dt) {
  for (let i = world.particles.length - 1; i >= 0; i -= 1) {
    const p = world.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) world.particles.splice(i, 1);
  }
}

function updateExplosions(dt) {
  for (let i = world.explosions.length - 1; i >= 0; i -= 1) {
    const e = world.explosions[i];
    e.life -= dt;
    e.radius += 120 * dt;
    if (e.life <= 0) world.explosions.splice(i, 1);
  }
}

function updateWave(dt) {
  world.spawnTimer -= dt;
  if (world.zombies.length === 0 && world.spawnTimer <= 0) {
    world.wave += 1;
    hud.waveValue.textContent = String(world.wave);
    hud.status.textContent = `Wave ${world.wave}`;
    world.spawnTimer = 1.25;
    setTimeout(() => spawnWave(), 120);
  }
  if (world.zombies.length > 0 && world.spawnTimer <= -0.5) {
    world.spawnTimer = 0;
  }
}

function updateCombat(dt) {
  for (let i = world.zombies.length - 1; i >= 0; i -= 1) {
    const zombie = world.zombies[i];
    resolveZombieMovement(zombie, dt);
    if (dist(zombie.x, zombie.y, world.player.x, world.player.y) < zombie.radius + world.player.radius) {
      world.player.hp -= zombie.damage * dt;
      zombie.eyeFluid = 1;
      if (world.player.hp <= 0) {
        world.player.hp = 0;
        world.running = false;
        world.gameOver = true;
        hud.overlay.classList.remove('hidden');
        hud.status.textContent = 'You were overwhelmed';
        const card = hud.overlay.querySelector('.card');
        card.innerHTML = `
          <h1>Game Over</h1>
          <p>Wave reached: ${world.wave}</p>
          <p>Score: ${world.score}</p>
          <button id="restartButton">Play Again</button>
        `;
        const restartButton = document.getElementById('restartButton');
        restartButton.addEventListener('click', () => {
          hud.overlay.classList.add('hidden');
          startGame();
        });
      }
    }

    zombie.hitFlash = Math.max(0, zombie.hitFlash - dt * 2);
    if (zombie.hp <= 0) {
      world.zombies.splice(i, 1);
    }
  }
}

function updateGame(dt) {
  if (!world.running || world.gameOver) return;
  updatePlayer(dt);
  updateCars(dt);
  updateBullets(dt);
  updatePickups(dt);
  updateCombat(dt);
  updateParticles(dt);
  updateExplosions(dt);
  maybeSpawnCars();
  updateWave(dt);

  if (world.player.hp <= 0) {
    world.running = false;
    world.gameOver = true;
  }

  hud.healthFill.style.width = `${(world.player.hp / world.player.maxHp) * 100}%`;
  hud.scoreValue.textContent = String(world.score);
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, world.height);
  g.addColorStop(0, '#12232a');
  g.addColorStop(1, '#05090d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, world.width, world.height);

  for (let i = 0; i < 20; i += 1) {
    const x = (i * 67 + (performance.now() * 0.01)) % (world.width + 200) - 100;
    const y = (i * 97 + (performance.now() * 0.02)) % (world.height + 200) - 100;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, y, 18, 18);
  }
}

function drawPlayer() {
  const p = world.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.fillStyle = '#c5f1ff';
  ctx.fillRect(-8, -5, 24, 10);
  ctx.fillStyle = '#7dd3fc';
  ctx.fillRect(10, -3, 12, 6);
  if (p.gunFlash > 0) {
    ctx.fillStyle = 'rgba(255, 213, 80, 0.9)';
    ctx.fillRect(18, -2, 12, 4);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(34,197,94,0.25)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#7dd3fc';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawBullets() {
  for (const bullet of world.bullets) {
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fillStyle = bullet.color;
    ctx.fill();
  }
}

function drawZombies() {
  for (const zombie of world.zombies) {
    ctx.save();
    ctx.translate(zombie.x, zombie.y);
    const glow = zombie.hitFlash > 0 ? '#fff' : zombie.color;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, zombie.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(-5, -6, 2.7, 0, Math.PI * 2);
    ctx.arc(5, -6, 2.7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#dbeafe';
    ctx.fillRect(-7, 5, 14, 3);
    ctx.fillStyle = '#fca5a5';
    if (zombie.eyeFluid > 0.5) {
      ctx.fillRect(-2, -10, 3, 5);
      ctx.fillRect(2, -10, 3, 5);
    }
    ctx.restore();

    const normal = zombie.hp / zombie.maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(zombie.x - 18, zombie.y - 30, 36, 5);
    ctx.fillStyle = '#34d399';
    ctx.fillRect(zombie.x - 18, zombie.y - 30, 36 * normal, 5);
  }
}

function drawCars() {
  for (const car of world.cars) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(-18, -10, 36, 20);
    ctx.fillStyle = '#111827';
    ctx.fillRect(-6, -12, 12, 24);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(-12, -15, 24, 5);
    ctx.restore();
  }
}

function drawPickups() {
  for (const item of world.pickups) {
    const bob = Math.sin(item.bob) * 5;
    ctx.save();
    ctx.translate(item.x, item.y + bob);
    if (item.type === 'ammo') {
      ctx.fillStyle = '#f8d67d';
      ctx.fillRect(-8, -8, 16, 16);
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(-8, -8, 16, 16);
    } else {
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-2, -6, 4, 12);
      ctx.fillRect(-6, -2, 12, 4);
    }
    ctx.restore();
  }
}

function drawParticles() {
  for (const p of world.particles) {
    ctx.globalAlpha = Math.max(0, p.life * 1.2);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawExplosions() {
  for (const e of world.explosions) {
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${e.life * 1.8})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius * 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = e.color.replace(')', `, ${e.life})`).replace('hsl', 'hsla');
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function draw() {
  drawBackground();
  drawCars();
  drawPickups();
  drawBullets();
  drawZombies();
  drawParticles();
  drawExplosions();
  drawPlayer();
}

function tick(timestamp) {
  const dt = Math.min((timestamp - world.lastTime) / 1000 || 0.016, 0.035);
  world.lastTime = timestamp;
  if (world.running) updateGame(dt);
  draw();
  requestAnimationFrame(tick);
}

function setPointerPosition(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  input.pointer.x = clientX - rect.left;
  input.pointer.y = clientY - rect.top;
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key)) {
    event.preventDefault();
  }
  input.keys.add(key);
  if (key === ' ') {
    input.bomb = true;
    event.preventDefault();
  }
});

window.addEventListener('keyup', (event) => {
  input.keys.delete(event.key.toLowerCase());
  if (event.key === ' ') input.bomb = false;
});

canvas.addEventListener('pointerdown', (event) => {
  setPointerPosition(event.clientX, event.clientY);
  input.pointer.down = true;
  input.pointer.moved = false;
});

canvas.addEventListener('pointermove', (event) => {
  setPointerPosition(event.clientX, event.clientY);
  input.pointer.moved = true;
});

canvas.addEventListener('pointerup', () => {
  input.pointer.down = false;
});

canvas.addEventListener('pointerleave', () => {
  input.pointer.down = false;
});

const stick = document.getElementById('stickKnob');
const leftStick = document.getElementById('leftStick');

function updateTouchStick(pointX, pointY) {
  const rect = leftStick.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = pointX - centerX;
  const dy = pointY - centerY;
  const maxRadius = 32;
  const length = Math.hypot(dx, dy) || 1;
  const clamped = Math.min(maxRadius, length);
  const ratio = clamped / length;
  const x = dx * ratio;
  const y = dy * ratio;
  stick.style.transform = `translate(${x}px, ${y}px)`;
  input.touchStick.x = x / maxRadius;
  input.touchStick.y = y / maxRadius;
  input.touchStick.active = true;
}

leftStick.addEventListener('pointerdown', (event) => {
  leftStick.setPointerCapture(event.pointerId);
  updateTouchStick(event.clientX, event.clientY);
});

leftStick.addEventListener('pointermove', (event) => {
  if (event.pressure > 0 || leftStick.hasPointerCapture(event.pointerId)) {
    updateTouchStick(event.clientX, event.clientY);
  }
});

leftStick.addEventListener('pointerup', () => {
  input.touchStick.active = false;
  input.touchStick.x = 0;
  input.touchStick.y = 0;
  stick.style.transform = 'translate(0px, 0px)';
});

leftStick.addEventListener('pointercancel', () => {
  input.touchStick.active = false;
  input.touchStick.x = 0;
  input.touchStick.y = 0;
  stick.style.transform = 'translate(0px, 0px)';
});

const fireButton = document.getElementById('fireButton');
const bombButton = document.getElementById('bombButton');

fireButton.addEventListener('pointerdown', () => {
  input.fire = true;
});
fireButton.addEventListener('pointerup', () => {
  input.fire = false;
});
fireButton.addEventListener('pointerleave', () => {
  input.fire = false;
});

bombButton.addEventListener('pointerdown', () => {
  input.bomb = true;
});

hud.startButton.addEventListener('click', () => {
  startGame();
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
world.player = createPlayer();
requestAnimationFrame(tick);
