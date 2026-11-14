// The player body: acceleration-based movement with friction, crouch, and circle-vs-AABB
// collision resolved one axis at a time so walls slide instead of swallowing. No jump —
// Yard Nine is a ground game and crouch-peeking is the vertical play.
import { resolveCircle } from './world.js';

const RADIUS = 0.36;
const STAND_EYE = 1.62;
const CROUCH_EYE = 1.05;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.6;
const ACCEL = 46;
const FRICTION = 10;

export function createPlayer(colliders, spawn) {
  const p = {
    x: spawn[0],
    z: spawn[1],
    vx: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    crouching: false,
    hp: 100,
    alive: true,
    armor: 0,
    speed2d: 0,
    stepPhase: 0,
  };

  function look(dx, dy, sensitivity = 0.0022) {
    p.yaw -= dx * sensitivity;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    p.pitch = Math.min(1.45, p.pitch + pitchKick);
    p.yaw += yawKick;
  }

  function step(dt, keys) {
    if (!p.alive) return;
    const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    p.crouching = crouch;
    const eyeTarget = crouch ? CROUCH_EYE : STAND_EYE;
    p.eye += (eyeTarget - p.eye) * Math.min(1, dt * 12);

    const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wx = 0;
    let wz = 0;
    if (fwd !== 0 || strafe !== 0) {
      const sin = Math.sin(p.yaw);
      const cos = Math.cos(p.yaw);
      wx = -sin * fwd + cos * strafe;
      wz = -cos * fwd - sin * strafe;
      const len = Math.hypot(wx, wz);
      wx /= len;
      wz /= len;
    }
    const speed = crouch ? CROUCH_SPEED : WALK_SPEED;
    const blend = Math.min(1, (ACCEL * dt) / speed);
    p.vx += (wx * speed - p.vx) * blend;
    p.vz += (wz * speed - p.vz) * blend;
    if (fwd === 0 && strafe === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      p.vx *= damp;
      p.vz *= damp;
    }
    p.speed2d = Math.hypot(p.vx, p.vz);

    // Move X, resolve, then Z — sliding along walls instead of sticking to them.
    let next = resolveCircle(colliders, p.x + p.vx * dt, p.z, RADIUS, 0, 1.72);
    if (Math.abs(next.x - (p.x + p.vx * dt)) > 0.001) p.vx = 0;
    p.x = next.x;
    next = resolveCircle(colliders, p.x, p.z + p.vz * dt, RADIUS, 0, 1.72);
    if (Math.abs(next.z - (p.z + p.vz * dt)) > 0.001) p.vz = 0;
    p.z = next.z;

    if (p.speed2d > 0.5) p.stepPhase += dt * p.speed2d * 1.6;
  }

  function reset(spawnPoint, yaw) {
    p.x = spawnPoint[0];
    p.z = spawnPoint[1];
    p.vx = 0;
    p.vz = 0;
    p.yaw = yaw;
    p.pitch = 0;
    p.eye = STAND_EYE;
    p.hp = 100;
    p.alive = true;
    p.armor = 0;
  }

  return { state: p, step, look, recoil, reset };
}
