import { strict as assert } from "node:assert";
import { test } from "node:test";
import { KernelBroker } from "../src/modules/studio/kernelBroker";

function fixture() {
  const disk = new Map<string, string>();
  let sequence = 0;
  const jobs: string[] = [];
  const kills: string[] = [];
  const controls = {
    launch: async () => {},
    kill: async () => {},
  };
  const broker = new KernelBroker({
    id: () => `id-${++sequence}`,
    createJob: async () => {
      const directory = `/owned/job-${jobs.length}`;
      jobs.push(directory);
      disk.set(`${directory}/ready.json`, '{"ok":true}');
      return directory;
    },
    read: async (path) => disk.get(path),
    write: async (path, text) => {
      disk.set(path, text);
      if (path.endsWith("/request.json")) {
        const { id } = JSON.parse(text);
        disk.set(
          path.replace("request.json", `response-${id}.json`),
          JSON.stringify({ status: "ok", execution_count: 1, outputs: [] }),
        );
      }
    },
    delay: async () => {},
    launch: () => controls.launch(),
    kill: async (directory) => {
      kills.push(directory);
      await controls.kill();
    },
  });
  return { broker, jobs, kills, controls };
}

test("concurrent kernel restarts share termination and retain the next session", async () => {
  const f = fixture();
  let release!: () => void;
  const termination = new Promise<void>((resolve) => (release = resolve));
  try {
    await f.broker.execute("notebook", "python3", "x = 1");
    f.controls.kill = () => termination;
    const first = f.broker.restart("notebook");
    const second = f.broker.restart("notebook");
    await new Promise<void>((resolve) => setImmediate(resolve));
    const killCount = f.kills.length;
    release();
    await Promise.all([first, second]);
    assert.equal(killCount, 1, "one process must have one termination owner");
    const next = await f.broker.execute("notebook", "python3", "x = 2");
    const resumed = await f.broker.execute("notebook", "python3", "print(x)");
    assert.equal(next.execution?.sessionID, resumed.execution?.sessionID);
    assert.equal(f.jobs.length, 2);
  } finally {
    release();
    f.controls.kill = async () => {};
    await f.broker.close();
  }
});

test("failed launch cleanup retains kernel ownership until a confirmed restart", async () => {
  const f = fixture();
  f.controls.launch = async () => {
    throw new Error("launch acknowledgement failed");
  };
  f.controls.kill = async () => {
    throw new Error("termination unconfirmed");
  };
  try {
    await assert.rejects(
      f.broker.execute("notebook", "python3", "never_run()"),
      /Cleanup could not be confirmed/,
    );
    f.controls.launch = async () => {};
    await assert.rejects(
      f.broker.execute("notebook", "python3", "do_not_start_a_second_worker()"),
      /Restart this kernel/,
    );
    assert.equal(f.jobs.length, 1);
    f.controls.kill = async () => {};
    await f.broker.restart("notebook");
    assert.deepEqual(f.kills, ["/owned/job-0", "/owned/job-0"]);
    assert.equal(
      (await f.broker.execute("notebook", "python3", "42")).status,
      "ok",
    );
    assert.equal(f.jobs.length, 2);
  } finally {
    f.controls.kill = async () => {};
    await f.broker.close();
  }
});
