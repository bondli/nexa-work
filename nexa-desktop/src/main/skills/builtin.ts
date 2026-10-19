/**
 * 内置 Skill 定义 —— 随应用打包，开箱即用
 * 定义与 entry 源码随应用打包，启动时若 ~/.nexa/skills/<id>/ 不存在则落盘（已存在不覆盖，尊重用户修改）
 */

/**
 * 内置 Skill: skill-creator —— 生成新的自定义 Skill 脚手架
 * 让 Agent 能"自己造技能"：按用户需求在 ~/.nexa/skills/<name>/ 下落 skill.yaml + index.js
 */
export const SKILL_CREATOR_ID = "skill-creator"
export const EXPERT_MANAGER_ID = "expert-manager"

export const SKILL_CREATOR_YAML = `name: skill-creator
description: 创建新的自定义 Skill（能力模块），生成 ~/.nexa/skills/<name>/ 下的 skill.yaml 与 index.js 骨架
version: "1.0.0"
entry: ./index.js
inputs:
  - name: name
    type: string
    required: true
    description: Skill id，仅小写字母、数字与连字符，需以字母或数字开头，例如 weekly-report
  - name: description
    type: string
    required: true
    description: 一句话说明这个 Skill 做什么、什么场景下使用
  - name: prompt_hint
    type: string
    required: false
    description: 可选，写给 Agent 的调用提示，说明何时调用以及调用后如何处理产物
  - name: spec
    type: object
    required: false
    description: 可选，进阶用法；传入包含 inputs 与 outputs 数组的定义对象后按它生成完整参数列表
  - name: overwrite
    type: boolean
    required: false
    description: 可选，目标 Skill 已存在时是否覆盖，默认 false（已存在则直接报错）
outputs: []
prompt_hint: |
  当用户要求新增、创建或封装一个自定义 Skill（能力模块）时调用本 Skill。
  调用前先与用户确认 Skill 名称（小写英文、连字符分隔）与用途，再传入 name 与 description。
  生成后提醒用户到「技能包 → Skills」补全 skill.yaml 的参数与 index.js 的实现逻辑；
  新 Skill 从下一轮对话开始出现在 Agent 的可用 Skills 列表中。
`

export const SKILL_CREATOR_ENTRY = `#!/usr/bin/env node
/**
 * skill-creator entry —— 生成新的自定义 Skill 脚手架
 * stdin 收 JSON {inputs}，stdout 出 JSON {ok, message, files}
 * 注意：产物目录在 ~/.nexa/skills/ 下（不在会话 workspace），因此不回报 files，路径写在 message 里
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const BUILTIN_IDS = ['skill-creator'];
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** 极简 YAML 标量输出：字符串走 JSON 引号（JSON 字符串本身是合法的 YAML 双引号标量） */
function scalar(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(String(v));
}

function buildYaml(s) {
  const out = [];
  out.push('name: ' + scalar(s.name));
  out.push('description: ' + scalar(s.description));
  out.push('version: ' + scalar(s.version));
  out.push('entry: ./index.js');
  if (s.inputs.length === 0) {
    out.push('inputs: []');
  } else {
    out.push('inputs:');
    for (const i of s.inputs) {
      out.push('  - name: ' + scalar(i.name));
      out.push('    type: ' + scalar(i.type || 'string'));
      out.push('    required: ' + (i.required ? 'true' : 'false'));
      if (i.description) out.push('    description: ' + scalar(i.description));
    }
  }
  if (s.outputs.length === 0) {
    out.push('outputs: []');
  } else {
    out.push('outputs:');
    for (const o of s.outputs) out.push('  - ' + scalar(o));
  }
  if (s.promptHint) {
    out.push('prompt_hint: |');
    for (const line of String(s.promptHint).split(/\\r?\\n/)) out.push(line ? '  ' + line : '');
  }
  return out.join('\\n') + '\\n';
}

function buildEntry(s) {
  return [
    '#!/usr/bin/env node',
    '// ' + s.name + ' —— ' + s.description.split(/\\r?\\n/)[0],
    '// stdin 收 JSON {inputs}，stdout 出 JSON {ok, message, files}；cwd 为会话 workspace',
    "let raw = '';",
    "process.stdin.on('data', (d) => (raw += d));",
    "process.stdin.on('end', () => {",
    '  try {',
    "    const data = JSON.parse(raw || '{}');",
    '    const inputs = data.inputs || {};',
    '    void inputs;',
    '    // TODO: 实现 Skill 逻辑，产物写相对路径即可在产物面板看到',
    "    process.stdout.write(JSON.stringify({ ok: true, message: '" + s.name + " 尚未实现', files: [] }));",
    '  } catch (err) {',
    '    process.stdout.write(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));',
    '    process.exit(1);',
    '  }',
    '});',
    '',
  ].join('\\n');
}

function main() {
  let raw = '';
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    try {
      const { inputs = {} } = JSON.parse(raw || '{}');
      const name = String(inputs.name || '').trim();
      const description = String(inputs.description || '').trim();
      if (!name) throw new Error('缺少必填参数 name');
      if (!description) throw new Error('缺少必填参数 description');
      if (!ID_RE.test(name)) throw new Error('name 只能包含小写字母、数字与连字符，且以字母或数字开头');
      if (BUILTIN_IDS.indexOf(name) >= 0) throw new Error('「' + name + '」是内置 Skill，不可覆盖');

      const spec = inputs.spec && typeof inputs.spec === 'object' ? inputs.spec : {};
      const yamlSpec = {
        name: name,
        description: description,
        version: String(inputs.version || '0.1.0'),
        inputs: Array.isArray(spec.inputs) ? spec.inputs : [],
        outputs: Array.isArray(spec.outputs) ? spec.outputs : [],
        promptHint: String(inputs.prompt_hint || ''),
      };

      const dir = path.join(os.homedir(), '.nexa', 'skills', name);
      if (fs.existsSync(dir) && inputs.overwrite !== true) {
        throw new Error('Skill「' + name + '」已存在，如需覆盖请传 overwrite: true');
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'skill.yaml'), buildYaml(yamlSpec), 'utf8');
      fs.writeFileSync(path.join(dir, 'index.js'), buildEntry(yamlSpec), 'utf8');

      const message = [
        '已创建 Skill「' + name + '」，目录 ' + dir + '（skill.yaml + index.js）。',
        yamlSpec.inputs.length === 0 ? '当前未定义 inputs，可到「技能包 → Skills」编辑 YAML 补全参数。' : '',
        '下一步：到「技能包 → Skills」补全 index.js 的实现逻辑。',
        '新 Skill 从下一轮对话开始对 Agent 可见。',
      ].filter(Boolean).join(' ');
      process.stdout.write(JSON.stringify({ ok: true, message: message, files: [] }));
    } catch (err) {
      process.stdout.write(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
      process.exit(1);
    }
  });
}

main();
`

