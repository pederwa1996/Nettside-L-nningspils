'use strict';

// Kort forklaring for nye brukere:
// - Første gang på forsiden: et velkomstvindu om hvordan lønningspilsen fungerer.
// - På hver side: en liten «Slik funker det»-boks. Første gang er den åpen, etterpå
//   ligger den sammenfoldet øverst og kan åpnes igjen.
(function () {
  const S = { spins: 10, cash: 500, chance: 15, price: 50, flappy: 50, taskCash: 30, packs: [{ n: 1, price: 100 }] };
  const packText = () => S.packs.map((p) => `${p.n} for ${p.price}`).join(', ');

  const PAGES = {
    home: {
      title: 'Slik funker lønningspilsen',
      lines: () => [
        '🍺 <b>Målet er å vinne pils til gode, altså ekte pils.</b> Du løser dem inn i <b>🍻 Baren</b>, og spillmesteren kommer med pilsen til bordet ditt.',
        `🎡 Du starter med <b>${S.spins} spinn</b> og <b>${S.cash} cash</b>. Spinnene bruker du på lykkehjulet; resten av kasinoet spiller du med cash.`,
        '🎯 Tjen flere spinn og cash med <b>oppgaver</b>, og vinn spinn fra de andre i <b>PvP</b>.',
        '💬 Chatten er boblen nede til venstre, og 🔔 viser varslene dine.',
      ],
    },
    casino: {
      title: 'Slik funker kasinoet',
      lines: () => [
        `🎡 <b>Lykkehjul:</b> 1 spinn per runde, ${S.chance} % sjanse for en pils. Et lite 💀-felt tar et ekstra spinn.`,
        `🎰 <b>Automat:</b> ${S.price} cash per trekk, 3 linjer som betaler hver for seg. Tre 🍺 på en linje gir en pils. Se sannsynlighetene under automaten.`,
        '🃏 <b>Blackjack</b> og ♠️ <b>Poker</b> er felles bord: sett deg på en ledig plass for å spille, ellers ser du på.',
        '🔴 <b>Roulette</b> er ett hjul for alle: første innsats starter nedtellingen, og hjulet spinner for alle samtidig.',
        `🛒 Spinn kan bare brukes på lykkehjulet. Tom for spinn? Kjøp flere under hjulet: ${packText()}.`,
        '🍻 <b>Baren:</b> har du pils til gode, trykk «Bruk pils til gode», så kommer spillmesteren med den til bordet.',
      ],
    },
    pvp: {
      title: 'Slik funker PvP',
      lines: () => [
        '🏟️ <b>Arena:</b> terninger, reaksjon og hoderegning om cash, spinn eller pils.',
        '✊ <b>Duell:</b> utfordre en kollega i stein, saks, papir. Vinneren tar spinnene som er satset.',
        '🗿 <b>Mogg-off:</b> ta en selfie med ditt hardeste ansikt. Høyest poeng vinner et spinn.',
        `🕊️ <b>Flappy Sjef:</b> ${S.flappy} poeng gir 1 spinn, ${S.flappy * 2} gir 2, ${S.flappy * 4} gir 3 …`,
      ],
    },
    bar: {
      title: 'Slik funker baren',
      lines: () => [
        '🍺 Har du <b>pils til gode</b>, trykk «Bruk pils til gode» og skriv gjerne hvor du sitter.',
        '👑 Spillmesteren får beskjed og kommer med pilsen til bordet ditt.',
        'Alle som er i baren akkurat nå sitter på krakkene. Baren finnes også i kasinoet.',
      ],
    },
    arena: {
      title: 'Slik funker arenaen',
      lines: () => [
        'Velg spill, motstander og hva dere spiller om: <b>cash</b>, <b>spinn</b> eller <b>pils</b>.',
        'Du spiller din runde først. Motstanderen får varsel, spiller sin, og vinneren tar hele potten. Uavgjort: begge får innsatsen tilbake.',
        '🎲 Terningduell er ren flaks. ⚡ Reaksjon: trykk når det blir grønt (ikke før!). 🧠 Hoderegning: flest riktige, og raskest ved likt.',
      ],
    },
    duel: {
      title: 'Slik funker duell',
      lines: () => [
        'Velg motstander, hvor mange spinn du satser og stein, saks eller papir.',
        'Motstanderen får et varsel og svarer med sitt valg. Vinneren tar innsatsen.',
        'Uavgjort: du får spinnene tilbake.',
      ],
    },
    mogg: {
      title: 'Slik funker mogg-off',
      lines: () => [
        'Ta en selfie med ditt hardeste chad-ansikt. Ansiktsuttrykket gir en poengsum fra 0 til 10.',
        'Utfordre en kollega. Det koster 1 spinn, og høyest poengsum vinner spinnet til den andre.',
      ],
    },
    flappy: {
      title: 'Slik funker Flappy Sjef',
      lines: () => [
        'Trykk på skjermen for å fly mellom rørene.',
        `${S.flappy} poeng gir 1 spinn, ${S.flappy * 2} gir 2 nye, ${S.flappy * 4} gir 3 nye osv. Spinnene bruker du på lykkehjulet i kasinoet.`,
      ],
    },
    tasks: {
      title: 'Slik funker oppgavene',
      lines: () => [
        'Gjør oppgaven i virkeligheten, og last opp et bilde eller en tekst som bevis.',
        '👑 Spillmesteren godkjenner, og du får <b>spinn og litt cash</b>. Du får et varsel 🔔.',
        '⚡ <b>Førstemann til mølla:</b> bare én kan ta hver oppgave, så vær rask!',
        '👯 <b>Duo:</b> gjør den med en kollega, og begge får belønningen. 🤝 <b>Mingle:</b> alle kan gjøre hver oppgave én gang. 🎉 <b>Hele gjengen:</b> samle flere, og alle som er med får belønningen.',
      ],
    },
    profile: {
      title: 'Slik funker profilen',
      lines: () => [
        'Her ser du bio, bilder og alt en person har gjort. Trykk <b>📊 Stats</b> for tallene.',
        'Skriv en <b>💌 hilsen</b> på profilen til andre, eller lik 🤍 og kommenter 💬 innleggene deres. De får et varsel.',
        'På din egen profil kan du skrive en bio, og under <b>🎒 Inventar</b> ligger pils til gode, lodd og innstillinger.',
      ],
    },
  };

  const path = location.pathname.replace(/\/$/, '') || '/';
  const key = {
    '/': 'home', '/index.html': 'home', '/kasino.html': 'casino', '/pvp.html': 'pvp', '/duell.html': 'duel',
    '/mogg.html': 'mogg', '/arena.html': 'arena', '/baren.html': 'bar', '/spill.html': 'flappy', '/oppgaver.html': 'tasks', '/profil.html': 'profile',
  }[path];
  if (!key) return;

  const store = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch { /* ignorer */ }
    },
  };

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // ---------- «Slik funker det» på hver side ----------
  function pageCard() {
    const page = PAGES[key];
    // Et lite ❓-ikon øverst til venstre; forklaringen vises bare når man trykker
    const btn = el('button', 'guide-icon', '?');
    btn.type = 'button';
    btn.title = page.title;
    btn.setAttribute('aria-label', page.title);
    const pop = el('div', 'guide-pop hidden');
    pop.setAttribute('role', 'dialog');
    const head = el('div', 'guide-pop-head', `<strong>${page.title}</strong>`);
    const x = el('button', 'guide-x', '✕');
    x.type = 'button';
    head.appendChild(x);
    const ul = el('ul', 'guide-lines');
    page.lines().forEach((l) => ul.appendChild(el('li', '', l)));
    pop.append(head, ul);
    if (key === 'home') {
      const again = el('button', 'secondary small-btn guide-ok', '🎬 Vis velkomsten igjen');
      again.type = 'button';
      again.addEventListener('click', () => {
        close();
        showWelcome();
      });
      pop.appendChild(again);
    }
    const open = () => {
      pop.classList.remove('hidden');
      btn.classList.add('active');
    };
    const close = () => {
      pop.classList.add('hidden');
      btn.classList.remove('active');
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pop.classList.contains('hidden')) open();
      else close();
    });
    x.addEventListener('click', close);
    document.addEventListener('click', (e) => !pop.contains(e.target) && close());
    document.body.append(btn, pop);
  }

  // ---------- Velkomstvindu første gang ----------
  function showWelcome() {
    if (document.querySelector('.guide-welcome')) return;
    const steps = [
      ['🍺', 'Vinn ekte pils!', 'Hovedpoenget er å vinne <b>pils til gode</b>, og hver av dem er <b>en ekte pils</b> du får servert her i kveld. Du løser dem inn i <b>Baren</b>, og spillmesteren kommer med pilsen til bordet ditt.'],
      ['🎡', `${S.spins} spinn og ${S.cash} cash`, `Det er det du starter med. Spinnene bruker du på <b>lykkehjulet</b> (${S.chance} % sjanse for pils). Med cash spiller du automat, roulette, blackjack og poker, og du kan kjøpe flere spinn under hjulet (${S.packs[0].price} cash for ett, billigere i pakker).`],
      ['🎯', 'Tjen mer', 'Løs <b>oppgaver</b> for spinn og cash, og utfordre kollegaene i <b>PvP</b> for å vinne spinnene deres.'],
      ['🍻', 'Slik løser du inn', 'Trykk på <b>🍻 Baren</b> på forsiden, trykk «Bruk pils til gode» og skriv gjerne hvor du sitter. <b>Spillmesteren</b> kommer med pilsen til bordet ditt. Skål!'],
    ];
    const overlay = el('div', 'guide-welcome');
    const box = el('div', 'guide-box');
    box.appendChild(el('h2', '', 'Velkommen til lønningspilsen! 🎉'));
    const list = el('ol', 'guide-steps');
    steps.forEach(([icon, title, text]) => {
      const li = el('li');
      li.append(el('span', 'gs-icon', icon), el('div', '', `<b>${title}</b><br>${text}`));
      list.appendChild(li);
    });
    box.appendChild(list);
    box.appendChild(el('p', 'note', 'Forsiden er navet: de fire store knappene tar deg til Kasino, Baren, PvP og Oppgaver, og 🏠 Hjem øverst tar deg tilbake. 💬 er chatten og 🔔 er varslene dine.'));
    const go = el('button', 'big guide-go', 'Kjør på! 🍻');
    go.type = 'button';
    const close = () => {
      overlay.remove();
      store.set('guide:welcome', 'seen');
    };
    go.addEventListener('click', close);
    overlay.addEventListener('click', (e) => e.target === overlay && close());
    box.appendChild(go);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  // Hent ekte tall (spinn, cash, sjanse) fra serveren før noe vises
  fetch('/api/state').then((r) => r.json()).then((d) => {
    const s = d.settings || {};
    S.spins = s.spinsPerPerson ?? S.spins;
    S.cash = s.startCash ?? S.cash;
    S.chance = Math.round((s.spinWinChance ?? 0.15) * 100);
    S.price = s.spinPrice ?? S.price;
    if (s.spinPacks && s.spinPacks.length) S.packs = s.spinPacks;
    S.flappy = s.gameFirstMilestone ?? S.flappy;
    S.taskCash = s.taskCashPerSpin ?? S.taskCash;
    if (!d.me) {
      // Ikke logget inn ennå: vis velkomsten rett etter registreringen (siden lastes på nytt da)
      return;
    }
    pageCard();
    if (key === 'home' && store.get('guide:welcome') !== 'seen') showWelcome();
  }).catch(() => {});
})();
