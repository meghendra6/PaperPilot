// Development harness for the packaged browser surface and real document store.
// It owns a separate local fixture directory; it never opens a Zotero profile.
import { createServer } from "node:http";
import {
  readFile,
  open,
  readdir,
  writeFile,
  mkdir,
  rename,
  access,
  rm,
  cp,
} from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { DOMParser } from "@xmldom/xmldom";

const require = createRequire(import.meta.url);
require("ts-node").register({ transpileOnly: true });
const { StudioRepository } = require("../src/modules/studio/repository.ts");
const { StudioCompilerService } = require("../src/modules/studio/compiler.ts");
const {
  compilerTemplateCache,
} = require("../src/modules/studio/compilerTemplateCache.ts");
const { KernelBroker } = require("../src/modules/studio/kernelBroker.ts");
const { StudioAIService } = require("../src/modules/studio/aiService.ts");
const {
  projectBundle,
  assertProjectSnapshotRevision,
} = require("../src/modules/studio/projectBundle.ts");
const { runStudioAI } = require("../src/modules/studio/aiRunner.ts");
const { documentText } = require("../src/modules/studio/documentText.ts");
const { CODEX_DEFAULT_MODEL } = require("../src/modules/codex/modelOptions.ts");
const { studioModelDefaults } = require("../src/modules/studio/aiModels.ts");
const fixtureName = process.env.PAPERPILOT_STUDIO_FIXTURE || "data";
if (!/^[a-z0-9-]{1,40}$/.test(fixtureName))
  throw new Error("Invalid preview fixture name.");
