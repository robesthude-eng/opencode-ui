export function handleCustomAuthRoute(req, res, userEmail, loadUserKeys, saveUserKeys, readBody, MAX_JSON_BODY_BYTES) {
  const urlPath = req.url.split("?")[0];
  if (urlPath !== "/api/auth/custom") {
    return false;
  }

  if (req.method === "GET") {
    if (!userEmail) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const keys = loadUserKeys(userEmail);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(Object.keys(keys)));
    return true;
  }
  
  if (req.method === "POST") {
    if (!userEmail) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    readBody(req, MAX_JSON_BODY_BYTES).then(buf => {
      try {
        const { providerId, key } = JSON.parse(buf.toString("utf8") || "{}");
        if (!providerId || !key || !/^[a-zA-Z0-9_-]+$/.test(providerId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid provider ID or key" }));
          return;
        }
        const keys = loadUserKeys(userEmail);
        keys[providerId] = { type: "api", key };
        saveUserKeys(userEmail, keys);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "success" }));
      } catch (_e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    }).catch(() => {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request body too large" }));
    });
    return true;
  }

  if (req.method === "DELETE") {
    if (!userEmail) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    readBody(req, MAX_JSON_BODY_BYTES).then(buf => {
      try {
        const { providerId } = JSON.parse(buf.toString("utf8") || "{}");
        if (!providerId || !/^[a-zA-Z0-9_-]+$/.test(providerId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid provider ID" }));
          return;
        }
        const keys = loadUserKeys(userEmail);
        delete keys[providerId];
        saveUserKeys(userEmail, keys);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "success" }));
      } catch (_e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    }).catch(() => {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request body too large" }));
    });
    return true;
  }
  return false;
}
