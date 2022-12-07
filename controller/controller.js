// Copyright (C) 2022 Intel Corporation
// SPDX-License-Identifier: MIT
import { serve } from "https://deno.land/std@0.165.0/http/server.ts";
import { parse as parseCSV } from "https://deno.land/std@0.165.0/encoding/csv.ts";

const CONNECTION_ROUTE = new URLPattern({ pathname: "/connect" });
const POLL_ROUTE = new URLPattern({ pathname: "/poll" });
const DATA_ROUTE = new URLPattern({ pathname: "/data" });

const nodes = {};
let instruction = "";

async function joiner(req) {
  try {
    if (CONNECTION_ROUTE.exec(req.url)) {
      const node = (await req.json()).hostname;
      if (!nodes.hasOwnProperty(node)) {
        nodes[node] = undefined;
      }
      return new Response(JSON.stringify({ success: true }));
    } else if (POLL_ROUTE.exec(req.url)) {
      return new Response(JSON.stringify({ instruction }));
    } else if (DATA_ROUTE.exec(req.url)) {
      instruction = "";
      const results = await req.json();
      console.log("receiving data from: " + results.hostname);

      if (!results.data.breakfast.hasOwnProperty("failure")) {
        Deno.writeTextFileSync(
          "breakfastResults/" + results.hostname + "/breakfast.csv",
          results.data.breakfast
        );
        results.data.breakfast = parseCSV(results.data.breakfast, {
          skipFirstRow: true,
        });
      } else {
        console.log(results.data.breakfast.failure.message);
        Deno.exit(1);
      }

      if (!results.data.top.hasOwnProperty("failure")) {
        Deno.writeTextFileSync(
          "breakfastResults/" + results.hostname + "/top.txt",
          results.data.top
        );
        let pidstats = {};
        results.data.top
          .split("\n")
          .map((e) => e.trim())
          .filter((e) => e[0] && e[0] >= "0" && e[0] <= "9")
          .map((e) => [e.split(/\s+/)[0], e.split(/\s+/)[8], e.split(/\s+/)[9]])
          .forEach((e) => {
            if (!pidstats.hasOwnProperty(e[0])) {
              pidstats[e[0]] = {
                cpu: [],
                mem: [],
              };
            }
            pidstats[e[0]].cpu.push(Number(e[1]));
            pidstats[e[0]].mem.push(Number(e[2]));
          });
        const avg = (array) => array.reduce((a, b) => a + b, 0) / array.length;
        for (const pid in pidstats) {
          pidstats[pid] = {
            cpu: avg(pidstats[pid].cpu),
            mem: avg(pidstats[pid].mem),
          };
        }
        results.data.top = pidstats;
      } else {
        console.log(results.data.top.failure.message);
        Deno.exit(1);
      }

      nodes[results.hostname] = results.data;
      if (Object.keys(nodes).every((e) => nodes[e])) {
        summaryReport();
        console.log("report and telemetery files generated");
        Deno.exit(0);
      }
      return new Response(JSON.stringify({ success: true }));
    }
    return new Response("Not found only supports /poll, /connect, and /data", {
      status: 404,
    });
  } catch (err) {
    console.log(err);
    Deno.exit(1);
  }
}

