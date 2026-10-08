'use strict';

// Felles kort for poker og blackjack: nye kort glir inn på bordet, kort som snus vendes
// rundt, og hvert kort får sin egen myke lyd i takt med animasjonen.
//   const fx = cardFx('poker');  fx.begin();  fx.card(c, 'big', 'mine:0');  fx.end();
(function () {
  const STAGGER = 120; // ms mellom hvert kort som deles ut samtidig

  function face(c) {
    return !c || c.hidden ? 'back' : `${c.r}${c.s}`;
  }

  window.cardFx = function (scope) {
    let seen = null; // nøkkel -> forside (null = første tegning, ingen animasjon)
    let now = new Map();
    let n = 0;

    function sound(name, delay) {
      if (!window.sfx || document.body.dataset.tab !== scope) return;
      setTimeout(() => sfx.play(name), delay);
    }

    return {
      begin() {
        now = new Map();
        n = 0;
      },
      // Lager ett kort. key må være stabil for samme plass (f.eks. «dealer:1»).
      card(c, size = '', key = '') {
        const d = document.createElement('div');
        d.className = `pk-card ${size}`;
        const f = face(c);
        if (f === 'back') d.classList.add('back');
        else {
          if (c.s === '♥' || c.s === '♦') d.classList.add('red');
          const rank = document.createElement('span');
          rank.className = 'pk-rank';
          rank.textContent = c.r;
          const suit = document.createElement('span');
          suit.className = 'pk-suit';
          suit.textContent = c.s;
          d.append(rank, suit);
        }
        if (!key) return d;
        now.set(key, f);
        if (seen) {
          const before = seen.get(key);
          const delay = n * STAGGER;
          if (before === undefined) {
            d.classList.add('fx-deal');
            d.style.animationDelay = `${delay}ms`;
            sound('card', delay);
            n++;
          } else if (before === 'back' && f !== 'back') {
            d.classList.add('fx-flip');
            d.style.animationDelay = `${delay}ms`;
            sound('cardflip', delay);
            n++;
          }
        }
        return d;
      },
      end() {
        seen = now;
      },
    };
  };
})();
