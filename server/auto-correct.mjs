import http from "http";
import path from "path";
import fs from "fs";

const SYSTEM_PORT = process.env.OC_SYSTEM_PORT || 4096;

/**
 * Automatically correct TypeScript compilation errors using the local OpenCode model.
 * Calls callback(err, correctedFiles).
 */
export function runAutoCorrection(files, compileErrors, callback) {
  console.log(`[Auto-Correct] Initiating correction request for ${files.length} files...`);

  // Step 1: Create a temporary OpenCode session
  requestJson("POST", "/session", {})
    .then((session) => {
      const sessionId = session.id;
      if (!sessionId) {
        return callback(new Error("OpenCode session creation response did not include session ID."));
      }
      console.log(`[Auto-Correct] Created temp session: ${sessionId}`);

      // Step 2: Construct the self-correction prompt
      const prompt = `You are an expert React/TypeScript debugger.
The following files failed to compile with the listed TypeScript compiler errors.
Please analyze the errors and fix the source code of the affected files so that they compile perfectly.

TS Compiler Errors:
${compileErrors.join("\n")}

Below are the contents of the files with errors.

${files.map(f => `File: ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``).join("\n\n")}

Your response MUST be a JSON object containing the corrected code for ALL the affected files in the following format:
{
  "files": [
    {
      "path": "path/to/file",
      "content": "entire corrected file content"
    }
  ]
}

DO NOT include any explanations, markdown text, or comments outside of the JSON structure. Return ONLY the raw JSON block.`;

      // Step 3: Send message to the temporary session
      console.log("[Auto-Correct] Sending prompt to OpenCode...");
      const messageBody = {
        parts: [{ type: "text", text: prompt }]
      };

      requestJson("POST", `/session/${sessionId}/message`, messageBody)
        .then((message) => {
          // Clean up the session in the background
          requestJson("DELETE", `/session/${sessionId}`, {}).catch(() => {});

          const textPart = message.parts?.find(p => p.type === "text");
          const text = textPart ? textPart.text : "";
          if (!text) {
            return callback(new Error("OpenCode returned an empty response."));
          }

          // Step 4: Parse the corrected files from the JSON response
          try {
            const result = extractJson(text);
            if (!Array.isArray(result.files) || result.files.length === 0) {
              return callback(new Error("Valid JSON parsed, but 'files' array is missing or empty."));
            }
            console.log(`[Auto-Correct] Successfully parsed ${result.files.length} corrected files from OpenCode!`);
            callback(null, result.files);
          } catch (parseErr) {
            callback(new Error(`Failed to parse auto-correction response: ${parseErr.message}\nRaw output: ${text.slice(0, 300)}`));
          }
        })
        .catch((msgErr) => {
          requestJson("DELETE", `/session/${sessionId}`, {}).catch(() => {});
          callback(msgErr);
        });
    })
    .catch((sessErr) => {
      callback(new Error(`Failed to initialize session with OpenCode: ${sessErr.message}`));
    });
}

/**
 * Perform a JSON request to local OpenCode.
 */
function requestJson(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const dataStr = body ? JSON.stringify(body) : "";
    const options = {
      hostname: "127.0.0.1",
      port: SYSTEM_PORT,
      path: endpoint,
      method: method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(dataStr)
      },
      timeout: 60000 // 60 seconds timeout for LLM generation
    };

    const req = http.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(responseBody || "{}"));
          } catch (e) {
            reject(new Error(`Failed to parse JSON response: ${e.message}`));
          }
        } else {
          reject(new Error(`OpenCode returned status ${res.statusCode}: ${responseBody}`));
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request to local OpenCode timed out"));
    });

    if (body) {
      req.write(dataStr);
    }
    req.end();
  });
}

/**
 * Robustly extract JSON from model output.
 */
function extractJson(text) {
  try {
    return JSON.parse(text.trim());
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1].trim());
      } catch (e) {
        throw new Error(`Failed to parse extracted JSON: ${e.message}`);
      }
    }
    throw new Error("No valid JSON structure found in response.");
  }
}