function summaryReport() {
  let msgbreakdown = {};
  let BFNODES = {};
  let BFEDGES = [];
  let ipmap = {};
  let BFCATGS = [...Object.keys(nodes)];

  function path(line) {
    return (
      line.LADDR +
      "port:" +
      line.LPORT +
      " to " +
      line.RADDR +
      "port:" +
      line.RPORT
    );
  }

  function id(row) {
    return row.COMM + " (" + row.PID + " " + row.n + ")";
  }

  // generate best guess IP addresses for PID's
  function genIpMap() {
    for (const n in nodes) {
      for (const line of nodes[n].breakfast) {
        line.n = n;
        if (!ipmap.hasOwnProperty(line.LADDR + " port: " + line.LPORT)) {
          ipmap[line.LADDR + " port: " + line.LPORT] = {};
        }
        if (
          !ipmap[line.LADDR + " port: " + line.LPORT].hasOwnProperty(id(line))
        ) {
          ipmap[line.LADDR + " port: " + line.LPORT][id(line)] = {
            cnt: 0,
            svr: n,
            pid: line.PID,
          };
        }
        ipmap[line.LADDR + " port: " + line.LPORT][id(line)].cnt += 1;
        BFNODES[id(line)] = {
          id: id(line),
          name: id(line),
          rx: 0,
          tx: 0,
          cnt: 0,
          lat: 0,
          cpu: nodes[n].top[line.PID] ? nodes[n].top[line.PID].cpu : 0,
          mem: nodes[n].top[line.PID] ? nodes[n].top[line.PID].mem : 0,
          symbolSize: 1,
          category: BFCATGS.indexOf(n),
        };
      }
    }
    for (const ip in ipmap) {
      let bestcomm = ["", { cnt: 0, svr: "", pid: "" }];
      for (const comm in ipmap[ip]) {
        if (ipmap[ip][comm].cnt > bestcomm[1].cnt) {
          bestcomm = [comm, ipmap[ip][comm]];
        }
      }
      ipmap[ip] = bestcomm[0];
    }
  }

  genIpMap();
  for (const n in nodes) {
    msgbreakdown[n] = {};
    for (const row of nodes[n].breakfast) {
      if (row.STATE === "-1" || row.STATE === "-2") {
        if (!msgbreakdown[n].hasOwnProperty(path(row))) {
          msgbreakdown[n][path(row)] = {};
          if (ipmap.hasOwnProperty(row.LADDR + " port: " + row.LPORT)) {
            msgbreakdown[n][path(row)].src =
              ipmap[row.LADDR + " port: " + row.LPORT];
          }
          if (ipmap.hasOwnProperty(row.RADDR + " port: " + row.RPORT)) {
            msgbreakdown[n][path(row)].dst =
              ipmap[row.RADDR + " port: " + row.RPORT];
          } else {
            msgbreakdown[n][path(row)].dst = row.RADDR + " port: " + row.RPORT;
            if (!BFNODES[row.RADDR + " port: " + row.RPORT]) {
              BFNODES[row.RADDR + " port: " + row.RPORT] = {
                id: row.RADDR + " port: " + row.RPORT,
                name: row.RADDR + " port: " + row.RPORT,
                symbolSize: 1,
                rx: 0,
                tx: 0,
                lat: 0,
                cnt: 0,
                cpu: 0,
                mem: 0,
                category: "external",
              };
            }
          }
          BFEDGES.push({
            source: msgbreakdown[n][path(row)].src,
            target: msgbreakdown[n][path(row)].dst,
          });
        }
        BFNODES[ipmap[row.LADDR + " port: " + row.LPORT]].lat += Number(row.MS);
        BFNODES[ipmap[row.LADDR + " port: " + row.LPORT]].cnt += 1;
        BFNODES[ipmap[row.LADDR + " port: " + row.LPORT]].rx += Number(
          row["RX_KB"]
        );
        BFNODES[ipmap[row.LADDR + " port: " + row.LPORT]].tx += Number(
          row["TX_KB"]
        );
        if (BFNODES[row.RADDR + " port: " + row.RPORT]) {
          BFNODES[row.RADDR + " port: " + row.RPORT].rx += Number(row["TX_KB"]);
          BFNODES[row.RADDR + " port: " + row.RPORT].tx += Number(row["RX_KB"]);
        }
      }
    }
  }

  let maxData = 0;
  let minData = 0;
  let maxLat = 0;
  let minLat = 0;
  let maxCPU = 0;
  let minCPU = 0;
  let maxMEM = 0;
  let minMEM = 0;
  for (const process in BFNODES) {
    BFNODES[process].totalData = BFNODES[process].rx + BFNODES[process].tx;

    maxData = Math.max(maxData, BFNODES[process].totalData);
    minData = Math.min(minData, BFNODES[process].totalData);
    maxLat = Math.max(maxLat, BFNODES[process].lat);
    minLat = Math.min(minLat, BFNODES[process].lat);
    maxCPU = Math.max(maxCPU, BFNODES[process].cpu);
    minCPU = Math.min(minCPU, BFNODES[process].cpu);
    maxMEM = Math.max(maxMEM, BFNODES[process].mem);
    minMEM = Math.min(minMEM, BFNODES[process].mem);

    BFNODES[process].dataName =
      BFNODES[process].name +
      "\ntx: " +
      Math.round(BFNODES[process].tx/15) +
      "kb/s\nrx: " +
      Math.round(BFNODES[process].rx/15) +
      "kb/s";
    delete BFNODES[process].rx;
    delete BFNODES[process].tx;
    BFNODES[process].latName =
      BFNODES[process].name + "\nrtt: " + BFNODES[process].lat + "ms";
    BFNODES[process].cpuName =
      BFNODES[process].name +
      "\ncpu: " +
      Math.round(BFNODES[process].cpu) +
      "%";
    BFNODES[process].memName =
      BFNODES[process].name +
      "\nmem: " +
      Math.round(BFNODES[process].mem) +
      "%";
    BFNODES[process].name = BFNODES[process].dataName;
  }

  for (const node in BFNODES) {
    BFNODES[node].normData = Math.round(
      ((BFNODES[node].totalData - minData) / (maxData - minData)) * 20 + 5
    );
    delete BFNODES[node].totalData;
    BFNODES[node].normLat = Math.round(
      ((BFNODES[node].lat - minLat) / (maxLat - minLat)) * 20 + 5
    );
    delete BFNODES[node].lat;
    BFNODES[node].normCPU = Math.round(
      ((BFNODES[node].cpu - minCPU) / (maxCPU - minCPU)) * 20 + 5
    );
    delete BFNODES[node].cpu;
    BFNODES[node].normMEM = Math.round(
      ((BFNODES[node].mem - minMEM) / (maxMEM - minMEM)) * 20 + 5
    );
    delete BFNODES[node].mem;
    BFNODES[node].symbolSize = BFNODES[node].normData;
  }

  Deno.writeTextFileSync(
    "report.html",
    basehtml
      .replace("BFNODES", JSON.stringify(Object.values(BFNODES)))
      .replaceAll(
        "BFCATGS",
        JSON.stringify([
          ...BFCATGS.map((e) => {
            return { name: e };
          }),
          { name: "external" },
        ])
      )
      .replace("BFEDGES", JSON.stringify(BFEDGES))
  );
}

console.log("Waiting for systems to join");
serve(joiner, { port: 8090 });
await new Promise((r) => setTimeout(r, 2000));
console.log(Object.keys(nodes));
if (Deno.args.length == 0 || Deno.args[0] != "noprompt") {
  alert("Found above systems. Start collecting all telemtry?");
}
try {
  Deno.removeSync("breakfastResults", { recursive: true });
} catch {}
try {
  Deno.mkdirSync("breakfastResults");
  for (const n in nodes) {
    Deno.mkdirSync("breakfastResults/" + n);
  }
} catch {}
instruction = "All";
