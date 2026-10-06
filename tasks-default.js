'use strict';

// Standardoppgaver. Belønning i spinn (1–10) etter hvor krevende oppgaven er.
// proof: 'photo' = bilde kreves, 'text' = holder med en kort forklaring (bilde valgfritt).
module.exports = [
  { title: 'Selfie med en fremmed', desc: 'Ta en selfie med noen du ikke kjenner. Spør pent først!', reward: 3, proof: 'photo' },
  { title: 'Bartenderens favoritt', desc: 'Spør bartenderen hvilken øl hen anbefaler, og ta bilde av deg med den.', reward: 2, proof: 'photo' },
  { title: 'High five med bartenderen', desc: 'Gi bartenderen et oppriktig kompliment og få en high five. Kollegaen din tar bildet.', reward: 2, proof: 'photo' },
  { title: 'Autograf på serviett', desc: 'Få en fremmed til å skrive autografen sin på en serviett. Bilde av servietten.', reward: 3, proof: 'photo' },
  { title: 'Bli kjent med tre fremmede', desc: 'Finn ut navn og jobb til tre fremmede. Skriv det inn som bevis.', reward: 4, proof: 'text' },
  { title: 'Skål på et annet språk', desc: 'Få en fremmed til å lære deg å si skål på et annet språk enn norsk og engelsk. Skriv ordet og språket, og ta bilde med personen.', reward: 4, proof: 'photo' },
  { title: 'Tale for bordet', desc: 'Hold en 30 sekunders tale for kollegene dine om hvorfor nettopp du fortjener mer lønn. Noen tar bilde mens du taler.', reward: 5, proof: 'photo' },
  { title: 'Gruppebilde med fremmede', desc: 'Få med minst fem fremmede på ett gruppebilde.', reward: 6, proof: 'photo' },
  { title: 'Slå en fremmed i et spill', desc: 'Vinn en runde dart, biljard, shuffleboard eller lignende mot en fremmed. Bilde med motstanderen.', reward: 6, proof: 'photo' },
  { title: 'Navnebror eller navnesøster', desc: 'Finn en fremmed med samme fornavn som deg og ta bilde sammen.', reward: 8, proof: 'photo' },
  { title: 'Hurra for kollegaen', desc: 'Få et bord med fremmede til å synge «Hurra for deg» for en av kollegene dine.', reward: 8, proof: 'photo' },
  { title: 'Bursdagsbarnet', desc: 'Finn en fremmed som har bursdag i dag og ta bilde sammen.', reward: 9, proof: 'photo' },
  { title: 'Byttehandel', desc: 'Start med en binders eller serviett og bytt deg oppover hos fremmede minst tre ganger. Bilde av det du ender opp med, og skriv hva du byttet.', reward: 10, proof: 'photo' },
];
