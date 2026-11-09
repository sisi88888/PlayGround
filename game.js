const canvas = document.getElementById('gameCanvas');
const hud = {
  healthFill: document.getElementById('healthFill'),
  waveValue: document.getElementById('waveValue'),
  scoreValue: document.getElementById('scoreValue'),
  status: document.getElementById('status'),
  overlay: document.getElementById('overlay'),
  startButton: document.getElementById('startButton'),
};

const THREE = window.THREE;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.setClearColor(0x071116);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071116);
scene.fog = new THREE.Fog(0x071116, 22, 52);
const camera = new THREE.OrthographicCamera(-10, 10, 7, -7, 0.1, 150);
camera.position.set(0, 32, 22);
camera.lookAt(0, 0, 0);
const cameraFocus = new THREE.Vector3();
const cameraPosition = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const mouseNdc = new THREE.Vector2();
const ambient = new THREE.HemisphereLight(0xb8d8d0, 0x26343a, 2.8);
scene.add(ambient);
const moonLight = new THREE.DirectionalLight(0xc5e6ff, 3.1);
moonLight.position.set(-12, 24, 8);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(1024, 1024);
moonLight.shadow.camera.left = -24;
moonLight.shadow.camera.right = 24;
moonLight.shadow.camera.top = 24;
moonLight.shadow.camera.bottom = -24;
moonLight.shadow.bias = -0.0005;
scene.add(moonLight);
const fillLight = new THREE.PointLight(0xff9a5c, 28, 22);
fillLight.position.set(0, 4, 0);
scene.add(fillLight);

const world = {
  width: 3200, height: 2000, running: false, gameOver: false, score: 0, wave: 1,
  spawnTimer: 0, zombies: [], bullets: [], bombs: [], pickups: [], explosions: [], cars: [],
  player: null, factor: 50, groundScale: 0.819, lastTime: 0, carTimer: 0,
};
const zombieAsset = { root: null, clips: [], failed: false, ready: null };
let gameStartPending = false;
const input = {
  keys: new Set(), pointer: { x: 0, y: 0, down: false }, move: { x: 0, y: 0 },
  fire: false, bomb: false, touchStick: { active: false, x: 0, y: 0 },
};
const audio = { context: null, master: null, drive: null, musicTimer: null, musicStep: 0, nextMoan: 0 };
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const mat = (color, roughness = 0.82, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const shared = {
  green: mat(0x668d50), darkGreen: mat(0x304737), pale: mat(0x9ca66a), eye: mat(0xf5ebca, 0.35),
  red: mat(0x613d49), black: mat(0x111b20), cloth: mat(0x753e4d), steel: mat(0x69757a, 0.45),
};

function startAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  if (!audio.context) {
    audio.context = new AudioContext();
    audio.master = audio.context.createGain();
    audio.master.gain.value = 0.13;
    audio.master.connect(audio.context.destination);
    audio.drive = audio.context.createWaveShaper();
    const curve = new Float32Array(4096);
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i * 2) / curve.length - 1;
      curve[i] = Math.tanh(x * 5);
    }
    audio.drive.curve = curve; audio.drive.oversample = '4x'; audio.drive.connect(audio.master);
  }
  audio.context.resume();
  if (audio.musicTimer) return;
  const riff = [41.2, 41.2, 49, 41.2, 55, 49, 41.2, 61.7, 41.2, 41.2, 49, 55, 41.2, 49, 36.7, 41.2];
  audio.musicTimer = window.setInterval(() => {
    if (!world.running || !audio.context) return;
    const ctx = audio.context;
    const now = ctx.currentTime;
    const step = audio.musicStep++ % riff.length;
    if ([0, 4, 8, 12].includes(step)) {
      const kick = ctx.createOscillator(); const volume = ctx.createGain();
      kick.type = 'sine'; kick.frequency.setValueAtTime(115, now); kick.frequency.exponentialRampToValueAtTime(38, now + 0.12);
      volume.gain.setValueAtTime(0.28, now); volume.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      kick.connect(volume); volume.connect(audio.master); kick.start(now); kick.stop(now + 0.15);
    } else if ([2, 6, 10, 14].includes(step)) {
      const snare = ctx.createOscillator(); const volume = ctx.createGain();
      snare.type = 'triangle'; snare.frequency.value = 175;
      volume.gain.setValueAtTime(0.12, now); volume.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      snare.connect(volume); volume.connect(audio.master); snare.start(now); snare.stop(now + 0.09);
    }
    if (step % 2 === 0) {
      const root = riff[step];
      [root, root * 1.5].forEach((frequency) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain(); const filter = ctx.createBiquadFilter();
        osc.type = 'sawtooth'; osc.frequency.value = frequency;
        filter.type = 'lowpass'; filter.frequency.value = 420;
        gain.gain.setValueAtTime(0.095, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(filter); filter.connect(gain); gain.connect(audio.drive); osc.start(now); osc.stop(now + 0.21);
      });
    }
  }, 220);
}
function playZombieMoan() {
  if (!audio.context || audio.context.state !== 'running') return;
  const ctx = audio.context; const now = ctx.currentTime;
  const osc = ctx.createOscillator(); const wobble = ctx.createOscillator();
  const wobbleGain = ctx.createGain(); const filter = ctx.createBiquadFilter(); const volume = ctx.createGain();
  osc.type = 'sawtooth'; osc.frequency.setValueAtTime(72 + Math.random() * 28, now);
  osc.frequency.exponentialRampToValueAtTime(42 + Math.random() * 16, now + 0.8);
  wobble.frequency.value = 5; wobbleGain.gain.value = 7; wobble.connect(wobbleGain); wobbleGain.connect(osc.frequency);
  filter.type = 'lowpass'; filter.frequency.value = 360;
  volume.gain.setValueAtTime(0.0001, now); volume.gain.linearRampToValueAtTime(0.035, now + 0.12);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
  osc.connect(filter); filter.connect(volume); volume.connect(audio.master);
  wobble.start(now); osc.start(now); wobble.stop(now + 1); osc.stop(now + 1);
}

