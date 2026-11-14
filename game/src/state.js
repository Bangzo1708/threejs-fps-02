// Match state: rounds, money, the bomb. One place owns the numbers so the HUD, the
// bots and the round flow can never disagree. main.js calls these; bots call back into
// plantBomb / defuseBomb / dropBomb when their AI reaches the objective.
export const WIN_ROUNDS = 5;
export const ROUND_TIME = 100;
export const BUY_TIME = 12;
export const BOMB_FUSE = 35;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_BONUS = 3250;
export const LOSS_BONUS = 1900;
export const LOSS_STREAK_BONUS = 500;

export function createMatch() {
  return {
    phase: 'lobby', // lobby | buy | live | roundEnd | matchEnd
    round: 1,
    scoreUs: 0,
    scoreThem: 0,
    timer: ROUND_TIME,
    buyTimer: BUY_TIME,
    roundEndT: 0,
    lossStreak: 0,
    bomb: { state: 'carried', x: 0, z: 0, fuse: BOMB_FUSE, plantT: 0 },
  };
}

export function startMatch(game) {
  const m = game.match;
  m.phase = 'buy';
  m.round = 1;
  m.scoreUs = 0;
  m.scoreThem = 0;
  m.timer = ROUND_TIME;
  m.buyTimer = BUY_TIME;
  m.lossStreak = 0;
  game.money = START_MONEY;
  game.kills = 0;
  game.deaths = 0;
  resetBomb(game);
  game.resetPositions();
  game.hud.setScore(0, 0, 1);
  game.hud.setMoney(game.money);
  game.hud.setBombStatus('BOMB WITH EMBER CARRIER', '');
  game.hud.banner('ROUND 1', 'Buy phase — press B to open the shop', true);
}

export function resetBomb(game) {
  const m = game.match;
  m.bomb = { state: 'carried', x: 0, z: 0, fuse: BOMB_FUSE, plantT: 0 };
  // The carrier is a random living enemy; if none is alive the bomb waits on the ground.
  const alive = game.enemies.filter((b) => b.alive);
  for (const b of game.enemies) b.isCarrier = false;
  if (alive.length > 0) {
    const carrier = alive[Math.floor(game.rng() * alive.length)];
    carrier.isCarrier = true;
  }
}

export function beginLive(game) {
  game.match.phase = 'live';
  game.match.timer = ROUND_TIME;
  game.hud.closeBuy();
  game.hud.setHint('Plant the charge at Site A — or wipe the Ember squad.');
}

export function dropBomb(game, x, z) {
  const b = game.match.bomb;
  if (b.state !== 'carried') return;
  b.state = 'dropped';
  b.x = x;
  b.z = z;
  game.hud.setBombStatus('BOMB DROPPED — RECOVER IT', 'danger');
  game.hud.killfeed('The charge was dropped', true);
}

export function plantBomb(game, bot) {
  const b = game.match.bomb;
  if (b.state !== 'carried' && b.state !== 'dropped') return;
  b.state = 'planted';
  b.x = game.site.x;
  b.z = game.site.z;
  b.fuse = BOMB_FUSE;
  bot.isCarrier = false;
  game.sfx.plantBeep();
  game.hud.setBombStatus('BOMB PLANTED — DEFUSE IT', 'danger');
  game.hud.banner('BOMB PLANTED', 'Defuse the charge at Site A before it blows', false);
  game.hud.killfeed(`${bot.name} planted the charge`, false);
  game.noises.push({ x: b.x, z: b.z, t: game.time, r: 40 });
}

export function defuseBomb(game, bot) {
  const b = game.match.bomb;
  if (b.state !== 'planted') return;
  b.state = 'defused';
  game.hud.setBombStatus('BOMB DEFUSED', 'good');
  endRound(game, 'us', `${bot.name} defused the charge`);
}

export function endRound(game, winner, reason) {
  const m = game.match;
  if (m.phase === 'roundEnd' || m.phase === 'matchEnd') return;
  m.phase = 'roundEnd';
  m.roundEndT = 4;
  if (winner === 'us') {
    m.scoreUs += 1;
    game.money += WIN_BONUS;
    m.lossStreak = 0;
    game.sfx.roundWin();
    game.hud.banner('ROUND WON', reason, true);
  } else {
    m.scoreThem += 1;
    m.lossStreak += 1;
    game.money += LOSS_BONUS + Math.min(3, m.lossStreak - 1) * LOSS_STREAK_BONUS;
    game.sfx.roundLose();
    game.hud.banner('ROUND LOST', reason, false);
  }
  game.hud.setScore(m.scoreUs, m.scoreThem, m.round);
  game.hud.setMoney(game.money);
  game.hud.killfeed(`${winner === 'us' ? 'Vanguard' : 'Ember'} takes round ${m.round} — ${reason}`, winner === 'us');
  if (m.scoreUs >= WIN_ROUNDS || m.scoreThem >= WIN_ROUNDS) {
    m.phase = 'matchEnd';
    const won = m.scoreUs >= WIN_ROUNDS;
    game.hud.showOverlay('end', won
      ? `Vanguard wins ${m.scoreUs}–${m.scoreThem}. Yard Nine is yours.`
      : `Ember wins ${m.scoreThem}–${m.scoreUs}. Regroup and run it back.`);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

export function nextRound(game) {
  const m = game.match;
  m.round += 1;
  m.phase = 'buy';
  m.buyTimer = BUY_TIME;
  m.timer = ROUND_TIME;
  // Surviving keeps your loadout; dying sends you back to the sidearm.
  if (!game.player.state.alive) {
    game.setPlayerWeapon('pistol');
    game.playerGrenades = 0;
  }
  resetBomb(game);
  game.resetPositions();
  game.hud.setScore(m.scoreUs, m.scoreThem, m.round);
  game.hud.setBombStatus('BOMB WITH EMBER CARRIER', '');
  game.hud.banner(`ROUND ${m.round}`, 'Buy phase — press B to open the shop', true);
}

export function awardKill(game, killerIsPlayer) {
  if (killerIsPlayer) {
    game.money += KILL_REWARD;
    game.kills += 1;
    game.hud.setMoney(game.money);
  }
}

// Called every fixed step while live: timer expiry, elimination, fuse expiry.
export function checkRoundEnd(game) {
  const m = game.match;
  if (m.phase !== 'live') return;
  if (m.timer <= 0) {
    if (m.bomb.state === 'planted') return; // fuse decides it now
    endRound(game, 'us', 'Time expired — Site A held');
    return;
  }
  const usAlive = game.player.state.alive || game.allies.some((b) => b.alive);
  const themAlive = game.enemies.some((b) => b.alive);
  if (!themAlive) {
    if (m.bomb.state === 'planted') {
      // Planted bomb still ticks — defenders must defuse or it blows.
      return;
    }
    endRound(game, 'us', 'Ember squad eliminated');
    return;
  }
  if (!usAlive) {
    if (m.bomb.state === 'planted') return;
    endRound(game, 'them', 'Vanguard squad eliminated');
  }
}
