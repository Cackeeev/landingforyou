// Keep the deadline active until the response body has been read, too.
export async function requestJson(url, options = {}, { timeoutMs = 30000, service = 'GitHub' } = {}) {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await fetch(url, { ...options, signal });
    const body = await result.text();
    let data;
    try { data = JSON.parse(body); }
    catch { if (result.ok) throw new Error(service + ' вернул неполный ответ. Повторите попытку.'); }
    return { ok: result.ok, status: result.status, data };
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Отправка остановлена. Черновик сохранён. При повторной попытке проверим, принял ли GitHub изменения.');
    if (controller.signal.aborted) throw new Error(service + ' не ответил за ' + Math.ceil(timeoutMs / 1000) + ' секунд. Черновик сохранён. Проверьте соединение и повторите попытку.');
    if (error instanceof TypeError) throw new Error('Не удалось связаться с ' + service + '. Проверьте соединение и доступность api.github.com в этом браузере. Черновик сохранён.');
    throw error;
  } finally { clearTimeout(timer); }
}
