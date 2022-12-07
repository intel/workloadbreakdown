// Copyright (C) 2022 Intel Corporation
// SPDX-License-Identifier: GPL-2.0
#include <vmlinux.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_endian.h>

#include "breakfast.h"

/* Define here, because there are conflicts with include files */
#define AF_INET 2
#define AF_INET6 10

struct id_t
{
	u32 pid;
	char task[TASK_COMM_LEN];
};

struct
{
	__uint(type, BPF_MAP_TYPE_PERF_EVENT_ARRAY);
	__uint(key_size, sizeof(u32));
	__uint(value_size, sizeof(u32));
} events SEC(".maps");

SEC("kprobe/tcp_cleanup_rbuf")
int BPF_KPROBE(tcp_cleanup_rbuf, struct sock *sk, int copied)
{
	struct tcp_sock *ts;
	u32 pid = bpf_get_current_pid_tgid() >> 32;
	u16 family;

	if (copied <= 0)
		return 0;

	bpf_probe_read_kernel(&family, sizeof(sk->__sk_common.skc_family), &sk->__sk_common.skc_family);
	
	
	ts = (struct tcp_sock *)(sk);
	u32 srtt = BPF_CORE_READ(ts, srtt_us) >> 3;

	struct event data = {};
	data.span_us = srtt;
	data.rx_b = (u64)copied;
	data.tx_b = 0;
	data.ts_us = 0;
	data.state = -1;
	// a workaround until data compiles with separate lport/dport
	data.ports = bpf_ntohs(BPF_CORE_READ(sk, __sk_common.skc_dport)) + ((0ULL + BPF_CORE_READ(sk, __sk_common.skc_num)) << 32);
	data.pid = pid;

	if (family == AF_INET)
	{
		data.af = AF_INET;
		bpf_probe_read_kernel(&data.saddr_v4, sizeof(sk->__sk_common.skc_rcv_saddr), &sk->__sk_common.skc_rcv_saddr);
		data.daddr_v4 = BPF_CORE_READ_BITFIELD_PROBED(sk, __sk_common.skc_daddr);
	}
	else if (family == AF_INET6)
	{
		data.af = AF_INET6;
		bpf_probe_read_kernel(&data.saddr_v4, sizeof(sk->__sk_common.skc_v6_rcv_saddr.in6_u.u6_addr32), sk->__sk_common.skc_v6_rcv_saddr.in6_u.u6_addr32);
		bpf_probe_read_kernel(&data.daddr_v4, sizeof(sk->__sk_common.skc_v6_daddr.in6_u.u6_addr32), sk->__sk_common.skc_v6_daddr.in6_u.u6_addr32);
	}

	bpf_get_current_comm(&data.task, sizeof(data.task));
	bpf_perf_event_output(ctx, &events, BPF_F_CURRENT_CPU, &data, sizeof(data));

	// else drop
	return 0;
}

SEC("kprobe/tcp_sendmsg")
int BPF_KPROBE(tcp_sendmsg, struct sock *sk, struct msghdr *msg, size_t size)
{
	u32 pid = bpf_get_current_pid_tgid() >> 32;
	u16 family;
	bpf_probe_read_kernel(&family, sizeof(sk->__sk_common.skc_family), &sk->__sk_common.skc_family);

	struct event data = {};
	data.span_us = 0;
	data.rx_b = 0;
	data.tx_b = (u64)size;
	data.ts_us = 0;
	data.state = -2;
	// a workaround until data compiles with separate lport/dport
	data.ports = bpf_ntohs(BPF_CORE_READ(sk, __sk_common.skc_dport)) + ((0ULL + BPF_CORE_READ(sk, __sk_common.skc_num)) << 32);
	data.pid = pid;

	if (family == AF_INET)
	{
		data.af = AF_INET;
		bpf_probe_read_kernel(&data.saddr_v4, sizeof(sk->__sk_common.skc_rcv_saddr), &sk->__sk_common.skc_rcv_saddr);
		data.daddr_v4 = BPF_CORE_READ_BITFIELD_PROBED(sk, __sk_common.skc_daddr);
	}
	else if (family == AF_INET6)
	{
		data.af = AF_INET6;
		bpf_probe_read_kernel(&data.saddr_v4, sizeof(sk->__sk_common.skc_v6_rcv_saddr.in6_u.u6_addr32), sk->__sk_common.skc_v6_rcv_saddr.in6_u.u6_addr32);
		bpf_probe_read_kernel(&data.daddr_v4, sizeof(sk->__sk_common.skc_v6_daddr.in6_u.u6_addr32), sk->__sk_common.skc_v6_daddr.in6_u.u6_addr32);
	}

	bpf_get_current_comm(&data.task, sizeof(data.task));
	bpf_perf_event_output(ctx, &events, BPF_F_CURRENT_CPU, &data, sizeof(data));

	// else drop
	return 0;
}

char LICENSE[] SEC("license") = "GPL";
