// DUSTLINE boot: renderer, fixed-step loop, hitscan shooting, grenades, bomb visuals,
// tracers and sparks — the one place that owns the frame. Modules own their jobs;
// this file wires them together and owns the game object they all share.
//
// ?shot=start|play|end with &seed=N stages a deterministic frame for a capture, renders
// it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, rayWorld, hasLOS, SITE, SPAWNS, ATK_ROUTES, DEF_ROUTES } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createViewModel, createGunState, gunReady, gunStep, gunShoot, gunReload, gunSpread, WEAPONS, GRENADE } from './weapons.js';
import { createBot, updateBot, killBot, botHitbox } from './bots.js';
import { createHud } from './hud.js';
import { createSfx } from './audio.js';
import {
  createMatch, startMatch, beginLive, nextRound, checkRoundEnd, awardKill,
  plantBomb, defuseBomb, dropBomb, resetBomb, endRound, WIN_ROUNDS, ROUND_TIME, BUY_TIME,
} from './state.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 34, 110);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const sfx = createSfx();
const viewModel = createViewModel(camera);

// ---------- game object (the one shared state) ----------
const game = {
  scene, world, site: SITE, hud, sfx, rng,
  time: 0,
  player: null,
  allies: [],
  enemies: [],
  match: createMatch(),
  money: 800,
  kills: 0,
  deaths: 0,
  playerWeaponId: 'pistol',
  playerGun: createGunState(WEAPONS.pistol),
  owned: { pistol: true },
  playerGrenades: 0,
  noises: [],
  spotted: new Map(),
  bomb: null, // alias of match.bomb, set below
  grenades: [],
  defuseT: 0,
  lastBeepT: -99,
};
game.bomb = game.match.bomb;

game.player = createPlayer(world.colliders, SPAWNS.def[0]);
game.player.state.yaw = Math.PI / 2; // face west, toward Site A

// ---------- effects: tracer pool + spark points ----------
const TRACER_N = 14;
const tracers = [];
for (let i = 0; i < TRACER_N; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIdx = 0;
const _v = new THREE.Vector3();
function spawnTracer(from, to, color) {
  const t = tracers[tracerIdx];
  tracerIdx = (tracerIdx + 1) % TRACER_N;
  const pos = t.line.geometry.attributes.position.array;
  pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
  pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.material.opacity = 0.85;
  t.life = 0.08;
}

const SPARK_N = 240;
const sparkPos = new Float32Array(SPARK_N * 3);
const sparkVel = new Float32Array(SPARK_N * 3);
const sparkLife = new Float32Array(SPARK_N);
const sparkCol = new Float32Array(SPARK_N * 3);
for (let i = 0; i < SPARK_N; i += 1) sparkPos[i * 3 + 1] = -999;
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
const sparkPoints = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
sparkPoints.frustumCulled = false;
scene.add(sparkPoints);
let sparkIdx = 0;
const _c = new THREE.Color();
function spawnSparks(p, n, colorHex, speed = 5) {
  _c.setHex(colorHex);
  for (let k = 0; k < n; k += 1) {
    const i = sparkIdx;
    sparkIdx = (sparkIdx + 1) % SPARK_N;
    sparkPos[i * 3] = p.x;
    sparkPos[i * 3 + 1] = p.y;
    sparkPos[i * 3 + 2] = p.z;
    const a = rng() * Math.PI * 2;
    const up = rng() * 0.9 + 0.2;
    const s = speed * (0.4 + rng() * 0.8);
    sparkVel[i * 3] = Math.cos(a) * s;
    sparkVel[i * 3 + 1] = up * s;
    sparkVel[i * 3 + 2] = Math.sin(a) * s;
    sparkLife[i] = 0.35 + rng() * 0.35;
    sparkCol[i * 3] = _c.r;
    sparkCol[i * 3 + 1] = _c.g;
    sparkCol[i * 3 + 2] = _c.b;
  }
  sparkGeo.attributes.color.needsUpdate = true;
}

// ---------- bomb prop at Site A ----------
const bombGroup = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.24, 0.3),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.gunMetal), roughness: 0.5, metalness: 0.4 }),
);
bombBody.position.y = 0.12;
const bombLed = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 8),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3b2d) }),
);
bombLed.position.set(0.1, 0.3, 0);
const bombLight = new THREE.PointLight(new THREE.Color(0xff3b2d), 0, 9, 1.5);
bombLight.position.y = 0.6;
bombGroup.add(bombBody, bombLed, bombLight);
bombGroup.position.set(SITE.x, 0, SITE.z);
bombGroup.visible = false;
scene.add(bombGroup);

