// data/raw/<id>.txt を形態素解析し、議員ごとの語の出現頻度を
// public/wordclouds/<id>.json ([[word, count], ...]) に出力する。
//
//   node scripts/build-wordclouds.mjs
//
// ビルド前(prebuild)に自動実行される（package.json 参照）。

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import kuromoji from 'kuromoji';

const RAW_DIR = 'data/raw';
const OUT_DIR = 'public/wordclouds';
const DICT_DIR = 'node_modules/kuromoji/dict';
const TOP_N = 100;

// 議会答弁に頻出するが「関心テーマ」を表さない語は除外する。
const STOPWORDS = new Set([
  '唐津', '唐津市', '本市', '市', '質問', '答弁', '議員', '市長', '委員', '委員会',
  '議会', '本会議', '定例会', '一般質問', '要望', '考え', '取り組み', '取組',
  '状況', '実施', '推進', '整備', '対応', '充実', '強化', '必要', '重要', '課題',
  '現状', '方針', '支援', '対策', '活用', '向上', '拡大', '拡充', '確保', '構築',
  '皆さん', '皆様', '今回', '今後', '現在', '昨年', '本年', '当該', '当局',
  'こと', 'もの', 'ため', 'これ', 'それ', 'ところ', 'よう', 'さん', '方',
  '平成', '令和', '年度', '年', '月', '日', '回', '点', '中', '的', '化', '性', '等',
  'について', 'いたし', 'ござい', 'おり',
  // 議会特有の手続き語（テーマを表さない）
  'お尋ね', '質疑', '議案', '議長', 'お願い', '一般', '言葉', '内容', '提案',
  '市議', '部長', '答弁', '答え', '御答弁', '関係', '部分', '以上', '一つ',
  '事業', '計画', '予算', '結果', '場合', '部', '議論', '質疑応答',
]);

function isMeaningfulNoun(token) {
  if (token.pos !== '名詞') return false;
  // 一般名詞・固有名詞・サ変接続(=「防災する」等の語幹)のみ採用
  if (!['一般', '固有名詞', 'サ変接続'].includes(token.pos_detail_1)) return false;
  const w = token.surface_form;
  if (w.length < 2) return false; // 1文字ノイズ除去
  if (/^[0-9０-９]+$/.test(w)) return false; // 数字のみ除去
  if (/^[ぁ-ん]+$/.test(w)) return false; // ひらがなのみは弱いので除外
  if (STOPWORDS.has(w)) return false;
  return true;
}

function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: DICT_DIR }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
}

async function main() {
  const tokenizer = await buildTokenizer();
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.txt'));
  if (files.length === 0) {
    console.warn(`[wordclouds] ${RAW_DIR} に .txt がありません`);
    return;
  }

  for (const file of files) {
    const id = basename(file, '.txt');
    const raw = await readFile(join(RAW_DIR, file), 'utf-8');
    // 「※」で始まる注記行（サンプル断り書き等）は解析対象から除外
    const text = raw
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('※'))
      .join('\n');

    const counts = new Map();
    for (const token of tokenizer.tokenize(text)) {
      if (!isMeaningfulNoun(token)) continue;
      const w = token.surface_form;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }

    const list = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N);

    await writeFile(
      join(OUT_DIR, `${id}.json`),
      JSON.stringify({ id, generatedAt: null, words: list }, null, 0),
    );
    console.log(`[wordclouds] ${id}: ${list.length} 語 -> ${OUT_DIR}/${id}.json`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
