// Korean narrator replies: the patterns reply-words.js reads (named groups: see CLAUDE.md)
export default {
  odds: /\s*[(（]\s*성공\s*확률\s*[:：]?\s*(?<p>\d{1,3})\s*[%％](?<rest>[^)）]*)[)）]\s*$/,
  decisive: /결정적|운명|목숨/,
  world: /월드\s*메시지|전\s*세계\s*공지|전\s*세계|월드/,
  constellation: /성좌/,
  titleGained: /^칭호\s*획득\s*[:：]?\s*["'「『]?(?<title>.+?)["'」』]?$/,
  checkLine: /^판정대?(?:성공|실패)/,
  tags: {
    TITLE: /칭호|업적/,
    QUEST: /의뢰|퀘스트|제안/,
    'LEVEL UP': /레벨|성장|진화|각성|합성|해금|경지/,
    REWARD: /보상|기연|획득/,
  },
  bad: /위기|경고|위험|추격|부상|실패|저주|사망|죽음|함정|포위/,
  good: /제안|의뢰|퀘스트|보상|칭호|업적|각성|진화|레벨|성장|기연|합성|해금/,
  midnight: /자정/,
  noon: /정오/,
  clock: [
    {
      re: /(?<period>오전|오후|새벽|아침|낮|저녁|밤)\s*(?<h>\d{1,2})\s*시(?:\s*(?<m>\d{1,2})\s*분|\s*(?<half>반))?/,
      pm: /^(?:오후|저녁)$/,
      day: /^낮$/,
      night: /^밤$/,
    },
  ],
  date: [{ re: /(?:서기\s*)?(?<y>\d{4})년\s*(?<m>\d{1,2})월\s*(?<d>\d{1,2})일/ }],
  weekday: /\s*\([월화수목금토일]\)|\s*[월화수목금토일]요일/,
  // the keys of a pasted character list (roster.js), spaces removed
  roster: {
    name: /^(?:이름|성명)$/,
    aliases: /^(?:별칭|별호|이명|애칭|다른이름)$/,
    faction: /^(?:소속|문파|세력|가문|진영|소속문파)$/,
    gender: /^성별$/,
    position: /^(?:직책|신분|지위|직위|직급|역할)$/,
    power: /^(?:실력|경지|무위|무력|등급|레벨|강함)$/,
    looks: /^(?:외모|외형|생김새|인상)$/,
    traits: /^(?:성격|특징|성향)$/,
    speech: /^(?:말투|어투|말버릇|입버릇|화법|대사)$/,
    signature: /^(?:무공|대표무공|무기|능력|특기|기술|스킬)$/,
    ties: /^(?:관계|인간관계|인맥)$/,
    secret: /^비밀$/,
  },
};
