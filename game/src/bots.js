// Bots: 4 Vanguard allies + 5 Ember enemies. Each bot is a low-poly soldier with a
// waypoint route, a hold point, and a small state machine — route, hold, engage, plant,
// defuse — driven by sight (line of sight + range + facing), sound (gunfire pulls them
// to investigate), and the bomb. They strafe while firing, burst instead of spraying,
// and miss more the faster you move.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { resolveCircle, hasLOS } from './world.js';
import { createGunState, gunReady, gunStep, gunShoot, gunReload, WEAPONS } from './weapons.js';

const BOT_SPEED = 4.3;
const BOT_RADIUS = 0.36;
const EYE_H = 1.5;
const SIGHT_RANGE = 46;
const FOV_COS = 0.25; // ~75 deg half-angle
const REACT_MIN = 0.35;
const REACT_MAX = 0.65;

const ALLY_NAMES = ['Vex', 'Mara', 'Juno', 'Kip'];
const ENEMY_NAMES = ['Rook', 'Fang', 'Sable', 'Nyx', 'Dagger'];
const ALLY_GUNS = ['rifle', 'smg', 'rifle', 'sniper'];
const ENEMY_GUNS = ['rifle', 'smg', 'rifle', 'smg', 'sniper'];

function buildMesh(team) {
  const teamColor = team === 'us' ? PALETTE.teamUs : PALETTE.teamThem;
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x3a3f47), roughness: 0.85 });
  const teamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8a6b52), roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.gunMetal), roughness: 0.6, metalness: 0.3 });

  const g = new THREE.Group();
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.72, 0.17), suit);
  legL.position.set(-0.13, 0.36, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.32), suit);
  torso.position.y = 1.08;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.34, 0.36), teamMat);
  vest.position.y = 1.14;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.28), skin);
  head.position.y = 1.58;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.32), teamMat);
  helmet.position.y = 1.72;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.04), dark);
  visor.position.set(0, 1.58, -0.15);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), dark);
  gun.position.set(0.2, 1.18, -0.32);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.44, 0.14), teamMat);
  pack.position.set(0, 1.12, 0.22);
  g.add(legL, legR, torso, vest, head, helmet, visor, gun, pack);
  g.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = true;
    }
  });
  return { group: g, legL, legR, gun };
}

export function createBot(game, team, index, spawn, routeNodes, rng) {
  const names = team === 'us' ? ALLY_NAMES : ENEMY_NAMES;
  const guns = team === 'us' ? ALLY_GUNS : ENEMY_GUNS;
  const weaponId = guns[index % guns.length];
  const mesh = buildMesh(team);
  mesh.group.position.set(spawn[0], 0, spawn[1]);
  game.scene.add(mesh.group);
  const bot = {
    id: `${team}-${index}`,
    team,
    name: names[index % names.length],
    x: spawn[0],
    z: spawn[1],
    yaw: team === 'us' ? -Math.PI / 2 : Math.PI / 2,
    hp: 100,
    alive: true,
    gun: createGunState(WEAPONS[weaponId]),
    weaponId,
    mesh,
    state: 'route',
    route: routeNodes.slice(),
    wp: 0,
    holdT: 0,
    scanT: rng() * 0.2,
    target: null,
    reactT: 0,
    lastSeenX: 0,
    lastSeenZ: 0,
    lastSeenT: -99,
    burstLeft: 0,
    burstGap: 0,
    strafeDir: rng() > 0.5 ? 1 : -1,
    strafeT: 0,
    isCarrier: false,
    plantT: 0,
    defuseT: 0,
    investigate: null,
    walkPhase: rng() * 6,
    fall: 0,
    stepT: rng() * 0.4,
  };
  return bot;
}

// Aim point of a target: chest, or the player's eye height.
function targetPoint(t) {
  if (t.isPlayer) return { x: t.x, y: t.eye * 0.9, z: t.z };
  return { x: t.x, y: 1.15, z: t.z };
}

function canSee(game, bot, t) {
  const p = targetPoint(t);
  const dx = p.x - bot.x;
  const dz = p.z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > SIGHT_RANGE) return false;
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  if (bot.state !== 'engage' && (dx * fx + dz * fz) / Math.max(0.001, dist) < FOV_COS) return false;
  return hasLOS(game.world.colliders, bot.x, EYE_H, bot.z, p.x, p.y, p.z);
}

