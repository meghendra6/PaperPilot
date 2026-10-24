import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  KernelBroker,
  type KernelPorts,
} from "../src/modules/studio/kernelBroker";

let fixtureCount = 0;
function fixture(scope = `/owned/kernel-project-${++fixtureCount}`) {
  const disk = new Map<string, string>();
  let sequence = 0;
  const jobs: string[] = [];
  const kills: string[] = [];
  const controls = {
    launch: async () => {},
    kill: async () => {},
  };
  const ports: KernelPorts = {
    scope,
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
  };
  const broker = new KernelBroker(ports);
  return { broker, ports, disk, jobs, kills, controls };
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

test("replacement brokers retain failed cleanup and use fresh termination ports without adopting a session", async () => {
  const f = fixture();
  f.controls.launch = async () => {
    throw new Error("launch acknowledgement failed");
  };
  f.controls.kill = async () => {
    throw new Error("old window termination unavailable");
  };
  await assert.rejects(
    f.broker.execute("notebook", "python3", "never_run()"),
    /Cleanup/,
  );
  await assert.rejects(f.broker.close(), /old window/);
  let releaseStop!: () => void;
  let stopping!: () => void;
  const stopStarted = new Promise<void>((resolve) => (stopping = resolve));
  const stopped = new Promise<void>((resolve) => (releaseStop = resolve));
  const replacementKills: string[] = [];
  let replacementKillFails = true;
  const replacement = new KernelBroker({
    ...f.ports,
    launch: async () => {},
    kill: async (directory) => {
      replacementKills.push(directory);
      if (replacementKillFails)
        throw new Error("replacement termination unconfirmed");
      stopping();
      await stopped;
    },
  });
  const concurrent = new KernelBroker({
    ...f.ports,
    kill: async () => {
      assert.fail("Cleanup must have one owner");
    },
  });
  try {
    await assert.rejects(
      replacement.execute("notebook", "python3", "do_not_overlap()"),
      /previous window/,
    );
    await assert.rejects(replacement.restart("notebook"), /unconfirmed/);
    await assert.rejects(
      replacement.execute("notebook", "python3", "do_not_overlap()"),
      /previous window/,
    );
    replacementKillFails = false;
    const restart = replacement.restart("notebook");
    await stopStarted;
    const sameRestart = concurrent.restart("notebook");
    assert.equal(restart, sameRestart);
    await assert.rejects(
      replacement.execute("notebook", "python3", "do_not_overlap()"),
      /previous window/,
    );
    assert.equal(f.jobs.length, 1);
    releaseStop();
    await Promise.all([restart, sameRestart]);
    const first = await replacement.execute("notebook", "python3", "x = 42");
    assert.equal(f.jobs.length, 2);
    await f.broker.restart("notebook");
    await f.broker.interrupt("notebook");
    await f.broker.close();
    const next = await replacement.execute("notebook", "python3", "print(x)");
    assert.equal(first.execution?.sessionID, next.execution?.sessionID);
    assert.equal(f.disk.has(`${f.jobs[1]}/interrupt`), false);
    assert.deepEqual(replacementKills, [f.jobs[0], f.jobs[0]]);
  } finally {
    replacementKillFails = false;
    releaseStop();
    await replacement.close();
    await concurrent.close();
    f.controls.kill = async () => {};
    await f.broker.close();
  }
});

test("a closed broker reserves the notebook through pending startup and termination", async () => {
  const f = fixture();
  let releaseLaunch!: () => void;
  let launching!: () => void;
  const launchStarted = new Promise<void>((resolve) => (launching = resolve));
  const launched = new Promise<void>((resolve) => (releaseLaunch = resolve));
  let releaseStop!: () => void;
  let stopping!: () => void;
  const stopStarted = new Promise<void>((resolve) => (stopping = resolve));
  const stopped = new Promise<void>((resolve) => (releaseStop = resolve));
  f.controls.launch = async () => {
    launching();
    await launched;
  };
  f.controls.kill = async () => {
    stopping();
    await stopped;
  };
  const execution = assert.rejects(
    f.broker.execute("notebook", "python3", "never_run()"),
    /closed/,
  );
  await launchStarted;
  const closing = f.broker.close();
  const replacement = new KernelBroker({
    ...f.ports,
    launch: async () => {},
    kill: async () => {},
  });
  try {
    await assert.rejects(
      replacement.execute("notebook", "python3", "do_not_overlap()"),
      /previous window/,
    );
    const restarting = replacement.restart("notebook");
    releaseLaunch();
    await stopStarted;
    await assert.rejects(
      replacement.execute("notebook", "python3", "do_not_overlap()"),
      /previous window/,
    );
    assert.equal(f.jobs.length, 1);
    releaseStop();
    await Promise.all([closing, restarting, execution]);
    assert.equal(
      (await replacement.execute("notebook", "python3", "42")).status,
      "ok",
    );
    assert.equal(f.jobs.length, 2);
    assert.equal(f.disk.has(`${f.jobs[0]}/request.json`), false);
  } finally {
    releaseLaunch();
    releaseStop();
    await Promise.all([closing, execution]);
    await replacement.close();
  }
});

test("kernel ownership keeps notebooks and profiles independent and prevents live-session adoption", async () => {
  const f = fixture();
  const otherProfile = fixture();
  const otherWindow = new KernelBroker({ ...f.ports });
  try {
    const first = await f.broker.execute("notebook", "python3", "x = 1");
    await assert.rejects(
      otherWindow.execute("notebook", "python3", "do_not_adopt()"),
      /previous window/,
    );
    await assert.rejects(
      otherWindow.restart("notebook"),
      /another open project window/,
    );
    assert.equal(
      (await otherWindow.execute("another-notebook", "python3", "42")).status,
      "ok",
    );
    assert.equal(
      (await otherProfile.broker.execute("notebook", "python3", "43")).status,
      "ok",
    );
    await otherWindow.close();
    const next = await f.broker.execute("notebook", "python3", "print(x)");
    assert.equal(first.execution?.sessionID, next.execution?.sessionID);
  } finally {
    await Promise.all([
      f.broker.close(),
      otherWindow.close(),
      otherProfile.broker.close(),
    ]);
  }
});