function resizeCanvas() {
  const rect = document.getElementById('game-shell').getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  const aspect = rect.width / rect.height;
  const viewHeight = rect.height / world.factor;
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  const plane = scene.getObjectByName('arena');
  if (plane) plane.scale.set(world.width / world.factor + 4, world.height / (world.factor * world.groundScale) + 4, 1);
  if (world.player) {
    world.player.x = clamp(world.player.x, 20, world.width - 20);
    world.player.y = clamp(world.player.y, 20, world.height - 20);
    updateCamera(1);
  }
}
function updateCamera(dt = 0.016) {
  const focus = world.player ? toScene(world.player.x, world.player.y) : new THREE.Vector3();
  cameraFocus.lerp(focus, Math.min(1, dt * 10));
  cameraPosition.set(cameraFocus.x, 32, cameraFocus.z + 22);
  camera.position.lerp(cameraPosition, Math.min(1, dt * 10));
  camera.lookAt(cameraFocus.x, 0, cameraFocus.z);
}
function toScene(x, y, height = 0) {
  return new THREE.Vector3((x - world.width / 2) / world.factor, height, (y - world.height / 2) / (world.factor * world.groundScale));
}
function fromScene(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  mouseNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(mouseNdc, camera);
  const point = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, point)) return { x: world.width / 2, y: world.height / 2 };
  return { x: point.x * world.factor + world.width / 2, y: point.z * world.factor * world.groundScale + world.height / 2 };
}
function mesh(geometry, material, parent, x, y, z, cast = true) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  object.castShadow = cast;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}
function addArena() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(0x132229, 1));
  floor.name = 'arena';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.scale.set(world.width / world.factor + 4, world.height / (world.factor * world.groundScale) + 4, 1);
  scene.add(floor);
  const grid = new THREE.GridHelper(80, 80, 0x26373b, 0x1b2b30);
  grid.position.y = 0.006;
  grid.material.transparent = true;
  grid.material.opacity = 0.3;
  scene.add(grid);
  for (let i = 0; i < 34; i += 1) {
    const x = (Math.random() - 0.5) * (world.width / world.factor - 6);
    const z = (Math.random() - 0.5) * (world.height / (world.factor * world.groundScale) - 6);
    const h = 0.4 + Math.random() * 1.1;
    const crate = mesh(new THREE.BoxGeometry(0.65, h, 0.65), mat(i % 2 ? 0x303b3c : 0x3e4541), scene, x, h / 2, z);
    crate.receiveShadow = true;
  }
}
addArena();

