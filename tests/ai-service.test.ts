import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AIService,
  parseAnswer,
  candidateXml,
} from "../packages/ai-service/index.ts";
import { runProcess, type Runner } from "../packages/ai-service/process.ts";
const xml = await fs.readFile("fixtures/examples/architecture.drawio", "utf8");
async function setup(runner: Runner) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhitu-unit-"));
  const s = await new AIService(dir, runner).init();
  await s.save({
    defaultProvider: "codex",
    providers: {
      codex: { path: process.execPath, model: "" },
      qoder: { path: process.execPath, model: "" },
    },
  });
  return {
    s,
    dir,
    close: async () => {
      await s.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
const output =
  (answer: string): Runner =>
  async (_file, args, opts) => {
    if (args[0] === "--version") return "fake 1.0";
    if (args[0] === "exec") {
      await fs.writeFile(args[args.indexOf("-o") + 1], answer);
      return "{}";
    }
    return JSON.stringify({ type: "result", result: answer });
  };
async function finish(s: AIService, id: string) {
  await s.jobs.get(id)!.done;
  return s.view(id);
}
test("CLI settings persist separately, detect does not claim AI online", async () => {
  const f = await setup(output("ZHITU_OK"));
  try {
    assert.equal((await f.s.status()).clients[0].state, "unverified");
    assert.equal((await f.s.detect("codex")).version, "fake 1.0");
    assert.equal((await f.s.status()).clients[0].state, "unverified");
    const j = await finish(f.s, f.s.test("codex").id);
    assert.equal(j.status, "succeeded");
    assert.equal((await f.s.status()).clients[0].state, "online");
    const c = structuredClone(f.s.config);
    c.providers.codex.model = "other";
    await f.s.save(c);
    assert.equal((await f.s.status()).clients[0].state, "unverified");
    const reloaded = await new AIService(f.dir, output("")).init();
    assert.equal(reloaded.config.providers.codex.model, "other");
    await reloaded.close();
    await assert.rejects(
      f.s.save({
        ...c,
        providers: { ...c.providers, codex: { path: "codex;evil", model: "" } },
      }),
      /绝对路径/,
    );
  } finally {
    await f.close();
  }
});
test("candidate generation keeps baseline and revision, retries invalid candidate at most 3 times", async () => {
  let attempts = 0;
  const f = await setup(async (file, args, opts) => {
    attempts++;
    return output(
      attempts === 1
        ? "invalid"
        : xml.replace('value="订单服务"', 'value="订单处理服务"'),
    )(file, args, opts);
  });
  try {
    const j = await finish(
      f.s,
      f.s.generate({
        provider: "codex",
        prompt: "改名",
        xml,
        revision: 7,
        mode: "edit",
      }).id,
    );
    assert.equal(j.status, "succeeded");
    assert.equal(attempts, 2);
    assert.equal(j.revision, 7);
    assert.ok(j.result?.changes.some((c) => c.kind === "文字"));
    assert.ok(j.result?.sameDocument);
    assert.deepEqual(
      (await fs.readdir(f.dir)).filter((p) => p.startsWith("task-")),
      [],
    );
  } finally {
    await f.close();
  }
});
test("selection scope rejects unrelated edits and invalid requests", async () => {
  const f = await setup(
    output(xml.replace('value="订单服务"', 'value="订单处理服务"')),
  );
  try {
    assert.throws(
      () =>
        f.s.generate({
          provider: "codex",
          prompt: "改名",
          xml,
          revision: 1,
          mode: "selection",
          selection: [],
        }),
      /选择/,
    );
    const { validate } = await import("../packages/document-core/index.ts");
    const other = validate(xml).cells!.find(
      (c) => c.kind === "node" && c.label === "API 网关",
    )!;
    const j = await finish(
      f.s,
      f.s.generate({
        provider: "qoder",
        prompt: "改名",
        xml,
        revision: 1,
        mode: "selection",
        selection: [other.id],
      }).id,
    );
    assert.equal(j.status, "failed");
    assert.match(j.error!, /选区之外/);
    assert.throws(
      () =>
        f.s.generate({
          provider: "bad" as any,
          prompt: "x",
          xml,
          revision: 1,
          mode: "edit",
        }),
      /不支持/,
    );
  } finally {
    await f.close();
  }
});
test("cancellation preserves state, releases queue and removes task directory", async () => {
  const f = await setup(async (_f, _a, o) => {
    await new Promise<void>((_, reject) => {
      o.signal!.addEventListener("abort", () => reject(Error("abort")), {
        once: true,
      });
    });
    return "";
  });
  try {
    const j = f.s.test("qoder");
    await new Promise((r) => setTimeout(r, 30));
    assert.throws(() => f.s.test("codex"), /已有/);
    f.s.cancel(j.id);
    assert.equal((await finish(f.s, j.id)).status, "cancelled");
    assert.deepEqual(
      (await fs.readdir(f.dir)).filter((p) => p.startsWith("task-")),
      [],
    );
  } finally {
    await f.close();
  }
});
test("provider output errors do not become candidates", () => {
  assert.equal(parseAnswer("qoder", '{"result":"ZHITU_OK"}'), "ZHITU_OK");
  assert.throws(
    () =>
      parseAnswer(
        "qoder",
        '{"type":"result","is_error":true,"result":"token=secret"}',
      ),
    /AI 请求失败/,
  );
  assert.throws(() => candidateXml("incomplete <mxfile>"), /完整/);
});
test("runner uses stdin, preserves unicode, suppresses stderr and terminates timeouts", async () => {
  const text = await runProcess(
    process.execPath,
    [
      "-e",
      'process.stdin.setEncoding("utf8");process.stdin.on("data",d=>process.stdout.write(d));console.error("PRIVATE")',
    ],
    { cwd: os.tmpdir(), input: "订单服务" },
  );
  assert.equal(text, "订单服务");
  await assert.rejects(
    runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      cwd: os.tmpdir(),
      timeout: 50,
    }),
    /超时/,
  );
});

