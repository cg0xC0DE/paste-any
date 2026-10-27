/**
 * Client-side load balancer for ngrok endpoints.
 * Probes all endpoints concurrently, picks the fastest healthy one.
 * Exposes: window.__lbReady (Promise<string|null>)
 */
(function () {
  // 候选公网入口（ngrok 免费域名会轮换，恢复时需更新）
  var ENDPOINTS = [
    "https://overbrutal-semiexclusively-wilhemina.ngrok-free.dev",
    "https://illaudable-roseanna-unsobering.ngrok-free.dev",
    "https://dentiled-gennie-stichometrical.ngrok-free.dev",
  ];

  function probeEndpoint(endpoint) {
    var start = performance.now();

    // Strategy 1: cors — full signal (status + body check)
    return fetch(endpoint, {
      method: "GET",
      mode: "cors",
      signal: AbortSignal.timeout(5000),
      headers: { "ngrok-skip-browser-warning": "1" },
    })
      .then(function (res) {
        var latency = performance.now() - start;
        if (!res.ok) return { endpoint: endpoint, healthy: false, latency: Infinity };
        return res.text().then(function (text) {
          var bad =
            text.indexOf("ngrok") !== -1 &&
            (text.indexOf("ERR_NGROK") !== -1 || text.indexOf("Tunnel not found") !== -1);
          return { endpoint: endpoint, healthy: !bad, latency: bad ? Infinity : latency };
        });
      })
      .catch(function () {
        // Strategy 2: no-cors fallback — check reachability but don't assume healthy
        return fetch(endpoint, {
          method: "HEAD",
          mode: "no-cors",
          signal: AbortSignal.timeout(5000),
        })
          .then(function () {
            return { endpoint: endpoint, healthy: false, latency: Infinity };
          })
          .catch(function () {
            return { endpoint: endpoint, healthy: false, latency: Infinity };
          });
      });
  }

  window.__lbReady = Promise.allSettled(ENDPOINTS.map(probeEndpoint)).then(function (results) {
    var probes = results.map(function (r) {
      return r.status === "fulfilled" ? r.value : { endpoint: "", healthy: false, latency: Infinity };
    });
    probes.sort(function (a, b) {
      return a.latency - b.latency;
    });
    var best = null;
    for (var i = 0; i < probes.length; i++) {
      if (probes[i].healthy) {
        best = probes[i].endpoint;
        break;
      }
    }
    console.log("[LB] best:", best, probes);
    return best;
  });
})();