// ---------- teams ----------
const DEF_ROUTE_KEYS = ['siteNorth', 'siteWest', 'mid', 'long'];
const ATK_ROUTE_KEYS = ['long', 'mid', 'conn', 'long', 'mid'];
function spawnTeams() {
  for (let i = 0; i < 4; i += 1) {
    const bot = createBot(game, 'us', i, SPAWNS.def[(i + 1) % SPAWNS.def.length], DEF_ROUTES[DEF_ROUTE_KEYS[i]], rng);
    game.allies.push(bot);
  }
  for (let i = 0; i < 5; i += 1) {
    const bot = createBot(game, 'them', i, SPAWNS.atk[i % SPAWNS.atk.length], ATK_ROUTES[ATK_ROUTE_KEYS[i]], rng);
    game.enemies.push(bot);
  }
}
spawnTeams();

game.resetPositions = function resetPositions() {
  const ps = game.player.state;
  ps.x = SPAWNS.def[0][0];
  ps.z = SPAWNS.def[0][1];
  game.player.reset(SPAWNS.def[0], Math.PI / 2);
  game.allies.forEach((b, i) => {
    const s = SPAWNS.def[(i + 1) % SPAWNS.def.length];
    b.x = s[0];
    b.z = s[1];
    b.hp = 100;
    b.alive = true;
    b.fall = 0;
    b.target = null;
    b.investigate = null;
    b.isCarrier = false;
    b.plantT = 0;
    b.defuseT = 0;
    b.route = DEF_ROUTES[DEF_ROUTE_KEYS[(i + game.match.round) % DEF_ROUTE_KEYS.length]].slice();
    b.wp = 0;
    b.state = 'route';
    b.gun = createGunState(WEAPONS[b.weaponId]);
    b.mesh.group.rotation.set(0, 0, 0);
    b.mesh.group.position.set(b.x, 0, b.z);
    b.yaw = Math.PI / 2;
  });
  game.enemies.forEach((b, i) => {
    const s = SPAWNS.atk[i % SPAWNS.atk.length];
    b.x = s[0];
    b.z = s[1];
    b.hp = 100;
    b.alive = true;
    b.fall = 0;
    b.target = null;
    b.investigate = null;
    b.isCarrier = false;
    b.plantT = 0;
    b.defuseT = 0;
    b.route = ATK_ROUTES[ATK_ROUTE_KEYS[(i + game.match.round) % ATK_ROUTE_KEYS.length]].slice();
    b.wp = 0;
    b.state = 'route';
    b.gun = createGunState(WEAPONS[b.weaponId]);
    b.mesh.group.rotation.set(0, 0, 0);
    b.mesh.group.position.set(b.x, 0, b.z);
    b.yaw = -Math.PI / 2;
  });
  game.defuseT = 0;
  game.grenades.length = 0;
  game.noises.length = 0;
  game.spotted.clear();
  bombGroup.visible = false;
  bombLight.intensity = 0;
};

game.setPlayerWeapon = function setPlayerWeapon(id) {
  if (!game.owned[id]) return;
  game.playerWeaponId = id;
  game.playerGun = createGunState(WEAPONS[id]);
  viewModel.setWeapon(id);
  hud.setAmmo(game.playerGun.mag, game.playerGun.reserve, WEAPONS[id].name);
};
viewModel.setWeapon('pistol');

