// Yard Nine — DUSTLINE's map: a dusk freight yard, 72 x 52 m, one bomb site (A) in the
// north-east container stack, three lanes in from the west spawn (Long north, Mid centre,
// Connector south). Everything is axis-aligned boxes, so collision and bullet rays are
// cheap slab tests against one flat collider list; the meshes are built from the same list
// so what you see is exactly what blocks you.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// [cx, cz, width, depth, height, material]
const BOXES = [
  // Perimeter walls
  [0, -26.5, 74, 1, 4.5, 'concreteDark'],
  [0, 26.5, 74, 1, 4.5, 'concreteDark'],
  [-36.5, 0, 1, 54, 4.5, 'concreteDark'],
  [36.5, 0, 1, 54, 4.5, 'concreteDark'],
  // Long lane (north): container row with gaps to peek and cross through
  [-20, -20, 6, 2.4, 2.6, 'containerAmber'],
  [-8, -21, 6, 2.4, 2.6, 'containerTeal'],
  [4, -20, 6, 2.4, 2.6, 'containerRed'],
  [14, -21, 6, 2.4, 2.6, 'containerGrey'],
  [-14, -17.5, 1.6, 1.6, 1.1, 'crateWood'],
  [9, -16.5, 1.6, 1.6, 1.1, 'crateWood'],
  // Mid: staggered crates and one low container as the central duel spot
  [-14, -2, 2, 2, 1.1, 'crateWood'],
  [-13, -2, 1.2, 1.2, 1.1, 'crateWoodDark'],
  [-4, 3, 6, 2.4, 2.6, 'containerGrey'],
  [2, -4, 1.8, 1.8, 1.1, 'crateWood'],
  [10, 2, 6, 2.4, 2.6, 'containerAmber'],
  [-22, 6, 1.8, 1.8, 1.1, 'crateWood'],
  [6, 7, 1.4, 1.4, 0.9, 'crateWoodDark'],
  // Connector (south): boxes and a red container wall
  [-16, 14, 6, 2.4, 2.6, 'containerRed'],
  [-2, 16, 2, 2, 1.1, 'crateWood'],
  [-1, 16, 1.2, 1.2, 1.1, 'crateWoodDark'],
  [12, 13, 6, 2.4, 2.6, 'containerTeal'],
  [20, 17, 1.8, 1.8, 1.1, 'crateWood'],
  // Site A (north-east): two containers + crates as plant cover
  [20, -16, 6, 2.4, 2.6, 'containerAmber'],
  [28, -6, 6, 2.4, 2.6, 'containerGrey'],
  [24, -4, 2, 2, 1.1, 'crateWood'],
  [30, -13, 1.6, 1.6, 1.1, 'crateWood'],
  [17, -8, 1.4, 1.4, 0.9, 'crateWoodDark'],
  // Defender spawn yard (east) and attacker spawn yard (west)
  [31, 16, 2, 2, 1.1, 'crateWood'],
  [33, 4, 1.6, 1.6, 1.1, 'crateWood'],
  [-31, -8, 1.8, 1.8, 1.1, 'crateWood'],
  [-31, 8, 1.8, 1.8, 1.1, 'crateWood'],
  [-26, -14, 1.4, 1.4, 0.9, 'crateWoodDark'],
];

// Waypoint nodes the bots walk: [x, z]
const NODES = [
  [-31, 0], // 0 attacker spawn
  [-28, -12], // 1
  [-20, -19], // 2
  [-8, -20], // 3
  [4, -20], // 4
  [14, -18], // 5
  [20, -14], // 6
  [24, -10], // 7 site A
  [-20, 0], // 8
  [-10, 0], // 9
  [0, 0], // 10
  [10, 0], // 11
  [16, -4], // 12
  [-24, 10], // 13
  [-14, 14], // 14
  [0, 15], // 15
  [12, 13], // 16
  [20, 6], // 17
  [22, -2], // 18
  [31, 10], // 19 defender spawn
  [28, -14], // 20 defender hold, site north
  [18, -14], // 21 defender hold, site west
  [8, 2], // 22 defender hold, mid
  [12, -18], // 23 defender hold, long
  [14, 10], // 24 defender hold, connector
  [30, -2], // 25 defender hold, site east
  [-26, -6], // 26 attacker staging, long entry
  [26, 2], // 27 defender rotate, site south
];

// Attacker lanes into the site, as node index lists.
export const ATK_ROUTES = {
  long: [0, 1, 2, 3, 4, 5, 6, 7],
  mid: [0, 8, 9, 10, 11, 12, 7],
  conn: [0, 13, 14, 15, 16, 17, 18, 7],
};

// Defender routes from spawn to a hold point, as node index lists.
export const DEF_ROUTES = {
  siteNorth: [19, 25, 20],
  siteWest: [19, 27, 21],
  mid: [19, 24, 22],
  long: [19, 27, 18, 23],
  connector: [19, 24],
};

