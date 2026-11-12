namespace Penny.Backend.AppHost;

// The local Grafana stack, each image pinned by its multi-platform index digest. Update the
// tag and the digest together.
public static class ObservabilityImages
{
    public static readonly PinnedImage Alloy = new(
        "docker.io",
        "grafana/alloy",
        "v1.21.1",
        "4039c971193053a84e53dd9ed3e7d4561c069256b024631cd3498a353ed7ece8"
    );

    public static readonly PinnedImage Loki = new(
        "docker.io",
        "grafana/loki",
        "3.6.19",
        "0f9cbc340cbe33ee498e654075034336962057db072f57b37f253e14d476443a"
    );

    public static readonly PinnedImage Tempo = new(
        "docker.io",
        "grafana/tempo",
        "2.10.10",
        "12b0820f13ffa10ce956b6e9acc3b03f3cffded99109be6cc09d106fe56e5d38"
    );

    public static readonly PinnedImage Prometheus = new(
        "docker.io",
        "prom/prometheus",
        "v3.15.1",
        "fa3302279710be2f21a8301ec17a8b4f2301fd829bd113839b3b6b02b6f191a2"
    );

    public static readonly PinnedImage Grafana = new(
        "docker.io",
        "grafana/grafana",
        "13.2.5",
        "9f7aa1e1e3246aade5792d35a738049f7f32f89cd51d1956cf426a4e86268a84"
    );
}