function applyZombieAsset(zombie) {
  if (!zombieAsset.root || !window.THREE.SkeletonUtils) return false;
  const replacement = THREE.SkeletonUtils.clone(zombieAsset.root);
  replacement.traverse((part) => {
    if (!part.isMesh) return;
    part.castShadow = true;
    part.receiveShadow = true;
    const cloneMaterial = (material) => {
      const instance = material.clone();
      if (instance.emissive) instance.userData.baseEmissive = instance.emissive.clone();
      return instance;
    };
    part.material = Array.isArray(part.material) ? part.material.map(cloneMaterial) : cloneMaterial(part.material);
  });
  replacement.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(replacement);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y < 0.1) return false;
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = 1.65 / size.y;
  replacement.scale.setScalar(scale);
  replacement.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  const root = new THREE.Group();
  root.add(replacement);
  if (zombie.model) {
    scene.remove(zombie.model);
    zombie.model.traverse((part) => { if (part.geometry) part.geometry.dispose(); });
  }
  scene.add(root);
  zombie.model = root;
  zombie.limbs = [];
  zombie.mixer = new THREE.AnimationMixer(replacement);
  if (zombieAsset.clips.length) {
    zombie.action = zombie.mixer.clipAction(zombieAsset.clips[0]);
    zombie.action.setLoop(THREE.LoopRepeat, Infinity);
    zombie.action.play();
  }
  syncEntity(zombie);
  return true;
}
function loadZombieAsset() {
  zombieAsset.ready = new Promise((resolve) => {
    if (!THREE.GLTFLoader) {
      zombieAsset.failed = true;
      console.warn('GLTFLoader unavailable; using procedural zombies.');
      resolve(false);
      return;
    }
    const loader = new THREE.GLTFLoader();
    loader.load('public/models/zombie.glb', (gltf) => {
      zombieAsset.root = gltf.scene;
      zombieAsset.clips = gltf.animations || [];
      for (const zombie of world.zombies) applyZombieAsset(zombie);
      resolve(true);
    }, undefined, (error) => {
      zombieAsset.failed = true;
      console.warn('Zombie model failed to load; using procedural fallback.', error);
      resolve(false);
    });
  });
  return zombieAsset.ready;
}
function makeZombieModel(zombie) {
  const root = new THREE.Group();
  const shade = Math.random();
  const skin = mat(shade > 0.5 ? 0x718c58 : 0x8e9b64);
  const outfit = mat([0x4a3e48, 0x38494a, 0x55503e, 0x553941][Math.floor(Math.random() * 4)]);
  const accent = mat([0x784353, 0x8b534a, 0x414f6b, 0x7d663d][Math.floor(Math.random() * 4)]);
  const bootMat = mat(0x25292a);
  // Ragged, fully clothed silhouette with deliberately exaggerated padded chest armor.
  const torso = mesh(new THREE.CapsuleGeometry(0.34, 0.42, 4, 8), outfit, root, 0, 0.79, 0);
  torso.scale.set(1.05, 0.9, 0.77);
  const coatTail = mesh(new THREE.BoxGeometry(0.58, 0.38, 0.28), outfit, root, 0, 0.48, -0.03);
  coatTail.rotation.x = -0.08;
  for (const side of [-1, 1]) {
    const leg = mesh(new THREE.CapsuleGeometry(0.105, 0.34, 3, 6), skin, root, side * 0.17, 0.28, 0);
    leg.rotation.z = side * -0.09;
    mesh(new THREE.BoxGeometry(0.23, 0.13, 0.34), bootMat, root, side * 0.17, 0.09, 0.07);
    const arm = mesh(new THREE.CapsuleGeometry(0.085, 0.43, 3, 6), skin, root, side * 0.43, 0.83, 0.01);
    arm.rotation.z = side * -0.58;
    const sleeve = mesh(new THREE.CapsuleGeometry(0.11, 0.2, 3, 6), outfit, root, side * 0.42, 1.00, 0.01);
    sleeve.rotation.z = side * -0.58;
    // Oversized, smooth fabric panels emphasize the chest while keeping the zombie fully clothed.
    const chest = mesh(new THREE.SphereGeometry(1, 20, 16), outfit, root, side * 0.2, 0.9, 0.29);
    chest.scale.set(0.25, 0.215, 0.15);
    const seam = mesh(new THREE.BoxGeometry(0.018, 0.36, 0.018), accent, root, side * 0.2, 0.9, 0.425);
    const strap = mesh(new THREE.BoxGeometry(0.045, 0.42, 0.035), mat(0x292d2c), root, side * 0.21, 0.88, 0.445);
    strap.rotation.z = side * 0.12;
  }
  const neck = mesh(new THREE.CylinderGeometry(0.10, 0.13, 0.18, 8), skin, root, 0, 1.21, 0);
  const head = mesh(new THREE.SphereGeometry(0.23, 12, 10), skin, root, 0, 1.42, 0.015);
  head.scale.set(0.88, 1.04, 0.83);
  for (const side of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.042, 8, 8), shared.eye, root, side * 0.09, 1.45, 0.205);
    mesh(new THREE.SphereGeometry(0.019, 6, 6), mat(0x301d19), root, side * 0.09, 1.45, 0.24);
  }
  mesh(new THREE.BoxGeometry(0.18, 0.055, 0.04), mat(0x2a2221), root, 0, 1.31, 0.19);
  for (let i = 0; i < 3; i += 1) {
    const torn = mesh(new THREE.ConeGeometry(0.07, 0.18, 4), outfit, root, -0.23 + i * 0.23, 0.30, 0.08);
    torn.rotation.z = Math.PI;
  }
  root.traverse((part) => { if (part.isMesh) part.userData.baseMaterial = part.material; });
  scene.add(root);
  zombie.model = root;
  zombie.limbs = root.children.filter((part) => part.geometry && part.geometry.type === 'CapsuleGeometry');
  syncEntity(zombie);
  if (zombieAsset.root) applyZombieAsset(zombie);
}
function makePlayerModel(player) {
  const root = new THREE.Group();
  const uniform = mat(0x315b68);
  const body = mesh(new THREE.CapsuleGeometry(0.28, 0.45, 4, 8), uniform, root, 0, 0.72, 0);
  body.scale.set(1, 0.9, 0.8);
  mesh(new THREE.SphereGeometry(0.2, 12, 10), mat(0xd0b28a), root, 0, 1.28, 0);
  mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.11, 10), mat(0x18272c), root, 0, 1.43, 0);
  mesh(new THREE.BoxGeometry(0.26, 0.12, 0.34), mat(0x3d4c42), root, -0.31, 0.82, 0);
  const gun = mesh(new THREE.BoxGeometry(0.14, 0.13, 0.68), mat(0x1b262a, 0.45, { metalness: 0.3 }), root, 0, 0.96, 0.45);
  gun.name = 'gun';
  for (const side of [-1, 1]) {
    mesh(new THREE.CapsuleGeometry(0.08, 0.37, 3, 6), uniform, root, side * 0.37, 0.83, 0.10).rotation.x = -0.4;
    mesh(new THREE.CapsuleGeometry(0.11, 0.34, 3, 6), mat(0x202c2f), root, side * 0.15, 0.23, 0);
  }
  scene.add(root);
  player.model = root;
  syncEntity(player);
}
function syncEntity(entity) {
  if (!entity.model) return;
  const position = toScene(entity.x, entity.y);
  entity.model.position.set(position.x, 0, position.z);
}
function createPlayer() {
  const player = { x: world.width / 2, y: world.height / 2, radius: 18, speed: 220, hp: 100, maxHp: 100, fireCooldown: 0, angle: 0, weaponLevel: 1, weapon: 'pistol', gunFlash: 0, invuln: 0 };
  makePlayerModel(player);
  updateWeaponLabel(player);
  return player;
}
function updateWeaponLabel(player = world.player) {
  const button = document.getElementById('switchButton');
  if (button && player) button.textContent = player.weapon === 'pistol' ? 'PISTOL' : 'BOMB';
  const status = document.getElementById('weaponValue');
  if (status && player) status.textContent = player.weapon === 'pistol' ? 'PISTOL' : 'BOMB';
}
function toggleWeapon() {
  if (!world.player) return;
  world.player.weapon = world.player.weapon === 'pistol' ? 'bomb' : 'pistol';
  updateWeaponLabel();
  hud.status.textContent = world.player.weapon === 'pistol' ? 'Pistol selected' : 'Bombs selected — fire to throw';
}
function createZombie(x, y) {
  const levelBoost = 1 + (world.wave - 1) * 0.15;
  const zombie = { x, y, radius: 18, speed: 36 + Math.random() * 20 * levelBoost, hp: 32 + world.wave * 4, maxHp: 32 + world.wave * 4, damage: 10 + world.wave * 1.2, hitFlash: 0, phase: Math.random() * 6.28, limbs: [] };
  makeZombieModel(zombie);
  return zombie;
}
function spawnAroundPlayer(minScale = 0.82, maxScale = 1.08) {
  const player = world.player || { x: world.width / 2, y: world.height / 2 };
  const angle = Math.random() * Math.PI * 2;
  const scale = minScale + Math.random() * (maxScale - minScale);
  const radiusX = (camera.right - camera.left) * world.factor * 0.52 * scale;
  const radiusY = (camera.top - camera.bottom) * world.factor * world.groundScale * 0.52 * scale;
  return {
    x: clamp(player.x + Math.cos(angle) * radiusX, 28, world.width - 28),
    y: clamp(player.y + Math.sin(angle) * radiusY, 28, world.height - 28),
  };
}
function spawnWave() {
  const count = Math.min(5 + world.wave * 2, 24);
  world.spawnTimer = 0;
  for (let i = 0; i < count; i += 1) {
    const point = spawnAroundPlayer(0.9, 1.18);
    world.zombies.push(createZombie(point.x, point.y));
  }
}
function addPickup(x, y, type = 'ammo') {
  const group = new THREE.Group();
  const color = type === 'ammo' ? 0xe9b544 : 0x40df91;
  const crystal = mesh(new THREE.BoxGeometry(0.30, 0.30, 0.30), mat(color, 0.3, { emissive: color, emissiveIntensity: 0.25 }), group, 0, 0.42, 0);
  crystal.rotation.set(0.3, 0.45, 0.3);
  scene.add(group);
  const item = { x, y, radius: 10, type, bob: Math.random() * Math.PI * 2, model: group };
  syncEntity(item);
  world.pickups.push(item);
}
function createCar(x, y) {
  const root = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(1.05, 0.34, 0.58), mat(0x6d7372), root, 0, 0.36, 0);
  const roof = mesh(new THREE.BoxGeometry(0.52, 0.25, 0.48), mat(0x293d43), root, -0.08, 0.63, 0);
  for (const side of [-1, 1]) for (const front of [-1, 1]) {
    const wheel = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.11, 10), mat(0x101214), root, front * 0.32, 0.18, side * 0.30);
    wheel.rotation.z = Math.PI / 2;
  }
  const lights = mat(0xffc15a, 0.4, { emissive: 0xff5b21, emissiveIntensity: 0.7 });
  mesh(new THREE.BoxGeometry(0.10, 0.09, 0.13), lights, root, 0.51, 0.4, -0.18);
  mesh(new THREE.BoxGeometry(0.10, 0.09, 0.13), lights, root, 0.51, 0.4, 0.18);
  scene.add(root);
  const car = { x, y, radius: 24, hp: 80, angle: Math.random() * 6.28, charge: 0, model: root };
  syncEntity(car);
  world.cars.push(car);
}
function clearEntities() {
  for (const list of [world.zombies, world.bullets, world.bombs, world.pickups, world.explosions, world.cars]) {
    for (const entity of list) if (entity.model) scene.remove(entity.model);
  }
}
function resetGame() {
  clearEntities();
  if (world.player?.model) scene.remove(world.player.model);
  world.running = true; world.gameOver = false; world.score = 0; world.wave = 1; world.spawnTimer = 0; world.carTimer = 0;
  world.zombies = []; world.bullets = []; world.bombs = []; world.pickups = []; world.explosions = []; world.cars = [];
  world.player = createPlayer();
  hud.status.textContent = 'Survive the night';
  hud.waveValue.textContent = '1'; hud.scoreValue.textContent = '0';
  spawnWave();
}
async function startGame() {
  if (gameStartPending) return;
  gameStartPending = true;
  const button = hud.overlay.querySelector('button');
  if (button) {
    button.disabled = true;
    button.textContent = 'Loading…';
  }
  startAudio();
  if (zombieAsset.ready && !zombieAsset.root && !zombieAsset.failed) {
    hud.status.textContent = 'Loading 3D zombies…';
    await zombieAsset.ready;
  }
  if (button?.isConnected) {
    button.disabled = false;
    button.textContent = button.id === 'restartButton' ? 'Play Again' : 'Start Game';
  }
  gameStartPending = false;
  resetGame();
  hud.overlay.classList.add('hidden');
}
function fireBullet() {
  const bullet = mesh(new THREE.SphereGeometry(0.075, 8, 6), mat(0xffd26c, 0.25, { emissive: 0xff8a30, emissiveIntensity: 1.3 }), scene, 0, 0.62, 0);
  const angle = world.player.angle + (Math.random() - 0.5) * 0.08 * world.player.weaponLevel;
  const p = toScene(world.player.x + Math.cos(angle) * 28, world.player.y + Math.sin(angle) * 28, 0.64);
  bullet.position.copy(p);
  world.bullets.push({ x: world.player.x + Math.cos(angle) * 28, y: world.player.y + Math.sin(angle) * 28, vx: Math.cos(angle) * 520, vy: Math.sin(angle) * 520, radius: 4, life: 1.1, damage: 20 + (world.player.weaponLevel - 1) * 8, model: bullet });
}
function throwBomb() {
  const player = world.player;
  if (!player || player.fireCooldown > 0) return;
  const angle = player.angle;
  const model = mesh(new THREE.SphereGeometry(0.13, 10, 8), mat(0x282d31, 0.45, { emissive: 0x7f1d1d, emissiveIntensity: 0.35 }), scene, 0, 0, 0);
  const bomb = { x: player.x + Math.cos(angle) * 24, y: player.y + Math.sin(angle) * 24, vx: Math.cos(angle) * 260, vy: Math.sin(angle) * 260, age: 0, fuse: 0.72, model };
  bomb.model.position.copy(toScene(bomb.x, bomb.y, 0.7));
  world.bombs.push(bomb);
  player.fireCooldown = 0.85;
}
function detonateBomb(bomb) {
  scene.remove(bomb.model);
  const radius = 105;
  for (let i = world.zombies.length - 1; i >= 0; i -= 1) {
    const zombie = world.zombies[i];
    const distance = dist(bomb.x, bomb.y, zombie.x, zombie.y);
    if (distance < radius) {
      zombie.hp -= 72 * (1 - distance / (radius * 1.5));
      zombie.hitFlash = 0.12;
      if (zombie.hp <= 0) {
        world.score += 15; scene.remove(zombie.model); world.zombies.splice(i, 1);
        if (Math.random() < 0.22) addPickup(zombie.x, zombie.y, 'ammo');
      }
    }
  }
  for (const car of world.cars) if (dist(bomb.x, bomb.y, car.x, car.y) < radius + 24) car.hp -= 90;
  createExplosion(bomb.x, bomb.y, radius, 0xff5d73);
  hud.status.textContent = 'Bomb detonated!';
}
function updateBombs(dt) {
  for (let i = world.bombs.length - 1; i >= 0; i -= 1) {
    const bomb = world.bombs[i];
    bomb.age += dt; bomb.x += bomb.vx * dt; bomb.y += bomb.vy * dt;
    const arc = Math.sin(Math.min(1, bomb.age / bomb.fuse) * Math.PI) * 1.25;
    bomb.model.position.copy(toScene(bomb.x, bomb.y, 0.25 + arc));
    bomb.model.rotation.x += dt * 8; bomb.model.rotation.z += dt * 6;
    if (bomb.age >= bomb.fuse) {
      detonateBomb(bomb); world.bombs.splice(i, 1);
    }
  }
}
function createExplosion(x, y, radius, color = 0xffbb33) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 6, 24), mat(color, 0.35, { emissive: color, emissiveIntensity: 1.2 }));
  ring.rotation.x = Math.PI / 2;
  const p = toScene(x, y, 0.22);
  ring.position.copy(p);
  scene.add(ring);
  world.explosions.push({ x, y, radius, maxRadius: radius, life: 0.45, model: ring });
}
function updatePlayer(dt) {
  const player = world.player;
  let dx = 0; let dy = 0;
  if (input.keys.has('w') || input.keys.has('arrowup')) dy -= 1;
  if (input.keys.has('s') || input.keys.has('arrowdown')) dy += 1;
  if (input.keys.has('a') || input.keys.has('arrowleft')) dx -= 1;
  if (input.keys.has('d') || input.keys.has('arrowright')) dx += 1;
  if (input.touchStick.active) { dx += input.touchStick.x; dy += input.touchStick.y; }
  const length = Math.hypot(dx, dy) || 1;
  player.x = clamp(player.x + dx / length * player.speed * dt, 20, world.width - 20);
  player.y = clamp(player.y + dy / length * player.speed * dt, 20, world.height - 20);
  const target = fromScene(input.pointer.x, input.pointer.y);
  player.angle = Math.atan2(target.y - player.y, target.x - player.x);
  player.model.rotation.y = Math.PI / 2 - player.angle;
  syncEntity(player);
  player.fireCooldown -= dt;
  if ((input.fire || input.pointer.down) && player.fireCooldown <= 0) {
    if (player.weapon === 'bomb') throwBomb();
    else { fireBullet(); player.fireCooldown = 0.15; player.gunFlash = 0.08; }
  }
  if (input.bomb) { input.bomb = false; throwBomb(); }
  if (player.invuln > 0) player.invuln -= dt;
  if (player.gunFlash > 0) player.gunFlash -= dt;
}
function updateBullets(dt) {
  for (let i = world.bullets.length - 1; i >= 0; i -= 1) {
    const b = world.bullets[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    const p = toScene(b.x, b.y, 0.64); b.model.position.copy(p);
    if (b.life <= 0 || b.x < -30 || b.x > world.width + 30 || b.y < -30 || b.y > world.height + 30) {
      scene.remove(b.model); world.bullets.splice(i, 1); continue;
    }
    for (let j = world.zombies.length - 1; j >= 0; j -= 1) {
      const z = world.zombies[j];
      if (dist(b.x, b.y, z.x, z.y) < b.radius + z.radius) {
        z.hp -= b.damage; z.hitFlash = 0.08;
        scene.remove(b.model); world.bullets.splice(i, 1);
        if (z.hp <= 0) {
          world.score += 15; scene.remove(z.model); world.zombies.splice(j, 1);
          createExplosion(z.x, z.y, 22, 0x9ae6b4);
          if (Math.random() < 0.28) addPickup(z.x, z.y, 'ammo'); else if (Math.random() < 0.12) addPickup(z.x, z.y, 'health');
        }
        break;
      }
    }
  }
}
function updateCombat(dt, time) {
  for (let i = world.zombies.length - 1; i >= 0; i -= 1) {
    const z = world.zombies[i];
    const dx = world.player.x - z.x; const dy = world.player.y - z.y; const len = Math.hypot(dx, dy) || 1;
    z.x += dx / len * z.speed * dt; z.y += dy / len * z.speed * dt;
    z.model.rotation.y = Math.atan2(dx, dy);
    z.phase += dt * 5;
    z.model.position.copy(toScene(z.x, z.y));
    z.model.position.y = Math.abs(Math.sin(z.phase)) * 0.035;
    if (z.mixer) z.mixer.update(dt);
    else z.limbs.forEach((limb, index) => { limb.rotation.z += Math.sin(time * 0.008 + index) * 0.0015; });
    if (z.hitFlash > 0) {
      z.hitFlash -= dt;
      z.model.traverse((part) => {
        if (!part.isMesh) return;
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        materials.forEach((material) => material.emissive?.setHex(0x756f61));
      });
    } else z.model.traverse((part) => {
      if (!part.isMesh) return;
      const materials = Array.isArray(part.material) ? part.material : [part.material];
      materials.forEach((material) => material.emissive?.copy(material.userData.baseEmissive || new THREE.Color(0x000000)));
    });
    if (dist(z.x, z.y, world.player.x, world.player.y) < z.radius + world.player.radius && world.player.invuln <= 0) {
      world.player.hp -= z.damage;
      world.player.invuln = 0.55;
      if (world.player.hp <= 0) finishGame();
    }
    if (z.hp <= 0) { scene.remove(z.model); world.zombies.splice(i, 1); }
  }
}
function updatePickups(dt) {
  for (let i = world.pickups.length - 1; i >= 0; i -= 1) {
    const item = world.pickups[i]; item.bob += dt * 4;
    item.model.position.copy(toScene(item.x, item.y, 0.42 + Math.sin(item.bob) * 0.07));
    item.model.rotation.y += dt * 1.3;
    if (dist(item.x, item.y, world.player.x, world.player.y) < item.radius + world.player.radius + 6) {
      if (item.type === 'ammo') { world.player.weaponLevel = Math.min(5, world.player.weaponLevel + 1); hud.status.textContent = 'Weapon upgraded'; }
      else { world.player.hp = Math.min(world.player.maxHp, world.player.hp + 25); hud.status.textContent = 'Health refill'; }
      scene.remove(item.model); world.pickups.splice(i, 1);
    }
  }
}
function updateCars(dt) {
  world.carTimer -= dt;
  if (world.cars.length < 3 && world.carTimer <= 0) {
    world.carTimer = 7 + Math.random() * 8;
    const point = spawnAroundPlayer(0.9, 1.15);
    createCar(point.x, point.y);
  }
  for (let i = world.cars.length - 1; i >= 0; i -= 1) {
    const car = world.cars[i]; car.charge += dt * 0.2;
    const dx = world.player.x - car.x; const dy = world.player.y - car.y; const len = Math.hypot(dx, dy) || 1;
    car.x += dx / len * 18 * dt; car.y += dy / len * 18 * dt;
    car.model.position.copy(toScene(car.x, car.y)); car.model.rotation.y = -Math.atan2(dy, dx);
    if (car.charge > 0.9 && Math.random() < 0.03) { createExplosion(car.x, car.y, 34, 0xf97316); car.hp -= 20; car.charge = 0; }
    if (dist(car.x, car.y, world.player.x, world.player.y) < car.radius + world.player.radius + 10 && world.player.invuln <= 0) {
      world.player.hp -= 8;
      world.player.invuln = 0.7;
      if (world.player.hp <= 0) finishGame();
    }
    if (car.hp <= 0) { createExplosion(car.x, car.y, 48, 0xfbbf24); scene.remove(car.model); world.cars.splice(i, 1); world.score += 40; }
  }
}
function updateExplosions(dt) {
  for (let i = world.explosions.length - 1; i >= 0; i -= 1) {
    const e = world.explosions[i]; e.life -= dt;
    const scale = 1 + (1 - e.life / 0.45) * 6;
    e.model.scale.setScalar(scale); e.model.material.opacity = Math.max(0, e.life / 0.45); e.model.material.transparent = true;
    if (e.life <= 0) { scene.remove(e.model); world.explosions.splice(i, 1); }
  }
}
function updateWave(dt) {
  world.spawnTimer -= dt;
  if (world.zombies.length === 0 && world.spawnTimer <= 0) {
    world.wave += 1; hud.waveValue.textContent = String(world.wave); hud.status.textContent = `Wave ${world.wave}`;
    world.spawnTimer = 1.25; setTimeout(() => { if (world.running && !world.gameOver) spawnWave(); }, 120);
  }
  if (world.zombies.length > 0 && world.spawnTimer <= -0.5) world.spawnTimer = 0;
}
function finishGame() {
  if (world.gameOver) return;
  world.player.hp = 0; world.running = false; world.gameOver = true;
  hud.status.textContent = 'You were overwhelmed';
  const card = hud.overlay.querySelector('.card');
  card.innerHTML = `<h1>Game Over</h1><p>Wave reached: ${world.wave}</p><p>Score: ${world.score}</p><button id="restartButton">Play Again</button>`;
  document.getElementById('restartButton').addEventListener('click', startGame);
  hud.overlay.classList.remove('hidden');
}
function updateGame(dt, time) {
  if (!world.running || world.gameOver) return;
  updatePlayer(dt); updateBullets(dt); updateBombs(dt); updateCars(dt); updatePickups(dt); updateCombat(dt, time); updateExplosions(dt); updateWave(dt);
  updateCamera(dt);
  if (world.zombies.length && time > audio.nextMoan) {
    playZombieMoan(); audio.nextMoan = time + 3800 + Math.random() * 3600;
  }
  hud.healthFill.style.width = `${(world.player.hp / world.player.maxHp) * 100}%`;
  hud.scoreValue.textContent = String(world.score);
}
function tick(timestamp) {
  const dt = Math.min((timestamp - world.lastTime) / 1000 || 0.016, 0.035);
  world.lastTime = timestamp;
  updateGame(dt, timestamp);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
function setPointerPosition(clientX, clientY) {
  input.pointer.x = clientX;
  input.pointer.y = clientY;
}
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key)) event.preventDefault();
  input.keys.add(key);
  if (!event.repeat && key === 'q') toggleWeapon();
  if (!event.repeat && key === '1' && world.player) { world.player.weapon = 'pistol'; updateWeaponLabel(); }
  if (!event.repeat && key === '2' && world.player) { world.player.weapon = 'bomb'; updateWeaponLabel(); }
  if (key === ' ') { input.bomb = true; event.preventDefault(); }
});
window.addEventListener('keyup', (event) => { input.keys.delete(event.key.toLowerCase()); if (event.key === ' ') input.bomb = false; });
canvas.addEventListener('pointerdown', (event) => { setPointerPosition(event.clientX, event.clientY); input.pointer.down = true; });
canvas.addEventListener('pointermove', (event) => setPointerPosition(event.clientX, event.clientY));
canvas.addEventListener('pointerup', () => { input.pointer.down = false; });
canvas.addEventListener('pointerleave', () => { input.pointer.down = false; });
const stick = document.getElementById('stickKnob');
const leftStick = document.getElementById('leftStick');
function updateTouchStick(pointX, pointY) {
  const rect = leftStick.getBoundingClientRect();
  const dx = pointX - (rect.left + rect.width / 2); const dy = pointY - (rect.top + rect.height / 2);
  const maxRadius = 32; const length = Math.hypot(dx, dy) || 1; const ratio = Math.min(maxRadius, length) / length;
  const x = dx * ratio; const y = dy * ratio;
  stick.style.transform = `translate(${x}px, ${y}px)`;
  input.touchStick.x = x / maxRadius; input.touchStick.y = y / maxRadius; input.touchStick.active = true;
}
leftStick.addEventListener('pointerdown', (event) => { leftStick.setPointerCapture(event.pointerId); updateTouchStick(event.clientX, event.clientY); });
leftStick.addEventListener('pointermove', (event) => { if (event.pressure > 0 || leftStick.hasPointerCapture(event.pointerId)) updateTouchStick(event.clientX, event.clientY); });
function releaseStick() { input.touchStick.active = false; input.touchStick.x = 0; input.touchStick.y = 0; stick.style.transform = 'translate(0px, 0px)'; }
leftStick.addEventListener('pointerup', releaseStick); leftStick.addEventListener('pointercancel', releaseStick);
const fireButton = document.getElementById('fireButton'); const switchButton = document.getElementById('switchButton');
fireButton.addEventListener('pointerdown', (event) => { event.preventDefault(); input.fire = true; });
fireButton.addEventListener('pointerup', () => { input.fire = false; }); fireButton.addEventListener('pointerleave', () => { input.fire = false; });
fireButton.addEventListener('pointercancel', () => { input.fire = false; });
switchButton.addEventListener('pointerdown', (event) => { event.preventDefault(); toggleWeapon(); });
hud.startButton.addEventListener('click', startGame);
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
world.player = createPlayer();
const canvasRect = canvas.getBoundingClientRect();
input.pointer.x = canvasRect.left + canvasRect.width * 0.75;
input.pointer.y = canvasRect.top + canvasRect.height * 0.5;
updateCamera(1);
loadZombieAsset();
requestAnimationFrame(tick);