/**
 * 内置 Skill: expert-manager —— 引导 AI 创建 / 修改 Nexa 专家
 * 适配 WorkBuddy expert-manager SKILL.md 的角色定位，但输出是 Nexa 格式的 YAML
 * （Nexa 不使用 plugin.json / Agent MD，而是 name/description/system_prompt/tools/disallow_tools 五字段）
 */
export const EXPERT_MANAGER_YAML = `name: expert-manager
description: |
  创建 / 修改 Nexa 专家（~/.nexa/experts/*.yaml），自动命名、落盘、校验 YAML 结构。
  触发词：创建专家、新增专家、新建专家、我想要一个 XX 专家、expert-manager、修改专家、编辑专家、更新专家。
version: "1.0.0"
entry: ./index.js
inputs:
  - name: name
    type: string
    required: true
    description: 专家中文名，例如「React 组件库专家」
  - name: system_prompt
    type: string
    required: true
    description: 专家的人设 + 方法论（完整 systemPrompt 正文）
  - name: description
    type: string
    required: false
    description: 可选，专家在列表中的一句话描述（缺省自动从 name + system_prompt 前 60 字生成）
  - name: tools
    type: array
    required: false
    description: 可选，白名单工具列表（空或不传 = 全部内置工具可用）
  - name: disallow_tools
    type: array
    required: false
    description: 可选，禁止使用的工具列表
  - name: overwrite
    type: boolean
    required: false
    description: 可选，目标专家已存在时是否覆盖，默认 false（已存在则直接报错）
outputs: []
prompt_hint: |
  当用户要创建、新增、修改、编辑一个 Nexa 专家（Agent 人设 / 方法论）时调用本 Skill。

  你是 Nexa 专家包管理器，帮助用户按 Nexa 规范创建 / 修改可直接使用的专家 YAML。

  ## Nexa 专家格式（唯一正确格式）
  - 文件位置: ~/.nexa/experts/<slug>.yaml（slug = name 小写去空格换连字符）
  - 字段: name（中文名）、description（列表描述）、system_prompt（人设 + 方法论）、tools（可选，白名单工具数组）、disallow_tools（可选，黑名单工具数组）
  - 示例:
      name: React 组件库专家
      description: 精通 React + shadcn/ui 组件设计
      system_prompt: |
        你是资深 React 组件库专家...
      tools: []
      disallow_tools: []

  ## 工作流程
  1. 收集信息：专家名称、擅长什么、关键方法论 / 工作风格、是否需要限制工具范围
  2. 生成 system_prompt（人设 + 工作方式 + 注意事项，至少 3 段结构化）
  3. 调用本 Skill 落盘，产物在 ~/.nexa/experts/<slug>.yaml
  4. 告知用户已创建、文件路径、如何在「技能包 → 专家」中看到并启用

  ## 重要规则
  - 内置专家（"通用助手" / "全栈开发专家" / "研究员"）不可覆盖，只能新建自定义专家
  - system_prompt 必须中文 + 分段 + 具体可执行，避免空泛口号
  - 不要引入 WorkBuddy 的 plugin.json / Agent MD / marketplace.json 格式——Nexa 只认这一份 YAML
`