const root = resolve(`reference/studio-preview-${fixtureName}`);
const assets = resolve("build/addon/chrome/content/studio");
const projectID = "preview-project";
const token = randomUUID();
const fileOps = {
  exists: async (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  readText: async (path) =>
    readFile(path, "utf8").catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }),
  writeTextAtomic: async (path, contents) => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, path);
  },
  ensureDirectory: (path) => mkdir(path, { recursive: true }),
  listDirectory: async (path) =>
    (await readdir(path)).map((name) => resolve(path, name)),
  remove: (path) => rm(path, { force: true }),
};
const repository = new StudioRepository(root, fileOps, randomUUID);
const aiChildren = new Map();
const assistant = new StudioAIService(projectID, repository, {
  root,
  files: fileOps,
  id: randomUUID,
  encode: (text) => Buffer.from(text).toString("base64"),
  text: async (name, base64, signal) => {
    if (/\.pdf$/i.test(name)) {
      const directory = resolve(root, "runtime", "context", randomUUID());
      await mkdir(directory, { recursive: true });
      const input = resolve(directory, "document.pdf");
      try {
        await writeFile(input, Buffer.from(base64, "base64"));
        await new Promise((resolveJob, rejectJob) => {
          const child = spawn(
            "java",
            [
              "-jar",
              resolve(
                "build/addon/chrome/content/vendor/opendataloader/opendataloader-pdf-cli.jar",
              ),
              input,
              "--output-dir",
              directory,
              "--format",
              "markdown,json",
              "--quiet",
              "--use-struct-tree",
              "--reading-order",
              "xycut",
              "--table-method",
              "cluster",
              "--markdown-page-separator",
              "\n\n<!-- page %page-number% -->\n\n",
            ],
            {
              signal: signal
                ? globalThis.AbortSignal.any([
                    signal,
                    globalThis.AbortSignal.timeout(120000),
                  ])
                : globalThis.AbortSignal.timeout(120000),
              stdio: ["ignore", "ignore", "pipe"],
            },
          );
          let diagnostics = "";
          child.stderr.on("data", (chunk) => {
            diagnostics = (diagnostics + chunk.toString()).slice(-16000);
          });
          child.once("error", rejectJob);
          child.once("close", (code) =>
            code === 0
              ? resolveJob()
              : rejectJob(
                  new Error(`PDF extraction failed (${code}): ${diagnostics}`),
                ),
          );
        });
        return await readFile(resolve(directory, "document.md"), "utf8");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    return documentText(name, Buffer.from(base64, "base64"), (xml) =>
      new DOMParser().parseFromString(xml, "application/xml"),
    );
  },
  run: (config, prompt, signal) =>
    runStudioAI(
      config,
      prompt,
      {
        scope: resolve(root, "runtime", projectID, "ai"),
        fetch: globalThis.fetch,
        read: fileOps.readText,
        write: fileOps.writeTextAtomic,
        delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        prepare: async (provider) => {
          const directory = resolve(root, "runtime", "ai", randomUUID());
          await mkdir(directory, { recursive: true });
          return {
            directory,
            executable:
              provider === "codex"
                ? process.env.PAPERPILOT_CODEX_BIN || "codex"
                : "claude",
          };
        },
        launch: async (job, command) => {
          const out = createWriteStream(resolve(job.directory, "stdout.txt"));
          const err = createWriteStream(resolve(job.directory, "stderr.txt"));
          const child = spawn(command[0], command.slice(1), {
            cwd: job.directory,
            detached: true,
            stdio: "pipe",
          });
          aiChildren.set(job.directory, child);
          child.stdout.pipe(out);
          child.stderr.pipe(err);
          child.stdin.on("error", () => {});
          child.once("close", (code) => {
            void Promise.all([finished(out), finished(err)])
              .then(() =>
                fileOps.writeTextAtomic(
                  resolve(job.directory, "exit-code"),
                  String(code ?? 1),
                ),
              )
              .catch((error) => process.stderr.write(`${error}\n`));
            aiChildren.delete(job.directory);
          });
          await new Promise((resolve, reject) => {
            child.once("spawn", resolve);
            child.once("error", reject);
          });
          child.stdin.end(await readFile(resolve(job.directory, "prompt.txt")));
        },
        stop: async (job) => {
          const child = aiChildren.get(job.directory);
          if (!child || child.exitCode !== null) return;
          process.kill(-child.pid, "SIGTERM");
          for (let i = 0; i < 50; i++) {
            if (child.exitCode !== null || child.signalCode !== null) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error("The AI process did not confirm cancellation.");
        },
      },
      signal,
    ),
});
const buildChildren = new Map();
const compiler = new StudioCompilerService(projectID, repository, {
  scope: resolve(root, "runtime", "builds", projectID),
  id: randomUUID,
  templates: compilerTemplateCache(
    resolve(root, "runtime", "builds"),
    fileOps,
    (source, target) =>
      cp(source, target, { recursive: true, errorOnExist: true, force: false }),
  ),
  prepare: async (compiler) => {
    const directory = resolve(root, "runtime", "builds", randomUUID());
    await mkdir(resolve(directory, "workspace"), { recursive: true });
    await mkdir(resolve(directory, "output"), { recursive: true });
    return {
      directory,
      executable:
        process.env[`PAPERPILOT_STUDIO_${compiler.toUpperCase()}`] || compiler,
    };
  },
  writeBase64: async (path, base64) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(base64, "base64"));
  },
  readBase64: async (path) => {
    const file = await open(path, "r");
    try {
      if ((await file.stat()).size > 50 * 1024 * 1024)
        throw new Error("PDF exceeds 50 MiB.");
      return (await file.readFile()).toString("base64");
    } finally {
      await file.close();
    }
  },
  read: fileOps.readText,
  write: fileOps.writeTextAtomic,
  log: async (path) => {
    if (!(await fileOps.exists(path))) return "";
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(65536);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      return (
        buffer.subarray(0, bytesRead).toString("utf8") +
        ((await file.stat()).size > bytesRead
          ? "\n[Log display limited to 64 KiB.]"
          : "")
      );
    } finally {
      await file.close();
    }
  },
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  launch: async (job, command) => {
    const out = createWriteStream(resolve(job.directory, "stdout.txt"));
    const err = createWriteStream(resolve(job.directory, "stderr.txt"));
    const typst = process.env.PAPERPILOT_STUDIO_TYPST;
    const child = spawn(command[0], command.slice(1), {
      cwd: resolve(job.directory, "workspace"),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TECTONIC_UNTRUSTED_MODE: "1",
        PATH: typst?.includes("/")
          ? `${dirname(typst)}:${process.env.PATH}`
          : process.env.PATH,
      },
    });
    buildChildren.set(job.directory, child);
    child.stdout.pipe(out);
    child.stderr.pipe(err);
    child.once("close", (code) => {
      void Promise.all([finished(out), finished(err)])
        .then(() =>
          fileOps.writeTextAtomic(
            resolve(job.directory, "exit-code"),
            String(code ?? 1),
          ),
        )
        .catch((error) => process.stderr.write(`${error}\n`));
      buildChildren.delete(job.directory);
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  },
  stop: async (job) => {
    const child = buildChildren.get(job.directory);
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    process.kill(-child.pid, "SIGTERM");
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("The compiler did not confirm cancellation.");
  },
});
const children = new Map();
const kernels = new KernelBroker({
  scope: resolve(root, "runtime", projectID),
  id: randomUUID,
  read: (path) =>
    readFile(path, "utf8").catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }),
  write: async (path, text) => {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, text);
    await rename(temporary, path);
  },
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  createJob: async (documentID) => {
    const saved = await repository.read(projectID, documentID);
    if (saved.document.archived)
      throw new Error("Restore the notebook before running it.");
    const directory = resolve(root, "runtime", documentID, randomUUID());
    await mkdir(resolve(directory, "workspace"), { recursive: true });
    let total = 0;
    const inputs = [];
    for (const doc of (await repository.list(projectID)).documents.filter(
      (doc) => !doc.archived,
    )) {
      const data = await repository.read(
        projectID,
        doc.id,
        doc.versions.at(-1).revision,
      );
      const bytes = Buffer.from(data.base64, "base64");
      inputs.push({
        id: doc.id,
        name: doc.name,
        revision: doc.revision,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      total += bytes.length;
      if (total > 100 * 1024 * 1024)
        throw new Error("Runtime snapshot exceeds 100 MiB.");
      const path = resolve(directory, "workspace", doc.name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }
    await writeFile(resolve(directory, "inputs.json"), JSON.stringify(inputs));
    return directory;
  },
  launch: async (directory, kernel) => {
    const child = spawn(
      process.env.PAPERPILOT_STUDIO_PYTHON || "python3",
      [
        resolve("addon/chrome/content/studio/kernel_worker.py"),
        directory,
        kernel,
      ],
      { stdio: "ignore" },
    );
    children.set(directory, child);
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  },
  kill: async (directory) => {
    await writeFile(resolve(directory, "shutdown"), "shutdown");
    const child = children.get(directory);
    if (!child || child.exitCode !== null) return;
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      "Worker did not confirm shutdown; heartbeat expiry will stop it.",
    );
  },
});
process.on("SIGINT", () => {
  assistant.cancel();
  compiler.cancel();
  void kernels.close().finally(() => server.close(() => process.exit(0)));
});
let port;
const server = createServer(async (request, response) => {
  try {
    const host = `127.0.0.1:${port}`;
    if (request.headers.host !== host) throw new Error("Unexpected host.");
    const sandboxAsset =
      request.headers.origin === "null" &&
      (request.method === "GET" || request.method === "HEAD") &&
      request.url?.startsWith("/studio/");
    if (
      request.headers.origin &&
      request.headers.origin !== `http://${host}` &&
      !sandboxAsset
    )
      throw new Error("Unexpected origin.");
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><head><title>Paper Pilot · Studio development</title><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style></head><body><iframe title="Project documents" sandbox="allow-scripts allow-downloads" src="/studio/index.html#${token}"></iframe><script>
        const frame=document.querySelector('iframe');
        const bridge=new MessageChannel();
        let connected=false;
        frame.addEventListener('load',()=>{
          if(connected){bridge.port1.close();return;}
          connected=true;
          frame.contentWindow.postMessage({protocol:'paperpilot-studio/1',channel:${JSON.stringify(token)},method:'connect'},'*',[bridge.port2]);
        });
        bridge.port1.onmessage=async(event)=>{
          const m=event.data;
          if(m?.channel!==${JSON.stringify(token)} || m?.protocol!=='paperpilot-studio/1' || m.method==='dirty')return;
          try{
            const response=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json','x-studio-token':${JSON.stringify(token)}},body:JSON.stringify(m)});
            const result=await response.json();bridge.port1.postMessage({...result,id:m.id,channel:m.channel,protocol:m.protocol});
          }catch(error){bridge.port1.postMessage({id:m.id,channel:m.channel,protocol:m.protocol,error:String(error)});}
        };
      </script></body></html>`);
      return;
    }
    if (request.url === "/rpc" && request.method === "POST") {
      if (request.headers["x-studio-token"] !== token)
        throw new Error("Unauthorized.");
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 104 * 1024 * 1024) throw new Error("Too large.");
        chunks.push(chunk);
      }
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const p = message.payload ?? {};
      let result;
      switch (message.method) {
        case "backup.project.export": {
          const documents = JSON.parse(
            await repository.exportDocuments(projectID, true),
          );
          const context = await assistant.exportProjectContext(
            "Research Studio verification",
            {
              project: { projectID, name: "Research Studio verification" },
              sources: [],
              artifacts: [],
              runs: [],
              members: [],
            },
          );
          assertProjectSnapshotRevision(
            documents,
            (await repository.list(projectID)).revision,
          );
          const path = resolve(
            root,
            "exports",
            `project-${randomUUID()}.paperpilot.json`,
          );
          await fileOps.writeTextAtomic(
            path,
            projectBundle(documents, context),
          );
          result = { path };
          break;
        }
        case "backup.project.restore":
          result = await assistant.restoreProjectBundle(p.text);
          break;
        case "backup.export": {
          const text = await repository.exportDocuments(projectID);
          const path = resolve(
            root,
            "exports",
            `documents-${randomUUID()}.paperpilot.json`,
          );
          await fileOps.writeTextAtomic(path, text);
          result = { path };
          break;
        }
        case "backup.restore":
          result = await repository.restoreDocuments(projectID, p.text);
          break;
        case "assets.pdf-worker":
          result = await readFile(resolve(assets, "pdf-worker.js"), "utf8");
          break;
        case "compiler.build":
          result = await compiler.build(p.id, p.expectedRevision);
          break;
        case "compiler.cancel":
          compiler.cancel();
          result = true;
          break;
        case "references.styles":
          result = [];
          break;
        case "references.zotero":
          throw new Error(
            "Zotero library access requires the native Paper Pilot window. Manual and BibTeX references work in this preview.",
          );
        case "ai.defaults":
          // Mirrors the add-on's preference defaults for the picker lists.
          result = studioModelDefaults({
            engineMode: process.env.PAPERPILOT_STUDIO_ENGINE || "codex_cli",
            codexModel:
              process.env.PAPERPILOT_STUDIO_MODEL || CODEX_DEFAULT_MODEL,
            claudeModel: "sonnet",
            codexAllowed: "",
            claudeAllowed: "sonnet, opus, haiku, fable",
          });
          break;
        case "ai.history":
          result = await assistant.history();
          break;
        case "ai.conversations":
          result = await assistant.conversations();
          break;
        case "ai.resume":
          result = await assistant.resumeConversation(p.id);
          break;
        case "ai.ask":
          result = await assistant.ask(p.config, p.question, p.documentIDs);
          break;
        case "ai.cancel":
          assistant.cancel();
          result = true;
          break;
        case "ai.decide":
          result = await assistant.decide(
            p.changeID,
            p.decision,
            p.docxBase64,
            p.editedAfter,
          );
          break;
        case "ai.new":
          result = await assistant.newConversation();
          break;
        case "kernel.execute":
          result = await kernels.execute(p.id, p.kernel, p.code);
          break;
        case "kernel.interrupt":
          result = await kernels.interrupt(p.id);
          break;
        case "kernel.restart":
          result = await kernels.restart(p.id);
          break;
        case "list":
          result = {
            name: "Research Studio verification",
            manifest: await repository.list(projectID),
          };
          break;
        case "create":
          result = await repository.create(
            projectID,
            p.name,
            p.base64,
            "You",
            p.origin,
          );
          break;
        case "links":
          result = await repository.links(projectID);
          break;
        case "references.passages":
          result = [];
          break;
        case "read":
          result = await repository.read(projectID, p.id, p.revision);
          break;
        case "save":
          result = await repository.save(
            projectID,
            p.id,
            p.expectedRevision,
            p.base64,
            "You",
            "edit",
            p.insertions,
          );
          break;
        case "rename":
          result = await repository.rename(
            projectID,
            p.id,
            p.expectedRevision,
            p.name,
          );
          break;
        case "archive":
          result = await repository.archive(
            projectID,
            p.id,
            p.expectedRevision,
            p.archived,
          );
          break;
        case "restore":
          result = await repository.restore(
            projectID,
            p.id,
            p.expectedRevision,
            p.revision,
            "You",
          );
          break;
        case "export": {
          const saved = await repository.read(projectID, p.id);
          const path = resolve(
            root,
            "exports",
            saved.document.id,
            basename(saved.document.name),
          );
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, Buffer.from(saved.base64, "base64"));
          result = { path };
          break;
        }
        case "reveal":
          result = true;
          break;
        default:
          throw new Error("Unknown operation.");
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ result }));
      return;
    }
    const name = request.url?.replace(/^\/studio\//, "");
    if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
      response.writeHead(404).end();
      return;
    }
    const types = {
      html: "text/html",
      js: "text/javascript",
      mjs: "text/javascript",
      css: "text/css",
      woff2: "font/woff2",
    };
    response.setHeader(
      "Content-Type",
      types[name.split(".").at(-1)] ?? "application/octet-stream",
    );
    response.setHeader("Access-Control-Allow-Origin", "null");
    response.end(await readFile(resolve(assets, name)));
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error.message }));
  }
});
server.listen(0, "127.0.0.1", () => {
  port = server.address().port;
  console.log(`Studio development: http://127.0.0.1:${port}`);
});
