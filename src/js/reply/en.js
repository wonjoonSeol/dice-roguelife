// English narrator replies: the patterns reply-words.js reads (named groups: see CLAUDE.md)
const MONTH =
  /jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?/
    .source;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export default {
  odds: /\s*\(\s*success\s+chance\s*:?\s*(?<p>\d{1,3})\s*%(?<rest>[^)]*)\)\s*$/,
  decisive: /decisive|fateful|life-or-death/,
  world: /world\s*message|world\s*announcement|world/,
  constellation: /constellation/,
  titleGained: /^title\s*(?:acquired|earned|gained|obtained|unlocked)\s*:?\s*["']?(?<title>.+?)["']?$/,
  checkLine: /^(?:(?:check|roll)(?:critical)?(?:success|fail)|critical(?:success|fail))/,
  tags: {
    TITLE: /title|achievement/,
    QUEST: /quest|offer/,
    'LEVEL UP': /level|growth|evolv|awaken|merge|unlock|realm/,
    REWARD: /reward|windfall|fortune|acquired|obtained|gained/,
  },
  bad: /crisis|warning|danger|pursu|chase|injur|wound|fail|curse|death|dead|died|trap|surround|ambush/,
  good: /offer|quest|reward|title|achievement|awaken|evolv|level|growth|windfall|fortune|merge|unlock/,
  midnight: /\bmidnight\b/,
  noon: /\b(?:noon|midday)\b/,
  clock: [{ re: /(?<h>\d{1,2})(?::(?<m>\d{2}))?\s*(?<period>[ap])\.?\s*m\b\.?/, pm: /^p$/ }],
  date: [
    {
      re: new RegExp(`(?:AD\\s*)?\\b(?<mon>${MONTH})\\b\\.?\\s+(?<d>\\d{1,2})(?:st|nd|rd|th)?,?\\s+(?<y>\\d{4})`),
      months: MONTHS,
    },
    {
      re: new RegExp(
        `(?:AD\\s*)?\\b(?<d>\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?<mon>${MONTH})\\b\\.?,?\\s+(?<y>\\d{4})`,
      ),
      months: MONTHS,
    },
  ],
  weekday:
    /\s*\((?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\)|\b(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)day\b,?\s*/,
  // the keys of a pasted character list (roster.js), spaces removed
  roster: {
    name: /^(?:name|fullname)$/,
    aliases: /^(?:alias|aliases|aka|epithet|nickname|nicknames|othernames?)$/,
    faction: /^(?:faction|affiliation|sect|clan|house|group|organi[sz]ation)$/,
    gender: /^(?:gender|sex)$/,
    position: /^(?:position|title|role|job|occupation)$/,
    power: /^(?:power|realm|level|rank|tier|grade|strength)$/,
    looks: /^(?:looks?|appearance)$/,
    traits: /^(?:personality|traits?|character)$/,
    speech: /^(?:speech|speechstyle|voice|tone|catchphrases?)$/,
    signature: /^(?:signature|weapons?|skills?|abilit(?:y|ies)|arts?|techniques?)$/,
    ties: /^(?:ties|relationships?|relations)$/,
    secret: /^secrets?$/,
  },
};
