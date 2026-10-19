/**
 * nexa-extension 构建脚本
 * - 用 esbuild 把 src/*.ts 编译为 dist/*.js
 * - 拷贝 manifest.json / icons / *.html 到 dist/
 * - 产物 dist/ 可直接在 Chrome「加载已解压的扩展程序」中安装
 *
 * 用法：
 *   node scripts/build.mjs          构建一次
 *   node scripts/build.mjs --watch  监听变更增量构建
 */
import { build, context } from "esbuild"
import { cpSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const DIST = join(ROOT, "dist")
const WATCH = process.argv.includes("--watch")

/** 需要原样拷贝到 dist 的静态资源 */
const STATIC_ASSETS = ["manifest.json", "icons", "src/popup.html", "src/options.html"]

function clean() {
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true })
}

function copyStatic() {
  for (const asset of STATIC_ASSETS) {
    const src = join(ROOT, asset)
    // src/popup.html -> dist/popup.html（扁平化，去掉 src/ 前缀，与 manifest 路径对齐）
    const rel = asset.startsWith("src/") ? asset.slice(4) : asset
    const dest = join(DIST, rel)
    cpSync(src, dest, { recursive: true })
  }
}

const commonBuildOptions = {
  bundle: true,
  platform: "browser",
  target: ["chrome110"],
  logLevel: "info",
  sourcemap: !WATCH ? false : "inline",
}

async function run() {
  clean()

  if (WATCH) {
    // 监听模式：背景脚本 + popup + options 同时构建，静态资源每次变更前拷贝
    const ctx = await context({
      ...commonBuildOptions,
      entryPoints: {
        background: join(ROOT, "src/background.ts"),
        popup: join(ROOT, "src/popup.ts"),
        options: join(ROOT, "src/options.ts"),
      },
      outdir: DIST,
      format: "iife",
      plugins: [
        {
          name: "copy-static-on-end",
          setup(build) {
            build.onEnd(() => copyStatic())
          },
        },
      ],
    })
    await ctx.watch()
    console.log("[build] watching for changes...")
  } else {
    // 一次性构建：background 输出 ESM（manifest 声明 type: module），popup/options 输出 IIFE
    await build({
      ...commonBuildOptions,
      entryPoints: [join(ROOT, "src/background.ts")],
      outfile: join(DIST, "background.js"),
      format: "esm",
    })
    await build({
      ...commonBuildOptions,
      entryPoints: [join(ROOT, "src/popup.ts"), join(ROOT, "src/options.ts")],
      outdir: DIST,
      format: "iife",
    })
    copyStatic()
    console.log(`[build] done → ${DIST}`)
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