export const EXPERT_MANAGER_ENTRY = `#!/usr/bin/env node
/**
 * expert-manager entry —— 生成 / 修改 Nexa 专家 YAML
 * stdin 收 JSON {inputs}，stdout 出 JSON {ok, message, files}
 * 产物目录在 ~/.nexa/experts/
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXPERTS_DIR = path.join(os.homedir(), '.nexa', 'experts');
const BUILTIN_SLUGS = ['builtin-general', 'builtin-coder', 'builtin-researcher', 'skill-creator', 'expert-manager'];

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\\u4e00-\\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'expert';
}

function scalar(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(String(v));
}

function buildYaml(doc) {
  const out = [];
  out.push('name: ' + scalar(doc.name));
  if (doc.description) out.push('description: ' + scalar(doc.description));
  if (doc.system_prompt && doc.system_prompt.includes('\\n')) {
    out.push('system_prompt: |');
    for (const line of doc.system_prompt.split(/\\r?\\n/)) out.push(line ? '  ' + line : '');
  } else {
    out.push('system_prompt: ' + scalar(doc.system_prompt || ''));
  }
  if (Array.isArray(doc.tools) && doc.tools.length > 0) {
    out.push('tools:');
    for (const t of doc.tools) out.push('  - ' + scalar(t));
  }
  if (Array.isArray(doc.disallow_tools) && doc.disallow_tools.length > 0) {
    out.push('disallow_tools:');
    for (const t of doc.disallow_tools) out.push('  - ' + scalar(t));
  }
  return out.join('\\n') + '\\n';
}

function main() {
  let raw = '';
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    try {
      const { inputs = {} } = JSON.parse(raw || '{}');
      const name = String(inputs.name || '').trim();
      const systemPrompt = String(inputs.system_prompt || inputs.systemPrompt || '').trim();
      if (!name) throw new Error('缺少必填参数 name');
      if (!systemPrompt) throw new Error('缺少必填参数 system_prompt');

      const slug = slugify(name);
      if (BUILTIN_SLUGS.indexOf(slug) >= 0) throw new Error('「' + name + '」与内置专家冲突，请换个名字');

      if (!fs.existsSync(EXPERTS_DIR)) fs.mkdirSync(EXPERTS_DIR, { recursive: true });
      const filePath = path.join(EXPERTS_DIR, slug + '.yaml');
      if (fs.existsSync(filePath) && inputs.overwrite !== true) {
        throw new Error('专家「' + name + '」已存在（' + filePath + '），如需覆盖请传 overwrite: true');
      }

      const desc = String(inputs.description || '').trim() || (systemPrompt.slice(0, 60) + '...');
      const tools = Array.isArray(inputs.tools) ? inputs.tools : [];
      const disallowTools = Array.isArray(inputs.disallow_tools || inputs.disallowTools) ? (inputs.disallow_tools || inputs.disallowTools) : [];

      fs.writeFileSync(filePath, buildYaml({ name, description: desc, system_prompt: systemPrompt, tools, disallow_tools: disallowTools }), 'utf8');

      const message = [
        '已创建专家「' + name + '」，文件: ' + filePath,
        '请到「技能包 → 专家」页面查看并启用；新专家从下一轮对话开始可用。',
      ].join(' ');
      process.stdout.write(JSON.stringify({ ok: true, message, files: [] }));
    } catch (err) {
      process.stdout.write(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
      process.exit(1);
    }
  });
}

main();
`

/**
 * 内置 Skill 清单：id → 目录内容（yaml + entry）
 *
 * 内置 Skill 随应用提供、不可删除（SkillRegistry.remove 会拒绝），只能在列表里停用。
 * 新增内置 Skill：在此追加一项（entry 文件名固定为 index.js，yaml 里 entry 写 ./index.js），
 * 启动时 SkillRegistry.materializeBuiltins 会把不存在的目录落盘（已存在不覆盖）。
 */
export const BUILTIN_SKILLS: { id: string; yaml: string; entry: string }[] = [
  { id: SKILL_CREATOR_ID, yaml: SKILL_CREATOR_YAML, entry: SKILL_CREATOR_ENTRY },
  { id: EXPERT_MANAGER_ID, yaml: EXPERT_MANAGER_YAML, entry: EXPERT_MANAGER_ENTRY },
]
