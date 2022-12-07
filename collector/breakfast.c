// Copyright (C) 2022 Intel Corporation
// SPDX-License-Identifier: (LGPL-2.1 OR BSD-2-Clause)
#include <sys/resource.h>
#include <arpa/inet.h>
#include <argp.h>
#include <signal.h>
#include <limits.h>
#include <unistd.h>
#include <time.h>
#include <bpf/bpf.h>
#include "breakfast.h"
#include "breakfast.skel.h"
#include <stdio.h>

#define warn(...) fprintf(stderr, __VA_ARGS__)

static volatile sig_atomic_t exiting = 0;

const char *argp_program_version = "breakfast 0.1";
const char *argp_program_bug_address = "https://github.com/intel-sandbox/cloudcompute.breakfast";
static const char argp_program_doc[] = "breakfast: fast breakdowns\n";

struct breakfast_opts_t
{
	FILE *csv_file;
} breakfast_opts;

static const struct argp_option opts[] = {
	{"verbose", 'v', NULL, 0, "Verbose debug output"},
	{NULL, 'h', NULL, OPTION_HIDDEN, "Show the full help"},
	{},
};

static struct env
{
	bool verbose;
} env;

static error_t parse_arg(int key, char *arg, struct argp_state *state)
{
	switch (key)
	{
	case 'v':
		env.verbose = true;
		break;
	default:
		return ARGP_ERR_UNKNOWN;
	}
	return 0;
}

static int libbpf_print_fn(enum libbpf_print_level level, const char *format, va_list args)
{
	if (level == LIBBPF_DEBUG && !env.verbose)
		return 0;
	return vfprintf(stderr, format, args);
}

static void sig_int(int signo)
{
	printf("exiting");
	fclose(breakfast_opts.csv_file);
	exiting = 1;
}

static void print_events_header()
{
	fprintf(breakfast_opts.csv_file, "STATE,PID,COMM,LADDR,LPORT,RADDR,RPORT,TX_KB,RX_KB,MS,TS\n");
}

static void handle_event(void *ctx, int cpu, void *data, __u32 data_sz)
{
	const struct event *event = data;
	char src[INET6_ADDRSTRLEN];
	char dst[INET6_ADDRSTRLEN];
	union
	{
		struct in_addr x4;
		struct in6_addr x6;
	} s, d;

	if (event->af == AF_INET)
	{
		s.x4.s_addr = event->saddr_v4;
		d.x4.s_addr = event->daddr_v4;
	}
	else if (event->af == AF_INET6)
	{
		memcpy(&s.x6.s6_addr, event->saddr_v6, sizeof(s.x6.s6_addr));
		memcpy(&d.x6.s6_addr, event->daddr_v6, sizeof(d.x6.s6_addr));
	}
	else
	{
		// warn("broken event: event->af=%d", event->af);
		return;
	}

	fprintf(breakfast_opts.csv_file, "%d,%d,%s,%s,%u,%s,%u,%llu,%llu,%llu,%llu\n",
			event->state,
			event->pid,
			event->task,
			inet_ntop(event->af, &s, src, sizeof(src)),
			(unsigned int)(event->ports >> 32),
			inet_ntop(event->af, &d, dst, sizeof(dst)),
			(unsigned int)(event->ports & 0xFFFFFFFF),
			event->tx_b,
			event->rx_b,
			event->span_us / 1000,
			event->ts_us);
}

static void handle_lost_events(void *ctx, int cpu, __u64 lost_cnt)
{
	fprintf(breakfast_opts.csv_file, "poop,PID,COMM,LADDR,LPORT,RADDR,RPORT,TX_KB,RX_KB,MS,TS\n");
	warn("Lost %llu events on CPU #%d!\n", lost_cnt, cpu);
}

static void print_events(int perf_map_fd)
{
	struct perf_buffer *pb;
	int err;

	pb = perf_buffer__new(perf_map_fd, 128, handle_event, handle_lost_events, NULL, NULL);
	if (!pb)
	{
		err = -errno;
		warn("failed to open perf buffer: %d\n", err);
		goto cleanup;
	}

	print_events_header();
	while (!exiting)
	{
		err = perf_buffer__poll(pb, 100);
		if (err < 0 && err != -EINTR)
		{
			warn("error polling perf buffer: %s\n", strerror(-err));
			goto cleanup;
		}
		/* reset err to return 0 if exiting */
		err = 0;
	}

cleanup:
	perf_buffer__free(pb);
	exit(0);
}

int main(int argc, char **argv)
{
	static const struct argp argp = {
		.options = opts,
		.parser = parse_arg,
		.doc = argp_program_doc,
		.args_doc = NULL,
	};
	breakfast_opts.csv_file = fopen("output.csv", "w+");
	struct breakfast_bpf *obj;
	int err;

	err = argp_parse(&argp, argc, argv, 0, NULL, NULL);
	if (err)
		return err;

	libbpf_set_strict_mode(LIBBPF_STRICT_ALL);
	libbpf_set_print(libbpf_print_fn);

	obj = breakfast_bpf__open();
	if (!obj)
	{
		warn("failed to open BPF object\n");
		return 1;
	}

	err = breakfast_bpf__load(obj);
	if (err)
	{
		warn("failed to load BPF object: %d\n", err);
		goto cleanup;
	}

	err = breakfast_bpf__attach(obj);
	if (err)
	{
		warn("failed to attach BPF programs: %s\n", strerror(-err));
		goto cleanup;
	}

	if (signal(SIGINT, sig_int) == SIG_ERR)
	{
		warn("can't set signal handler: %s\n", strerror(errno));
		err = 1;
		goto cleanup;
	}
	signal(SIGTERM, sig_int);

	print_events(bpf_map__fd(obj->maps.events));

cleanup:
	breakfast_bpf__destroy(obj);

	return err != 0;
}
