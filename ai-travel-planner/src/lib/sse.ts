/**
 * SSE 服务端工具(v2.0 变更 5 / 需求文档 v2.0 第 10 章)
 *
 * 设计:同一个 POST 请求内流式返回 —— 先推阶段事件,最后推结果。
 * 不引入 taskId 与任务状态表(最简可靠,单实例下无需共享状态)。
 */

export interface ProgressStep {
  seq: number;
  code: string;
  text: string;
  detail?: string;
  /** 0–1,反映**真实耗时占比**的粗粒度进度 */
  progress: number;
}

export type EmitFn = (event: "step", data: ProgressStep) => void;

/** 创建一个 SSE Response */
export function createSseResponse(
  handler: (emit: EmitFn, sendResult: (data: unknown) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let seq = 0;
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));

      const emit: EmitFn = (event, data) => {
        seq = Math.max(seq, data.seq);
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const sendResult = (data: unknown) => {
        write(`event: result\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // 心跳:防中间层因空闲断连(需求文档 v2.0 第 10.2 节)
      const heartbeat = setInterval(() => {
        try {
          write(": ping\n\n");
        } catch {
          /* 已关闭 */
        }
      }, 15_000);

      try {
        await handler(emit, sendResult);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        write(
          `event: error\ndata: ${JSON.stringify({ ok: false, error: message, retryable: true })}\n\n`,
        );
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 明确告诉 nginx / 各类反代不要缓冲,否则阶段事件会一次性到达,失去意义
      "X-Accel-Buffering": "no",
    },
  });
}

/** 构造一个阶段发射器,自动递增 seq 并按序号估算 progress */
export function createStepEmitter(emit: EmitFn, totalSteps: number) {
  let seq = 0;
  return (code: string, text: string, detail?: string, progressOverride?: number) => {
    seq += 1;
    emit("step", {
      seq,
      code,
      text,
      detail,
      progress: progressOverride ?? Math.min(0.98, seq / totalSteps),
    });
  };
}
