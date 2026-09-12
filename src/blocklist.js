// Terms that make a post ineligible for on-screen display. Matched on word
// boundaries after normalizeForBlocklist(). Extend as needed.
export const BLOCKLIST = [
  // adult / sexual
  'porn', 'porno', 'nsfw', 'onlyfans', 'nudes', 'nude', 'hentai', 'xxx',
  'sex', 'sexy', 'blowjob', 'handjob', 'cum', 'cumming', 'dick', 'cock',
  'pussy', 'tits', 'boobs', 'anal', 'milf', 'horny', 'fuck me', 'dm me',
  // spam / scams
  'crypto giveaway', 'airdrop', 'free followers', 'follow back', 'f4f',
  'promo code', 'click here', 'link in bio', 'earn money', 'casino',
  // violence / hate
  'kys', 'kill yourself', 'nazi', 'heil', 'lynch', 'rape', 'rapist',
  'retard', 'retarded', 'faggot', 'fag', 'tranny', 'nigger', 'nigga',
  'chink', 'spic', 'kike', 'wetback',
];
