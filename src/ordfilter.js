// Filter for brukernavn. Fanger de vanligste stygge ordene på norsk, engelsk, svensk og dansk,
// også skrevet med tall i stedet for bokstaver (sh1t), med mellomrom/understrek (f_u_c_k) og
// med gjentatte bokstaver (fuuuck). Substreng-treff gir noen falske positive (Scunthorpe-
// problemet), men for et lite spillbibliotek er det bedre enn å slippe gjennom for mye.
const ORD = [
  // norsk
  'faen', 'fitte', 'fitta', 'fittе', 'kuk', 'kukk', 'pikk', 'pikken', 'hore', 'hora', 'horunge',
  'jævel', 'jævla', 'jaevel', 'jaevla', 'helvete', 'satan', 'drit', 'dritt', 'rasshøl', 'rasshol',
  'ræv', 'ræva', 'raeva', 'pule', 'pul', 'knulle', 'runke', 'onanere', 'tiss', 'bæsj', 'baesj',
  'neger', 'negr', 'svartin', 'pakkis', 'svarting', 'homse', 'soper', 'mongo', 'mongis', 'spasser',
  'hitler', 'nazi', 'nazist', 'voldtekt', 'voldta', 'pedo', 'pedofil', 'incest',
  // svensk / dansk
  'fitta', 'kuken', 'knulla', 'runka', 'bög', 'bog', 'hora', 'skit', 'luder', 'pik', 'kusse', 'røv',
  // engelsk
  'fuck', 'fuk', 'fck', 'shit', 'sh1t', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'penis', 'vagina',
  'whore', 'slut', 'asshole', 'arse', 'bastard', 'wank', 'jerkoff', 'blowjob', 'handjob', 'anal',
  'porn', 'porno', 'sex', 'rape', 'rapist', 'nigger', 'nigga', 'negro', 'faggot', 'fag', 'retard',
  'tranny', 'kike', 'spic', 'chink', 'coon', 'kkk', 'isis', 'jihad', 'terrorist',
];

// Ord som ikke er stygge i seg selv, men som vi ikke vil at vanlige brukere skal eie.
const RESERVERT = ['admin', 'administrator', 'moderator', 'spillside', 'system', 'support', 'root', 'eier', 'owner', 'staff', 'ansatt'];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't' };

function normaliser(navn) {
  const lc = String(navn).toLowerCase().normalize('NFKC');
  // Erstatt tall/tegn som brukes som bokstaver, fjern alt som ikke er bokstaver.
  let s = '';
  for (const ch of lc) s += LEET[ch] ?? ch;
  s = s.replace(/[^a-zæøåäö]/g, '');
  return s;
}

// Hvorfor navnet avvises, eller null hvis det er greit.
export function sjekkBrukernavn(navn) {
  const lc = String(navn).toLowerCase();
  for (const r of RESERVERT) if (lc.includes(r)) return 'Brukernavnet ser ut som en offisiell rolle. Velg noe annet.';
  const n = normaliser(navn);
  const kollapset = n.replace(/(.)\1+/g, '$1'); // fuuuck -> fuck
  for (const ord of ORD) {
    const o = normaliser(ord);
    if (!o) continue;
    if (n.includes(o) || kollapset.includes(o)) return 'Brukernavnet inneholder et ord vi ikke tillater. Prøv et annet.';
  }
  return null;
}