export const SITE = { x: 24, z: -10, r: 5 };
export const SPAWNS = {
  atk: [[-31, -3], [-31, 0], [-31, 3], [-29, -5], [-29, 5]],
  def: [[31, 8], [31, 12], [29, 10], [33, 10], [31, 14]],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    if (typeof PALETTE[name] !== 'number') continue;
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'lampGlow' ? 0.4 : 0.92,
      metalness: name === 'towerSteel' || name === 'containerGrey' ? 0.35 : 0.05,
    });
  }

  const colliders = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const [cx, cz, w, d, h, mat] of BOXES) {
    const mesh = new THREE.Mesh(boxGeo, materials[mat]);
    mesh.scale.set(w, h, d);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, y0: 0, y1: h });
  }

  // Ground: asphalt slab with painted yard lines.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(74, 54),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ground), roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.groundLine) });
  for (const [lx, lz, lw, ld] of [[-10, -20.5, 30, 0.18], [0, 0.5, 40, 0.18], [0, 15.5, 34, 0.18], [24, -10, 0.18, 12]]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(lw, ld), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(lx, 0.02, lz);
    group.add(line);
  }

  // Site A: painted ring + dark pad + a sodium lamp mast so the site reads at a glance.
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(SITE.r, 40),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.siteGround), roughness: 0.9 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(SITE.x, 0.03, SITE.z);
  pad.receiveShadow = true;
  group.add(pad);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(SITE.r - 0.35, SITE.r, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.siteRing), side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(SITE.x, 0.04, SITE.z);
  group.add(ring);

  function lamp(x, z, height) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, height, 8),
      materials.towerSteel,
    );
    pole.position.set(x, height / 2, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, 0.3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lampGlow) }),
    );
    head.position.set(x, height, z);
    group.add(head);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.lampGlow), 26, 22, 1.6);
    light.position.set(x, height - 0.3, z);
    group.add(light);
    colliders.push({ x0: x - 0.15, z0: z - 0.15, x1: x + 0.15, z1: z + 0.15, y0: 0, y1: height });
  }
  lamp(SITE.x - 4, SITE.z - 4, 6.5);
  lamp(0, 0, 6.5);
  lamp(-24, 12, 6.5);

  // Two watchtowers (visual anchors; legs are small colliders).
  for (const [tx, tz] of [[-30, -22], [30, 22]]) {
    const tower = new THREE.Group();
    const platform = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 3), materials.towerSteel);
    platform.position.y = 4.4;
    platform.castShadow = true;
    tower.add(platform);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.15, 3.4), materials.rustDark);
    roof.position.y = 6.6;
    tower.add(roof);
    for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 6.6, 0.22), materials.towerSteel);
      leg.position.set(lx, 3.3, lz);
      tower.add(leg);
    }
    tower.position.set(tx, 0, tz);
    group.add(tower);
    colliders.push({ x0: tx - 1.4, z0: tz - 1.4, x1: tx + 1.4, z1: tz + 1.4, y0: 0, y1: 4.4 });
  }

  // Light rig: dusk hemisphere, warm low key sun, cool fill.
  scene.add(new THREE.HemisphereLight(new THREE.Color(0x8a7f9a), new THREE.Color(0x2a2620), 0.85));
  const key = new THREE.DirectionalLight(new THREE.Color(0xffd9a0), 2.4);
  key.position.set(28, 38, 18);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -42;
  key.shadow.camera.right = 42;
  key.shadow.camera.top = 42;
  key.shadow.camera.bottom = -42;
  key.shadow.camera.far = 120;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x6a7ba8), 0.5);
  fill.position.set(-24, 18, -20);
  scene.add(fill);

  return { colliders, group, nodes: NODES };
}

// Circle (radius r, standing y0..y1) vs the flat collider list: push out of overlap.
// Returns the corrected {x, z}; the caller moves one axis at a time for sliding.
export function resolveCircle(colliders, x, z, r, y0, y1) {
  for (const c of colliders) {
    if (y1 <= c.y0 || y0 >= c.y1) continue;
    const nx = Math.max(c.x0, Math.min(x, c.x1));
    const nz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - nx;
    const dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * r;
      z = nz + (dz / d) * r;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = x - c.x0 + r;
      const pr = c.x1 - x + r;
      const pt = z - c.z0 + r;
      const pb = c.z1 - z + r;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = c.x0 - r;
      else if (m === pr) x = c.x1 + r;
      else if (m === pt) z = c.z0 - r;
      else z = c.z1 + r;
    }
  }
  return { x, z };
}

// Slab ray test against every collider. Returns {t, x, y, z} of the nearest hit, or null.
export function rayWorld(colliders, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = null;
  let bestT = maxDist;
  for (const c of colliders) {
    let tmin = 0;
    let tmax = bestT;
    // X slab
    if (Math.abs(dx) < 1e-9) {
      if (ox < c.x0 || ox > c.x1) continue;
    } else {
      let t1 = (c.x0 - ox) / dx;
      let t2 = (c.x1 - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Y slab
    if (Math.abs(dy) < 1e-9) {
      if (oy < c.y0 || oy > c.y1) continue;
    } else {
      let t1 = (c.y0 - oy) / dy;
      let t2 = (c.y1 - oy) / dy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) {
      if (oz < c.z0 || oz > c.z1) continue;
    } else {
      let t1 = (c.z0 - oz) / dz;
      let t2 = (c.z1 - oz) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (tmin < 0) continue;
    if (tmin < bestT) {
      bestT = tmin;
      best = { t: tmin, x: ox + dx * tmin, y: oy + dy * tmin, z: oz + dz * tmin };
    }
  }
  return best;
}

// Line of sight between two eye-level points: true when no collider blocks the segment.
export function hasLOS(colliders, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const hit = rayWorld(colliders, ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.05);
  return hit === null;
}
