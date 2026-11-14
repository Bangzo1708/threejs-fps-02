// Weapons: the buy-menu catalogue and the per-weapon fire state. Numbers are tuned so
// stopping to aim pays — spread grows with speed and with sustained fire, recoil kicks
// the view up, and the sniper is a one-shot cannon you cannot spam. main.js owns the ray
// and the damage; this module owns the feel.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 26, headMul: 2.0,
    rpm: 380, auto: false, mag: 12, reserve: 48, spread: 0.011, moveSpread: 0.02,
    recoil: 0.008, reload: 1.1, range: 55, sound: 'pistol', tracer: 0xffd166,
  },
  smg: {
    id: 'smg', name: 'Ratter-9 SMG', price: 1500, damage: 22, headMul: 1.8,
    rpm: 780, auto: true, mag: 30, reserve: 90, spread: 0.017, moveSpread: 0.026,
    recoil: 0.007, reload: 1.7, range: 45, sound: 'smg', tracer: 0xffd166,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Longshot', price: 2700, damage: 33, headMul: 2.0,
    rpm: 600, auto: true, mag: 30, reserve: 90, spread: 0.009, moveSpread: 0.022,
    recoil: 0.013, reload: 2.1, range: 70, sound: 'rifle', tracer: 0xffd166,
  },
  sniper: {
    id: 'sniper', name: 'Longbow .50', price: 4200, damage: 96, headMul: 2.2,
    rpm: 50, auto: false, mag: 5, reserve: 15, spread: 0.001, moveSpread: 0.05,
    recoil: 0.05, reload: 3.2, range: 110, sound: 'sniper', tracer: 0x9fd8ff,
  },
};
export const GRENADE = { id: 'grenade', name: 'Popper Frag', price: 300, damage: 105, radius: 6.5 };
export const BUY_ORDER = ['rifle', 'smg', 'sniper', 'pistol', 'grenade'];

// A view-model gun strapped to the camera, rebuilt per weapon so the silhouette changes
// with what you hold. The muzzle tip position is exposed for tracer origins.
export function createViewModel(camera) {
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.gunMetal), roughness: 0.5, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.gunAccent), roughness: 0.6, metalness: 0.3 });
  const model = new THREE.Group();
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lampGlow), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.lampGlow), 0, 6);
  model.position.set(0.26, -0.22, -0.45);
  camera.add(model);
  flash.position.set(0, 0.03, -0.55);
  flash.visible = false;
  model.add(flash);
  flashLight.position.set(0, 0.02, -0.5);
  model.add(flashLight);

  const SHAPES = {
    pistol: [[0.07, 0.09, 0.24, 0, 0, 0, metal], [0.05, 0.12, 0.06, 0, -0.09, 0.08, accent]],
    smg: [[0.08, 0.09, 0.4, 0, 0, -0.05, metal], [0.05, 0.16, 0.05, 0, -0.1, 0.06, accent], [0.04, 0.04, 0.22, 0, 0.02, -0.3, accent]],
    rifle: [[0.09, 0.1, 0.46, 0, 0, -0.02, metal], [0.045, 0.045, 0.4, 0, 0.025, -0.4, accent], [0.07, 0.09, 0.2, 0, -0.03, 0.26, accent], [0.03, 0.06, 0.1, 0, 0.08, -0.12, accent]],
    sniper: [[0.09, 0.11, 0.5, 0, 0, 0, metal], [0.04, 0.04, 0.55, 0, 0.03, -0.48, accent], [0.05, 0.05, 0.18, 0, 0.1, -0.05, accent], [0.08, 0.1, 0.22, 0, -0.04, 0.28, accent]],
  };

  let current = null;
  function setWeapon(id) {
    if (current === id) return;
    current = id;
    while (model.children.length > 2) model.remove(model.children[2]);
    for (const [w, h, d, x, y, z, mat] of SHAPES[id] || SHAPES.rifle) {
      const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      part.position.set(x, y, z);
      model.add(part);
    }
  }

  const state = { flash: 0, kick: 0, reloadT: 0, reloadDur: 1 };
  return {
    state,
    setWeapon,
    muzzleWorld(out) {
      flash.getWorldPosition(out);
      return out;
    },
    fire() {
      state.flash = 0.06;
      state.kick = 0.06;
    },
    startReload(dur) {
      state.reloadT = dur;
      state.reloadDur = dur;
    },
    step(dt) {
      state.flash = Math.max(0, state.flash - dt);
      state.kick += (0 - state.kick) * Math.min(1, dt * 13);
      model.position.z = -0.45 + state.kick;
      model.rotation.x = state.kick * 2.4;
      flash.visible = state.flash > 0;
      flash.rotation.z = state.flash * 40;
      flashLight.intensity = state.flash > 0 ? 16 : 0;
      if (state.reloadT > 0) {
        state.reloadT = Math.max(0, state.reloadT - dt);
        const p = 1 - state.reloadT / state.reloadDur;
        model.rotation.x = -0.5 * Math.sin(Math.min(1, p * 1.4) * Math.PI);
        if (state.reloadT === 0) model.rotation.x = 0;
      }
    },
  };
}

// One shooter's ammo state. Bots share this shape so their fire discipline reads the same.
export function createGunState(def) {
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloading: 0,
    bloom: 0, // grows per shot, decays when not firing — sustained fire punishes itself
  };
}

export function gunReady(gun) {
  return gun.mag > 0 && gun.cooldown <= 0 && gun.reloading <= 0;
}

export function gunStep(gun, dt) {
  gun.cooldown = Math.max(0, gun.cooldown - dt);
  gun.bloom = Math.max(0, gun.bloom - dt * 0.045);
  if (gun.reloading > 0) {
    gun.reloading = Math.max(0, gun.reloading - dt);
    if (gun.reloading === 0) {
      const need = gun.def.mag - gun.mag;
      const take = Math.min(need, gun.reserve);
      gun.mag += take;
      gun.reserve -= take;
    }
  }
}

export function gunShoot(gun) {
  if (!gunReady(gun)) return false;
  gun.mag -= 1;
  gun.cooldown = 60 / gun.def.rpm;
  gun.bloom = Math.min(0.05, gun.bloom + gun.def.spread * 0.55);
  return true;
}

export function gunReload(gun) {
  if (gun.reloading > 0 || gun.mag === gun.def.mag || gun.reserve === 0) return false;
  gun.reloading = gun.def.reload;
  return true;
}

export function gunSpread(gun, speed, crouched) {
  const moving = Math.min(1, speed / 5.2);
  let s = gun.def.spread + moving * gun.def.moveSpread + gun.bloom;
  if (crouched) s *= 0.72;
  return s;
}
