/**
 * nexa-extension 构建脚本
 * - esbuild：background (ESM) + options (IIFE)
 * - Vite：popup / notes（React 页面，需代码分割 + CSS 处理）
 * - 拷贝 manifest.json / icons / options.html 到 dist/
 *
 * 用法：
 *   node scripts/build.mjs          构建一次
 *   node scripts/build.mjs --watch  监听（仅 esbuild 部分；Vite 一次性跑）
 */
import { build, context } from "esbuild"
import { cpSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const DIST = join(ROOT, "dist")
const WATCH = process.argv.includes("--watch")

/** 需要原样拷贝到 dist 的静态资源（popup.html / notes.html 由 Vite 产出，不在此列） */
const STATIC_ASSETS = ["manifest.json", "icons", "src/options.html"]

function clean() {
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true })
}

function copyStatic() {
  for (const asset of STATIC_ASSETS) {
    const src = join(ROOT, asset)
    const rel = asset.startsWith("src/") ? asset.slice(4) : asset
    const dest = join(DIST, rel)
    cpSync(src, dest, { recursive: true })
  }
}

function buildReact() {
  // 调 Vite 构建 React 页面（popup + notes）
  execSync("npx vite build", { cwd: ROOT, stdio: "inherit" })
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
    const ctx = await context({
      ...commonBuildOptions,
      entryPoints: {
        background: join(ROOT, "src/background.ts"),
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
    // background 是 ESM，单独再起一个 context
    const ctxBg = await context({
      ...commonBuildOptions,
      entryPoints: [join(ROOT, "src/background.ts")],
      outfile: join(DIST, "background.js"),
      format: "esm",
    })
    await Promise.all([ctx.watch(), ctxBg.watch()])
    buildReact()
    console.log("[build] watching for changes...")
  } else {
    // background 输出 ESM（manifest 声明 type: module）
    await build({
      ...commonBuildOptions,
      entryPoints: [join(ROOT, "src/background.ts")],
      outfile: join(DIST, "background.js"),
      format: "esm",
    })
    // options 输出 IIFE
    await build({
      ...commonBuildOptions,
      entryPoints: [join(ROOT, "src/options.ts")],
      outdir: DIST,
      format: "iife",
    })
    copyStatic()
    buildReact()
    console.log(`[build] done → ${DIST}`)
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
