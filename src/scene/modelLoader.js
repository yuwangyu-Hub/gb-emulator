// 带字节级进度的 GLB 加载：fetch 流式读取 → GLTFLoader.parse
//
// 为什么不用 loader.loadAsync：three 的 onProgress 只在服务端给出
// Content-Length 时才可用，而且拿不到"累计已下载字节"的稳定口径。
// 线上模型是首屏最大的阻塞项（机身 3.6MB + 包装盒 0.6MB），
// 启动遮罩需要真实百分比，所以这里自己读流。

export async function loadGLBWithProgress(loader, url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`模型加载失败 ${res.status} ${url}`);

  const total = Number(res.headers.get('Content-Length')) || 0;
  const chunks = [];
  let loaded = 0;

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (onProgress) onProgress(loaded, total);
    }
  } else {
    // 极老的浏览器没有流式 body，退回一次性读取（进度只有 0 和 100）
    const buf = await res.arrayBuffer();
    loaded = buf.byteLength;
    chunks.push(new Uint8Array(buf));
    if (onProgress) onProgress(loaded, total || loaded);
  }

  // 拼回连续内存：parse 需要一个完整 ArrayBuffer
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }

  return await new Promise((resolve, reject) => {
    loader.parse(bytes.buffer, '', resolve, reject);
  });
}
