# syntax=docker/dockerfile:1

FROM denoland/deno:ubuntu AS builder
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install --no-install-recommends -y libcap2=1:2.32-1 git=1:2.25.1-1ubuntu3.6 pkg-config=0.29.1-0ubuntu4 libelf-dev=0.176-1.1build1 cmake=3.16.3-1ubuntu1.20.04.1 clang=1:10.0-50~exp1 llvm=1:10.0-50~exp1
WORKDIR /
COPY . .
RUN git submodule update --init --recursive
WORKDIR /collector
RUN make; deno compile --allow-all --unstable collector.js

FROM debian:stable
WORKDIR /
RUN apt-get update && apt-get -o DPkg::Options::="--force-confnew" install --no-install-recommends -y procps=2:3.3.17-5 libelf-dev=0.183-1 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /collector/breakfast .
COPY --from=builder /collector/collector .
ENTRYPOINT [ "./collector"]