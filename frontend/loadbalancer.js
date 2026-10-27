/**
 * Client-side load balancer for ngrok endpoints.
 * Probes all endpoints concurrently, picks the fastest healthy one.
 * Exposes: window.__lbReady (Promise<string|null>)
 */
(function () {
  // 候选公网入口（ngrok 免费域名会轮换，恢复时需更新）
  // ⚠️ 只保留**当前确实指向本机**的域名。ngrok 会把已释放的免费域名回收给别的用户，
  //    旧域名会指向第三方服务器——若被选中，用户粘贴的内容就会被发到别人那里。
  var ENDPOINTS = [
    "https://overbrutal-semiexclusively-wilhemina.ngrok-free.dev",
  ];

  function probeEndpoint(endpoint) {
    var start = performance.now();

    // Strategy 1: cors — 探测 /paste-api/health 并校验返回体确实是本服务
    return fetch(endpoint + "/paste-api/health", {
      method: "GET",
      mode: "cors",
      signal: AbortSignal.timeout(5000),
      headers: { "ngrok-skip-browser-warning": "1" },
    })
      .then(function (res) {
        var latency = performance.now() - start;
        if (!res.ok) return { endpoint: endpoint, healthy: false, latency: Infinity };
        return res.text().then(function (text) {
          // 必须包含 service=paste-any，否则可能是一个碰巧同域名的第三方服务
          var ours = text.indexOf("paste-any") !== -1;
          var bad =
            text.indexOf("ngrok") !== -1 &&
            (text.indexOf("ERR_NGROK") !== -1 || text.indexOf("Tunnel not found") !== -1);
          var healthy = ours && !bad;
          return { endpoint: endpoint, healthy: healthy, latency: healthy ? latency : Infinity };
        });
      })
      .catch(function () {
        // Strategy 2: no-cors fallback — 只能确认可达，**不能**假定它指向本服务
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
