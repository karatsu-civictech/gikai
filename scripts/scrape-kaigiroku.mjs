// 唐津市議会 会議録検索システム（ssp.kaigiroku.net/tenant/karatsu）から
// 議員ごとの発言テキストを取得する。
//
//   node scripts/scrape-kaigiroku.mjs
//
// 仕組み（解析済みの内部API・JSONP/POST）:
//   councils/index            → 議会一覧（council_id）
//   minutes/get_schedule_all  → 各議会の日程（schedule_id）
//   minutes/get_minute        → 会議録本文（発言テキスト）
//
// 本文中、議員の発言は「◆<席次>番（<氏名>君）…」で始まる。
// これを議員ごとに集約し data/raw/<氏名>.txt と
// src/data/members.generated.json を生成する。
// （◎＝執行部の答弁、○＝議長の進行 は除外する）

import { writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const TENANT_ID = 519; // 唐津市
const API = 'https://ssp.kaigiroku.net/dnp/search';
const REFERER = 'https://ssp.kaigiroku.net/tenant/karatsu/SpTop.html';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 取り込む本会議の数（新しい順）。増やすほど語彙が豊かになる。
const COUNCIL_LIMIT = Number(process.env.COUNCIL_LIMIT ?? 2);

const RAW_DIR = 'data/raw';
const MEMBERS_OUT = 'src/data/members.generated.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(endpoint, params) {
  const body = new URLSearchParams({ tenant_id: TENANT_ID, ...params }).toString();
  const res = await fetch(`${API}/${endpoint}?callback=cb`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Referer: REFERER,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body,
  });
  const text = await res.text();
  const json = text.replace(/^\s*cb\(/, '').replace(/\);?\s*$/, '');
  return JSON.parse(json);
}

function stripHtml(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

// 会議録本文から議員ごとの発言を集約する
function collectSpeeches(text, store) {
  const lines = text.split('\n');
  // ◆<席次>番（<氏名>君/さん）<発言>
  // 注意: 席次1〜9番は全角数字（◆６番）、10番以降は半角（◆22番）で記録される。
  //       女性議員は「さん」、男性議員は「君」。両方に対応する。
  const memberRe = /^[\s　]*◆([\d０-９]+)番（(.+?)[君さん]）\s*(.*)$/;
  const otherMarkerRe = /^[◎○●]/;
  const toHalf = (s) =>
    s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  let current = null;

  for (const line of lines) {
    const m = line.match(memberRe);
    if (m) {
      const seat = Number(toHalf(m[1]));
      const name = m[2].replace(/[\s　]/g, '');
      current = name;
      if (!store.has(name)) store.set(name, { name, seat, parts: [] });
      store.get(name).parts.push(m[3]);
    } else if (otherMarkerRe.test(line.trimStart())) {
      current = null; // 執行部・議長の発言は対象外
    } else if (current) {
      store.get(current).parts.push(line);
    }
  }
}

async function main() {
  console.log(`[scrape] councils/index ...`);
  const index = await api('councils/index', {});

  // 本会議（council_type_name2 === '本会議'）の council を新しい順に集める
  const councils = [];
  for (const c of index.councils ?? []) {
    for (const y of c.view_years ?? []) {
      for (const t of y.council_type ?? []) {
        if (t.council_type_name2 !== '本会議') continue;
        for (const cc of t.councils ?? []) {
          councils.push({ council_id: cc.council_id, name: cc.name, year: y.view_year });
        }
      }
    }
  }
  councils.sort((a, b) => b.council_id - a.council_id);
  const targets = councils.slice(0, COUNCIL_LIMIT);
  console.log(`[scrape] 対象議会 ${targets.length} 件:`, targets.map((t) => t.name).join(' / '));

  const store = new Map(); // name -> { name, seat, parts: [] }

  for (const council of targets) {
    const sched = await api('minutes/get_schedule_all', { council_id: council.council_id });
    const schedules = (sched.schedules_and_materials ?? []).filter(
      (s) => !/目次|名簿/.test(s.name),
    );
    console.log(`[scrape] ${council.name}: ${schedules.length} 日程`);

    for (const s of schedules) {
      const minute = await api('minutes/get_minute', {
        council_id: council.council_id,
        schedule_id: s.schedule_id,
      });
      const body = (minute.tenant_minutes ?? [])
        .map((m) => stripHtml(m.body ?? ''))
        .join('\n');
      collectSpeeches(body, store);
      process.stdout.write('.');
      await sleep(400); // 過負荷を避ける
    }
    process.stdout.write('\n');
  }

  // 出力
  await mkdir(RAW_DIR, { recursive: true });
  // 既存の生成物（前回分・サンプル）を掃除
  for (const f of await readdir(RAW_DIR)) {
    if (f.endsWith('.txt')) await unlink(join(RAW_DIR, f));
  }

  const members = [...store.values()]
    .filter((m) => m.parts.join('').replace(/\s/g, '').length >= 50) // 発言が極端に少ない人は除外
    .sort((a, b) => a.seat - b.seat);

  for (const m of members) {
    await writeFile(join(RAW_DIR, `${m.name}.txt`), m.parts.join('\n'), 'utf-8');
  }

  const memberList = members.map((m) => ({
    id: m.name,
    name: m.name,
    seat: m.seat,
    isSample: false,
  }));
  await writeFile(MEMBERS_OUT, JSON.stringify(memberList, null, 2), 'utf-8');

  console.log(`\n[scrape] 完了: ${members.length} 議員`);
  console.log('  ', members.map((m) => `${m.seat}:${m.name}`).join('  '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