// ---------- ray helpers ----------
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [dx, ox, b.x0, b.x1],
    [dy, oy, b.y0, b.y1],
    [dz, oz, b.z0, b.z1],
  ];
  for (const [d, o, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// ---------- shooting ----------
function applyBotDamage(bot, amount, head, attackerIsPlayer, fromX, fromZ) {
  if (!bot.alive) return;
  bot.hp -= amount;
  if (attackerIsPlayer) {
    hud.hitMarker(false);
    sfx.hit();
  }
  if (bot.hp <= 0) {
    killBot(game, bot);
    const killer = attackerIsPlayer ? 'You' : (bot.team === 'us' ? 'Ember' : 'Vanguard');
    hud.killfeed(`${killer} ▸ ${bot.name}${head ? ' (headshot)' : ''}`, attackerIsPlayer);
    if (attackerIsPlayer) {
      awardKill(game, true);
      sfx.kill();
    }
    spawnSparks({ x: bot.x, y: 1.2, z: bot.z }, 14, 0x8f1d1d, 4);
  }
}

function damagePlayer(amount, fromX, fromZ) {
  const p = game.player.state;
  if (!p.alive) return;
  p.hp -= amount;
  sfx.hurt();
  const dx = fromX - p.x;
  const dz = fromZ - p.z;
  // Direction indicator: angle of the attacker relative to where the player faces.
  const worldAng = Math.atan2(-dx, -dz);
  let rel = worldAng - p.yaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  hud.damageFrom((-rel * 180) / Math.PI);
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    game.deaths += 1;
    game.defuseT = 0;
    hud.showOverlay('dead');
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

// One hitscan shot from any shooter. Resolves wall, bots and the player; draws the
// tracer, sparks and sound; returns the hit point.
game.shootFrom = function shootFrom(shooter, ox, oy, oz, dx, dy, dz, def, r) {
  const wall = rayWorld(world.colliders, ox, oy, oz, dx, dy, dz, def.range);
  const wallT = wall ? wall.t : def.range;
  let bestT = wallT;
  let bestBot = null;
  let bestHead = false;
  let bestPlayer = false;
  const targets = shooter.team === 'us' ? game.enemies : game.allies;
  for (const b of targets) {
    if (!b.alive || b === shooter) continue;
    const hb = botHitbox(b);
    const th = raySphere(ox, oy, oz, dx, dy, dz, hb.head.x, hb.head.y, hb.head.z, hb.head.r);
    if (th < bestT) {
      bestT = th;
      bestBot = b;
      bestHead = true;
      bestPlayer = false;
    }
    const tb = rayBox(ox, oy, oz, dx, dy, dz, hb.body);
    if (tb < bestT) {
      bestT = tb;
      bestBot = b;
      bestHead = false;
      bestPlayer = false;
    }
  }
  const p = game.player.state;
  if (shooter.team === 'them' && p.alive) {
    const th = raySphere(ox, oy, oz, dx, dy, dz, p.x, p.eye - 0.12, p.z, 0.2);
    if (th < bestT) {
      bestT = th;
      bestBot = null;
      bestPlayer = true;
    }
    const tb = rayBox(ox, oy, oz, dx, dy, dz, { x0: p.x - 0.36, y0: 0, z0: p.z - 0.36, x1: p.x + 0.36, y1: p.eye - 0.25, z1: p.z + 0.36 });
    if (tb < bestT) {
      bestT = tb;
      bestBot = null;
      bestPlayer = true;
    }
  }
  const hit = { x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT };
  const falloff = bestT > def.range ? 0.6 : 1;
  if (bestBot) {
    const dmg = def.damage * (bestHead ? def.headMul : 1) * falloff;
    applyBotDamage(bestBot, dmg, bestHead, shooter.isPlayer === true, ox, oz);
    spawnSparks(hit, 8, 0x8f1d1d, 3);
  } else if (bestPlayer) {
    damagePlayer(def.damage * falloff, ox, oz);
    spawnSparks(hit, 8, 0x8f1d1d, 3);
  } else if (wall) {
    spawnSparks(hit, 6, 0xffc46b, 3.5);
  }
  const muzzle = { x: ox, y: oy, z: oz };
  spawnTracer(muzzle, hit, shooter.team === 'them' ? PALETTE.tracerThem : def.tracer);
  game.noises.push({ x: ox, z: oz, t: game.time, r: shooter.isPlayer ? 26 : 20 });
  return hit;
};

game.dropBomb = function dropBomb(x, z) {
  dropBomb(game, x, z);
};
game.plantBomb = function plantBombFn(bot) {
  plantBomb(game, bot);
  bombGroup.visible = true;
  bombGroup.position.set(game.site.x, 0, game.site.z);
};
game.defuseBomb = function defuseBombFn(bot) {
  defuseBomb(game, bot);
  bombGroup.visible = false;
  bombLight.intensity = 0;
};

// ---------- grenades ----------
function throwGrenade() {
  if (game.playerGrenades <= 0 || game.match.phase !== 'live') return;
  game.playerGrenades -= 1;
  sfx.grenadePin();
  const p = game.player.state;
  const fx = -Math.sin(p.yaw) * Math.cos(p.pitch);
  const fy = Math.sin(p.pitch);
  const fz = -Math.cos(p.yaw) * Math.cos(p.pitch);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2e4a2e), roughness: 0.6 }),
  );
  mesh.position.set(p.x + fx * 0.5, p.eye + fy * 0.5, p.z + fz * 0.5);
  scene.add(mesh);
  game.grenades.push({ mesh, x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, vx: fx * 15, vy: fy * 15 + 3.2, vz: fz * 15, fuse: 1.6 });
}

