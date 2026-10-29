// Japanese narrator replies: the patterns reply-words.js reads (named groups: see CLAUDE.md)
export default {
  odds: /\s*[(（]\s*成功(?:確)?率\s*[:：]?\s*(?<p>\d{1,3})\s*[%％](?<rest>[^)）]*)[)）]\s*$/,
  decisive: /決定的|運命|命がけ/,
  world: /ワールドメッセージ|全世界告知|全世界|ワールド/,
  constellation: /星座/,
  titleGained: /^称号(?:獲得|取得)\s*[:：]?\s*["'「『]?(?<title>.+?)["'」』]?$/,
  checkLine: /^判定大?(?:成功|失敗)/,
  tags: {
    TITLE: /称号|実績/,
    QUEST: /依頼|クエスト|提案/,
    'LEVEL UP': /レベル|成長|進化|覚醒|合成|解放|境地/,
    REWARD: /報酬|奇縁|獲得/,
  },
  bad: /危機|警告|危険|追跡|負傷|失敗|呪い|死亡|死|罠|包囲/,
  good: /提案|依頼|クエスト|報酬|称号|実績|覚醒|進化|レベル|成長|奇縁|合成|解放/,
  midnight: /真夜中|零時/,
  noon: /正午/,
  clock: [
    {
      re: /(?<period>午前|午後|早朝|明け方|朝|昼|夕方|深夜|夜)\s*(?<h>\d{1,2})\s*時(?:\s*(?<m>\d{1,2})\s*分|\s*(?<half>半))?/,
      pm: /^(?:午後|夕方)$/,
      day: /^昼$/,
      night: /^(?:夜|深夜)$/,
    },
  ],
  date: [{ re: /(?:西暦\s*)?(?<y>\d{4})年\s*(?<m>\d{1,2})月\s*(?<d>\d{1,2})日/ }],
  weekday: /\s*[(（][日月火水木金土][)）]|\s*[日月火水木金土]曜日/,
  // the keys of a pasted character list (roster.js), spaces removed
  roster: {
    name: /^(?:名前|氏名)$/,
    aliases: /^(?:別名|二つ名|愛称|あだ名)$/,
    faction: /^(?:所属|流派|門派|勢力|陣営|家門)$/,
    gender: /^性別$/,
    position: /^(?:役職|身分|地位|立場|役割)$/,
    power: /^(?:実力|境地|強さ|ランク|等級|レベル)$/,
    looks: /^(?:外見|容姿|見た目)$/,
    traits: /^(?:性格|特徴)$/,
    speech: /^(?:口調|話し方|口癖|台詞|セリフ)$/,
    signature: /^(?:武功|得意技|武器|能力|技|スキル)$/,
    ties: /^(?:関係|人間関係)$/,
    secret: /^秘密$/,
  },
};
