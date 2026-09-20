import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const exec = promisify(execFile);
const cli = path.resolve("bin/diagram.mjs");
test("CLI validates from another working directory and never overwrites input/output", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diagram-cli-test-"));
  const source = await fs.readFile("fixtures/examples/flow.drawio", "utf8");
  const input = path.join(dir, "input.drawio"),
    output = path.join(dir, "existing.png");
  try {
    await fs.writeFile(input, source);
    await fs.writeFile(output, "keep");
    const result = await exec(
      process.execPath,
      [cli, "validate", "--input", input, "--json"],
      { cwd: dir },
    );
    assert.equal(JSON.parse(result.stdout).ok, true);
    for (const destination of [input, output]) {
      try {
        await exec(
          process.execPath,
          [
            cli,
            "render",
            "--input",
            input,
            "--output",
            destination,
            "--format",
            "png",
          ],
          { cwd: dir },
        );
        assert.fail("expected refusal");
      } catch (e: any) {
        assert.equal(e.code, 5);
        assert.equal(JSON.parse(e.stdout).ok, false);
      }
    }
    assert.equal(await fs.readFile(input, "utf8"), source);
    assert.equal(await fs.readFile(output, "utf8"), "keep");
    await fs.writeFile(input, "<broken>");
    try {
      await exec(process.execPath, [
        cli,
        "validate",
        "--input",
        input,
        "--json",
      ]);
      assert.fail("expected rejection");
    } catch (e: any) {
      assert.equal(e.code, 2);
      assert.equal(JSON.parse(e.stdout).ok, false);
    }
    assert.equal(await fs.readFile(input, "utf8"), "<broken>");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