function explodeGrenade(g) {
  scene.remove(g.mesh);
  sfx.explosion();
  spawnSparks({ x: g.x, y: g.y, z: g.z }, 60, 0xffa63d, 9);
  spawnSparks({ x: g.x, y: g.y, z: g.z }, 30, 0x5a5a5a, 5);
  const flash = new THREE.PointLight(new THREE.Color(0xffa63d), 60, 16, 1.8);
  flash.position.set(g.x, g.y + 0.5, g.z);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 180);
  const hurt = (tx, tz, ty) => {
    const d = Math.hypot(tx - g.x, tz - g.z, (ty - g.y) * 0.7);
    if (d > GRENADE.radius) return 0;
    return GRENADE.damage * (1 - (d / GRENADE.radius) * 0.75);
  };
  for (const b of [...game.allies, ...game.enemies]) {
    if (!b.alive) continue;
    const dmg = hurt(b.x, b.z, 1.1);
    if (dmg > 0) applyBotDamage(b, dmg, false, true, g.x, g.z);
  }
  const p = game.player.state;
  const dmg = hurt(p.x, p.z, p.eye);
  if (dmg > 0) damagePlayer(dmg, g.x, g.z);
  game.noises.push({ x: g.x, z: g.z, t: game.time, r: 34 });
}

function stepGrenades(dt) {
  for (let i = game.grenades.length - 1; i >= 0; i -= 1) {
    const g = game.grenades[i];
    g.vy -= 14 * dt;
    const nx = g.x + g.vx * dt;
    const nz = g.z + g.vz * dt;
    // Wall bounce: revert the axis that entered a collider and reflect.
    let hitX = false;
    let hitZ = false;
    for (const c of world.colliders) {
      if (g.y < c.y0 || g.y > c.y1) continue;
      if (nx > c.x0 - 0.09 && nx < c.x1 + 0.09 && g.z > c.z0 - 0.09 && g.z < c.z1 + 0.09) hitX = true;
      if (nz > c.z0 - 0.09 && nz < c.z1 + 0.09 && g.x > c.x0 - 0.09 && g.x < c.x1 + 0.09) hitZ = true;
    }
    if (hitX) g.vx = -g.vx * 0.45;
    else g.x = nx;
    if (hitZ) g.vz = -g.vz * 0.45;
    else g.z = nz;
    g.y += g.vy * dt;
    if (g.y < 0.09) {
      g.y = 0.09;
      g.vy = -g.vy * 0.45;
      g.vx *= 0.7;
      g.vz *= 0.7;
    }
    g.mesh.position.set(g.x, g.y, g.z);
    g.fuse -= dt;
    if (g.fuse <= 0) {
      explodeGrenade(g);
      game.grenades.splice(i, 1);
    }
  }
}

// ---------- input / UI ----------
const input = createInput(renderer.domElement, onLockChange);
let prevFiring = false;

