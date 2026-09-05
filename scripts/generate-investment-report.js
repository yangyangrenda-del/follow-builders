#!/usr/bin/env node

// ============================================================================
// Follow Builders — Generate Investment Report
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";


const ROOT_DIR = process.cwd();

const INPUT_FILE = join(
  ROOT_DIR,
  "digest-investment.json"
);

const REPORT_DIR = join(
  ROOT_DIR,
  "reports"
);


async function loadClaudeConfig() {
  const settingsPath = join(
    homedir(),
    ".claude",
    "settings.json"
  );

  const settings = JSON.parse(
    await readFile(settingsPath, "utf-8")
  );

  return settings.env;
}


function extractText(response) {
  const item = response.content.find(
    (x) => x.type === "text"
  );

  return item ? item.text : "";
}


async function main() {

  console.log(
    "Generating AI investment report..."
  );


  if (!existsSync(INPUT_FILE)) {
    throw new Error(
      "digest-investment.json not found"
    );
  }


  const digest = JSON.parse(
    await readFile(INPUT_FILE, "utf-8")
  );


  const env = await loadClaudeConfig();


  const client = new Anthropic({
    apiKey: env.ANTHROPIC_AUTH_TOKEN,
    baseURL: env.ANTHROPIC_BASE_URL,
  });


  const prompt = `
你是一名顶级硅谷AI投资机构的研究员。

请根据下面提供的信息，生成一份中文AI产业投资日报。

要求：

1. 不编造信息。
2. 不把普通新闻包装成投资机会。
3. 只分析有明确价值的信息。
4. 区分事实和判断。

输出结构：

# AI投资日报

## 一、今日AI产业核心变化

总结今天最重要的产业变化。

## 二、Builder动态分析

分别分析：

- VC投资人的观点
- AI创业者动态
- 技术研究人员动态
- 大型科技公司方向

## 三、正在形成的AI创业方向

分析：

- 哪些方向正在获得关注
- 为什么现在出现机会
- 创业公司的切入点是什么

## 四、值得持续跟踪的公司和团队

列出：

- 公司/团队
- 做什么
- 为什么值得关注

## 五、未来观察指标

未来需要继续跟踪什么变化。

下面是原始数据：

${JSON.stringify(digest, null, 2)}
`;


  const response = await client.messages.create({

    model: env.ANTHROPIC_MODEL,

    max_tokens: 16000,

    messages: [
      {
        role: "user",
        content: prompt
      }
    ]

  });


  const report = extractText(response);


  await mkdir(
    REPORT_DIR,
    { recursive: true }
  );


  const date =
    new Date()
      .toISOString()
      .slice(0,10);


  const outputFile = join(
    REPORT_DIR,
    `${date}-investment-report.md`
  );


  await writeFile(
    outputFile,
    report,
    "utf-8"
  );


  console.log(
    `Report saved: ${outputFile}`
  );
}


main().catch((err)=>{
  console.error(err);
  process.exit(1);
});