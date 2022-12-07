// Copyright (C) 2022 Intel Corporation
// SPDX-License-Identifier: MIT
async function search(host) {
  const hostname = host;
  let searching = true;
  while (searching) {
    await new Promise((r) => setTimeout(r, 2000));

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000);

    await fetch("http://" + Deno.args[0] + ":8090/connect", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hostname }),
    })
      .then((_resp) => {
        console.log(_resp);
        searching = false;
      })
      .catch((_err) => {
        console.log(_err);
        console.log("attempting to connect");
      });
    clearTimeout(id);
  }
}

export async function serve_telemetry(suffix, func) {
  const hostname = Deno.hostname() + suffix;
  while (true) {
    console.log("attempting to connect to http://" + Deno.args[0] + ":8090");
    await search(hostname);
    console.log("Successfully connected, polling for instruction");

    await new Promise((r) => setTimeout(r, 1000));
    await fetch("http://" + Deno.args[0] + ":8090/poll")
      .then(async (resp) => {
        const corn = await resp.json();
        let data = {};

        if (corn.instruction === "All") {
          data = { ...(await func()) };
          console.log("sending to " + Deno.args[0]);
          await fetch("http://" + Deno.args[0] + ":8090/data", {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ hostname, data }),
          });
        }
      })
      .catch((_err) => {
        console.log(_err);
      });
  }
}

async function run_breakfast(t) {
  try {
    const cmd = ["timeout", t + "s", "./breakfast"];
    const _p = await Deno.run({ cmd }).status();
    const text = Deno.readTextFileSync("output.csv");
    return text;
  } catch (err) {
    return { failure: err };
  }
}

async function run_top(t) {
  try {
    const data = new TextDecoder().decode(
      await Deno.run({
        cmd: ["top", "-b", "-n 30", "-d", "0.5"],
        stdout: "piped",
      }).output()
    );
    return data;
  } catch (err) {
    return { failure: err };
  }
}

await serve_telemetry("", async () => {
  const breakfast = run_breakfast(15);
  const top = run_top(15);
  return {
    breakfast: await breakfast,
    top: await top,
  };
});