function pickTarget(game, bot) {
  const enemies = bot.team === 'us' ? game.enemies : game.allies;
  const player = game.player.state;
  let best = null;
  let bestDist = Infinity;
  if (bot.team === 'them' && player.alive) {
    if (canSee(game, bot, { isPlayer: true, x: player.x, z: player.z, eye: player.eye })) {
      best = { isPlayer: true, x: player.x, z: player.z, eye: player.eye };
      bestDist = Math.hypot(player.x - bot.x, player.z - bot.z);
    }
  }
  for (const e of enemies) {
    if (!e.alive) continue;
    if (!canSee(game, bot, e)) continue;
    const d = Math.hypot(e.x - bot.x, e.z - bot.z);
    if (d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

function moveToward(game, bot, tx, tz, dt, speed) {
  const dx = tx - bot.x;
  const dz = tz - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return true;
  const vx = (dx / dist) * speed;
  const vz = (dz / dist) * speed;
  const targetYaw = Math.atan2(-dx, -dz);
  let dy = targetYaw - bot.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  bot.yaw += dy * Math.min(1, dt * 8);
  let next = resolveCircle(game.world.colliders, bot.x + vx * dt, bot.z, BOT_RADIUS, 0, 1.72);
  bot.x = next.x;
  next = resolveCircle(game.world.colliders, bot.x, bot.z + vz * dt, BOT_RADIUS, 0, 1.72);
  bot.z = next.z;
  bot.walkPhase += dt * speed * 1.7;
  return dist < 0.7;
}

function botFire(game, bot, target, rng) {
  const p = targetPoint(target);
  const ox = bot.x;
  const oy = 1.45;
  const oz = bot.z;
  const dx = p.x - ox;
  const dy = p.y - oy;
  const dz = p.z - oz;
  const dist = Math.hypot(dx, dy, dz);
  // Miss more at range, against a moving target, and with the sniper's slow cadence.
  const targetSpeed = target.isPlayer ? target.speed2d || 0 : 2.5;
  const err = 0.016 + dist * 0.0009 + targetSpeed * 0.004;
  const ax = dx / dist + (rng() * 2 - 1) * err;
  const ay = dy / dist + (rng() * 2 - 1) * err * 0.7;
  const az = dz / dist + (rng() * 2 - 1) * err;
  const len = Math.hypot(ax, ay, az);
  game.shootFrom(bot, ox, oy, oz, ax / len, ay / len, az / len, bot.gun.def, rng);
}

export function updateBot(game, bot, dt, time, rng) {
  if (!bot.alive) {
    bot.fall = Math.min(1, bot.fall + dt / 0.4);
    bot.mesh.group.rotation.x = -bot.fall * 1.5;
    bot.mesh.group.position.y = -bot.fall * 0.1;
    return;
  }
  gunStep(bot.gun, dt);
  bot.scanT -= dt;
  bot.strafeT -= dt;
  bot.stepT -= dt;

  // Periodic perception, staggered so nine bots never raycast on the same tick.
  if (bot.scanT <= 0) {
    bot.scanT = 0.14 + rng() * 0.06;
    const seen = pickTarget(game, bot);
    if (seen) {
      if (bot.target !== seen) bot.reactT = REACT_MIN + rng() * (REACT_MAX - REACT_MIN);
      bot.target = seen;
      bot.lastSeenX = seen.x;
      bot.lastSeenZ = seen.z;
      bot.lastSeenT = time;
    } else if (bot.target && time - bot.lastSeenT > 2.2) {
      bot.target = null;
    }
  }

  // Hearing: a shot nearby pulls the bot to investigate the sound.
  if (!bot.target && bot.investigate === null) {
    for (const n of game.noises) {
      if (time - n.t > 3) continue;
      const d = Math.hypot(n.x - bot.x, n.z - bot.z);
      if (d < n.r) {
        bot.investigate = { x: n.x, z: n.z };
        break;
      }
    }
  }

  const bomb = game.bomb;
  // Bomb carrier reaches the site and plants.
  if (bot.isCarrier && bomb.state === 'carried' && bot.state !== 'engage') {
    const dSite = Math.hypot(game.site.x - bot.x, game.site.z - bot.z);
    if (dSite < 3.2) {
      bot.state = 'plant';
      bot.plantT += dt;
      if (bot.plantT > 3.5) game.plantBomb(bot);
      bot.mesh.group.position.set(bot.x, 0, bot.z);
      bot.mesh.group.rotation.y = bot.yaw;
      return;
    }
  }
  // Defenders rush a planted bomb and defuse it.
  if (bot.team === 'us' && bomb.state === 'planted' && bot.state !== 'engage') {
    const dBomb = Math.hypot(bomb.x - bot.x, bomb.z - bot.z);
    if (dBomb < 2.6) {
      bot.state = 'defuse';
      bot.defuseT += dt;
      if (Math.floor(bot.defuseT * 2) !== Math.floor((bot.defuseT - dt) * 2)) game.sfx.defuseTick();
      if (bot.defuseT > 5) game.defuseBomb(bot);
      bot.mesh.group.position.set(bot.x, 0, bot.z);
      bot.mesh.group.rotation.y = bot.yaw;
      return;
    }
    moveToward(game, bot, bomb.x, bomb.z, dt, BOT_SPEED);
    bot.mesh.group.position.set(bot.x, 0, bot.z);
    bot.mesh.group.rotation.y = bot.yaw;
    return;
  }

  if (bot.target && bot.reactT <= 0) {
    bot.state = 'engage';
    bot.reactT = 0;
    const p = targetPoint(bot.target);
    const dx = p.x - bot.x;
    const dz = p.z - bot.z;
    const targetYaw = Math.atan2(-dx, -dz);
    let dy = targetYaw - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.yaw += dy * Math.min(1, dt * 10);
    // Strafe sideways, flipping direction every second or so.
    if (bot.strafeT <= 0) {
      bot.strafeT = 0.7 + rng() * 0.8;
      bot.strafeDir = -bot.strafeDir;
    }
    const sx = Math.cos(bot.yaw) * bot.strafeDir;
    const sz = -Math.sin(bot.yaw) * bot.strafeDir;
    const dist = Math.hypot(dx, dz);
    let mx = sx;
    let mz = sz;
    if (dist > 26) {
      mx += -Math.sin(bot.yaw) * 0.6;
      mz += -Math.cos(bot.yaw) * 0.6;
    } else if (dist < 7) {
      mx += Math.sin(bot.yaw) * 0.5;
      mz += Math.cos(bot.yaw) * 0.5;
    }
    const ml = Math.hypot(mx, mz) || 1;
    const sp = BOT_SPEED * 0.55;
    let next = resolveCircle(game.world.colliders, bot.x + (mx / ml) * sp * dt, bot.z, BOT_RADIUS, 0, 1.72);
    bot.x = next.x;
    next = resolveCircle(game.world.colliders, bot.x, bot.z + (mz / ml) * sp * dt, BOT_RADIUS, 0, 1.72);
    bot.z = next.z;
    bot.walkPhase += dt * sp * 1.7;

    // Burst fire: 3–5 shots, a pause, then another burst. Reload when dry.
    if (bot.gun.mag === 0 && bot.gun.reloading <= 0) {
      gunReload(bot.gun);
    } else if (gunReady(bot.gun)) {
      if (bot.burstLeft <= 0) {
        bot.burstLeft = bot.weaponId === 'sniper' ? 1 : 3 + Math.floor(rng() * 3);
        bot.burstGap = 0.55 + rng() * 0.5;
      }
      if (bot.burstGap > 0) {
        bot.burstGap -= dt;
      } else if (bot.burstLeft > 0) {
        if (gunShoot(bot.gun)) {
          botFire(game, bot, bot.target, rng);
          bot.burstLeft -= 1;
          if (bot.burstLeft === 0) bot.burstGap = 0.5 + rng() * 0.6;
        }
      }
    }
  } else {
    if (bot.target) bot.reactT -= dt;
    // Route / investigate / hold.
    let dest = null;
    if (bot.investigate) {
      dest = bot.investigate;
      if (moveToward(game, bot, dest.x, dest.z, dt, BOT_SPEED)) bot.investigate = null;
    } else if (bot.wp < bot.route.length) {
      const node = game.world.nodes[bot.route[bot.wp]];
      dest = { x: node[0], z: node[1] };
      if (moveToward(game, bot, node[0], node[1], dt, BOT_SPEED)) bot.wp += 1;
    } else {
      // At the end of the route: hold and scan, slowly turning.
      bot.state = 'hold';
      bot.holdT += dt;
      bot.yaw += dt * 0.45;
    }
    if (dest && bot.state !== 'hold') bot.state = 'route';
  }

  // Walk cycle + mesh sync.
  const swing = bot.state === 'engage' || bot.state === 'route' ? Math.sin(bot.walkPhase) * 0.5 : 0;
  bot.mesh.legL.rotation.x = swing;
  bot.mesh.legR.rotation.x = -swing;
  bot.mesh.group.position.set(bot.x, 0, bot.z);
  bot.mesh.group.rotation.y = bot.yaw;
}

export function killBot(game, bot) {
  bot.alive = false;
  bot.target = null;
  bot.fall = 0;
  if (bot.isCarrier) {
    bot.isCarrier = false;
    game.dropBomb(bot.x, bot.z);
  }
}

export function botHitbox(bot) {
  // {head: sphere, body: box} in world space — used by the hitscan resolver.
  return {
    head: { x: bot.x, y: 1.58, z: bot.z, r: 0.22 },
    body: { x0: bot.x - 0.3, y0: 0.72, z0: bot.z - 0.2, x1: bot.x + 0.3, y1: 1.44, z1: bot.z + 0.2 },
  };
}
