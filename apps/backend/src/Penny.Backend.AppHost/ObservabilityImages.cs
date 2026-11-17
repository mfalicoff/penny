namespace Penny.Backend.AppHost;

// The local Grafana stack, each image pinned by its multi-platform index digest. Update the
// tag and the digest together.
public static class ObservabilityImages
{
    public static readonly PinnedImage Alloy = new(
        "docker.io",
        "grafana/alloy",
        "v1.22.0",
        "9acc2529bc1edb7f5b2bd801dd8334ebc80c158e3a9e5526ecd7c9a273d43189"
    );

    public static readonly PinnedImage Loki = new(
        "docker.io",
        "grafana/loki",
        "3.7.10",
        "b43c257ccfc925d4a50b8717cac61a3b51df8c48d01847936057e5c4075a24a7"
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
        "v3.16.0",
        "e04987641b57704f408e31f6373ba4138ecf27cb4a165d24aabb6c38fddd0f06"
    );

    public static readonly PinnedImage Grafana = new(
        "docker.io",
        "grafana/grafana",
        "13.3.1",
        "0615ec4fbd4072004b7d86b46ded63013a74b7d6eb1119273dd89e8fa25c13cf"
    );
}
