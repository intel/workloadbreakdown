# Intel® Workload Breakdown
Drop-in analysis of distributed workloads. Generates a map of processes which communicate over TCP. Gets the following metrics per visualized process
- Network time
- Network data (kb sent and received)
-	CPU utilization
- Memory utilization

## How to use
1. Start collector container on all system with IP of controller node as an argument passed to the container
```
docker run -d --pid=host --userns=host --privileged intel/workload-breakdown-collector:latest <controller-node-ip>
```
2. Run controller
```
wget https://github.com/intel/workloadbreakdown/releases/latest/download/controller -O controller
sudo chmod +x controller
./controller
```
![example](https://github.com/intel-innersource/applications.analyzers.cloudcompute.breakfast/assets/86739774/94a4f0d0-fb5b-4692-a8aa-cb9c43e5ed52)

## How to build
### Controller
Needs:
- [deno](https://deno.land/)

Compile:
```
cd controller
echo let basehtml = \` > final.js
cat base.html >> final.js
echo \` >> final.js
cat controller.js >> final.js
deno compile --output controller --allow-all --unstable final.js
```
### Collector binaries
Needs:
- [deno](https://deno.land/)
- libelf-dev
- clang
- llvm

Compile:
```
cd collector
make
deno compile --allow-all --unstable collector.js
```
### Collector docker image
```
docker build --no-cache -t workload-breakdown-collector:latest .