hud.onPlay(() => {
  sfx.unlock();
  if (shot) return;
  if (game.match.phase === 'matchEnd') {
    startMatch(game);
    hud.hideOverlay();
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    if (game.match.phase === 'lobby') startMatch(game);
    hud.hideOverlay();
  } else if (game.match.phase !== 'matchEnd' && game.match.phase !== 'lobby') {
    if (game.player.state.alive) hud.showOverlay('paused');
  }
}

function tryBuy(id) {
  const m = game.match;
  if (m.phase !== 'buy') return;
  if (id === 'grenade') {
    if (game.playerGrenades > 0 || game.money < GRENADE.price) {
      sfx.denied();
      return;
    }
    game.money -= GRENADE.price;
    game.playerGrenades = 1;
  } else {
    const w = WEAPONS[id];
    if (game.owned[id] || game.money < w.price) {
      if (game.owned[id]) game.setPlayerWeapon(id);
      else sfx.denied();
      return;
    }
    game.money -= w.price;
    game.owned[id] = true;
    game.setPlayerWeapon(id);
  }
  sfx.buy();
  hud.setMoney(game.money);
  hud.refreshBuy(game);
}

function handleKeys() {
  const m = game.match;
  if (input.consumePressed('KeyB') && (m.phase === 'buy' || m.phase === 'live')) {
    if (m.phase === 'buy') {
      if (hud.buyOpen()) hud.closeBuy();
      else {
        hud.refreshBuy(game);
        hud.openBuy();
      }
      sfx.click();
    }
  }
  if (hud.buyOpen()) {
    const buyKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
    buyKeys.forEach((code, i) => {
      if (input.consumePressed(code)) tryBuy(['rifle', 'smg', 'sniper', 'pistol', 'grenade'][i]);
    });
    if (input.consumePressed('Escape')) hud.closeBuy();
  } else {
    const switchKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
    const ids = ['rifle', 'smg', 'sniper', 'pistol'];
    switchKeys.forEach((code, i) => {
      if (input.consumePressed(code) && game.owned[ids[i]]) game.setPlayerWeapon(ids[i]);
    });
  }
  if (input.consumePressed('KeyR') && m.phase === 'live') {
    if (gunReload(game.playerGun)) {
      viewModel.startReload(game.playerGun.def.reload);
      sfx.reload();
    }
  }
  if (input.consumePressed('KeyG')) throwGrenade();
}

// ---------- player shooting ----------
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
function playerShoot() {
  const gun = game.playerGun;
  if (!gunShoot(gun)) {
    if (gun.mag === 0 && gun.cooldown <= 0) sfx.dry();
    return;
  }
  const p = game.player.state;
  camera.getWorldDirection(_dir);
  const spread = gunSpread(gun, p.speed2d, p.crouching);
  _dir.x += (rng() * 2 - 1) * spread;
  _dir.y += (rng() * 2 - 1) * spread;
  _dir.z += (rng() * 2 - 1) * spread;
  _dir.normalize();
  viewModel.muzzleWorld(_muzzle);
  const shooter = { team: 'us', isPlayer: true };
  game.shootFrom(shooter, _muzzle.x, _muzzle.y, _muzzle.z, _dir.x, _dir.y, _dir.z, gun.def, rng);
  viewModel.fire();
  sfx.shot(gun.def.sound);
  game.player.recoil(gun.def.recoil * (0.9 + rng() * 0.25), (rng() * 2 - 1) * gun.def.recoil * 0.45);
  hud.setAmmo(gun.mag, gun.reserve, gun.def.name);
}

// ---------- fixed-step simulation ----------
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let mmTimer = 0;
let spotTimer = 0;

function syncCamera() {
  const p = game.player.state;
  camera.position.set(p.x, p.eye, p.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
}

function step(dt) {
  game.time += dt;
  const m = game.match;
  const p = game.player.state;

  if (m.phase === 'buy') {
    m.buyTimer -= dt;
    if (m.buyTimer <= 0) beginLive(game);
  } else if (m.phase === 'live') {
    m.timer -= dt;
    if (m.bomb.state === 'planted') {
      m.bomb.fuse -= dt;
      const interval = m.bomb.fuse < 10 ? 0.5 : 1;
      if (game.time - game.lastBeepT >= interval) {
        game.lastBeepT = game.time;
        sfx.plantBeep();
      }
      if (m.bomb.fuse <= 0) {
        bombGroup.visible = false;
        bombLight.intensity = 0;
        sfx.explosion();
        spawnSparks({ x: SITE.x, y: 1, z: SITE.z }, 80, 0xffa63d, 10);
        endRound(game, 'them', 'The charge detonated at Site A');
      }
    }
    checkRoundEnd(game);
  } else if (m.phase === 'roundEnd') {
    m.roundEndT -= dt;
    if (m.roundEndT <= 0 && m.scoreUs < WIN_ROUNDS && m.scoreThem < WIN_ROUNDS) nextRound(game);
  }

  // Bomb pickup: a living enemy walking over a dropped charge takes it.
  if (m.bomb.state === 'dropped') {
    for (const b of game.enemies) {
      if (b.alive && Math.hypot(b.x - m.bomb.x, b.z - m.bomb.z) < 1.5) {
        b.isCarrier = true;
        m.bomb.state = 'carried';
        hud.setBombStatus('BOMB WITH EMBER CARRIER', '');
        hud.killfeed(`${b.name} recovered the charge`, false);
        break;
      }
    }
  }

  // Player movement + actions (only while live; buy phase lets you walk the spawn).
  if (m.phase === 'buy' || m.phase === 'live') {
    game.player.step(dt, input.state.keys);
    gunStep(game.playerGun, dt);
    if (m.phase === 'live' && p.alive) {
      const triggerEdge = input.state.firing && !prevFiring;
      const wantFire = game.playerGun.def.auto ? input.state.firing : triggerEdge;
      if (wantFire && gunReady(game.playerGun)) playerShoot();
      // Defuse: hold E within 2.6 m of a planted bomb.
      if (m.bomb.state === 'planted' && input.state.keys.has('KeyE')) {
        const d = Math.hypot(m.bomb.x - p.x, m.bomb.z - p.z);
        if (d < 2.6) {
          game.defuseT += dt;
          hud.setHint(`DEFUSING… ${Math.ceil((5 - game.defuseT) * 10) / 10}s — hold E`);
          if (Math.floor(game.defuseT * 2) !== Math.floor((game.defuseT - dt) * 2)) sfx.defuseTick();
          if (game.defuseT >= 5) {
            game.defuseBomb({ name: 'You' });
            game.defuseT = 0;
          }
        } else {
          game.defuseT = Math.max(0, game.defuseT - dt * 2);
        }
      } else {
        game.defuseT = Math.max(0, game.defuseT - dt * 2);
        if (m.bomb.state === 'planted') hud.setHint('Get to Site A and hold E to defuse');
      }
    }
  }
  prevFiring = input.state.firing;

  // Bots (they keep fighting through roundEnd so the scene stays alive).
  for (const b of game.allies) updateBot(game, b, dt, game.time, rng);
  for (const b of game.enemies) updateBot(game, b, dt, game.time, rng);

  stepGrenades(dt);

  // Bomb prop blink while planted.
  if (m.bomb.state === 'planted') {
    bombLight.intensity = 6 + 5 * Math.sin(game.time * 9);
    bombLed.material.color.setHex(Math.sin(game.time * 9) > 0 ? 0xff3b2d : 0x550000);
  }

  // Tracers + sparks decay.
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.85;
    }
  }
  for (let i = 0; i < SPARK_N; i += 1) {
    if (sparkLife[i] <= 0) continue;
    sparkLife[i] -= dt;
    if (sparkLife[i] <= 0) {
      sparkPos[i * 3 + 1] = -999;
      continue;
    }
    sparkVel[i * 3 + 1] -= 9 * dt;
    sparkPos[i * 3] += sparkVel[i * 3] * dt;
    sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
    sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
    if (sparkPos[i * 3 + 1] < 0.02) {
      sparkPos[i * 3 + 1] = 0.02;
      sparkVel[i * 3 + 1] = -sparkVel[i * 3 + 1] * 0.4;
    }
  }
  sparkGeo.attributes.position.needsUpdate = true;

  // Spotted enemies for the minimap (player line of sight, refreshed 4x/s).
  spotTimer -= dt;
  if (spotTimer <= 0) {
    spotTimer = 0.25;
    for (const b of game.enemies) {
      if (!b.alive) {
        game.spotted.delete(b.id);
        continue;
      }
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < 46 && hasLOS(world.colliders, p.x, p.eye, p.z, b.x, 1.15, b.z)) {
        game.spotted.set(b.id, game.time);
      } else if (game.time - (game.spotted.get(b.id) || -99) > 3) {
        game.spotted.delete(b.id);
      }
    }
  }

  // Prune stale noise events.
  while (game.noises.length > 0 && game.time - game.noises[0].t > 3.5) game.noises.shift();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) {
    renderer.render(scene, camera);
    return;
  }
  const look = input.takeLook();
  if (game.match.phase !== 'lobby') game.player.look(look.x, look.y);
  handleKeys();
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * 5) accumulator = 0;
  input.clearPressed();
  syncCamera();
  viewModel.step(dt);

  // HUD refresh (cheap cached writes).
  const p = game.player.state;
  const gun = game.playerGun;
  hud.setHealth(p.hp, 0);
  hud.setAmmo(gun.mag, gun.reserve, gun.def.name);
  hud.setMoney(game.money);
  hud.setScore(game.match.scoreUs, game.match.scoreThem, game.match.round);
  if (game.match.phase === 'buy') hud.setTimer(game.match.buyTimer, false);
  else hud.setTimer(game.match.timer, game.match.bomb.state === 'planted');
  hud.setCrosshairSpread(6 + gunSpread(gun, p.speed2d, p.crouching) * 900);
  mmTimer -= dt;
  if (mmTimer <= 0) {
    mmTimer = 0.15;
    hud.drawMinimap(game);
  }
  renderer.render(scene, camera);
}

