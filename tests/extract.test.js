'use strict';
/**
 * extract.js 单元测试 + CLI 端到端测试
 * 运行: node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const { stripHtml, safeJson, pickSubject, yearOf, parsePoints } = require('../scripts/extract.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'extract.js');
const FIXTURE_DIR = path.join(__dirname, '..', 'examples', '题库数据');

// ---------- stripHtml ----------
test('stripHtml: <br> 与 </p> 转换行', () => {
  assert.strictEqual(stripHtml('a<br>b</p>c'), 'a\nb\nc');
});

test('stripHtml: 去标签并解码常见实体', () => {
  assert.strictEqual(stripHtml('<p>A&nbsp;&amp;&nbsp;B</p>'), 'A & B');
  assert.strictEqual(stripHtml('&lt;tag&gt; &quot;q&quot; &#39;s&#39;'), '<tag> "q" \'s\'');
});

test('stripHtml: 折叠多余空白与连续空行', () => {
  assert.strictEqual(stripHtml('a   b'), 'a b');
  assert.strictEqual(stripHtml('a\n\n\n\nb'), 'a\n\nb');
});

test('stripHtml: 空值安全', () => {
  assert.strictEqual(stripHtml(null), '');
  assert.strictEqual(stripHtml(undefined), '');
});

// ---------- safeJson ----------
test('safeJson: 合法 JSON 与非法输入', () => {
  assert.deepStrictEqual(safeJson('[1,2]'), [1, 2]);
  assert.deepStrictEqual(safeJson('not json'), []);
  assert.deepStrictEqual(safeJson(null), []);
});

// ---------- pickSubject ----------
test('pickSubject: 别名命中（含模糊包含）', () => {
  assert.strictEqual(pickSubject('刑法').name, '刑法');
  assert.strictEqual(pickSubject('我要批改刑事诉讼').name, '刑事诉讼法');
  assert.strictEqual(pickSubject('民综').file, '民法_raw.json');
});

test('pickSubject: 文件名模糊兜底与未命中', () => {
  assert.strictEqual(pickSubject('民法_raw').file, '民法_raw.json');
  assert.strictEqual(pickSubject('航海法'), null);
  assert.strictEqual(pickSubject(''), null);
  assert.strictEqual(pickSubject(undefined), null);
});

// ---------- yearOf ----------
test('yearOf: sn 前四位年份，snText 兜底', () => {
  assert.strictEqual(yearOf({ sn: '2025-03-1-1' }), '2025');
  assert.strictEqual(yearOf({ sn: '', snText: '2023年真题' }), '2023');
  assert.strictEqual(yearOf({}), '');
});

// ---------- parsePoints ----------
test('parsePoints: subKeyWord 主路径，携带白/黑名单', () => {
  const subQ = {
    subKeyWord: JSON.stringify([
      { text: '构成盗窃罪', score: '2', whiteList: [{ text: ' 窃取 ' }], blackList: [{ text: '抢劫' }] },
      { text: '', score: '1' }, // 空文本应被过滤
    ]),
  };
  const { points, source } = parsePoints(subQ);
  assert.strictEqual(source.includes('subKeyWord'), true);
  assert.strictEqual(points.length, 1);
  assert.deepStrictEqual(points[0], { id: 1, score: 2, text: '构成盗窃罪', white: ['窃取'], black: ['抢劫'] });
});

test('parsePoints: 无 subKeyWord 时回退 answerKeywordList', () => {
  const subQ = {
    answerKeywordList: JSON.stringify([
      { isSubKeyWord: '1', text: '要点A', score: '3' },
      { isSubKeyWord: '0', text: '干扰项', score: '9' },
      { isSubKeyWord: '1', text: '', score: '1' },
    ]),
  };
  const { points, source } = parsePoints(subQ);
  assert.strictEqual(source.includes('answerKeywordList'), true);
  assert.strictEqual(points.length, 1);
  assert.strictEqual(points[0].score, 3);
  assert.deepStrictEqual(points[0].white, []);
});

test('parsePoints: 双来源皆空', () => {
  const { points, source } = parsePoints({});
  assert.strictEqual(points.length, 0);
  assert.strictEqual(source, '');
});

// ---------- CLI 端到端（使用 examples/ 的虚构示例题库） ----------
function runCli(args) {
  return execFileSync('node', [SCRIPT, ...args], {
    env: { ...process.env, FAKAO_DATA_DIR: FIXTURE_DIR },
    encoding: 'utf8',
  });
}

test('CLI: 指定年份输出完整作业单', () => {
  const out = runCli(['刑法', '9001']);
  assert.ok(out.includes('评分作业单'));
  assert.ok(out.includes('P1-1'));
  assert.ok(out.includes('白名单'));
  assert.ok(out.includes('黑名单'));
  assert.ok(out.includes('采分点总分 10 / 题分 10'));
});

test('CLI: 无年份列出可选题目', () => {
  const out = runCli(['刑法']);
  assert.ok(out.includes('可批改题目'));
  assert.ok(out.includes('9001年'));
});

test('CLI: 不存在的年份退出码 2 并列出可用题目', () => {
  try {
    runCli(['刑法', '1888']);
    assert.fail('应当以非零码退出');
  } catch (e) {
    assert.strictEqual(e.status, 2);
    assert.ok(String(e.stderr).includes('未找到'));
  }
});

test('CLI: fixture 文件存在（示例与测试共用一份数据源）', () => {
  assert.ok(fs.existsSync(path.join(FIXTURE_DIR, '刑法_raw.json')));
});
