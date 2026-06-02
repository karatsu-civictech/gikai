// 唐津市議会 議員の一覧。
//
// このファイルは scripts/scrape-kaigiroku.mjs が生成する
// members.generated.json（会議録から取り込んだ実議員）を読み込む。
// 各議員の発言テキストは data/raw/<id>.txt にあり、
// scripts/build-wordclouds.mjs がワードクラウド用の
// public/wordclouds/<id>.json を生成する。

import generated from './members.generated.json';

export interface Member {
  /** URL に使う id（氏名）。/gikai/giin/<id> */
  id: string;
  /** 氏名 */
  name: string;
  /** 議席番号 */
  seat?: number;
  /** 会派 */
  party?: string;
  /** ダミーデータかどうか */
  isSample?: boolean;
}

export const members: Member[] = generated as Member[];

export function getMember(id: string): Member | undefined {
  return members.find((m) => m.id === id);
}