test('failed requests invalidate previously verified online status',async()=>{let fail=false;const f=await setup(async(file,args,opts)=>{if(fail)throw Error('客户端连接失败');return output('ZHITU_OK')(file,args,opts);});try{await finish(f.s,f.s.test('codex').id);assert.equal(f.s.health.codex.state,'online');fail=true;const j=await finish(f.s,f.s.generate({provider:'codex',prompt:'测试',xml,revision:1,mode:'edit'}).id);assert.equal(j.status,'failed');assert.equal(f.s.health.codex.state,'error');}finally{await f.close();}});
test('known old CLI version errors are actionable without leaking raw logs',async()=>{await assert.rejects(runProcess(process.execPath,['-e','console.log(JSON.stringify({type:"error",message:"The model requires a newer version of Codex. secret-token"}));process.exit(1)'],{cwd:os.tmpdir()}),e=>e instanceof Error&&e.message.includes('更新版本')&&!e.message.includes('secret-token'));});

test('read-only detection overrides path without changing saved settings',async()=>{const f=await setup(output('version 1'));try{const original=JSON.stringify(f.s.config);await f.s.detect('codex',process.execPath);assert.equal(JSON.stringify(f.s.config),original);await assert.rejects(f.s.detect('codex','relative --evil'),/绝对路径/);}finally{await f.close();}});
test('recent tasks expose recoverable identity and prompt without duplicating candidate XML in lists',async()=>{const f=await setup(output(xml));try{const j=await finish(f.s,f.s.generate({provider:'codex',prompt:'恢复测试',xml,revision:8,mode:'edit'}).id);const recent=f.s.list()[0];assert.equal(recent.id,j.id);assert.equal(recent.requestPrompt,'恢复测试');assert.ok(recent.documentId);assert.equal(recent.revision,8);assert.equal('result' in recent,false);assert.equal('controller' in recent,false);assert.ok(f.s.view(j.id).result?.baseHash);}finally{await f.close();}});

test('streamed progress is incremental and excludes private reasoning and raw CLI data', async () => {
  let seenArgs:string[]=[];
  const f=await setup(async(file,args,o)=>{
    seenArgs=args;
    const stream=[{type:'system'}, {type:'stream_event',event:{delta:{type:'thinking_delta',thinking:'SECRET_REASONING'}}},{type:'stream_event',event:{delta:{type:'text_delta',text:'<mxfile>SECRET_XML'}}}].map(e=>JSON.stringify(e)+'\n').join('');
    o.onStdout?.(stream.slice(0,18));o.onStdout?.(stream.slice(18));
    return output(xml)(file,args,o);
  });
  try {
    const result=await finish(f.s,f.s.generate({provider:'qoder',model:'Qwen3.8-Flash',prompt:'保持原图',xml,revision:1,mode:'edit'}).id);
    assert.equal(result.status,'succeeded');assert.ok(result.progress.some(p=>p.text.includes('个字符')));
    assert.ok(!JSON.stringify(result.progress).includes('SECRET'));assert.ok(result.outputBytes!>0);
    assert.ok(seenArgs.includes('stream-json'));assert.ok(seenArgs.includes('--include-partial-messages'));assert.ok(seenArgs.includes('--strict-mcp-config'));assert.ok(seenArgs.includes('{"disableAllHooks":true}'));
    assert.equal(seenArgs[seenArgs.indexOf('-m')+1],'Qwen3.8-Flash');
    assert.equal(f.s.model('qoder',''),'Auto');assert.throws(()=>f.s.model('qoder','unknown'),/支持/);
    await finish(f.s,f.s.generate({provider:'codex',model:'should-be-ignored',prompt:'保持原图',xml,revision:1,mode:'edit'}).id);
    assert.ok(!seenArgs.includes('-m'));
  }finally{await f.close();}
});
test('activity resets idle deadline while absolute deadline and cancellation remain effective',async()=>{
  let received='';
  const output=await runProcess(process.execPath,['-e','let n=0;const t=setInterval(()=>{console.log("tick");if(++n===8){clearInterval(t)}},30)'],{cwd:os.tmpdir(),idleTimeout:200,timeout:2000,onStdout:c=>received+=c});
  assert.equal(output,received);assert.equal(output.trim().split('\n').length,8);
  await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:os.tmpdir(),idleTimeout:60,timeout:2000}),/没有输出/);
  await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>console.log("tick"),20)'],{cwd:os.tmpdir(),idleTimeout:200,timeout:150}),/最长运行/);
});
