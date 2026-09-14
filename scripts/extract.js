#!/usr/bin/env node
/**
 * 法考主观题评分老师 - 抽题脚本
 * 用法: node extract.js <科目> [年份|题号]
 *   科目: 理论|刑法|刑诉|民综|行政|商法 （支持模糊）
 *   年份: 2021~2025 ；题号: 如 "2025" 或 "2023"
 * 无年份参数时列出该科目全部题目
 * 输出: 评分作业单 (Markdown, stdout)
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.FAKAO_DATA_DIR || path.join(process.cwd(), '题库数据');

const SUBJECT_MAP = [
  { alias: ['理论', '中国特色社会主义', '法治理论', '理论法'], file: '中国特色社会主义法治理论_raw.json', name: '中国特色社会主义法治理论' },
  { alias: ['刑法'], file: '刑法_raw.json', name: '刑法' },
  { alias: ['刑诉', '刑事诉讼'], file: '刑事诉讼法_raw.json', name: '刑事诉讼法' },
  { alias: ['民综', '民法', '民诉', '民事'], file: '民法_raw.json', name: '民法·民诉综合（民综）' },
  { alias: ['行政'], file: '行政法与行政诉讼法_raw.json', name: '行政法与行政诉讼法' },
  { alias: ['商法', '商经'], file: '商法_raw.json', name: '商法（选做）' },
];

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeJson(s) { try { return JSON.parse(s || '[]'); } catch (e) { return []; } }

function pickSubject(arg) {
  if (!arg) return null;
  for (const s of SUBJECT_MAP) {
    if (s.alias.some(a => arg.includes(a))) return s;
  }
  // 文件名模糊兜底
  for (const s of SUBJECT_MAP) {
    if (s.file.includes(arg)) return s;
  }
  return null;
}

function yearOf(q) {
  const m = String(q.sn || '').match(/^(\d{4})/);
  return m ? m[1] : (String(q.snText || '').match(/(\d{4})/) || [])[1] || '';
}

function loadQuestions(sub) {
  const fp = path.join(DATA_DIR, sub.file);
  if (!fs.existsSync(fp)) { console.error('数据文件不存在: ' + fp); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return j.data || [];
}

// 解析一个小问的采分点（优先 subKeyWord，回退 answerKeywordList）
function parsePoints(subQ) {
  let points = [];
  let source = '';
  const kw = safeJson(subQ.subKeyWord).filter(k => k && k.text && String(k.text).trim());
  if (kw.length) {
    source = 'subKeyWord（平台评分标准，含白/黑名单）';
    points = kw.map((k, i) => ({
      id: i + 1,
      score: Number(k.score) || 0,
      text: stripHtml(k.text),
      white: (k.whiteList || []).map(w => String(w.text || '').trim()).filter(Boolean),
      black: (k.blackList || []).map(b => String(b.text || '').trim()).filter(Boolean),
    }));
  } else {
    const akw = safeJson(subQ.answerKeywordList).filter(k => k.isSubKeyWord === '1' && k.text && String(k.text).trim());
    if (akw.length) {
      source = 'answerKeywordList（回退来源，无白/黑名单）';
      points = akw.map((k, i) => ({ id: i + 1, score: Number(k.score) || 0, text: stripHtml(k.text), white: [], black: [] }));
    }
  }
  return { points, source };
}

function main() {
  const [, , subArg, yearArg] = process.argv;
  const sub = pickSubject(subArg);
  if (!sub) {
    console.error('用法: node extract.js <' + SUBJECT_MAP.flatMap(s => s.alias).join('|') + '> [年份]');
    process.exit(1);
  }
  const questions = loadQuestions(sub);

  if (!yearArg) {
    console.log(`# ${sub.name} · 可批改题目\n`);
    for (const q of questions) {
      const subs = (q.subList || []).length;
      console.log(`- ${yearOf(q)}年 ${q.snText || q.sn || ''}（总分 ${q.score != null ? q.score : '?'} 分，${subs} 问，题目ID ${q.id}）`);
    }
    console.log(`\n用法: node extract.js ${subArg} <年份>`);
    return;
  }

  const year = yearArg.replace(/年|题/g, '').match(/(\d{4})/);
  const want = year ? year[1] : null;
  let q = null;
  if (want) q = questions.find(x => yearOf(x) === want);
  if (!q && want) q = questions.find(x => String(q.sn || '').includes(want));
  if (!q) {
    console.error(`未找到 ${sub.name} ${yearArg} 的题目。可用：`);
    questions.forEach(x => console.error(`  ${yearOf(x)}年 ${x.snText || x.sn}`));
    process.exit(2);
  }

  const subList = (q.subList || []).slice().sort((a, b) => (a.subOrder || 0) - (b.subOrder || 0));
  const out = [];
  out.push(`# 评分作业单 · ${sub.name} · ${q.snText || q.sn}（总分 ${q.score != null ? q.score : '?'} 分）`);
  if (sub.name.includes('选做')) out.push(`> ⚠️ 考场规则：本题科目为选做（商法/行政法二选一），双答只计第一道。`);
  out.push('');
  out.push('## 题干');
  out.push(stripHtml(q.question));
  out.push('');

  let pointTotal = 0, fallbackCount = 0;
  subList.forEach((s, qi) => {
    const { points, source } = parsePoints(s);
    const ptsSum = points.reduce((a, p) => a + p.score, 0);
    const declared = Number(s.subScore) || 0;
    if (points.length) pointTotal += ptsSum; else fallbackCount++;
    out.push(`---`);
    out.push(`## 第${qi + 1}问（${declared} 分）｜${stripHtml(s.subQuestion)}`);
    if (!points.length) {
      out.push(`> ⚠️ 本问无结构化采分点，请依据参考答案自行拆点判分（拆点后按参考答案要点均分 ${declared} 分）。`);
    } else {
      const diff = Math.abs(ptsSum - declared) > 0.01 ? ` ⚠️采分点分值和(${ptsSum})≠问分值(${declared})` : '';
      out.push(`采分点（${points.length} 个，来源 ${source}${diff}）：`);
      for (const p of points) {
        out.push(`- P${qi + 1}-${p.id}（${p.score} 分）${p.text}`);
        if (p.white.length) out.push(`  - 白名单（等义即给分）: ${p.white.join(' ／ ')}`);
        if (p.black.length) out.push(`  - 黑名单（出现即该点不得分）: ${p.black.join(' ／ ')}`);
      }
    }
    const ans = stripHtml(s.answer);
    if (ans) { out.push(`参考答案：`); out.push(ans); }
    out.push('');
  });

  out.push(`---`);
  out.push(`校验：题干字数约 ${stripHtml(q.question).length}；采分点总分 ${Math.round(pointTotal * 10) / 10} / 题分 ${q.score != null ? q.score : '?'}；无结构化采分点的小问 ${fallbackCount} 个。`);

  console.log(out.join('\n'));
}

main();
