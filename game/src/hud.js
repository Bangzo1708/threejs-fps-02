// The DOM HUD: health, ammo, money, round score and timer, kill feed, hitmarker, damage
// direction, buy menu, round banners and a live minimap. It never touches the simulation;
// main.js pushes numbers in and reads buy choices out. Updates are cached so the DOM is
// only touched when a value actually changes.
import { WEAPONS, GRENADE, BUY_ORDER } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'),
    title: $('overlay-title'),
    copy: $('overlay-copy'),
    play: $('play'),
    health: $('health'),
    healthNum: $('health-num'),
    armor: $('armor-num'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    money: $('money'),
    timer: $('timer'),
    scoreUs: $('score-us'),
    scoreThem: $('score-them'),
    roundNum: $('round-num'),
    killfeed: $('killfeed'),
    hitmarker: $('hitmarker'),
    crosshair: $('crosshair'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    buyMenu: $('buy-menu'),
    buyList: $('buy-list'),
    buyMoney: $('buy-money'),
    damageDir: $('damage-dir'),
    minimap: $('minimap'),
    bombStatus: $('bomb-status'),
    hint: $('hint'),
    vignette: $('vignette'),
  };
  const mm = els.minimap.getContext('2d');
  const cache = {};
  let hitTimer = 0;
  let bannerTimer = 0;
  let dmgTimer = 0;

  function setText(el, key, value) {
    if (cache[key] === value) return;
    cache[key] = value;
    el.textContent = value;
  }

  function setWidth(el, key, value) {
    if (cache[key] === value) return;
    cache[key] = value;
    el.style.width = value;
  }

  return {
    setHealth(hp, armor) {
      setText(els.healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      setWidth(els.health, 'hpw', `${Math.max(0, hp)}%`);
      els.health.classList.toggle('low', hp <= 30);
      setText(els.armor, 'armor', armor > 0 ? `+${armor}` : '');
      els.vignette.style.opacity = hp <= 30 ? String(0.55 - hp * 0.012) : '0';
    },
    setAmmo(mag, reserve, name) {
      setText(els.ammoMag, 'mag', String(mag));
      setText(els.ammoReserve, 'res', `/ ${reserve}`);
      setText(els.weaponName, 'wname', name);
    },
    setMoney(m) {
      setText(els.money, 'money', `$${m}`);
      setText(els.buyMoney, 'buymoney', `$${m}`);
    },
    setScore(us, them, round) {
      setText(els.scoreUs, 'sus', String(us));
      setText(els.scoreThem, 'sthem', String(them));
      setText(els.roundNum, 'round', `ROUND ${round}`);
    },
    setTimer(seconds, bombPlanted) {
      const s = Math.max(0, Math.ceil(seconds));
      const mmv = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0');
      setText(els.timer, 'timer', `${mmv}:${ss}`);
      els.timer.classList.toggle('urgent', s <= 15 || bombPlanted);
    },
    setBombStatus(text, cls) {
      setText(els.bombStatus, 'bomb', text);
      els.bombStatus.className = cls || '';
    },
    setHint(text) {
      setText(els.hint, 'hint', text);
    },
    setCrosshairSpread(px) {
      els.crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(killed) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), 110);
    },
    damageFrom(angleDeg) {
      els.damageDir.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
      els.damageDir.classList.add('on');
      clearTimeout(dmgTimer);
      dmgTimer = setTimeout(() => els.damageDir.classList.remove('on'), 450);
    },
    killfeed(text, usScored) {
      const div = document.createElement('div');
      div.className = usScored ? 'kf us' : 'kf them';
      div.textContent = text;
      els.killfeed.prepend(div);
      while (els.killfeed.children.length > 5) els.killfeed.removeChild(els.killfeed.lastChild);
      setTimeout(() => div.remove(), 6000);
    },
    banner(title, sub, good) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub || '';
      els.banner.classList.remove('good', 'bad');
      els.banner.classList.add('show', good ? 'good' : 'bad');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => els.banner.classList.remove('show'), 3200);
    },
    hideBanner() {
      els.banner.classList.remove('show');
    },
    showOverlay(mode, detail) {
      const copy = {
        start: ['DUSTLINE', 'Tactical FPS on Yard Nine. First to 5 rounds — eliminate the Ember squad or plant the charge at Site A. Click to deploy.', 'DEPLOY'],
        paused: ['DUSTLINE', 'Paused. Click to resume the round.', 'RESUME'],
        dead: ['YOU ARE DOWN', 'Your squad fights on. You redeploy next round.', 'KEEP WATCHING'],
        end: ['MATCH OVER', detail || '', 'PLAY AGAIN'],
      }[mode];
      els.title.textContent = copy[0];
      els.copy.textContent = copy[1];
      els.play.textContent = copy[2];
      els.overlay.hidden = false;
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    onPlay(handler) {
      els.play.addEventListener('click', handler);
    },
    buildBuy(game) {
      els.buyList.innerHTML = '';
      const items = BUY_ORDER.map((id) => {
        if (id === 'grenade') return { id: 'grenade', name: GRENADE.name, price: GRENADE.price, desc: 'Frag — 105 dmg, 6.5 m blast' };
        const w = WEAPONS[id];
        return { id, name: w.name, price: w.price, desc: `${w.damage} dmg · ${w.mag} rnd · ${w.rpm} rpm` };
      });
      items.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'buy-row';
        row.dataset.id = item.id;
        row.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price}</span>`;
        els.buyList.appendChild(row);
      });
    },
    refreshBuy(game) {
      for (const row of els.buyList.children) {
        const id = row.dataset.id;
        const owned = id === 'grenade' ? game.playerGrenades > 0 : game.playerWeaponId === id;
        const price = id === 'grenade' ? GRENADE.price : WEAPONS[id].price;
        row.classList.toggle('owned', owned);
        row.classList.toggle('poor', game.money < price && !owned);
      }
      setText(els.buyMoney, 'buymoney2', `$${game.money}`);
    },
    openBuy() {
      els.buyMenu.hidden = false;
    },
    closeBuy() {
      els.buyMenu.hidden = true;
    },
    buyOpen() {
      return !els.buyMenu.hidden;
    },
    drawMinimap(game) {
      const W = 168;
      const H = 124;
      const sx = W / 76;
      const sz = H / 56;
      const X = (x) => (x + 38) * sx;
      const Z = (z) => (z + 28) * sz;
      mm.clearRect(0, 0, W, H);
      mm.fillStyle = 'rgba(20,22,26,0.82)';
      mm.fillRect(0, 0, W, H);
      // Walls / cover
      mm.fillStyle = '#5b6068';
      for (const c of game.world.colliders) {
        if (c.y1 < 2) continue;
        mm.fillRect(X(c.x0), Z(c.z0), (c.x1 - c.x0) * sx, (c.z1 - c.z0) * sz);
      }
      // Site A
      mm.strokeStyle = '#ffc233';
      mm.lineWidth = 2;
      mm.beginPath();
      mm.arc(X(game.site.x), Z(game.site.z), game.site.r * sx, 0, Math.PI * 2);
      mm.stroke();
      mm.fillStyle = '#ffc233';
      mm.font = 'bold 11px monospace';
      mm.fillText('A', X(game.site.x) - 4, Z(game.site.z) + 4);
      // Bomb
      if (game.bomb.state === 'planted' || game.bomb.state === 'dropped') {
        mm.fillStyle = '#ff5a3c';
        mm.beginPath();
        mm.arc(X(game.bomb.x), Z(game.bomb.z), 4, 0, Math.PI * 2);
        mm.fill();
      }
      const dot = (x, z, color, r) => {
        mm.fillStyle = color;
        mm.beginPath();
        mm.arc(X(x), Z(z), r, 0, Math.PI * 2);
        mm.fill();
      };
      for (const b of game.allies) if (b.alive) dot(b.x, b.z, '#2e86de', 3);
      for (const b of game.enemies) {
        if (!b.alive) continue;
        if (game.spotted.has(b.id)) dot(b.x, b.z, '#e14b32', 3);
      }
      // Player arrow
      const p = game.player.state;
      mm.save();
      mm.translate(X(p.x), Z(p.z));
      mm.rotate(-p.yaw);
      mm.fillStyle = '#e9e6df';
      mm.beginPath();
      mm.moveTo(0, -6);
      mm.lineTo(4.5, 5);
      mm.lineTo(-4.5, 5);
      mm.closePath();
      mm.fill();
      mm.restore();
    },
  };
}
