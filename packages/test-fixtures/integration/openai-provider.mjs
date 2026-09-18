import { createServer } from "node:http";

// The OpenCode server is real; only the paid model provider is replaced.
export async function startCompatibilityProvider() {
  let requests = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests += 1;
    const base = { id: "chatcmpl_fixture", created: 1, model: "fixture" };
    if (input.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const [delta, finish_reason] of [
        [{ role: "assistant", content: "Compatibility probe complete." }, null],
        [{}, "stop"],
      ]) {
        response.write(
          `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      }
      response.end("data: [DONE]\n\n");
    } else {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          ...base,
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Compatibility probe complete." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests: () => requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