// ---------- deterministic screenshot staging ----------
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(x, y, z) {
  const p = game.player.state;
  const dx = x - p.x;
  const dy = y - p.eye;
  const dz = z - p.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  startMatch(game);
  const p = game.player.state;
  if (name === 'start') {
    // Buy phase at the defender spawn, shop open, looking down the yard.
    hud.buildBuy(game);
    hud.refreshBuy(game);
    hud.openBuy();
    p.yaw = Math.PI / 2 - 0.35;
    settle(30);
  } else if (name === 'play') {
    beginLive(game);
    game.match.timer = 78;
    game.money = 2450;
    game.owned.rifle = true; // staged loadout for the capture, as if bought in the buy phase
    game.setPlayerWeapon('rifle');
    // Stage a firefight in mid: player at the central container, enemies ahead.
    p.x = -6;
    p.z = 2;
    p.yaw = -Math.PI / 2 + 0.15;
    const spots = [[8, 0], [13, -3], [3, 5]];
    game.enemies.slice(0, 3).forEach((b, i) => {
      b.x = spots[i][0];
      b.z = spots[i][1];
      b.route = [];
      b.wp = 0;
      b.state = 'hold';
      b.yaw = Math.PI / 2;
      b.mesh.group.position.set(b.x, 0, b.z);
      b.mesh.group.rotation.y = b.yaw;
    });
    game.allies[0].x = -9;
    game.allies[0].z = -2;
    game.allies[0].route = [];
    game.allies[0].state = 'hold';
    game.allies[0].mesh.group.position.set(-9, 0, -2);
    settle(20);
    // Fire once at the nearest enemy so the frame shows a live tracer + hitmarker.
    aimAt(8, 1.2, 0);
    playerShoot();
    settle(2);
    aimAt(8, 1.2, 0);
    // One enemy tracer back at the player for the crossfire read.
    const e = game.enemies[0];
    game.shootFrom(e, e.x, 1.45, e.z, -0.9, -0.05, 0.1, e.gun.def, rng);
  } else {
    // Round won at Site A: banner up, bomb smoke, squad on the site.
    game.match.scoreUs = 1;
    game.match.round = 2;
    game.match.phase = 'roundEnd';
    game.match.roundEndT = 4;
    game.bomb.state = 'planted';
    game.bomb.fuse = 12;
    bombGroup.visible = true;
    p.x = 17;
    p.z = -4;
    spawnSparks({ x: SITE.x, y: 1.2, z: SITE.z }, 40, 0x9aa0a8, 3);
    game.enemies.forEach((b) => {
      b.alive = false;
      b.fall = 1;
      b.mesh.group.rotation.x = -1.5;
    });
    game.allies[0].x = 21;
    game.allies[0].z = -7;
    game.allies[0].route = [];
    game.allies[0].state = 'hold';
    game.allies[0].mesh.group.position.set(21, 0, -7);
    settle(10);
    aimAt(SITE.x, 1, SITE.z);
    hud.banner('ROUND WON', 'Ember squad eliminated — Site A held', true);
  }
  hud.setHealth(p.hp, 0);
  hud.setAmmo(game.playerGun.mag, game.playerGun.reserve, game.playerGun.def.name);
  hud.setMoney(game.money);
  hud.setScore(game.match.scoreUs, game.match.scoreThem, game.match.round);
  hud.drawMinimap(game);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = game;
hud.buildBuy(game);
hud.setAmmo(game.playerGun.mag, game.playerGun.reserve, WEAPONS.pistol.name);
hud.setMoney(game.money);
hud.setScore(0, 0, 1);
hud.setTimer(ROUND_TIME, false);
hud.showOverlay('start');
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
